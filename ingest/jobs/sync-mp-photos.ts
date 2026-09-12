/**
 * Kopiowanie zdjęć posłów do własnego Storage.
 *
 *   npm run ingest:zdjecia                 wszystkie brakujące + odświeżenie 17
 *   npm run ingest:zdjecia -- --ile=20     tylko pierwsze N (do sprawdzenia)
 *   npm run ingest:zdjecia -- --sucho      pobiera i sprawdza, NIC nie zapisuje
 *   npm run ingest:zdjecia -- --rownolegle=2   łagodniej dla serwera Sejmu
 *   npm run ingest:zdjecia -- --odswiez=0  sam dokopiuje, bez odświeżania
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
 *
 * ---------------------------------------------------------------------
 * DRUGI ETAP: ODŚWIEŻANIE KROCZĄCE (P0-4, migracja 0027).
 *
 * Do 12.09.2026 kopia była jednorazowa. `photo_stored_at` miało w 0023
 * komentarz „służy do odświeżania", a żaden mechanizm odświeżania nie
 * istniał — komentarz opisywał zamiar, nie kod.
 *
 * Po dokopiowaniu brakujących bierzemy **17 najstarszych kopii** i sprawdzamy,
 * czy plik u źródła to nadal ten sam plik. 17 = ceil(499 / 30), czyli każde
 * zdjęcie wraca raz na około trzydzieści dni — w tym samym rytmie co kontrola
 * HEAD w `sync-mps`. Koszt: ~17 pobrań × ~2 s = około pół minuty na dobę.
 *
 * DLACZEGO SUMA KONTROLNA, A NIE NAGŁÓWEK. Odpowiedź Sejm API nie ma ani
 * `ETag`, ani `Last-Modified`, ani `Cache-Control` (zmierzone 11.09.2026).
 * Nie ma czego porównać bez pobrania pliku — a skoro i tak go pobieramy,
 * sha256 pozwala przynajmniej NIE zapisywać go z powrotem do Storage,
 * gdy nic się nie zmieniło.
 *
 * DWIE PUŁAPKI, KTÓRE TEN ETAP MUSI ROZRÓŻNIAĆ.
 *
 *   „Zdjęcie się zmieniło" i „serwer zwrócił coś, co nie jest obrazem"
 *   wyglądają w kodzie tak samo: inne bajty, inna suma. Różnią się skutkiem.
 *   Pierwsze ma nadpisać kopię, drugie nie ma prawa jej dotknąć — inaczej
 *   jedna strona błędu ze statusem 200 zamieniłaby portret posła w śmieć,
 *   a stara, dobra kopia zniknęłaby bezpowrotnie. Dlatego kontrola magic
 *   bytes działa w tym etapie tak samo jak przy kopiowaniu, a plik
 *   nierozpoznany zostawia WSZYSTKO bez zmian: i kopię, i sumę, i datę.
 *
 *   Konsekwencja jest zamierzona: taki poseł wraca w rotacji następnej nocy
 *   i zgłasza się tak długo, aż ktoś to obejrzy. Cichnięcie byłoby gorsze.
 *
 * Data kontroli przesuwa się natomiast ZAWSZE, gdy plik był obrazem — także
 * wtedy, gdy nic się nie zmieniło. Bez tego te same 17 zdjęć byłoby
 * najstarsze w nieskończoność i rotacja nigdy by nie ruszyła.
 */

import { createHash } from 'node:crypto';

import { db } from '../lib/db.js';
import { getBuffer } from '../lib/http.js';
import { assertSchema, WYMOGI_ZDJECIA } from '../lib/preflight.js';

const KUBELEK = 'portrety';

/** Zmierzony najgorszy przypadek to 58,8 s — bierzemy dwukrotny zapas. */
const LIMIT_CZASU_MS = 120_000;

/**
 * Ile kopii sprawdzamy na jedno uruchomienie.
 *
 * ceil(499 / 30) = 17 — każde zdjęcie wraca raz na około trzydzieści dni,
 * czyli w tym samym rytmie co kontrola HEAD w `sync-mps`. Jedna kadencja,
 * jeden cykl, jedna liczba do zapamiętania.
 */
const ODSWIEZ_DOMYSLNIE = 17;

/** Ta sama postać, której pilnuje ograniczenie mps_photo_sha256_hex (0027). */
function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

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
type Opcje = { sucho: boolean; rownolegle: number };

