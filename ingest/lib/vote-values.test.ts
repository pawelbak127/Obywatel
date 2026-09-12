/**
 * Testy dziedziny wartosci glosu. Bez sieci, bez bazy.
 *   npx tsx --test ingest/lib/vote-values.test.ts
 *
 * Ten plik pilnuje D7 i D8 (docs/decyzje.md). D7: `jestStanowiskiem` musi byc
 * lista DOZWOLONYCH (YES/NO/ABSTAIN), nie lista zakazanych ("wszystko poza
 * ABSENT") — bo przy tej drugiej regule PRESENT (obecnosc bez stanowiska)
 * wyszloby jako nielojalnosc wobec klubu. D8: obecnosc i udzial to dwie
 * rozne liczby, obie licza sie inaczej.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ZNANE_WARTOSCI,
  STANOWISKA,
  jestStanowiskiem,
  jestObecnoscia,
  nieznaneWartosci,
  komunikatONieznanych,
} from './vote-values.js';

// --- jestStanowiskiem: lista dozwolonych, nie zakazanych -------------------

test('jestStanowiskiem przepuszcza dokladnie YES, NO, ABSTAIN i nic wiecej', () => {
  // Przechodzimy CALA dziedzine znanych wartosci i sprawdzamy rownowaznosc
  // z lista STANOWISKA — nie tylko trzy przypadki pozytywne, zeby zlapac
  // ewentualne "przeciekanie" dodatkowej wartosci do stanowisk.
  for (const v of ZNANE_WARTOSCI) {
    const oczekiwane = (['YES', 'NO', 'ABSTAIN'] as readonly string[]).includes(v);
    assert.equal(jestStanowiskiem(v), oczekiwane, `${v}: jestStanowiskiem powinno dac ${oczekiwane}`);
  }
});

test('jestStanowiskiem("PRESENT") jest falszem — posel obecny bez oddania glosu nie moze wyjsc jako niezgodny z klubem', () => {
  // To jest dokladnie awaria z D7: przy regule "wszystko poza ABSENT" PRESENT
  // trafialby do porownania z wiekszoscia klubu i wychodzil jako nielojalnosc.
  assert.equal(jestStanowiskiem('PRESENT'), false);
});

test('nieznana wartosc spoza dzisiejszego slownika nie jest stanowiskiem — bez dopisywania jej gdziekolwiek', () => {
  // Test listy dozwolonych: gdyby ktos wrocil do listy zakazanych
  // ("wszystko poza ABSENT/PRESENT"), ten test zaczalby padac, bo wymyslona
  // tu wartosc nigdy nie trafi na liste STANOWISKA ani ZNANE_WARTOSCI.
  assert.equal(jestStanowiskiem('ZUPELNIE_NOWA'), false);
});

// --- jestObecnoscia ----------------------------------------------------------

test('jestObecnoscia: PRESENT jest obecnoscia, ABSENT nie jest, YES/NO/ABSTAIN sa', () => {
  assert.equal(jestObecnoscia('PRESENT'), true);
  assert.equal(jestObecnoscia('ABSENT'), false);
  for (const v of ['YES', 'NO', 'ABSTAIN']) {
    assert.equal(jestObecnoscia(v), true, `${v} powinno liczyc sie do obecnosci`);
  }
});

// --- nieznaneWartosci ---------------------------------------------------------

test('nieznaneWartosci zwraca wartosci spoza ZNANE_WARTOSCI i pomija znane', () => {
  assert.deepEqual(nieznaneWartosci(['YES', 'NO', 'PRESENT', 'ABSENT', 'VOTE_VALID', 'VOTE_INVALID']), []);
  assert.deepEqual(nieznaneWartosci(['YES', 'ZULU', 'ABSTAIN']), ['ZULU']);
});

test('nieznaneWartosci radzi sobie z null i undefined w wejsciu, nie zglaszajac ich jako nieznane', () => {
  assert.deepEqual(nieznaneWartosci(['YES', null, undefined, 'NO']), []);
  assert.deepEqual(nieznaneWartosci([null, undefined]), []);
});

test('nieznaneWartosci nie powtarza tej samej nieznanej wartosci dwa razy', () => {
  assert.deepEqual(nieznaneWartosci(['ZULU', 'ZULU', 'ZULU']), ['ZULU']);
});

test('nieznaneWartosci przy samych znanych wartosciach zwraca pusta tablice', () => {
  assert.deepEqual(nieznaneWartosci(ZNANE_WARTOSCI), []);
  assert.deepEqual(nieznaneWartosci([]), []);
});

test('nieznaneWartosci sortuje wynik', () => {
  // Deterministyczny porzadek w komunikacie bledu — latwiej porownac dwa logi.
  assert.deepEqual(nieznaneWartosci(['ZULU', 'ALFA', 'MIKE']), ['ALFA', 'MIKE', 'ZULU']);
});

// --- komunikatONieznanych ------------------------------------------------------

test('komunikatONieznanych wymienia kazda nieznana wartosc i miejsce, ktorego dotyczy', () => {
  const komunikat = komunikatONieznanych(['ZULU', 'ALFA'], 'posiedzenie 63');
  assert.match(komunikat, /posiedzenie 63/);
  assert.match(komunikat, /ZULU/);
  assert.match(komunikat, /ALFA/);
});

test('komunikatONieznanych daje gotowe polecenie SQL dla kazdej nieznanej wartosci', () => {
  // Komentarz w vote-values.ts obiecuje "gotowe polecenie SQL" — sprawdzamy
  // te obietnice doslownie, dla wielu wartosci na raz.
  const komunikat = komunikatONieznanych(['ZULU', 'ALFA'], 'posiedzenie 63');
  assert.match(komunikat, /alter type vote_value add value if not exists 'ZULU';/);
  assert.match(komunikat, /alter type vote_value add value if not exists 'ALFA';/);
});

test('komunikatONieznanych przy jednej wartosci nie gubi jej w liscie ani w SQL', () => {
  const komunikat = komunikatONieznanych(['SAMOTNA'], 'sync-votings');
  assert.match(komunikat, /NIEZNANE WARTOSCI GLOSU \(sync-votings\): SAMOTNA/);
  assert.match(komunikat, /alter type vote_value add value if not exists 'SAMOTNA';/);
});

// --- spojnosc STANOWISKA z ZNANE_WARTOSCI ---------------------------------

test('kazde stanowisko z STANOWISKA jest znana wartoscia z ZNANE_WARTOSCI', () => {
  // Wylapuje literowke przy dopisywaniu nowej wartosci: gdyby ktos dopisal
  // do STANOWISKA cos, czego nie ma w ZNANE_WARTOSCI, ten test padnie.
  const znane = new Set<string>(ZNANE_WARTOSCI);
  for (const s of STANOWISKA) {
    assert.ok(znane.has(s), `${s} jest w STANOWISKA, ale nie ma go w ZNANE_WARTOSCI`);
  }
});
