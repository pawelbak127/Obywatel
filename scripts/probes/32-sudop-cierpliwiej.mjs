/**
 * Sonda 32 — SUDOP z cierpliwością, jakiej wymaga sam Urząd.
 *
 *   node scripts/probes/32-sudop-cierpliwiej.mjs --tylko-spec
 *   node scripts/probes/32-sudop-cierpliwiej.mjs --pelna
 *
 * ---------------------------------------------------------------------
 * TA SONDA NIE URUCHAMIA SIĘ SAMA I NIE MA SKRÓTU W `package.json`.
 * Wymaga jawnej flagi. Powód jest w D13 i w liście UOKiK: urząd napisał,
 * że ruch **przekracza jego możliwości infrastrukturalne**. Każde wyszukanie
 * zajmuje miejsce w kolejce, w której stoją też inni.
 *
 * ---------------------------------------------------------------------
 * CO POPRAWIA WOBEC SONDY 29 — i dlaczego to nie jest drobiazg.
 *
 * Sonda 29 odpytywała jeden identyfikator przez SZEŚĆ MINUT co dziesięć
 * sekund i sama zapisała w swoim komentarzu, że brak danych po tym czasie
 * będzie „twardym dowodem, że anonimowy dostęp nie kończy wyszukiwań".
 *
 * Nie był. UOKiK odpowiedział, że ten konkretny wynik **został policzony
 * i zapisany**, a kolejka potrafi trwać **kilkadziesiąt minut**. Zmierzyliśmy
 * własne wyobrażenie o czasie, nie czas.
 *
 * Stąd trzy zmiany, każda wprost z listu urzędu:
 *
 *   1. ODSTĘP 60 SEKUND, nie 10. „Najlepiej w odstępach około 60 sekund" —
 *      cytat z odpowiedzi. Sześć razy mniej żądań na tę samą minutę czekania.
 *   2. HORYZONT 62 MINUTY, nie 6. Urząd podał, że wynik wygasa po 60 minutach,
 *      a zadanie czekające dłużej nigdy nie zostanie wykonane. Dłuższe czekanie
 *      niż ~62 min nie ma więc sensu — po tym czasie odpowiedź brzmi
 *      „za późno", a nie „jeszcze nie".
 *   3. JEDNA REJESTRACJA, nie dwie. Sonda 29 zakładała dwa wyszukania naraz
 *      (kolejka + bez-kolejki). Bierzemy wyłącznie `bez-kolejki`, bo to jego
 *      wynik urząd potwierdził jako policzony. Jedno miejsce w kolejce
 *      na całe uruchomienie.
 *
 * ---------------------------------------------------------------------
 * NA CO TA SONDA MA ODPOWIEDZIEĆ.
 *
 * Nie na „czy API działa" — urząd już odpowiedział, że działa. Na pytanie,
 * którego nigdy nie zadaliśmy danym:
 *
 *     JAK NAPRAWDĘ WYGLĄDA ODPOWIEDŹ Z WYNIKIEM?
 *
 * Nie widzieliśmy jej ANI RAZU. Wszystko, co „wiemy" o kształcie danych
 * z SUDOP — 29 pól, `gmina-siedziby-kod`, „bogatsza niż oba eksporty CSV
 * razem wzięte" — pochodzi z `/v3/api-docs`, czyli z dokumentacji.
 * A D15 mówi, że kontraktem jest to, co naprawdę przychodzi.
 *
 * Od odpowiedzi na to pytanie zależy, czy „Radar Sąsiedzki" ma z czego
 * działać i czy w ogóle potrzebujemy ręcznego CSV.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BAZA = 'https://api-sudop.uokik.gov.pl/sudop-api';
const NIP = '6150022153'; // PGE Elektrownia Turow — wiemy, ze ma dane
const UA = 'Obywatel2.0/0.1 (+civic-tech, dane publiczne; kontakt w repozytorium)';
const KATALOG = resolve('scripts/probes/out');

const CO_ILE_MS = 60_000; // cytat z listu UOKiK
const HORYZONT_MS = 62 * 60_000; // wynik wygasa po 60 min — dalej nie ma po co

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const czas = () => new Date().toISOString().slice(11, 19);

async function strzal(url, opis) {
  console.log('');
  console.log(`[${czas()}] --> ${opis}`);
  console.log(`            ${url}`);
  try {
    // `redirect: 'manual'` — lekcja z sondy 28. Domyslne podazanie za 303
    // skonsumowalo naglowek Location i kazalo nam napisac do urzedu, ze go nie ma.
    const res = await fetch(url, {
      redirect: 'manual',
      headers: { 'User-Agent': UA, Accept: 'application/json, text/csv, */*' },
    });
    const tekst = await res.text();
    const loc = res.headers.get('location');
    console.log(`            HTTP ${res.status}${loc ? `  Location: ${loc}` : ''}`);
    if (tekst && tekst.length <= 400) console.log(`            ${tekst}`);
    else if (tekst) console.log(`            (${tekst.length} znakow)`);
    return { status: res.status, loc, tekst };
  } catch (e) {
    console.log(`            BLAD SIECI: ${e.message}`);
    return null;
  }
}

