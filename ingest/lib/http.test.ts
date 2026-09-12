/**
 * Testy `mapLimit` z ingest/lib/http.ts. Bez sieci, bez bazy.
 *   npx tsx --test ingest/lib/http.test.ts
 *
 * Testujemy WYLACZNIE mapLimit - getJson, getBuffer i headExists wymagaja
 * prawdziwej sieci, a testy w tym projekcie dzialaja bez sieci i bez bazy
 * (CLAUDE.md §3). mapLimit da sie przetestowac w calosci, bo funkcja podana
 * jako `fn` moze byc zwykla lokalna funkcja asynchroniczna - zadnego fetch.
 *
 * mapLimit ogranicza rownoleglosc WSZYSTKICH importow. Jesli przestanie
 * ograniczac, backfill uderzy w serwer Kancelarii Sejmu taka liczba zapytan
 * naraz, ile ma elementow lista - przy backfillu to tysiace. Jesli zgubi
 * kolejnosc wynikow, dane trafia do bazy pod niewlasciwe rekordy.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mapLimit } from './http.js';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// CONCURRENCY w http.ts jest stala prywatna modulu (nieeksportowana), wiec nie
// da sie jej zaimportowac. Odtwarzamy TU DOKLADNIE ta sama formule - ta sama
// zmienna srodowiskowa, ten sam fallback 8 - zeby test mierzyl prawdziwy limit
// uzywany w danym uruchomieniu, a nie zgadywal liczbe "8" na sztywno.
const LIMIT = Number(process.env.INGEST_CONCURRENCY ?? 8);

// --- pusta i krotka lista ----------------------------------------------------

test('pusta lista zwraca pusta tablice i nie wiesza sie', async () => {
  const items: string[] = [];
  let wywolania = 0;
  const wynik = await mapLimit(items, async (item, i) => {
    wywolania++;
    return `${item}-${i}`;
  });
  assert.deepEqual(wynik, []);
  assert.equal(wywolania, 0, 'fn nie powinno byc wywolane ani razu dla pustej listy');
});

test('lista krotsza niz limit rownoleglosci jest przetwarzana poprawnie', async () => {
  const items = ['a', 'b', 'c'];
  assert.ok(items.length < LIMIT, 'zalozenie testu: lista musi byc krotsza niz LIMIT');
  const wynik = await mapLimit(items, async (item, i) => `${item}-${i}`);
  assert.deepEqual(wynik, ['a-0', 'b-1', 'c-2']);
});

// --- kolejnosc wynikow -------------------------------------------------------

test('kolejnosc wynikow odpowiada kolejnosci wejscia, nawet gdy zadania koncza sie w innej kolejnosci', async () => {
  // Opoznienie odwrotnie proporcjonalne do indeksu: element 0 czeka najdluzej,
  // ostatnie konacza sie niemal od razu. Lista jest dluzsza niz LIMIT, wiec
  // pozniejsze elementy trafiaja do workera, ktory zwolnil sie wczesniej -
  // to sprawdza kolejke, nie tylko rownolegly start. Gdyby mapLimit zwracal
  // wyniki w kolejnosci UKONCZENIA zamiast WEJSCIA, out[0] wypadloby na
  // koncu tablicy zamiast na poczatku.
  const n = LIMIT + 5;
  const items = Array.from({ length: n }, (_, i) => i);
  const wynik = await mapLimit(items, async (item, i) => {
    await sleep((n - i) * 4);
    return item * 10;
  });
  assert.deepEqual(
    wynik,
    items.map((x) => x * 10),
  );
});

// --- rownoleglosc jest naprawde ograniczona ----------------------------------

test(`rownoleglosc nie przekracza limitu (${LIMIT}, z INGEST_CONCURRENCY albo domyslnego 8 w http.ts) i faktycznie go wykorzystuje`, async () => {
  const n = LIMIT + 6; // wiecej zadan niz limit, zeby limit mial szanse zostac wyczerpany
  const items = Array.from({ length: n }, (_, i) => i);
  let biezace = 0;
  let maksimum = 0;

  await mapLimit(items, async (item) => {
    biezace++;
    maksimum = Math.max(maksimum, biezace);
    await sleep(10);
    biezace--;
    return item;
  });

  assert.ok(maksimum <= LIMIT, `naraz dzialalo ${maksimum} zadan, limit to ${LIMIT}`);
  // Kontrola w druga strone: przy liczbie zadan wiekszej niz limit rownoleglosc
  // powinna go w pelni wykorzystac. Gdyby ktos kiedys zamienil workerow na
  // petle sekwencyjna, maksimum spadaloby do 1 i ten test by to zlapal.
  assert.equal(maksimum, LIMIT, 'przy liczbie zadan wiekszej niz limit powinien on zostac w pelni wykorzystany');
});

// --- kazdy element dokladnie raz, wlasciwy indeks ----------------------------

test('kazdy element listy jest przetworzony dokladnie raz - zaden pominiety, zaden podwojnie', async () => {
  const n = LIMIT * 3 + 1; // kilka pelnych rund kolejki, celowo nierowna wielokrotnosc limitu
  const items = Array.from({ length: n }, (_, i) => i);
  const liczniki = new Array<number>(n).fill(0);

  await mapLimit(items, async (item, i) => {
    liczniki[i]!++;
    await sleep(2);
    return item;
  });

  assert.deepEqual(liczniki, new Array(n).fill(1));
});

test('indeks przekazywany do fn odpowiada pozycji elementu we wejsciowej liscie', async () => {
  const items = ['x', 'y', 'z', 'w', 'v'];
  const wywolania: Array<[string, number]> = [];

  await mapLimit(items, async (item, i) => {
    // Celowo losowe-ish opoznienie, zeby kolejnosc WYWOLAN nie pokrywala sie
    // z kolejnoscia listy - sprawdzamy, ze i tak kazdy element dostaje SWOJ
    // wlasciwy indeks, a nie np. numer kolejnego zwolnionego workera.
    await sleep((items.length - i) % 3);
    wywolania.push([item, i]);
  });

  const posortowane = [...wywolania].sort((a, b) => a[1] - b[1]);
  assert.deepEqual(
    posortowane,
    items.map((item, i): [string, number] => [item, i]),
  );
});

// --- blad w jednym zadaniu ---------------------------------------------------

test('blad w jednym zadaniu odrzuca cala obietnice mapLimit, ale NIE zatrzymuje kolejki - pozostale zadania i tak zostaja odpalone i dokonczone w tle', async () => {
  // Zachowanie zweryfikowane najpierw poza testami (probe skryptowy z
  // process.on('unhandledRejection', ...) i logiem start/end per indeks),
  // dopiero potem opisane tu jako test - zgodnie z zasada projektu, ze
  // twierdzenie w komentarzu ma byc sprawdzone, nie zgadywane.
  //
  // mapLimit to Promise.all nad "workerami" ciagnacymi z jednego kursora.
  // Promise.all odrzuca sie z PIERWSZYM bledem, ale nie anuluje petli w
  // pozostalych workerach - one licza dalej (i, przy liscie dluzszej niz
  // limit, nadal pobieraja KOLEJNE elementy z kursora), tylko ich wynik
  // juz nigdzie nie trafia, bo `out` ginie razem z odrzucona funkcja.
  // W praktyce importu: pojedynczy zly rekord nie przerywa reszty pobierania,
  // ale wolajacy, ktory zlapal wyjatek, i tak straci WSZYSTKIE wyniki tej
  // porcji - rowniez te, ktore w tle policzyly sie poprawnie.
  const n = LIMIT + 4; // wiecej niz limit - czesc elementow czeka w kolejce w chwili bledu
  const items = Array.from({ length: n }, (_, i) => i);
  const zakonczone: number[] = [];

  const wynikPromise = mapLimit(items, async (item, i) => {
    await sleep(5);
    if (i === 2) throw new Error(`blad na indeksie ${i}`);
    zakonczone.push(i);
    return item;
  });

  await assert.rejects(wynikPromise, /blad na indeksie 2/);

  // W chwili odrzucenia dalsze zadania moga jeszcze nie byc skonczone -
  // odczekujemy, az kolejka rozpracuje sie w tle do konca.
  await sleep(100);

  const oczekiwane = items.filter((i) => i !== 2);
  assert.deepEqual(zakonczone.sort((a, b) => a - b), oczekiwane);
});
