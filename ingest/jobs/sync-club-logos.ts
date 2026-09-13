/**
 * Kopiowanie znakow klubow do wlasnego Storage.
 *
 *   npm run ingest:loga
 *   npm run ingest:loga -- --sucho     pobiera i sprawdza, NIC nie zapisuje
 *
 * ---------------------------------------------------------------------
 * PO CO. Pawel poprosil o odroznianie partii logiem. Pierwsza odpowiedz
 * brzmiala „nie da sie uczciwie" — bo `clubs.logo_url` jest puste dla
 * wszystkich trzynastu klubow, wiec znak trzeba by wziac skadinad.
 *
 * Byla bledna. Specyfikacja OpenAPI Sejm API wymienia
 * `/sejm/term{term}/clubs/{id}/logo`, a endpoint dziala: jedenascie z dwunastu
 * klubow zwraca `image/jpeg` o wielkosci 1,9–7,3 kB (zmierzone 13.09.2026).
 * Znak ma wiec to samo zrodlo co zdjecie posla i moze przy nim stanac
 * odnosnik do rejestru.
 *
 * ---------------------------------------------------------------------
 * TRZY RZECZY, KTORE TEN SKRYPT ROBI SPECJALNIE.
 *
 * 1. ZEROWA DLUGOSC TO NIE AWARIA. `niez.` (poslowie niezrzeszeni) zwraca
 *    `200` z pustym cialem — nie sa partia i nie maja znaku. Gdyby skrypt
 *    liczyl to jako blad, co noc zglaszalby awarie, ktorej nie ma.
 *    Rozroznienie jest jawne i raportowane osobno.
 *
 * 2. SPRAWDZAMY BAJTY, NIE NAGLOWEK — tak samo jak przy zdjeciach. Gdyby
 *    pod tym adresem pojawila sie kiedys strona bledu ze statusem 200,
 *    zapisalibysmy HTML jako `.jpg`.
 *
 * 3. SUMA KONTROLNA I ZAPIS TYLKO PRZY ROZNICY. Znak partii zmienia sie
 *    rzadziej niz zdjecie posla, wiec bez tego co noc nadpisywalibysmy
 *    trzynascie identycznych plikow i resetowali cache przegladarkom.
 *
 * Trzynascie klubow to trzynascie zadan, wiec nie ma tu ani puli
 * rownoleglosci, ani rotacji — caly zbior miesci sie w jednym przebiegu.
 */

import { createHash } from 'node:crypto';

import { db } from '../lib/db.js';
import { writeCursor } from '../lib/source-recorder.js';
import { getBuffer } from '../lib/http.js';
import { assertSchema, WYMOGI_LOGA } from '../lib/preflight.js';

const KUBELEK = 'loga';
const TERM = 10;
const LIMIT_CZASU_MS = 30_000;

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** JPEG zaczyna sie od FF D8 FF, PNG od 89 50 4E 47. Kubelek przyjmuje tylko te dwa. */
function rozpoznajObraz(buf: Buffer): 'image/jpeg' | 'image/png' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  return null;
}

type Klub = { id: string; logo_sha256: string | null };