const pelny = (loc) => (loc ? (/^https?:\/\//.test(loc) ? loc : `https://api-sudop.uokik.gov.pl${loc}`) : null);

function zapisz(nazwa, tresc) {
  mkdirSync(KATALOG, { recursive: true });
  const sciezka = resolve(KATALOG, nazwa);
  writeFileSync(sciezka, tresc, 'utf8');
  console.log(`            zapisano: ${sciezka}`);
  return sciezka;
}

/**
 * Wypisanie KSZTALTU odpowiedzi, nie jej tresci.
 *
 * Interesuje nas, czy pol jest 29 i czy jest wsrod nich TERYT — a nie ile
 * dotacji dostala konkretna spolka. Tresc laduje w pliku, tu ida same nazwy.
 */
function opiszKsztalt(json) {
  console.log('');
  console.log('='.repeat(72));
  console.log('KSZTALT ODPOWIEDZI — to jest powod istnienia tej sondy');
  console.log('='.repeat(72));

  const korzen = Object.keys(json ?? {});
  console.log(`Pola na najwyzszym poziomie (${korzen.length}): ${korzen.join(', ')}`);

  // Szukamy pierwszej tablicy obiektow — to beda przypadki pomocy.
  let lista = Array.isArray(json) ? json : null;
  let gdzie = lista ? '(korzen)' : null;
  if (!lista) {
    for (const [k, v] of Object.entries(json ?? {})) {
      if (Array.isArray(v) && v.length && typeof v[0] === 'object') {
        lista = v;
        gdzie = k;
        break;
      }
    }
  }

  if (!lista) {
    console.log('Nie znalazlem tablicy przypadkow. Obejrzyj zapisany plik.');
    return;
  }

  const pola = Object.keys(lista[0]);
  console.log('');
  console.log(`Tablica przypadkow w polu "${gdzie}": ${lista.length} pozycji`);
  console.log(`POL W JEDNYM PRZYPADKU: ${pola.length}`);
  console.log('');
  for (const p of pola) console.log(`  ${p}`);

  console.log('');
  console.log('--- kontrola twierdzen z dokumentacji ---');
  const ma = (fragment) => pola.filter((p) => p.toLowerCase().includes(fragment));
  console.log(`  29 pol wg specyfikacji     -> jest ${pola.length} ${pola.length === 29 ? '(ZGADZA SIE)' : '(NIE ZGADZA SIE)'}`);
  console.log(`  pola z "gmina"             -> ${ma('gmina').join(', ') || 'BRAK'}`);
  console.log(`  pola z "teryt"             -> ${ma('teryt').join(', ') || 'BRAK'}`);
  console.log(`  pola z "wartosc"/"kwota"   -> ${[...ma('wartos'), ...ma('kwota')].join(', ') || 'BRAK'}`);
  console.log(`  pola z "nip"               -> ${ma('nip').join(', ') || 'BRAK'}`);
  console.log('');
  console.log('Jesli pol z "gmina" albo "teryt" NIE MA, to „Radar Sasiedzki"');
  console.log('nie ma z czego dzialac na tym API i ręczny CSV zostaje jedyna droga.');
}

// ---------------------------------------------------------------------
// ETAP 0 — zero obciazenia kolejki
//
// `/wersja` i `/v3/api-docs` to zasoby statyczne, tak samo jak slowniki,
// ktore odpytujemy w produkcji przez `ingest:sudop-gminy`. NIE tworza pozycji
// w kolejce i odpowiadaja ponizej 200 ms.
// ---------------------------------------------------------------------
async function etapSpecyfikacji() {
  console.log('='.repeat(72));
  console.log('ETAP 0 — wersja uslugi i specyfikacja. Dwa zadania, zero kolejki.');
  console.log('='.repeat(72));

  await strzal(`${BAZA}/wersja`, 'wersja uslugi');
  await sleep(1500);

  const spec = await strzal(`${BAZA}/v3/api-docs`, 'specyfikacja OpenAPI');
  if (!spec || spec.status !== 200 || !spec.tekst) {
    console.log('');
    console.log('Nie udalo sie pobrac specyfikacji — dalej nie ma sensu.');
    return null;
  }

  zapisz('32-sudop-openapi.json', spec.tekst);

  try {
    const json = JSON.parse(spec.tekst);
    const schematy = Object.keys(json.components?.schemas ?? {});
    console.log('');
    console.log(`Schematy w specyfikacji (${schematy.length}): ${schematy.join(', ')}`);

    // Twierdzenie do sprawdzenia: AidEventEntity ma 29 pol, w tym gmina-siedziby-kod.
    for (const nazwa of schematy) {
      const wlasciwosci = Object.keys(json.components.schemas[nazwa]?.properties ?? {});
      if (!wlasciwosci.length) continue;
      const maGmine = wlasciwosci.some((p) => /gmina|teryt/i.test(p));
      console.log(`  ${nazwa}: ${wlasciwosci.length} pol${maGmine ? '  <-- MA POLE GMINY/TERYT' : ''}`);
    }

    console.log('');
    console.log('Czy jest securitySchemes:', json.components?.securitySchemes ? 'TAK' : 'NIE');
  } catch (e) {
    console.log(`Specyfikacja nie jest poprawnym JSON-em: ${e.message}`);
  }
  return true;
}

// ---------------------------------------------------------------------
// ETAP 1 — jedno wyszukanie, cierpliwie
// ---------------------------------------------------------------------
async function etapWyszukania() {
  console.log('');
  console.log('='.repeat(72));
  console.log('ETAP 1 — JEDNO wyszukanie, odpytywane co 60 s przez 62 min.');
  console.log('To jest jedno miejsce w kolejce UOKiK. Nie uruchamiaj tego w petli.');
  console.log('='.repeat(72));

  const rej = await strzal(
    `${BAZA}/api/przypadki-pomocy-bez-kolejki?nip-beneficjenta=${NIP}&strona=1`,
    'REJESTRACJA (bez-kolejki) — jedyne wyszukanie tego uruchomienia',
  );

  if (!rej || rej.status !== 303 || !rej.loc) {
    console.log('');
    console.log(`Spodziewalem sie 303 z Location, dostalem ${rej?.status ?? 'blad sieci'}.`);
    console.log('To jest nowa sytuacja wobec sondy 28 — wklej wyjscie.');
    return;
  }

  const url = pelny(rej.loc);
  const start = Date.now();
  let runda = 0;

  console.log('');
  console.log(`Sledze: ${url}`);
  console.log(`Pierwsze sprawdzenie za ${CO_ILE_MS / 1000} s.`);

  while (Date.now() - start < HORYZONT_MS) {
    await sleep(CO_ILE_MS);
    runda++;
    const minuty = ((Date.now() - start) / 60000).toFixed(1);
    const r = await strzal(url, `sprawdzenie ${runda}, ${minuty} min od rejestracji`);
    if (!r) continue;

    if (r.status === 404) {
      console.log('            -> jeszcze nie policzone (albo juz wygaslo). Czekam.');
      continue;
    }

    if (r.status === 200 && r.tekst.trim().startsWith('{')) {
      console.log('');
      console.log(`SA DANE po ${minuty} minutach.`);
      zapisz('32-sudop-wynik.json', r.tekst);
      try {
        opiszKsztalt(JSON.parse(r.tekst));
      } catch (e) {
        console.log(`Nie udalo sie sparsowac: ${e.message}`);
      }

      // Drugie twierdzenie z dokumentacji: ?csv=true zwraca CSV.
      await sleep(3000);
      const csv = await strzal(`${url}?csv=true`, 'ten sam wynik jako CSV');
      if (csv?.status === 200 && csv.tekst) {
        zapisz('32-sudop-wynik.csv', csv.tekst);
        console.log('');
        console.log(`Naglowek CSV: ${csv.tekst.split('\n')[0]?.slice(0, 300)}`);
      }
      return;
    }

    console.log(`            -> nieoczekiwany status ${r.status}. Czekam dalej.`);
  }

  console.log('');
  console.log('='.repeat(72));
  console.log(`BRAK DANYCH po ${HORYZONT_MS / 60000} minutach na JEDNYM identyfikatorze,`);
  console.log('przy odstepie 60 s zalecanym przez UOKiK.');
  console.log('');
  console.log('DOPIERO TO jest obserwacja porownywalna z tym, co urzad opisal.');
  console.log('Znaczy albo: kolejka byla dluzsza niz okno zycia wyniku (60 min),');
  console.log('albo cos sie zmienilo po ich stronie. Wklej cale wyjscie.');
  console.log('='.repeat(72));
}

async function main() {
  const tylkoSpec = process.argv.includes('--tylko-spec');
  const pelna = process.argv.includes('--pelna');

  if (!tylkoSpec && !pelna) {
    console.log('');
    console.log('Ta sonda odpytuje serwer UOKiK, ktory sam zglosil przeciazenie.');
    console.log('Uruchom jawnie:');
    console.log('');
    console.log('  --tylko-spec   wersja + specyfikacja OpenAPI. Dwa zadania, ZERO kolejki.');
    console.log('  --pelna        to samo + JEDNO wyszukanie odpytywane 62 min co 60 s.');
    console.log('');
    return;
  }

  const ok = await etapSpecyfikacji();
  if (ok && pelna) await etapWyszukania();
}

main();
