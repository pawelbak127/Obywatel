/**
 * Testy formatowania. Bez sieci, bez bazy, bez Reacta.
 *   npx tsx --test src/lib/format.test.ts
 *
 * Nazwiska w przykladach sa PRAWDZIWE i pochodza z naszej bazy — bo to na nich
 * naiwne `slice(0, 2)` sie wywraca.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { polskieDaty, inicjaly, procent, skalaDo, odmien, skrotKlubu } from './format.js';

// --- daty ----------------------------------------------------------------

test('daty ISO zamieniaja sie na polskie w calym zdaniu', () => {
  assert.equal(
    polskieDaty('Prezes Rady Ministrów (od 2023-12-13)'),
    'Prezes Rady Ministrów (od 13.12.2023)',
  );
});

test('zdanie z dwiema datami zamienia obie', () => {
  assert.equal(
    polskieDaty('Minister (od 2023-11-27 do 2024-05-14)'),
    'Minister (od 27.11.2023 do 14.05.2024)',
  );
});

test('tekst bez daty zostaje nietkniety', () => {
  assert.equal(polskieDaty('Marszałek Sejmu'), 'Marszałek Sejmu');
});

// --- inicjaly ------------------------------------------------------------

test('zwykle imie i nazwisko', () => {
  assert.equal(inicjaly('Donald Tusk'), 'DT');
});

test('nazwisko dwuczlonowe daje litere nazwiska, nie myslnik', () => {
  assert.equal(inicjaly('Władysław Kosiniak-Kamysz'), 'WK');
});

test('imie zlozone bierze PIERWSZE imie i NAZWISKO, nie dwa imiona', () => {
  // Naiwne "dwa pierwsze czlony" dawaloby tu "AM" — czyli inicjaly imion,
  // a nie osoby. Przy 499 poslach takich przypadkow jest kilkadziesiat.
  assert.equal(inicjaly('Anna Maria Żukowska'), 'AŻ');
});

test('polskie znaki nie gina przy zamianie na wielkie litery', () => {
  assert.equal(inicjaly('Łukasz Ścigała'), 'ŁŚ');
});

test('jeden czlon daje jedna litere, nie wyjatek', () => {
  assert.equal(inicjaly('Kukiz'), 'K');
});

test('pusty tekst daje znak zapytania, nie pusty portret', () => {
  assert.equal(inicjaly('   '), '?');
  assert.equal(inicjaly(''), '?');
});

test('twarda spacja rozdziela czlony tak samo jak zwykla', () => {
  assert.equal(inicjaly('Donald Tusk'), 'DT');
});

// --- procent -------------------------------------------------------------

test('liczba dostaje przecinek dziesietny', () => {
  assert.equal(procent(54.3), '54,3');
  assert.equal(procent(100), '100,0');
  assert.equal(procent(0.05, 2), '0,05');
});

test('polowka na granicy zaokraglenia — zachowanie ZMIERZONE, nie zalozone', () => {
  // Pierwsza wersja tego testu zakladala 54,05 -> "54,1". Jest "54,0", bo
  // 54.05 w IEEE754 to 54.04999..., a `toFixed` zaokragla to, co naprawde
  // siedzi w zmiennej, nie to, co widac w kodzie.
  //
  // Dla nas jest to nieszkodliwe: procenty przychodza z Postgresa juz
  // zaokraglone do jednego miejsca (`round(..., 1)` w migracji 0009), wiec
  // `procent()` ich nie zaokragla, tylko przepisuje kropke na przecinek.
  // Zapisuje to jednak jako test, zeby nikt nie zaczal liczyc tu sredniej
  // ani nie przepuscil przez ta funkcje surowego ilorazu.
  assert.equal(procent(54.05), '54,0');
  assert.equal(procent(2.5, 0), '3');
});

test('brak wartosci to polpauza, a NIE zero', () => {
  // To nie jest kosmetyka. "0,0%" znaczy "zmierzylismy zero", a "—" znaczy
  // "nie mamy tej liczby". W serwisie rozliczajacym poslow z frekwencji
  // pomylenie tych dwoch rzeczy jest bledem merytorycznym.
  assert.equal(procent(null), '—');
  assert.equal(procent(undefined), '—');
  assert.equal(procent(Number.NaN), '—');
  assert.equal(procent(0), '0,0');
});

// --- skala ---------------------------------------------------------------

test('skala zaokragla w gore do dziesiatki', () => {
  assert.equal(skalaDo([34.2, 12.0, 1.5]), 40);
  assert.equal(skalaDo([8.1, 2.0]), 10);
});

test('skala nigdy nie schodzi ponizej minimum', () => {
  // Lista z jednym poslem o niezgodnosci 0,3% nie moze dostac skali 0-0,3,
  // bo jego pasek wypelnilby cala szerokosc i wygladal jak rekord kadencji.
  assert.equal(skalaDo([0.3]), 10);
  assert.equal(skalaDo([]), 10);
  assert.equal(skalaDo([null, null]), 10);
});

test('skala ustawiona recznie na wyzsze minimum jest respektowana', () => {
  assert.equal(skalaDo([12], 100), 100);
});

test('wartosc dokladnie na dziesiatce nie przeskakuje wyzej', () => {
  // 30 ma dac 30, nie 40 — inaczej pasek najwyzszej wartosci nigdy nie dobija
  // do konca skali i wykres wyglada na uciety.
  assert.equal(skalaDo([30]), 30);
});

// --- odmien ----------------------------------------------------------------

test('odmien: jedynka bierze forme pojedyncza, zero i piatka - dopelniacz', () => {
  const P = ['poseł', 'posłowie', 'posłów'] as const;
  assert.equal(odmien(1, P), 'poseł');
  assert.equal(odmien(0, P), 'posłów');
  assert.equal(odmien(5, P), 'posłów');
  assert.equal(odmien(499, P), 'posłów');
});

test('odmien: 2, 3, 4 i ich wielokrotnosci biora mianownik liczby mnogiej', () => {
  const P = ['poseł', 'posłowie', 'posłów'] as const;
  // To jest przypadek, ktory pierwsza wersja licznika na /poslowie mylila.
  assert.equal(odmien(2, P), 'posłowie');
  assert.equal(odmien(3, P), 'posłowie');
  assert.equal(odmien(4, P), 'posłowie');
  assert.equal(odmien(22, P), 'posłowie');
  assert.equal(odmien(23, P), 'posłowie');
  assert.equal(odmien(104, P), 'posłowie');
});

test('odmien: nastolatki 12-14 sa wyjatkiem mimo koncowki 2, 3, 4', () => {
  // Ta trojka jest calym powodem, dla ktorego regula nie miesci sie w progu.
  const P = ['poseł', 'posłowie', 'posłów'] as const;
  assert.equal(odmien(12, P), 'posłów');
  assert.equal(odmien(13, P), 'posłów');
  assert.equal(odmien(14, P), 'posłów');
  // ...ale 112-114 tez, bo liczy sie reszta z dzielenia przez 100.
  assert.equal(odmien(112, P), 'posłów');
  assert.equal(odmien(113, P), 'posłów');
  // Kontrola odwrotna: 212 to nadal nastolatka w setce.
  assert.equal(odmien(212, P), 'posłów');
  assert.equal(odmien(222, P), 'posłowie');
});

test('odmien: dziala na innym rzeczowniku niz posel', () => {
  const W = ['wynik', 'wyniki', 'wyników'] as const;
  assert.equal(odmien(1, W), 'wynik');
  assert.equal(odmien(3, W), 'wyniki');
  assert.equal(odmien(11, W), 'wyników');
});

// --- skrotKlubu ------------------------------------------------------------

test('skrotKlubu zamienia podkreslenie na spacje, reszty nie rusza', () => {
  assert.equal(skrotKlubu('Konfederacja_KP'), 'Konfederacja KP');
  // Mysnik NIE jest podkresleniem — „PSL-TD" i „Polska2050-TD" maja zostac.
  assert.equal(skrotKlubu('PSL-TD'), 'PSL-TD');
  assert.equal(skrotKlubu('Polska2050-TD'), 'Polska2050-TD');
  assert.equal(skrotKlubu('KO'), 'KO');
  assert.equal(skrotKlubu('niez.'), 'niez.');
});

test('skrotKlubu nie zmienia klucza, ktory trafia do adresu', () => {
  // Kontrola swiadomosci: funkcja jest WYLACZNIE prezentacyjna. Gdyby ktos
  // uzyl jej wyniku do zbudowania /klub/..., adres przestalby dzialac.
  const id = 'Konfederacja_KP';
  assert.notEqual(skrotKlubu(id), id, 'jesli to przestanie sie roznic, sprawdz po co ta funkcja istnieje');
});
