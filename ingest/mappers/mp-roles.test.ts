/**
 * Testy kontroli funkcji panstwowych. Bez sieci, bez bazy.
 *   npx tsx --test ingest/mappers/mp-roles.test.ts
 *
 * To sa testy najbardziej zapalnego pola w projekcie: tresci, ktora dopisujemy
 * przy czyimś nazwisku od siebie. Kazdy z nich sprawdza JEDNA rzecz, ktorej
 * nie wolno wpuscic do bazy.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  NAGLOWKI_ROL,
  sprawdzNaglowekRol,
  parsujDateIso,
  sprawdzZrodlo,
  mapujRole,
  niezgodneNazwiska,
} from './mp-roles.js';

const OK = [
  'donald-tusk',
  'Donald Tusk',
  'Prezes Rady Ministrów',
  'rzad',
  '2023-12-13',
  '',
  'https://monitorpolski.gov.pl/M2023000139301',
];

// --- naglowek ------------------------------------------------------------

test('poprawny naglowek przechodzi', () => {
  assert.doesNotThrow(() => sprawdzNaglowekRol([...NAGLOWKI_ROL]));
});

test('zamieniona kolejnosc kolumn przerywa', () => {
  const zle: string[] = [...NAGLOWKI_ROL];
  const t = zle[4]!;
  zle[4] = zle[5]!;
  zle[5] = t;
  assert.throws(() => sprawdzNaglowekRol(zle), /NAGLOWEK/);
});

// --- zrodlo — najwazniejsza kontrola -------------------------------------

test('brak zrodla przerywa i mowi dlaczego', () => {
  assert.throws(() => sprawdzZrodlo(''), /bez linku do dokumentu powolania/);
});

test('oficjalne rejestry przechodza', () => {
  for (const u of [
    'https://monitorpolski.gov.pl/M2023000139301',
    'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WMP20230001393',
    'https://www.sejm.gov.pl/sejm10.nsf/posel.xsp?id=001',
    'https://www.gov.pl/web/premier/rada-ministrow',
    'https://www.prezydent.pl/aktualnosci/nominacje',
  ]) {
    assert.doesNotThrow(() => sprawdzZrodlo(u), u);
  }
});

test('encyklopedia i portal informacyjny NIE sa dokumentem powolania', () => {
  assert.throws(() => sprawdzZrodlo('https://pl.wikipedia.org/wiki/Rada_Ministrów'), /spoza oficjalnych rejestrow/);
  assert.throws(() => sprawdzZrodlo('https://www.onet.pl/informacje/xyz'), /spoza oficjalnych rejestrow/);
});

test('strona partii nie jest zrodlem', () => {
  assert.throws(() => sprawdzZrodlo('https://platforma.org/aktualnosci'), /spoza oficjalnych rejestrow/);
});

test('http bez szyfrowania nie przechodzi', () => {
  assert.throws(() => sprawdzZrodlo('http://monitorpolski.gov.pl/M2023000139301'), /musi byc https/);
});

test('podszycie sie pod oficjalny host nie przechodzi', () => {
  // "gov.pl.example.com" konczy sie na "example.com", nie na "gov.pl".
  assert.throws(() => sprawdzZrodlo('https://gov.pl.example.com/fake'), /spoza oficjalnych rejestrow/);
  // Poddomeny prawdziwego hosta sa w porzadku.
  assert.doesNotThrow(() => sprawdzZrodlo('https://www.gov.pl/web/premier'));
});

// --- daty ----------------------------------------------------------------

test('data w formacie ISO', () => {
  assert.equal(parsujDateIso('2023-12-13', 'od'), '2023-12-13');
});

test('data nieistniejaca przerywa', () => {
  assert.throws(() => parsujDateIso('2023-02-30', 'od'), /nie istnieje/);
  assert.throws(() => parsujDateIso('13.12.2023', 'od'), /RRRR-MM-DD/);
});

test('koniec funkcji nie moze byc przed poczatkiem', () => {
  const w = [...OK];
  w[5] = '2020-01-01';
  assert.throws(() => mapujRole(w, 2), /przed jej poczatkiem/);
});

test('pusta data konca znaczy "funkcja trwa"', () => {
  assert.equal(mapujRole([...OK], 2).date_to, null);
});

// --- rodzaj i pola obowiazkowe ------------------------------------------

test('rodzaj spoza listy przerywa', () => {
  const w = [...OK];
  w[3] = 'wazna';
  assert.throws(() => mapujRole(w, 2), /spoza listy/);
});

test('pusta nazwa funkcji przerywa', () => {
  const w = [...OK];
  w[2] = '  ';
  assert.throws(() => mapujRole(w, 2), /pusta nazwa funkcji/);
});

test('poprawny wiersz mapuje sie w calosci', () => {
  const w = mapujRole([...OK], 2);
  assert.equal(w.slug, 'donald-tusk');
  assert.equal(w.role_name, 'Prezes Rady Ministrów');
  assert.equal(w.role_kind, 'rzad');
  assert.equal(w.date_from, '2023-12-13');
  assert.equal(w.date_to, null);
  assert.equal(w.zrodlo_url, 'https://monitorpolski.gov.pl/M2023000139301');
});

// --- zgodnosc z baza -----------------------------------------------------

test('nazwisko z pliku musi zgadzac sie z baza', () => {
  const wiersz = mapujRole([...OK], 2);
  const baza = new Map([['donald-tusk', 'Donald Tusk']]);
  assert.deepEqual(niezgodneNazwiska([wiersz], baza), []);
});

test('rozne nazwisko pod tym samym slugiem jest zglaszane', () => {
  // To jest blad, ktorego zaden test typow nie zlapie, a ktory zobaczy
  // kazdy czytelnik: funkcja ministra dopisana nie temu poslowi.
  const wiersz = mapujRole([...OK], 2);
  const baza = new Map([['donald-tusk', 'Jan Kowalski']]);
  const p = niezgodneNazwiska([wiersz], baza);
  assert.equal(p.length, 1);
  assert.ok(p[0]!.includes('Donald Tusk'));
  assert.ok(p[0]!.includes('Jan Kowalski'));
});

test('slug spoza bazy jest zglaszany', () => {
  const wiersz = mapujRole([...OK], 2);
  assert.deepEqual(niezgodneNazwiska([wiersz], new Map()), ['  donald-tusk: nie ma takiego posla w bazie']);
});

test('roznica w wielkosci liter i spacjach nie jest bledem', () => {
  const w = [...OK];
  w[1] = '  donald   TUSK ';
  const wiersz = mapujRole(w, 2);
  assert.deepEqual(niezgodneNazwiska([wiersz], new Map([['donald-tusk', 'Donald Tusk']])), []);
});