async function main() {
  const sucho = process.argv.includes('--sucho') || process.argv.includes('--dry');
  const limit = Number(flaga('ile') ?? 0) || 0;
  const rownolegle = Math.max(1, Number(flaga('rownolegle') ?? 4) || 4);

  // Brak flagi znaczy „domyslnie 17", a nie „nie odswiezaj". Nocny cron
  // uruchamia ten skrypt bez argumentow i to wlasnie on ma rotowac kopie —
  // gdyby odswiezanie wymagalo flagi, trzeba by pamietac o zmianie workflow,
  // a zapomnienie nie daloby zadnego sygnalu.
  const surowe = flaga('odswiez');
  const odswiez = surowe === undefined ? ODSWIEZ_DOMYSLNIE : Math.max(0, Number(surowe) || 0);

  // Wzorzec z CLAUDE.md §7.5. Bez tego brak migracji 0023 daje surowe
  // "column mps.photo_stored_url does not exist" zamiast instrukcji, ktora
  // migracje uruchomic — a po to preflight w ogole powstal.
  await assertSchema(WYMOGI_ZDJECIA);

  await kopiujBrakujace({ sucho, rownolegle }, limit);

  // Odswiezanie idzie PO kopiowaniu i jest od niego niezalezne: gdy nie ma
  // czego kopiowac (stan normalny od 11.09.2026), to ten etap jest jedyna
  // praca, jaka skrypt wykonuje.
  if (odswiez > 0) await odswiezNajstarsze({ sucho, rownolegle }, odswiez);
}

