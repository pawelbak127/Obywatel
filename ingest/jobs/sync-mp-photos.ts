/**
 * Kopiowanie zdjęć posłów do własnego Storage.
 *
 *   npm run ingest:zdjecia                 wszystkie brakujące
 *   npm run ingest:zdjecia -- --ile=20     tylko pierwsze N (do sprawdzenia)
 *   npm run ingest:zdjecia -- --sucho      pobiera i sprawdza, NIC nie zapisuje
 *   npm run ingest:zdjecia -- --rownolegle=2   łagodniej dla serwera Sejmu
 *
 * ---------------------------------------------------------------------
 * PO CO. Zmierzone 11.09.2026 na `api.sejm.gov.pl/.../MP/{id}/photo`:
 * pliki ważą 4–17 kB, a czas do pierwszego bajtu wynosi od 11 do 59 sekund
 * i rośnie z każdym kolejnym żądaniem. Odpowiedź nie ma ŻADNEGO nagłówka
 * cache — ani `Cache-Control`, ani `ETag`, ani `Last-Modified` — więc
 * przeglądarka pobiera każdy portret od nowa przy każdym wejściu na listę.
 * Sześćdziesiąt wierszy to sześćdziesiąt takich żądań.
 *
 * Kopiujemy więc raz do siebie. Przy okazji przestajemy obciążać serwer
 * Kancelarii Sejmu ruchem czytelników — co `next.config.ts` deklarował
 * od Sprintu 3, choć nigdy nie zostało zrobione.
 *
 * ---------------------------------------------------------------------
 * TRZY RZECZY, KTÓRE TEN SKRYPT ROBI INACZEJ, NIŻ WYGLĄDA NA POTRZEBNE.
 *
 * 1. DŁUGI LIMIT CZASU. Domyślne 30 s z `ingest/lib/http.ts` jest tu za mało:
 *    zmierzony najgorszy przypadek to 58,8 s. Skrypt z domyślnym limitem
 *    zgłaszałby „błąd sieci" przy zdjęciach, które po prostu przychodzą wolno.
 *
 * 2. SPRAWDZAMY BAJTY, NIE NAGŁÓWEK. `Content-Type` mówi, co serwer twierdzi,
 *    że wysłał. Gdyby pod tym adresem pojawiła się kiedyś strona błędu ze
 *    statusem 200, zapisalibyśmy HTML jako `.jpg` i pokazali 499 zepsutych
 *    obrazków. Pierwsze bajty pliku rozstrzygają to jednoznacznie.
 *
 * 3. ZAPIS PRZEZ `UPDATE ... eq('id')`, nie `upsert`. Pułapka opisana
 *    w HANDOFF §3.4: `upsert` w PostgREST to `INSERT ... ON CONFLICT`,
 *    więc Postgres waliduje krotkę ZANIM dojdzie do konfliktu — a my mamy
 *    tu tylko dwie kolumny z kilkunastu wymaganych.
 *
 * Skrypt jest wznawialny: bierze wyłącznie posłów z pustym `photo_stored_url`,
 * więc przerwany w połowie dokańcza resztę przy następnym uruchomieniu.
 */

import { db } from '../lib/db.js';
import { getBuffer } from '../lib/http.js';

const KUBELEK = 'portrety';

/** Zmierzony najgorszy przypadek to 58,8 s — bierzemy dwukrotny zapas. */
const LIMIT_CZASU_MS = 120_000;

