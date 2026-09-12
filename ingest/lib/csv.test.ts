/**
 * Testy parsera CSV i wykrywania kodowania. Bez sieci, bez bazy.
 *   npx tsx --test ingest/lib/csv.test.ts
 *
 * D15: "Kodowanie wykrywamy z bajtow, nie z wygladu tekstu." Prawdziwy eksport
 * z UOKiK jest w CP1250 — zle wykryte kodowanie zamienia nazwy firm i gmin
 * w smieci tam, gdzie stoi kwota pomocy publicznej.
 *
 * Sekcja 7.6 CLAUDE.md: fixture ma byc oryginalnymi bajtami, nie przepisana
 * trescia. Ponizej NIE MA ani jednego polskiego znaku wpisanego wprost do
 * pliku testu i zdekodowanego z powrotem — to testowalo by Node, nie nasz
 * kod. Kazdy bajt jest jawny (`Buffer.from([...])`), a tam gdzie trzeba bylo
 * policzyc bajty UTF-8 dla konkretnego slowa, policzono je raz w node -e
 * (Buffer.from('Wartość', 'utf8')) i przepisano jako liczby — plik testu
 * sam z siebie tych bajtow juz nie liczy.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { wykryjKodowanie, dekoduj, parsujCsv, wczytajCsv } from './csv.js';

// --- wykryjKodowanie ---------------------------------------------------------

test('bajty UTF-8 z polskimi znakami jako sekwencje dwubajtowe -> utf-8', () => {
  // "Wartość" — nazwa kolumny z prawdziwego naglowka SUDOP (D15). Bajty UTF-8
  // dla "ś" (U+015B) to 0xC5 0x9B, dla "ć" (U+0107) to 0xC4 0x87 — policzone
  // raz przez Buffer.from('Wartość','utf8'), tu wpisane jako liczby.
  const bajty = Buffer.from([0x57, 0x61, 0x72, 0x74, 0x6f, 0xc5, 0x9b, 0xc4, 0x87]);
  assert.equal(wykryjKodowanie(bajty), 'utf-8');
});

test('bajty CP1250 z polskimi znakami jako pojedyncze bajty -> windows-1250', () => {
  // Cztery bajty z tresci zadania, w kolejnosci l-ogonek, a-ogonek, e-ogonek,
  // s-kreska. Kazdy z nich w zakresie 0x80-0xBF jest sam w sobie niepoprawnym
  // bajtem startowym sekwencji UTF-8 (wzorzec bitowy 10xxxxxx = bajt
  // kontynuacji, nie moze rozpoczynac znaku) — dlatego scisly dekoder UTF-8
  // rzuca i funkcja spada na windows-1250, dokladnie jak opisuje komentarz
  // w naglowku csv.ts.
  const bajty = Buffer.from([0xb3, 0xb9, 0xea, 0x9c]);
  assert.equal(wykryjKodowanie(bajty), 'windows-1250');
});

test('BOM UTF-8 rozpoznawany od razu, zanim dojdzie do proby scislego dekodowania', () => {
  // Komentarz w csv.ts: "Kolejnosc: BOM (jednoznaczny) -> proba scislego
  // UTF-8 -> CP1250." BOM to EF BB BF na poczatku pliku.
  const bajty = Buffer.from([0xef, 0xbb, 0xbf, 0x41, 0x42, 0x43]); // BOM + "ABC"
  assert.equal(wykryjKodowanie(bajty), 'utf-8');
});

test('czysty ASCII -> utf-8, bo kazdy bajt ASCII jest tez poprawnym bajtem UTF-8', () => {
  // Zachowanie zamierzone: scisly dekoder UTF-8 nie ma na czym rzucic, wiec
  // funkcja nigdy nie spada do galezi windows-1250 dla pliku bez polskich
  // znakow. To nie jest zgadywanie z wygladu — to jest prawdziwy wynik
  // scislego dekodowania; w zakresie 0x00-0x7F ASCII, UTF-8 i CP1250 i tak
  // sie pokrywaja, wiec dla takiego pliku etykieta nie zmienia interpretacji
  // ani jednego bajtu.
  const bajty = Buffer.from([0x61, 0x2c, 0x62, 0x3b, 0x63, 0x0d, 0x0a]); // "a,b;c\r\n"
  assert.equal(wykryjKodowanie(bajty), 'utf-8');
});

// --- dekoduj -----------------------------------------------------------------

test('te same bajty CP1250 dekodowane jako windows-1250 daja polskie znaki, jako utf-8 - smiecie', () => {
  // To jest sedno tego, po co wykryjKodowanie w ogole istnieje: zle dobrany
  // dekoder nie rzuca, tylko po cichu podmienia znak na U+FFFD.
  const bajty = Buffer.from([0x77, 0x70, 0xb3, 0x61, 0x74, 0x61]); // "wp" + l-ogonek(0xB3) + "ata" = "wpłata"
  assert.equal(dekoduj(bajty, 'windows-1250'), 'wpłata');
  const zleZdekodowane = dekoduj(bajty, 'utf-8');
  assert.notEqual(zleZdekodowane, 'wpłata');
  assert.ok(zleZdekodowane.includes('�'), 'bajt bez pary zamienia sie w znak zastepczy, nie znika po cichu');
});

// --- parsujCsv -----------------------------------------------------------------

test('domyslnym separatorem jest srednik, nie przecinek', () => {
  // Przecinek w nieocudzyslowionym polu ma zostac czescia tresci pola,
  // a nie zostac potraktowany jak granica kolumny.
  assert.deepEqual(parsujCsv('Kwota,zl;Opis\r\n'), [['Kwota,zl', 'Opis']]);
});

test('pole w cudzyslowach zawierajace separator nie jest dzielone', () => {
  // Gdyby parser dzielil na kazdy srednik bez wzgledu na cudzyslow, nazwa
  // "Kowalski; Wspolnicy sp. j." (legalna nazwa w KRS) rozjechalaby kolumny.
  assert.deepEqual(parsujCsv('"a;b";c\r\n'), [['a;b', 'c']]);
});

test('podwojony cudzyslow wewnatrz pola daje jeden znak cudzyslowu', () => {
  // Kod jawnie to obsluguje (linia z komentarzem `// "" -> "` w parsujCsv) —
  // ten test dokumentuje, ze dziala, nie tylko ze jest tam kod.
  assert.deepEqual(parsujCsv('"program ""Czyste Powietrze""";x\r\n'), [['program "Czyste Powietrze"', 'x']]);
});

test('pusta linia (sam CRLF) nie tworzy fikcyjnego wiersza z jednym pustym polem', () => {
  // Filtr na koncu parsujCsv usuwa wiersz dlugosci 1, ktorego jedyne pole
  // jest po przycieciu puste — ale tylko taki, nie kazdy krotki wiersz.
  assert.deepEqual(
    parsujCsv('a;b\r\n1;2\r\n\r\n3;4\r\n'),
    [['a', 'b'], ['1', '2'], ['3', '4']],
  );
});

test('CRLF i LF na koncu ostatniej linii pliku nie dokladaja dodatkowego pustego wiersza', () => {
  // Ostatnia linia realnego eksportu to zwykle sam znak konca linii — bez
  // tego filtra wynik mialby dodatkowy wiersz-widmo z jednym pustym polem.
  const oczekiwane = [['a', 'b'], ['1', '2']];
  assert.deepEqual(parsujCsv('a;b\r\n1;2\r\n'), oczekiwane, 'CRLF (Windows)');
  assert.deepEqual(parsujCsv('a;b\n1;2\n'), oczekiwane, 'LF (Unix)');
});

// --- wczytajCsv ----------------------------------------------------------------

test('zwraca naglowki oddzielone od wierszy, deklarowane kodowanie i liczbe wierszy w pliku', () => {
  const bajty = Buffer.from('a;b\r\n1;2\r\n3;4\r\n', 'utf8');
  const wynik = wczytajCsv(bajty);
  assert.deepEqual(wynik.naglowki, ['a', 'b']);
  assert.deepEqual(wynik.wiersze, [['1', '2'], ['3', '4']]);
  assert.equal(wynik.kodowanie, 'utf-8');
  assert.equal(wynik.wierszyWPliku, 2);
});

test('naglowki sa przycinane z bialych znakow wokol pola, wartosci w wierszach nie', () => {
  // Naglowek jest kluczem porownywanym co do znaku z kontraktem (D15) — biale
  // znaki wokol niego trzeba usunac. Wartosc w wierszu danych to tresc
  // rejestru: przycinanie jej to juz decyzja mappera (patrz sudop.ts), nie
  // parsera CSV, wiec csv.ts jej nie rusza.
  const bajty = Buffer.from(' a ; b \r\n c ; d \r\n', 'utf8');
  const wynik = wczytajCsv(bajty);
  assert.deepEqual(wynik.naglowki, ['a', 'b']);
  assert.deepEqual(wynik.wiersze, [[' c ', ' d ']]);
});

test('plik z samym naglowkiem daje zero wierszy, a nie blad', () => {
  const bajty = Buffer.from('a;b;c\r\n', 'utf8');
  const wynik = wczytajCsv(bajty);
  assert.deepEqual(wynik.naglowki, ['a', 'b', 'c']);
  assert.deepEqual(wynik.wiersze, []);
  assert.equal(wynik.wierszyWPliku, 0);
});