async function kopiujBrakujace({ sucho, rownolegle }: Opcje, limit: number) {
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

  /*
    KOD WYJSCIA PRZY CALKOWITEJ AWARII.

    Bledy pojedynczych zdjec sa łapane w petli i tylko raportowane — to jest
    sluszne, bo jedno niedostepne zdjecie nie ma prawa przerwac importu
    pozostalych 498. Ale od 12.09.2026 ten skrypt siedzi w nocnym cronie
    i nikt jego wyniku nie czyta. Gdyby Sejm API bylo niedostepne przez cala
    noc, krok w Actions swiecilby na zielono przy 499 niepowodzeniach.

    Wzorzec "raportuj, nie przerywaj" (§7.2) dotyczy nieznanych wartosci
    slownika, a nie awarii pobierania — to sa dwie rozne rzeczy.
  */
  if (bledy.length && bledy.length === doZrobienia.length) {
    console.log('');
    console.log(`::error::Nie udalo sie skopiowac ANI JEDNEGO zdjecia (${bledy.length}/${doZrobienia.length}).`);
    process.exitCode = 1;
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

type Kopia = { id: number; slug: string; photo_url: string; photo_sha256: string | null };

/**
 * Sprawdza N najstarszych kopii i nadpisuje WYŁĄCZNIE te, które naprawdę
 * się zmieniły. Uzasadnienie rytmu i pułapek — w nagłówku pliku.
 */
async function odswiezNajstarsze({ sucho, rownolegle }: Opcje, ile: number) {
  /*
    `nullsFirst: true` nie jest ozdobą. Po migracji 0027 wszystkie 499 kopii
    ma `photo_sha256 = null`, a część może mieć puste `photo_stored_at`
    (kopie sprzed 0023 zapisywały sam adres). Te wiersze są NAJSTARSZE
    z definicji — nie wiemy o nich nic — więc mają iść pierwsze, a nie
    wylądować na końcu kolejki, gdzie nie trafi na nie nikt.
  */
  const { data, error } = await db()
    .from('mps')
    .select('id, slug, photo_url, photo_sha256')
    .eq('photo_exists', true)
    .not('photo_stored_url', 'is', null)
    .order('photo_stored_at', { ascending: true, nullsFirst: true })
    .limit(ile);
  if (error) throw new Error(`mps.select (odswiezanie): ${error.message}`);

  const doSprawdzenia = (data ?? []) as Kopia[];
  if (!doSprawdzenia.length) {
    console.log('');
    console.log('Odświeżanie: nie ma jeszcze ani jednej kopii do sprawdzenia.');
    return;
  }

  console.log('');
  console.log(`Odświeżanie: sprawdzam ${doSprawdzenia.length} najstarszych kopii.`);
  if (sucho) console.log('--sucho: niczego nie zapiszemy.');

  const start = Date.now();
  let bezZmian = 0;
  let pierwszyPomiar = 0;
  const zmienione: string[] = [];
  const nieObrazy: string[] = [];
  const bledy: string[] = [];

  let kursor = 0;
  const pracownik = async () => {
    for (;;) {
      const i = kursor++;
      if (i >= doSprawdzenia.length) return;
      const m = doSprawdzenia[i]!;

      try {
        const { buffer } = await getBuffer(m.photo_url, { timeoutMs: LIMIT_CZASU_MS, retries: 2 });
        const typ = rozpoznajObraz(buffer);

        /*
          NIE-OBRAZ NIE DOTYKA NICZEGO. Ani Storage, ani sumy, ani daty.
          Strona błędu ze statusem 200 ma inne bajty niż portret, więc bez
          tej kontroli wyglądałaby jak „zdjęcie się zmieniło" i nadpisałaby
          dobrą kopię śmieciem — bezpowrotnie, bo źródła już nie ma.
          Data zostaje stara celowo: ten poseł wróci jutro i będzie się
          zgłaszał, dopóki ktoś tego nie obejrzy.
        */
        if (!typ) {
          nieObrazy.push(`  ${m.slug} (id ${m.id}): ${buffer.length} B, pierwsze bajty ${buffer.subarray(0, 4).toString('hex')}`);
          continue;
        }

        const suma = sha256(buffer);
        const bylo = m.photo_sha256;
        const zmiana = bylo !== null && bylo !== suma;

        if (zmiana) {
          zmienione.push(`  ${m.slug} (id ${m.id}): ${bylo.slice(0, 12)}… -> ${suma.slice(0, 12)}…`);
        } else if (bylo === null) {
          pierwszyPomiar++;
        } else {
          bezZmian++;
        }

        if (sucho) continue;

        // Do Storage piszemy TYLKO przy realnej różnicy. Przy pierwszym
        // pomiarze plik u nas jest już tym plikiem — zapisalibyśmy bajt
        // w bajt to samo i zresetowali cache przeglądarkom bez powodu.
        if (zmiana) {
          const sciezka = `mp/${m.id}.${typ === 'image/png' ? 'png' : 'jpg'}`;
          const up = await db().storage.from(KUBELEK).upload(sciezka, buffer, {
            contentType: typ,
            upsert: true,
            cacheControl: '604800',
          });
          if (up.error) throw new Error(`upload: ${up.error.message}`);
        }

        /*
          DATA PRZESUWA SIĘ ZAWSZE, gdy plik był obrazem — także bez zmiany.
          Gdyby przesuwała się wyłącznie przy różnicy, te same 17 zdjęć byłoby
          najstarsze w nieskończoność i rotacja nigdy by nie ruszyła.
          `photo_stored_url` nie zmieniamy: ścieżka w Storage jest ta sama.
          UPDATE ... eq('id'), nie upsert — patrz nagłówek pliku.
        */
        const zapis = await db()
          .from('mps')
          .update({ photo_sha256: suma, photo_stored_at: new Date().toISOString() })
          .eq('id', m.id);
        if (zapis.error) throw new Error(`mps.update: ${zapis.error.message}`);
      } catch (e) {
        bledy.push(`  ${m.slug} (id ${m.id}): ${(e as Error).message}`);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(rownolegle, doSprawdzenia.length) }, pracownik));

  const sek = ((Date.now() - start) / 1000).toFixed(1);
  console.log(
    `  bez zmian: ${bezZmian} · zważone pierwszy raz: ${pierwszyPomiar} · ` +
      `zmienione: ${zmienione.length} · nie-obraz: ${nieObrazy.length} · błędy: ${bledy.length} · ${sek} s`,
  );

  /*
    ZMIANA ZDJĘCIA JEST SYGNAŁEM, NIE SZUMEM. Portret posła nie zmienia się
    w trakcie kadencji przypadkiem — jeśli się zmienił, ktoś go u źródła
    podmienił i warto o tym wiedzieć. Do 0027 nie mielibyśmy o tym pojęcia.
  */
  if (zmienione.length) {
    console.log('');
    console.log(`ZDJĘCIA ZMIENIONE U ŹRÓDŁA (${zmienione.length}) — kopie nadpisane:`);
    console.log(zmienione.join('\n'));
  }

  if (nieObrazy.length) {
    console.log('');
    console.log(`UWAGA: ${nieObrazy.length} odpowiedzi NIE było obrazem. Kopie zostawiono NIETKNIĘTE:`);
    console.log(nieObrazy.slice(0, 10).join('\n'));
    console.log('Te wiersze wrócą w rotacji następnym razem, bo data kontroli się nie przesunęła.');
  }

  if (bledy.length) {
    console.log('');
    console.log(`${bledy.length} kopii nie udało się sprawdzić:`);
    console.log(bledy.slice(0, 10).join('\n'));
  }

  /*
    Ten sam wzorzec co przy kopiowaniu: pojedyncze niepowodzenie to nie
    awaria, ale komplet niepowodzeń w kroku, którego nikt nie czyta, musi
    zapalić czerwone światło w Actions.
  */
  if (bledy.length && bledy.length === doSprawdzenia.length) {
    console.log('');
    console.log(`::error::Nie udalo sie sprawdzic ANI JEDNEJ kopii (${bledy.length}/${doSprawdzenia.length}).`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(`\n${(e as Error).message}`);
  process.exit(1);
});
