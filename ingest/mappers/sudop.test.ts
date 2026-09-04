/**
 * Testy parsera i mappera eksportu SUDOP. Bez sieci, bez bazy.
 *   npx tsx --test ingest/mappers/sudop.test.ts
 *
 * FIXTURE. `PROBKA_B64` to bajt w bajt prawdziwy plik pobrany z wyszukiwarki
 * UOKiK — nie przepisany recznie i nie przekodowany do UTF-8. To jest celowe:
 * caly ten modul istnieje dlatego, ze piec razy wyciagnalem wniosek z tego,
 * jak dane wygladaly, zamiast z tego, jakie bajty przyszly. Test na
 * "poprawionej" probce sprawdzalby moje wyobrazenie o pliku.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { wykryjKodowanie, dekoduj, parsujCsv, wczytajCsv } from '../lib/csv.js';
import {
  NAGLOWKI_SUDOP,
  sprawdzNaglowek,
  ZlyNaglowek,
  parsujKwote,
  parsujDate,
  nipPoprawny,
  terytPoprawny,
  mapujWiersz,
  nieznaneWielkosci,
  dedupujGminy,
} from './sudop.js';

const PROBKA_B64 =
  'Ik5hendhIGJlbmVmaWNqZW50YSBwb21vY3kiOyJOSVAgYmVuZWZpY2plbnRhIjsiUG9kbWlvdCB1ZHppZWxharljeSBwb21vY3ki' +
  'OyJVc3Rhd2EiOyJOdW1lciCccm9ka2EgcG9tb2Nvd2VnbyI7IkR6aWXxIHVkemllbGVuaWEgcG9tb2N5IjsiV2llbGtvnOYgYmVu' +
  'ZWZpY2plbnRhIjsiSWRlbnR5ZmlrYXRvciB0ZXJ5dG9yaWFsbnkgc2llZHppYnkgYmVuZWZpY2plbnRhIjsiS2xhc2EgUEtEIjsi' +
  'V2FydG+c5iBub21pbmFuYSBwb21vY3kgW1BMTl0iOyJXYXJ0b5zmIHBvbW9jeSBicnV0dG8gW1BMTl0iOyJXYXJ0b5zmIHBvbW9j' +
  'eSBicnV0dG8gW0VVUk9dIjsiRm9ybWEgcG9tb2N5IjsiUHJ6ZXpuYWN6ZW5pZSBwb21vY3kiDQoiT3BvbHNrYSBTcC4geiBvLm8u' +
  'IjsiODk5Mjc0Nzc5NyI7IlByZXp5ZGVudCBXcm9js2F3aWEiOyJ1c3Rhd2EgeiBkbmlhIDEyIHN0eWN6bmlhIDE5OTEgci4gbyBw' +
  'b2RhdGthY2ggaSBvcLNhdGFjaCBsb2thbG55Y2giOyJYUjk3LzIwMDciOyIzMS4wMS4yMDIwIjsibWGzZSBwcnplZHNp6mJpb3Jz' +
  'dHdvIjsiMDI2NDAxMSI7IjY4LjIwIjsiMTg0IDEyMiwxMCI7IjE4NCAxMjIsMTAiOyI0MiA4MDksMTQiOyJ6d29sbmllbmllIHog' +
  'cG9kYXRrdSI7InJlZ2lvbmFsbmEgcG9tb2MgaW53ZXN0eWN5am5hIg0K';

const PROBKA = Buffer.from(PROBKA_B64, 'base64');
const hash = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

// --- kodowanie -----------------------------------------------------------

test('probka jest w CP1250, nie w UTF-8', () => {
  assert.equal(wykryjKodowanie(PROBKA), 'windows-1250');
});

test('bajt 0xB9 dekoduje sie do a-z-ogonkiem, nie do znaku zapytania', () => {
  const tekst = dekoduj(PROBKA, 'windows-1250');
  assert.ok(tekst.includes('Podmiot udzielający pomocy'), 'polskie znaki w naglowku');
  assert.ok(tekst.includes('Prezydent Wrocławia'), 'polskie znaki w danych');
  assert.ok(!tekst.includes('�'), 'zaden znak nie zostal zastapiony znakiem zastepczym');
});

test('plik w UTF-8 tez jest rozpoznany — nie zakladamy CP1250 na stale', () => {
  const utf8 = Buffer.from('"Nazwa";"Wartość"\r\n"Ą";"1,00"\r\n', 'utf8');
  assert.equal(wykryjKodowanie(utf8), 'utf-8');
});

// --- parser CSV ----------------------------------------------------------

test('probka: 14 kolumn naglowka i jeden wiersz danych', () => {
  const { naglowki, wiersze, wierszyWPliku, kodowanie } = wczytajCsv(PROBKA);
  assert.equal(naglowki.length, 14);
  assert.equal(wierszyWPliku, 1);
  assert.equal(wiersze[0]!.length, 14);
  assert.equal(kodowanie, 'windows-1250');
});

test('naglowek probki zgadza sie z kontraktem co do znaku', () => {
  const { naglowki } = wczytajCsv(PROBKA);
  assert.deepEqual(naglowki, [...NAGLOWKI_SUDOP]);
});

test('literowka urzedu w naglowku jest czescia kontraktu', () => {
  // "nominana" zamiast "nominalna". Poprawienie jej po naszej stronie sprawiloby,
  // ze import przestalby przyjmowac prawdziwe pliki.
  assert.ok(NAGLOWKI_SUDOP.includes('Wartość nominana pomocy [PLN]'));
});

test('srednik wewnatrz cudzyslowu nie rozbija kolumn', () => {
  // Nazwa spolki jawnej z KRS potrafi zawierac srednik. Przy split(';') ten wiersz
  // przesunalby wszystkie kolumny o jedna pozycje i wpisal NIP do pola z nazwa organu.
  const w = parsujCsv('"Kowalski; Wspólnicy sp. j.";"1234563218"\r\n');
  assert.deepEqual(w, [['Kowalski; Wspólnicy sp. j.', '1234563218']]);
});

test('podwojony cudzyslow to znak ucieczki, a nie koniec pola', () => {
  assert.deepEqual(parsujCsv('"program ""Czyste Powietrze""";"x"\r\n'), [['program "Czyste Powietrze"', 'x']]);
});

test('nowa linia wewnatrz pola nie tworzy nowego wiersza', () => {
  assert.deepEqual(parsujCsv('"ustawa\r\nz dnia 12 stycznia";"x"\r\n'), [['ustawa\r\nz dnia 12 stycznia', 'x']]);
});

// --- kontrakt naglowka ---------------------------------------------------

test('naglowek probki przechodzi kontrole', () => {
  assert.doesNotThrow(() => sprawdzNaglowek([...NAGLOWKI_SUDOP]));
});

test('inna liczba kolumn przerywa import', () => {
  assert.throws(() => sprawdzNaglowek(['Nazwa beneficjenta pomocy']), ZlyNaglowek);
});

test('zamienione kolejnoscia kolumny przerywaja import', () => {
  // To jest ten przypadek, dla ktorego kontrakt w ogole istnieje: gdyby UOKiK
  // zamienil miejscami kwote nominalna i brutto, zaden typ danych by nie zaprotestowal.
  const zamienione: string[] = [...NAGLOWKI_SUDOP];
  const tmp = zamienione[9]!;
  zamienione[9] = zamienione[10]!;
  zamienione[10] = tmp;
  assert.throws(() => sprawdzNaglowek(zamienione), ZlyNaglowek);
});

test('komunikat o zlym naglowku pokazuje ktora kolumna sie rozjechala', () => {
  const zle: string[] = [...NAGLOWKI_SUDOP];
  zle[9] = 'Wartość nominalna pomocy [PLN]'; // urzad poprawil literowke
  try {
    sprawdzNaglowek(zle);
    assert.fail('powinno rzucic');
  } catch (e) {
    const m = (e as Error).message;
    assert.ok(m.includes('ROZN'), 'zaznacza rozniace sie wiersze');
    assert.ok(m.includes('nominana'), 'pokazuje oczekiwana nazwe');
    assert.ok(m.includes('nominalna'), 'pokazuje otrzymana nazwe');
    assert.ok(m.includes('nic nie zapisano'), 'mowi, ze baza jest nietknieta');
  }
});

// --- kwoty ---------------------------------------------------------------

test('kwota ze spacja jako separatorem tysiecy i przecinkiem dziesietnym', () => {
  assert.equal(parsujKwote('184 122,10'), 184122.1);
  assert.equal(parsujKwote('42 809,14'), 42809.14);
  assert.equal(parsujKwote('1 000 000,00'), 1000000);
  assert.equal(parsujKwote('0,01'), 0.01);
});

test('twarda i waska spacja tez sa separatorem tysiecy', () => {
  assert.equal(parsujKwote('184 122,10'), 184122.1);
  assert.equal(parsujKwote('184 122,10'), 184122.1);
});

test('puste pole kwoty to null, nie zero', () => {
  // D14: null nie jest zerem. "0 zl pomocy" i "nie podano kwoty" to rozne zdania.
  assert.equal(parsujKwote(''), null);
  assert.equal(parsujKwote('   '), null);
});

test('kwota w nieznanym formacie przerywa, zamiast dawac NaN', () => {
  assert.throws(() => parsujKwote('184,122.10'), /nierozpoznanym formacie/); // format angielski
  assert.throws(() => parsujKwote('brak danych'), /nierozpoznanym formacie/);
});

// --- daty ----------------------------------------------------------------

test('data dd.mm.rrrr na ISO', () => {
  assert.equal(parsujDate('31.01.2020'), '2020-01-31');
  assert.equal(parsujDate('01.12.2007'), '2007-12-01');
});

test('data nieistniejaca w kalendarzu przerywa', () => {
  assert.throws(() => parsujDate('31.02.2020'), /nie istnieje/);
  assert.throws(() => parsujDate('2020-01-31'), /nierozpoznanym formacie/);
});

test('29 lutego przechodzi w roku przestepnym, a nie przechodzi w zwyklym', () => {
  assert.equal(parsujDate('29.02.2020'), '2020-02-29');
  assert.throws(() => parsujDate('29.02.2021'), /nie istnieje/);
});

// --- NIP i TERYT ---------------------------------------------------------

test('NIP z probki ma poprawna sume kontrolna', () => {
  assert.equal(nipPoprawny('8992747797'), true);
});

test('literowka w NIP-ie jest wykrywana', () => {
  // Laczenie dotacji z czymkolwiek po NIP-ie z bledna suma kontrolna
  // to laczenie po literowce — a stad juz krok do zniesławienia.
  assert.equal(nipPoprawny('8992747798'), false);
  assert.equal(nipPoprawny('1234567890'), false);
  assert.equal(nipPoprawny('899274779'), false, 'za krotki');
  assert.equal(nipPoprawny(''), false);
});

test('TERYT to dokladnie 7 cyfr, z zerem wiodacym', () => {
  assert.equal(terytPoprawny('0264011'), true);
  assert.equal(terytPoprawny('264011'), false, 'zero wiodace nie jest ozdoba');
  assert.equal(terytPoprawny('026401'), false);
});

// --- mapowanie calego wiersza -------------------------------------------

test('prawdziwy wiersz z probki mapuje sie na komplet pol', () => {
  const { wiersze } = wczytajCsv(PROBKA);
  const w = mapujWiersz(wiersze[0]!, hash);

  assert.equal(w.beneficiary_name, 'Opolska Sp. z o.o.');
  assert.equal(w.beneficiary_nip, '8992747797');
  assert.equal(w.nip_valid, true);
  assert.equal(w.grantor_name, 'Prezydent Wrocławia');
  assert.equal(w.legal_basis, 'ustawa z dnia 12 stycznia 1991 r. o podatkach i opłatach lokalnych');
  assert.equal(w.measure_number, 'XR97/2007');
  assert.equal(w.granted_on, '2020-01-31');
  assert.equal(w.beneficiary_size, 'małe przedsiębiorstwo');
  assert.equal(w.teryt, '0264011');
  assert.equal(w.pkd, '68.20');
  assert.equal(w.value_nominal_pln, 184122.1);
  assert.equal(w.value_gross_pln, 184122.1);
  assert.equal(w.value_gross_eur, 42809.14);
  assert.equal(w.aid_form, 'zwolnienie z podatku');
  assert.equal(w.aid_purpose, 'regionalna pomoc inwestycyjna');
  assert.equal(w.row_sha256.length, 64);
});

test('TERYT jest w pliku — to jest ta kolumna, ktora odblokowuje modul lokalny', () => {
  // Zapisane w tescie, zeby nie zginelo: wczesniej twierdzilem, ze eksport
  // nie zawiera lokalizacji. Zawiera, w tym samym formacie co slownik
  // gmina-siedziby z API (4 170 pozycji).
  const { wiersze } = wczytajCsv(PROBKA);
  assert.equal(mapujWiersz(wiersze[0]!, hash).teryt, '0264011'); // Wroclaw
});

test('ten sam wiersz daje ten sam hash, rozny wiersz — rozny', () => {
  const { wiersze } = wczytajCsv(PROBKA);
  const a = mapujWiersz(wiersze[0]!, hash);
  const b = mapujWiersz([...wiersze[0]!], hash);
  assert.equal(a.row_sha256, b.row_sha256, 'deduplikacja miedzy eksportami musi dzialac');

  const inny = [...wiersze[0]!];
  inny[10] = '184 122,11';
  assert.notEqual(mapujWiersz(inny, hash).row_sha256, a.row_sha256);
});

test('biale znaki wokol pol nie tworza duplikatu', () => {
  const { wiersze } = wczytajCsv(PROBKA);
  const zeSpacjami = wiersze[0]!.map((k, i) => (i === 0 ? `  ${k} ` : k));
  assert.equal(mapujWiersz(zeSpacjami, hash).row_sha256, mapujWiersz(wiersze[0]!, hash).row_sha256);
});

test('wiersz o zlej liczbie kolumn przerywa', () => {
  assert.throws(() => mapujWiersz(['a', 'b'], hash), /2 kolumn zamiast 14/);
});

test('pusta nazwa beneficjenta przerywa', () => {
  const { wiersze } = wczytajCsv(PROBKA);
  const bezNazwy = [...wiersze[0]!];
  bezNazwy[0] = '   ';
  assert.throws(() => mapujWiersz(bezNazwy, hash), /Pusta nazwa/);
});

test('nieznana wielkosc beneficjenta jest raportowana, ale nie przerywa importu', () => {
  const { wiersze } = wczytajCsv(PROBKA);
  const nowa = [...wiersze[0]!];
  nowa[6] = 'kategoria, ktorej jeszcze nie widzielismy';
  const zmapowane = [mapujWiersz(wiersze[0]!, hash), mapujWiersz(nowa, hash)];
  assert.deepEqual(nieznaneWielkosci(zmapowane), ['kategoria, ktorej jeszcze nie widzielismy']);
});

test('bledny NIP nie przerywa importu, tylko zostaje oznaczony', () => {
  // Rejestr moze zawierac literowke i mamy obowiazek pokazac to, co w nim jest.
  // Ale widok `dotacje_publiczne` takiego NIP-u nie wystawi.
  const { wiersze } = wczytajCsv(PROBKA);
  const zly = [...wiersze[0]!];
  zly[1] = '8992747798';
  const w = mapujWiersz(zly, hash);
  assert.equal(w.beneficiary_nip, '8992747798');
  assert.equal(w.nip_valid, false);
});

// --- slownik gmin: deduplikacja ------------------------------------------
//
// Slownik ma 4 170 pozycji przy okolo 2 477 gminach, a pierwszy import wywalil sie
// na "ON CONFLICT DO UPDATE command cannot affect row a second time" — czyli ten sam
// kod TERYT wystepuje w nim wiecej niz raz.

test('powtorzony kod TERYT zostaje raz', () => {
  const { wybrane, konflikty } = dedupujGminy([
    { teryt: '0264011', nazwa: 'Wrocław', koniec: '9999-12-31' },
    { teryt: '0264011', nazwa: 'Wrocław', koniec: '9999-12-31' },
    { teryt: '1465011', nazwa: 'Warszawa', koniec: '9999-12-31' },
  ]);
  assert.equal(wybrane.length, 2);
  assert.deepEqual(konflikty, [], 'identyczne nazwy to nie konflikt');
});

test('przy roznych nazwach wygrywa wpis obowiazujacy najdluzej', () => {
  const { wybrane } = dedupujGminy([
    { teryt: '0201011', nazwa: 'Stara nazwa', koniec: '2015-12-31' },
    { teryt: '0201011', nazwa: 'Nowa nazwa', koniec: '9999-12-31' },
  ]);
  assert.equal(wybrane[0]!.nazwa, 'Nowa nazwa');
});

test('kolejnosc wejscia nie decyduje o wyniku', () => {
  const a = dedupujGminy([
    { teryt: '0201011', nazwa: 'Nowa nazwa', koniec: '9999-12-31' },
    { teryt: '0201011', nazwa: 'Stara nazwa', koniec: '2015-12-31' },
  ]);
  assert.equal(a.wybrane[0]!.nazwa, 'Nowa nazwa');
});

test('rozne nazwy pod jednym kodem trafiaja do raportu, a nie gina po cichu', () => {
  const { konflikty } = dedupujGminy([
    { teryt: '0201011', nazwa: 'Stara nazwa', koniec: '2015-12-31' },
    { teryt: '0201011', nazwa: 'Nowa nazwa', koniec: '9999-12-31' },
  ]);
  assert.equal(konflikty.length, 1);
  assert.ok(konflikty[0]!.includes('Stara nazwa'), 'raport pokazuje odrzucona nazwe');
  assert.ok(konflikty[0]!.includes('Nowa nazwa'), 'raport pokazuje wybrana nazwe');
  assert.ok(konflikty[0]!.includes('0201011'), 'raport pokazuje kod');
});

test('bez dat zostaje pierwszy wpis, ale konflikt jest zgloszony', () => {
  const { wybrane, konflikty } = dedupujGminy([
    { teryt: '0201011', nazwa: 'Pierwsza', koniec: '' },
    { teryt: '0201011', nazwa: 'Druga', koniec: '' },
  ]);
  assert.equal(wybrane[0]!.nazwa, 'Pierwsza');
  assert.equal(konflikty.length, 1);
});

// --- wielkosc beneficjenta: dziedzina zmierzona, nie zgadnieta -----------

test('brzmienia wielkosci beneficjenta z prawdziwych eksportow sa znane', () => {
  // Wszystkie cztery wystapily w eksportach z /results/aidEvent. Pierwsza wersja
  // tej listy byla zgadnieta i tylko jedna pozycja z niej sie potwierdzila.
  const { wiersze } = wczytajCsv(PROBKA);
  const zmierzone = [
    'małe przedsiębiorstwo',
    'duży przedsiębiorca',
    'beneficjent nienależący do kategorii określonych kodem od 0 do 2',
    'przedsiębiorstwo nienależące do kategorii określonych kodem od 0 do 2',
  ];
  const zmapowane = zmierzone.map((w) => {
    const k = [...wiersze[0]!];
    k[6] = w;
    return mapujWiersz(k, hash);
  });
  assert.deepEqual(nieznaneWielkosci(zmapowane), []);
});

test('rozne brzmienia NIE sa sprowadzane do jednej kategorii', () => {
  // "duzy przedsiebiorca" i "beneficjent nienalezacy do kategorii 0-2" to nie jest
  // dowodliwie to samo — drugie moze obejmowac podmioty niebedace przedsiebiorcami.
  const { wiersze } = wczytajCsv(PROBKA);
  const a = [...wiersze[0]!]; a[6] = 'duży przedsiębiorca';
  const b = [...wiersze[0]!]; b[6] = 'beneficjent nienależący do kategorii określonych kodem od 0 do 2';
  assert.notEqual(mapujWiersz(a, hash).beneficiary_size, mapujWiersz(b, hash).beneficiary_size);
});

test('odrzucona nazwa gminy nie ginie — wraca w wariantach', () => {
  // Zmierzone: slownik ma 11 kodow pod dwiema nazwami (Swieta Katarzyna /
  // Siechnice i podobne). Bez tego wyszukanie po nowej nazwie nie trafialoby w nic.
  const { wybrane } = dedupujGminy([
    { teryt: '0223083', nazwa: 'ŚWIĘTA KATARZYNA', koniec: '' },
    { teryt: '0223083', nazwa: 'SIECHNICE', koniec: '' },
  ]);
  assert.equal(wybrane.length, 1);
  assert.equal(wybrane[0]!.nazwa, 'ŚWIĘTA KATARZYNA');
  assert.deepEqual(wybrane[0]!.warianty, ['SIECHNICE']);
});

test('gmina bez powtorzen ma pusta liste wariantow', () => {
  const { wybrane } = dedupujGminy([{ teryt: '0264011', nazwa: 'Wrocław', koniec: '' }]);
  assert.deepEqual(wybrane[0]!.warianty, []);
});

test('identyczna nazwa dwa razy nie staje sie wariantem', () => {
  const { wybrane } = dedupujGminy([
    { teryt: '0264011', nazwa: 'Wrocław', koniec: '' },
    { teryt: '0264011', nazwa: 'Wrocław', koniec: '' },
  ]);
  assert.deepEqual(wybrane[0]!.warianty, []);
});
