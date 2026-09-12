/**
 * Testy generatora adresow /posel/[slug]. Bez sieci, bez bazy.
 *   npx tsx --test ingest/lib/slug.test.ts
 *
 * Caly katalog ingest/lib/ nie mial dotad ani jednego testu, mimo ze slug.ts
 * jest jednym z plikow o najwiekszych konsekwencjach bledu w calym projekcie:
 * adres raz opublikowany krazy po X i jest kluczem cache grafik OG (patrz
 * komentarz w naglowku slug.ts). Testy ponizej pilnuja WLASNOSCI (niezmiennosc,
 * determinizm, brak kolizji), nie powtarzaja implementacji.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { slugify, assignSlugs } from './slug.js';
import type { SlugCandidate } from './slug.js';

const kandydat = (id: number, firstName: string, lastName: string, districtNum: number): SlugCandidate => ({
  id,
  firstName,
  lastName,
  districtNum,
});

// --- slugify ---------------------------------------------------------------

test('"ł" i "Ł" zamieniaja sie na "l" mimo ze Unicode NFD ich nie rusza', () => {
  // To jest pulapka nr 1 z naglowka pliku: "ł" nie jest w Unicode wariantem
  // "l" z diakrytykiem, wiec samo normalize('NFD') zostawia je nietkniete.
  // Gdyby ktos usunal mape PL i zdal sie tylko na NFD, "ł"/"Ł" wypadloby ze
  // sluga jako znak spoza [a-z0-9] i zamienilo sie w myslnik albo zniknelo.
  assert.equal(slugify('Łukasz Kmita'), 'lukasz-kmita');
  // "Władysław" ma DWIE male litery "ł" w srodku wyrazu - obie musza zniknac.
  assert.equal(slugify('Władysław Kosiniak-Kamysz'), 'wladyslaw-kosiniak-kamysz');
});

test('wielkie litery, spacje, myslniki, apostrofy i kropki dają czysty slug bez powtorzonych i skrajnych myslnikow', () => {
  assert.equal(slugify("O'Really -- Kowalski."), 'o-really-kowalski');
  assert.equal(slugify('  JAN   NOWAK  '), 'jan-nowak');
  assert.equal(slugify('---Zła--Droga---'), 'zla-droga');
});

test('nazwisko dwuczlonowe i zlozone imie zachowuja wszystkie czlony', () => {
  assert.equal(slugify('Żaneta Cwalina-Śliwowska'), 'zaneta-cwalina-sliwowska');
  assert.equal(slugify('Anna Maria Żukowska'), 'anna-maria-zukowska');
});

// --- assignSlugs: utrwalony slug jest niezmienny ----------------------------

test('slug utrwalony w bazie nie zmienia sie, nawet gdy dzisiejsze dane dalyby inny wynik', () => {
  // Symulacja realnego przypadku: posel zmienil nazwisko (np. przez malzenstwo),
  // ale adres /posel/... musi zostac ten sam, bo ludzie juz go wyslali dalej.
  const existing = new Map([[7, 'anna-kowalska']]);
  const slugi = assignSlugs([kandydat(7, 'Anna', 'Nowak-Wiśniewska', 12)], existing);
  assert.equal(slugi.get(7), 'anna-kowalska');
});

test('slug utrwalony blokuje ten sam adres dla innego posla o tym samym nazwisku', () => {
  // Nowy posel nie moze nadpisac adresu, ktory juz nalezy do kogos innego -
  // musi dostac wlasny, odrozniony sufiksem.
  const existing = new Map([[10, 'piotr-zielinski']]);
  const slugi = assignSlugs(
    [kandydat(10, 'Piotr', 'Zieliński', 3), kandydat(11, 'Piotr', 'Zieliński', 55)],
    existing,
  );
  assert.equal(slugi.get(10), 'piotr-zielinski');
  assert.equal(slugi.get(11), 'piotr-zielinski-55');
});

// --- assignSlugs: kolizje imiennikow ----------------------------------------

test('dwoch poslow o identycznym imieniu i nazwisku - drugi dostaje sufiks z okregiem, nie losowa liczbe', () => {
  const slugi = assignSlugs([
    kandydat(1, 'Marek', 'Wiśniewski', 4),
    kandydat(2, 'Marek', 'Wiśniewski', 19),
  ]);
  assert.equal(slugi.get(1), 'marek-wisniewski');
  assert.equal(slugi.get(2), 'marek-wisniewski-19');
});

test('gdy okreg tez jest identyczny, trzeci imiennik dostaje sufiks z id', () => {
  const slugi = assignSlugs([
    kandydat(1, 'Marek', 'Wiśniewski', 4),
    kandydat(2, 'Marek', 'Wiśniewski', 4),
    kandydat(3, 'Marek', 'Wiśniewski', 4),
  ]);
  assert.equal(slugi.get(1), 'marek-wisniewski');
  assert.equal(slugi.get(2), 'marek-wisniewski-4');
  assert.equal(slugi.get(3), 'marek-wisniewski-4-3');
});

test('kolejnosc podania listy nie zmienia wyniku - kolizje liczone sa deterministycznie wg id', () => {
  const ludzie = [
    kandydat(3, 'Ewa', 'Zielińska', 7),
    kandydat(1, 'Marek', 'Wiśniewski', 4),
    kandydat(9, 'Marek', 'Wiśniewski', 4),
    kandydat(5, 'Marek', 'Wiśniewski', 4),
  ];
  const przetasowani = [ludzie[2]!, ludzie[3]!, ludzie[0]!, ludzie[1]!];

  const a = assignSlugs(ludzie);
  const b = assignSlugs(przetasowani);

  // Porownanie jako posortowanej listy par, nie samego Map — zeby test
  // sprawdzal zawartosc, a nie polegal na wewnetrznej kolejnosci iteracji.
  assert.deepEqual([...a.entries()].sort(), [...b.entries()].sort());
});

// --- blad znaleziony w trakcie pisania testow -------------------------------

test('kolizja na trzecim poziomie PRZERYWA import, zamiast dac dwoch poslow pod jednym adresem', () => {
  /*
    Ten test powstal jako dokumentacja BLEDU (subagent, 12.09.2026): trzeci
    poziom eskalacji `base-okreg-id` byl przyjmowany bez sprawdzenia `taken`,
    wiec dwoch roznych ludzi moglo dostac ten sam adres /posel/… po cichu.

    Blad zostal naprawiony w slug.ts przy recenzji, a test przepisany tak,
    zeby sprawdzal ZACHOWANIE POPRAWNE. Wersja dokumentujaca usterke bylaby
    pulapka: po naprawie kodu swiecilaby na czerwono i kusila, zeby "naprawic
    test" zamiast zostawic naprawe.

    Ustawka jest sztuczna — utrwalony slug posla 99 zawiera `id` posla 5,
    czego dane z Sejm API nie wyprodukuja. O to chodzi: sprawdzamy bezpiecznik,
    ktory ma zadzialac wlasnie wtedy, gdy stanie sie cos nieprzewidzianego.
  */
  const existing = new Map([
    [99, 'jan-kowalski-13-5'], // slug utrwalony dla KOGOS INNEGO
    [100, 'jan-kowalski'], // zajmuje wariant bazowy
    [101, 'jan-kowalski-13'], // zajmuje wariant z okregiem
  ]);
  const ludzie = [
    kandydat(99, 'Zenon', 'Nowicki', 5),
    kandydat(100, 'Jan', 'Kowalski', 1),
    kandydat(101, 'Jan', 'Kowalski', 13),
    kandydat(5, 'Jan', 'Kowalski', 13), // NOWY - spada na trzeci poziom
  ];

  assert.throws(
    () => assignSlugs(ludzie, existing),
    /jest juz zajety/,
    'kolizja sluga musi przerwac import, a nie zostac zapisana',
  );
});

test('bez kolizji trzeci poziom dziala normalnie i nie rzuca', () => {
  // Kontrola odwrotna do poprzedniego testu: bezpiecznik nie moze przerywac
  // importu tam, gdzie sufiks z id naprawde rozstrzyga kolizje.
  const ludzie = [
    kandydat(10, 'Jan', 'Kowalski', 13),
    kandydat(11, 'Jan', 'Kowalski', 13),
    kandydat(12, 'Jan', 'Kowalski', 13),
  ];
  const slugi = assignSlugs(ludzie);

  assert.equal(slugi.get(10), 'jan-kowalski');
  assert.equal(slugi.get(11), 'jan-kowalski-13');
  assert.equal(slugi.get(12), 'jan-kowalski-13-12');
  assert.equal(new Set([...slugi.values()]).size, 3, 'trzy osoby, trzy rozne adresy');
});