function flaga(nazwa: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${nazwa}=`))?.split('=')[1];
}

/**
 * Rozpoznanie formatu z pierwszych bajtów.
 *
 * JPEG zaczyna się od FF D8 FF, PNG od 89 50 4E 47. Nic innego nas nie
 * interesuje — kubełek i tak przyjmuje wyłącznie te dwa typy (migracja 0023),
 * więc plik nierozpoznany lepiej zgłosić, niż wysłać i dostać odmowę.
 */
function rozpoznajObraz(buf: Buffer): 'image/jpeg' | 'image/png' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  return null;
}

type Poseł = { id: number; slug: string; photo_url: string };

async function main() {
  const sucho = process.argv.includes('--sucho') || process.argv.includes('--dry');
  const limit = Number(flaga('ile') ?? 0) || 0;
  const rownolegle = Math.max(1, Number(flaga('rownolegle') ?? 4) || 4);

  // Bierzemy TYLKO tych, u których HEAD potwierdził, że zdjęcie istnieje
  // (migracja 0018). Adresu bez potwierdzenia nie ma po co pobierać.
  let q = db()
    .from('mps')
    .select('id, slug, photo_url')
    .eq('photo_exists', true)
    .is('photo_stored_url', null)
    .order('id', { ascending: true });
  if (limit) q = q.limit(limit);

  const { data, error } = await q;
  if (error) throw new Error(`mps.select: ${error.message}`);

  const doZrobienia = (data ?? []) as Poseł[];
  if (!doZrobienia.length) {
    console.log('Nie ma czego kopiować — wszystkie zdjęcia są już u nas.');
    return;
  }

  console.log(`Do skopiowania: ${doZrobienia.length} zdjęć, równolegle ${rownolegle}.`);
  console.log(`Limit czasu na zdjęcie: ${LIMIT_CZASU_MS / 1000} s (zmierzony najgorszy przypadek: 58,8 s).`);
  if (sucho) console.log('--sucho: niczego nie zapiszemy.');
  console.log('');

  const start = Date.now();
  let gotowe = 0;
  let skopiowane = 0;
  const bledy: string[] = [];
  const nieObrazy: string[] = [];
  let sumaBajtow = 0;

  /*
    Wlasna pula zamiast `mapLimit` z http.ts — tam rownoleglosc jest globalna
    i wspolna dla wszystkich importow. Tutaj chcemy ja MNIEJSZA niz domyslne 8,
    bo serwer Sejmu przy piatym zadaniu z rzedu odpowiada piec razy wolniej niz
    przy pierwszym. Mniej rownoleglosci bywa tu szybsze, a na pewno uprzejmiejsze.
  */
  let kursor = 0;
  const pracownik = async () => {
    for (;;) {
      const i = kursor++;
      if (i >= doZrobienia.length) return;
      const m = doZrobienia[i]!;

      try {
        const { buffer } = await getBuffer(m.photo_url, { timeoutMs: LIMIT_CZASU_MS, retries: 2 });
        const typ = rozpoznajObraz(buffer);

        if (!typ) {
          // Nie przerywamy calego importu — raportujemy i idziemy dalej.
          // Ten sam wzorzec co przy nieznanych typach etapu w sync-processes.
          nieObrazy.push(`  ${m.slug} (id ${m.id}): ${buffer.length} B, pierwsze bajty ${buffer.subarray(0, 4).toString('hex')}`);
          continue;
        }

        sumaBajtow += buffer.length;
        const sciezka = `mp/${m.id}.${typ === 'image/png' ? 'png' : 'jpg'}`;

        if (!sucho) {
          const up = await db().storage.from(KUBELEK).upload(sciezka, buffer, {
            contentType: typ,
            upsert: true, // ponowne uruchomienie ma nadpisac, a nie wywalic sie
            cacheControl: '604800', // 7 dni — zdjecie posla nie zmienia sie w trakcie kadencji
          });
          if (up.error) throw new Error(`upload: ${up.error.message}`);

          const publiczny = db().storage.from(KUBELEK).getPublicUrl(sciezka).data.publicUrl;

          // UPDATE, nie upsert — patrz naglowek pliku.
          const zapis = await db()
            .from('mps')
            .update({ photo_stored_url: publiczny, photo_stored_at: new Date().toISOString() })
            .eq('id', m.id);
          if (zapis.error) throw new Error(`mps.update: ${zapis.error.message}`);
        }

        skopiowane++;
      } catch (e) {
        bledy.push(`  ${m.slug} (id ${m.id}): ${(e as Error).message}`);
      } finally {
        gotowe++;
        if (gotowe % 10 === 0 || gotowe === doZrobienia.length) {
          const sek = (Date.now() - start) / 1000;
          const naSztuke = sek / gotowe;
          const zostalo = Math.round((doZrobienia.length - gotowe) * naSztuke);
          process.stdout.write(
            `\r  ${gotowe}/${doZrobienia.length}  (${naSztuke.toFixed(1)} s/zdjęcie, zostało ~${Math.round(zostalo / 60)} min)   `,
          );
        }
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(rownolegle, doZrobienia.length) }, pracownik));
  process.stdout.write('\n\n');

  const minuty = ((Date.now() - start) / 60000).toFixed(1);
  console.log(`Skopiowane:     ${skopiowane}/${doZrobienia.length}`);
  console.log(`Łącznie bajtów: ${(sumaBajtow / 1024 / 1024).toFixed(1)} MB`);
  console.log(`Czas:           ${minuty} min`);

  if (nieObrazy.length) {
    console.log('');
    console.log(`UWAGA: ${nieObrazy.length} odpowiedzi NIE było obrazem — nie zapisano ich:`);
    console.log(nieObrazy.slice(0, 10).join('\n'));
    console.log('Sprawdź te adresy ręcznie. photo_exists mówi, że HEAD zwrócił 200.');
  }

  if (bledy.length) {
    console.log('');
    console.log(`${bledy.length} zdjęć nie udało się pobrać:`);
    console.log(bledy.slice(0, 10).join('\n'));
    console.log('Uruchom ponownie — skrypt bierze tylko te, których jeszcze nie ma.');
  }

  if (!sucho) {
    const { count, error: e2 } = await db()
      .from('mps')
      .select('id', { count: 'exact', head: true })
      .eq('photo_exists', true)
      .is('photo_stored_url', null);
    if (e2) throw new Error(`kontrola: ${e2.message}`);
    console.log('');
    console.log(`Zostało do skopiowania: ${count}`);
  }
}

main().catch((e) => {
  console.error(`\n${(e as Error).message}`);
  process.exit(1);
});
