/**
 * Testy funkcji czystych. Bez sieci, bez bazy - odpalaja sie w sekunde.
 *
 *   npx tsx --test ingest/mappers/mp.test.ts
 *
 * Przypadki nie sa wymyslone: kazdy pochodzi z realnych danych kadencji X
 * albo z bledu, ktory popelnilem w sondach.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { slugify, assignSlugs } from '../lib/slug.js';
import { mapMP, mapClub, mapInferredClub, assertPlausible } from './mp.js';
import type { SejmMP, SejmClub } from '../lib/sejm-client.js';

test('slugify radzi sobie z polskimi znakami', () => {
  assert.equal(slugify('Andrzej Adamczyk'), 'andrzej-adamczyk');
  assert.equal(slugify('Paweł Śliż'), 'pawel-sliz');
  assert.equal(slugify('Żaneta Cwalina-Śliwowska'), 'zaneta-cwalina-sliwowska');
  assert.equal(slugify('Józef Łaźniewski'), 'jozef-lazniewski');
});

test('"ł" nie znika przez NFD — to osobna litera Unicode, nie l z diakrytykiem', () => {
  // Klasyczna pulapka: sam normalize('NFD') zostawia "ł" nietkniete.
  assert.equal('ł'.normalize('NFD').replace(/[̀-ͯ]/g, ''), 'ł');
  assert.equal(slugify('ł'), 'l');
});

test('slugify nie zostawia myslnikow na brzegach', () => {
  assert.equal(slugify('  Jan   Kowalski!  '), 'jan-kowalski');
  assert.equal(slugify('---'), '');
});

const kandydat = (id: number, firstName: string, lastName: string, districtNum: number) =>
  ({ id, firstName, lastName, districtNum });

test('imiennicy dostaja sufiks z okregiem, nie losowa liczbe', () => {
  const slugs = assignSlugs([
    kandydat(1, 'Jan', 'Kowalski', 13),
    kandydat(2, 'Jan', 'Kowalski', 25),
  ]);
  assert.equal(slugs.get(1), 'jan-kowalski');
  assert.equal(slugs.get(2), 'jan-kowalski-25');
});

test('trzeci imiennik z tego samego okregu dostaje id', () => {
  const slugs = assignSlugs([
    kandydat(1, 'Jan', 'Kowalski', 13),
    kandydat(2, 'Jan', 'Kowalski', 13),
    kandydat(3, 'Jan', 'Kowalski', 13),
  ]);
  assert.deepEqual([slugs.get(1), slugs.get(2), slugs.get(3)], [
    'jan-kowalski', 'jan-kowalski-13', 'jan-kowalski-13-3',
  ]);
});

test('slug raz zapisany w bazie jest nienaruszalny', () => {
  // Adresy /posel/... kraza po X i sa kluczem cache dla grafik OG.
  const existing = new Map([[1, 'jan-kowalski-stary-slug']]);
  const slugs = assignSlugs([kandydat(1, 'Jan', 'Kowalski', 13)], existing);
  assert.equal(slugs.get(1), 'jan-kowalski-stary-slug');
});

test('nowy posel nie przejmie sluga zajetego przez utrwalony wpis', () => {
  const existing = new Map([[1, 'jan-kowalski']]);
  const slugs = assignSlugs(
    [kandydat(1, 'Jan', 'Kowalski', 13), kandydat(2, 'Jan', 'Kowalski', 40)],
    existing,
  );
  assert.equal(slugs.get(2), 'jan-kowalski-40');
});

test('kolejnosc wejscia nie zmienia wyniku — slugi sa deterministyczne', () => {
  const a = assignSlugs([kandydat(2, 'Jan', 'Kowalski', 25), kandydat(1, 'Jan', 'Kowalski', 13)]);
  const b = assignSlugs([kandydat(1, 'Jan', 'Kowalski', 13), kandydat(2, 'Jan', 'Kowalski', 25)]);
  assert.deepEqual([...a].sort(), [...b].sort());
});

// --- mapper --------------------------------------------------------------

const ADAMCZYK: SejmMP = {
  id: 1,
  firstName: 'Andrzej',
  secondName: 'Mieczysław',
  lastName: 'Adamczyk',
  firstLastName: 'Andrzej Adamczyk',
  lastFirstName: 'Adamczyk Andrzej',
  club: 'PiS',
  districtNum: 13,
  districtName: 'Kraków',
  voivodeship: 'małopolskie',
  profession: 'ekonomista',
  educationLevel: 'wyższe',
  birthDate: '1959-01-04',
  birthLocation: 'Krzeszowice',
  numberOfVotes: 45171,
  oathDate: '2023-11-13',
  email: 'Andrzej.Adamczyk@sejm.pl',
  active: true,
};

test('mapMP przepisuje realny rekord z API', () => {
  const row = mapMP(ADAMCZYK, { term: 10, slug: 'andrzej-adamczyk', clubSeq: 3, sourceId: 'uuid-1' });
  assert.equal(row.id, 1);
  assert.equal(row.first_name, 'Andrzej');
  assert.equal(row.second_name, 'Mieczysław');
  assert.equal(row.club_seq, 3);
  assert.equal(row.birth_date, '1959-01-04');
  assert.equal(row.source_id, 'uuid-1');
  assert.match(row.photo_url ?? '', /\/MP\/1\/photo$/);
});

test('puste stringi z API staja sie NULL, nie pustymi napisami', () => {
  const row = mapMP({ ...ADAMCZYK, profession: '   ', secondName: '' }, {
    term: 10, slug: 's', clubSeq: null, sourceId: 'uuid',
  });
  assert.equal(row.profession, null);
  assert.equal(row.second_name, null);
});

test('smiec w polu daty nie trafia do kolumny date', () => {
  const row = mapMP({ ...ADAMCZYK, birthDate: 'brak danych' }, {
    term: 10, slug: 's', clubSeq: null, sourceId: 'uuid',
  });
  assert.equal(row.birth_date, null);
});

test('mapClub zeruje puste telefony', () => {
  const club: SejmClub = { id: 'Centrum', name: 'Klub Parlamentarny Centrum', phone: '', fax: '(22) 694-20-71', membersCount: 15 };
  const row = mapClub(club, 'uuid');
  assert.equal(row.phone, null);
  assert.equal(row.fax, '(22) 694-20-71');
  assert.equal(row.members_count, 15);
  assert.equal(row.from_dictionary, true);
});

test('klub spoza slownika zachowuje ORYGINALNY kod, bez zgadywania', () => {
  // Realny przypadek z pierwszego importu: /clubs zna "Polska2050",
  // ale jeden posel ma w polu club wartosc "Polska2050-TD".
  // Przypisanie go do "Polska2050" byloby wymysleniem danych.
  const row = mapInferredClub('Polska2050-TD', 'uuid');
  assert.equal(row.id, 'Polska2050-TD');
  assert.equal(row.name, 'Polska2050-TD');
  assert.equal(row.from_dictionary, false);
  assert.match(row.note ?? '', /nie ma go w/);
  assert.notEqual(row.id, 'Polska2050');
});

// --- bezpiecznik ---------------------------------------------------------

test('import przerywa sie, gdy API zwroci podejrzanie malo poslow', () => {
  // Import, ktory po cichu wstawi 3 poslow zamiast 460, jest gorszy od takiego,
  // ktory sie wywali — bo strona nadal wyglada na dzialajaca.
  assert.throws(() => assertPlausible([ADAMCZYK]), /zwrocilo 1 poslow/);
});

test('import przerywa sie, gdy rekord nie ma nazwiska', () => {
  const mps = Array.from({ length: 460 }, (_, i) => ({ ...ADAMCZYK, id: i + 1 }));
  mps[7] = { ...mps[7]!, lastName: '' };
  assert.throws(() => assertPlausible(mps), /bez id\/imienia\/nazwiska/);
});

test('poprawna lista 460 aktywnych przechodzi', () => {
  const mps = Array.from({ length: 460 }, (_, i) => ({ ...ADAMCZYK, id: i + 1 }));
  assert.doesNotThrow(() => assertPlausible(mps));
});
