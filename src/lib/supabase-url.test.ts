/**
 * Testy normalizeSupabaseUrl. Bez sieci, bez bazy.
 *   npx tsx --test src/lib/supabase-url.test.ts
 *
 * Funkcja powstala po awarii opisanej w naglowku supabase-url.ts: adres w
 * .env.local ze sciezka /rest/v1 dawal PGRST125 na kazdym zapytaniu, a blad
 * wygladal jak problem uprawnien, nie literowka w konfiguracji. Testy ponizej
 * pilnuja WLASNOSCI ("wynik nigdy nie ma sciezki", "komunikat nazywa zmienna"),
 * nie powtarzaja tresci implementacji.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeSupabaseUrl } from './supabase-url.js';

// --- adres poprawny ---------------------------------------------------------

test('poprawny adres przechodzi bez zmian', () => {
  assert.equal(
    normalizeSupabaseUrl('https://xxx.supabase.co', 'NEXT_PUBLIC_SUPABASE_URL'),
    'https://xxx.supabase.co',
  );
});

// --- sciezka /rest/v1: funkcja RZUCA, nie obcina po cichu -------------------

test('adres ze sciezka /rest/v1 rzuca wyjatkiem zamiast po cichu obciac sciezke', () => {
  // To jest sedno awarii z naglowka pliku: cichej naprawy tu NIE WOLNO
  // zrobic, bo poprzednia wersja tego typu "naprawy" i tak wywalala PGRST125
  // gdzie indziej. Test pilnuje, ze funkcja przerywa z czytelnym komunikatem,
  // a nie zwraca skorygowany URL.
  assert.throws(
    () => normalizeSupabaseUrl('https://xxx.supabase.co/rest/v1', 'NEXT_PUBLIC_SUPABASE_URL'),
    /zawiera sciezke/,
  );
});

test('komunikat o sciezce /rest/v1 tlumaczy mechanizm awarii (PGRST125), nie tylko nazywa blad', () => {
  assert.throws(
    () => normalizeSupabaseUrl('https://xxx.supabase.co/rest/v1/', 'NEXT_PUBLIC_SUPABASE_URL'),
    /PGRST125/,
  );
});

test('dowolna inna sciezka (nie tylko /rest/v1) tez jest odrzucana', () => {
  assert.throws(
    () => normalizeSupabaseUrl('https://xxx.supabase.co/cokolwiek', 'NEXT_PUBLIC_SUPABASE_URL'),
    /zawiera sciezke/,
  );
});

// --- komunikat bledu musi nazywac zmienna -----------------------------------

test('komunikat o sciezce zawiera nazwe zmiennej przekazana w varName', () => {
  assert.throws(
    () => normalizeSupabaseUrl('https://xxx.supabase.co/rest/v1', 'MOJA_ZMIENNA_TESTOWA'),
    /MOJA_ZMIENNA_TESTOWA/,
    'bez nazwy zmiennej czlowiek nie wie, ktory wpis w .env.local poprawic',
  );
});

test('komunikat o niepoprawnym URL-u zawiera nazwe zmiennej', () => {
  assert.throws(
    () => normalizeSupabaseUrl('nie-jest-urlem', 'INNA_ZMIENNA'),
    /INNA_ZMIENNA/,
  );
});

// --- wartosc pusta i undefined ----------------------------------------------

test('brak wartosci (undefined) rzuca i nazywa zmienna, ktorej brakuje', () => {
  assert.throws(
    () => normalizeSupabaseUrl(undefined, 'SUPABASE_SERVICE_ROLE_URL'),
    /Brak zmiennej/,
  );
  assert.throws(
    () => normalizeSupabaseUrl(undefined, 'SUPABASE_SERVICE_ROLE_URL'),
    /SUPABASE_SERVICE_ROLE_URL/,
  );
});

test('pusty string traktowany jest tak samo jak undefined', () => {
  assert.throws(
    () => normalizeSupabaseUrl('', 'NEXT_PUBLIC_SUPABASE_URL'),
    /Brak zmiennej NEXT_PUBLIC_SUPABASE_URL/,
  );
});

test('sam bialy znak (bez tresci) tez liczy sie jako brak wartosci', () => {
  // ' '.trim() daje '', wiec to ta sama galaz co pusty string i undefined —
  // sprawdzamy, ze trim() dzieje sie PRZED sprawdzeniem pustki.
  assert.throws(
    () => normalizeSupabaseUrl('   ', 'NEXT_PUBLIC_SUPABASE_URL'),
    /Brak zmiennej NEXT_PUBLIC_SUPABASE_URL/,
  );
});

// --- ukosnik na koncu --------------------------------------------------------

test('ukosnik na koncu adresu znika — wynik nigdy nie konczy sie slashem', () => {
  const wynik = normalizeSupabaseUrl('https://xxx.supabase.co/', 'NEXT_PUBLIC_SUPABASE_URL');
  assert.equal(wynik, 'https://xxx.supabase.co');
  assert.ok(!wynik.endsWith('/'), 'sam koncowy slash nie moze byc traktowany jak sciezka i wywalac bledu');
});

// --- adres, ktory nie jest adresem ------------------------------------------

test('tekst, ktory nie jest URL-em, rzuca czytelny blad zamiast wyjatku z wnetrza URL()', () => {
  assert.throws(
    () => normalizeSupabaseUrl('nie-jest-urlem', 'NEXT_PUBLIC_SUPABASE_URL'),
    /nie jest poprawnym adresem URL/,
  );
});

// --- biale znaki na brzegach (kopiowanie z panelu Supabase) -----------------

test('spacje i tabulacje na brzegach sa obcinane przed walidacja', () => {
  assert.equal(
    normalizeSupabaseUrl('  https://xxx.supabase.co  ', 'NEXT_PUBLIC_SUPABASE_URL'),
    'https://xxx.supabase.co',
  );
  assert.equal(
    normalizeSupabaseUrl('\thttps://xxx.supabase.co\t', 'NEXT_PUBLIC_SUPABASE_URL'),
    'https://xxx.supabase.co',
  );
});

test('koncowy znak nowej linii (CRLF z pliku .env edytowanego na Windowsie) nie zostaje w wyniku', () => {
  assert.equal(
    normalizeSupabaseUrl('https://xxx.supabase.co\r\n', 'NEXT_PUBLIC_SUPABASE_URL'),
    'https://xxx.supabase.co',
  );
});

// --- wlasnosc ogolna: wynik nigdy nie zawiera sciezki -----------------------

test('kazdy adres, ktory przejdzie walidacje, ma origin bez sciezki, parametrow i kotwicy', () => {
  for (const adres of [
    'https://abc.supabase.co',
    'https://abc.supabase.co/',
    '  https://abc.supabase.co  ',
  ]) {
    const wynik = normalizeSupabaseUrl(adres, 'X');
    assert.match(wynik, /^https:\/\/[^/?#]+$/, `"${adres}" -> "${wynik}" powinien byc samym originem`);
  }
});