async function main() {
  const sucho = process.argv.includes('--sucho') || process.argv.includes('--dry');

  await assertSchema(WYMOGI_LOGA);

  const { data, error } = await db().from('clubs').select('id, logo_sha256').order('id');
  if (error) throw new Error(`clubs.select: ${error.message}`);

  const kluby = (data ?? []) as Klub[];
  if (!kluby.length) {
    console.log('Brak klubow w bazie — uruchom najpierw ingest:mps.');
    return;
  }

  console.log(`Kluby do sprawdzenia: ${kluby.length}.`);
  if (sucho) console.log('--sucho: niczego nie zapiszemy.');
  console.log('');

  let bezZmian = 0;
  let zapisane = 0;
  const bezZnaku: string[] = [];
  const nieObrazy: string[] = [];
  const bledy: string[] = [];

  for (const k of kluby) {
    try {
      const url = `https://api.sejm.gov.pl/sejm/term${TERM}/clubs/${encodeURIComponent(k.id)}/logo`;
      const { buffer } = await getBuffer(url, { timeoutMs: LIMIT_CZASU_MS, retries: 2 });

      /*
        PUSTA ODPOWIEDZ = KLUB NIE MA ZNAKU. Patrz punkt 1 w naglowku.
        Nie dotykamy zadnej kolumny: `logo_stored_url` zostaje NULL i to
        jest poprawny, docelowy stan dla tego wiersza.
      */
      if (buffer.length === 0) {
        bezZnaku.push(k.id);
        continue;
      }

      const typ = rozpoznajObraz(buffer);
      if (!typ) {
        nieObrazy.push(`  ${k.id}: ${buffer.length} B, pierwsze bajty ${buffer.subarray(0, 4).toString('hex')}`);
        continue;
      }

      const suma = sha256(buffer);
      if (k.logo_sha256 === suma) {
        bezZmian++;
        continue;
      }

      if (sucho) {
        zapisane++;
        continue;
      }

      // Nazwa pliku z `encodeURIComponent`, bo identyfikatory klubow zawieraja
      // kropke (`niez.`) i podkreslenie (`Konfederacja_KP`).
      const sciezka = `klub/${encodeURIComponent(k.id)}.${typ === 'image/png' ? 'png' : 'jpg'}`;
      const up = await db().storage.from(KUBELEK).upload(sciezka, buffer, {
        contentType: typ,
        upsert: true,
        cacheControl: '604800', // 7 dni — znak partii nie zmienia sie w trakcie kadencji
      });
      if (up.error) throw new Error(`upload: ${up.error.message}`);

      const publiczny = db().storage.from(KUBELEK).getPublicUrl(sciezka).data.publicUrl;

      // UPDATE ... eq('id'), nie upsert — `upsert` w PostgREST to
      // INSERT ... ON CONFLICT, wiec Postgres walidowalby cala krotke
      // (CLAUDE.md §7.7), a my mamy tu trzy kolumny z dwunastu.
      const zapis = await db()
        .from('clubs')
        .update({ logo_stored_url: publiczny, logo_stored_at: new Date().toISOString(), logo_sha256: suma })
        .eq('id', k.id);
      if (zapis.error) throw new Error(`clubs.update: ${zapis.error.message}`);

      zapisane++;
    } catch (e) {
      bledy.push(`  ${k.id}: ${(e as Error).message}`);
    }
  }

  console.log(
    `zapisane: ${zapisane} · bez zmian: ${bezZmian} · bez znaku: ${bezZnaku.length} · ` +
      `nie-obraz: ${nieObrazy.length} · błędy: ${bledy.length}`,
  );

  if (bezZnaku.length) {
    console.log('');
    console.log(`Kluby bez znaku w rejestrze (to NIE jest błąd): ${bezZnaku.join(', ')}`);
  }

  if (nieObrazy.length) {
    console.log('');
    console.log(`UWAGA: ${nieObrazy.length} odpowiedzi nie było obrazem. Kopie zostawiono nietknięte:`);
    console.log(nieObrazy.join('\n'));
  }

  if (bledy.length) {
    console.log('');
    console.log(`${bledy.length} klubów nie udało się pobrać:`);
    console.log(bledy.join('\n'));
  }

  /*
    Ten sam wzorzec co przy zdjeciach: pojedyncze niepowodzenie to nie awaria,
    ale komplet niepowodzen w kroku, ktorego nikt nie czyta, musi zapalic
    czerwone swiatlo w Actions.
  */
  if (bledy.length && bledy.length === kluby.length) {
    console.log('');
    console.log(`::error::Nie udalo sie pobrac ANI JEDNEGO loga (${bledy.length}/${kluby.length}).`);
    process.exitCode = 1;
  }
  /*
    ZAPIS STANU IMPORTU. Bez tego /status nie ma skad wiedziec, czy ten krok
    w ogole chodzil — dokladnie tak, jak przez wiele tygodni milczal o procesach
    legislacyjnych (naprawione rano 13.09.2026, migracja 0028). Ten sam blad
    powtorzyl sie w trzech zadaniach naraz, wiec zapisujemy stan w kazdym.

    Stoi na KONCU, po kontroli koncowej: import, ktory sie wywrocil, nie ma
    prawa zapisac sie jako udany.
  */
  /*
    CALKOWITA AWARIA ZAPISUJE SIE JAKO AWARIA, nie jako sukces.
    Pierwsza wersja tej linii stala PO bloku ustawiajacym `exitCode = 1`
    i mimo to zapisywala `error: null` — /status pokazalby wtedy
    swieza date przy imporcie, ktory nie pobral niczego. Dokladnie
    ten rodzaj cichego klamstwa, ktory naprawiamy od rana.
  */
  await writeCursor('logos', {
    cursorAt: new Date().toISOString(),
    error: process.exitCode === 1 ? 'import nie pobral ani jednej pozycji' : null,
  });

}

main().catch(async (e) => {
  const msg = (e as Error).message;
  console.error(`\n${msg}`);
  // Blad tez trafia do sync_state — inaczej /status pokazywalby date
  // ostatniego UDANEGO przebiegu jako date ostatniego przebiegu w ogole.
  await writeCursor('logos', { error: msg }).catch(() => {});
  process.exit(1);
});
