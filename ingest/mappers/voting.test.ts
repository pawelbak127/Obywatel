/**
 * Testy mapperow glosowan. Bez sieci, bez bazy.
 *   npx tsx --test ingest/mappers/voting.test.ts
 *
 * Dane wejsciowe pochodza z realnych odpowiedzi API zebranych sondami
 * (posiedzenie 63, kadencja X) — nie z wyobrazni.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractPrintNumbers, mapVoting, mapVotes, checkVotingConsistency, unknownVoteValues } from './voting.js';
import { jestStanowiskiem, jestObecnoscia, nieznaneWartosci } from '../lib/vote-values.js';
import type { SejmVoting } from '../lib/sejm-client.js';

// --- numery drukow -------------------------------------------------------

test('numer druku z realnego tytulu glosowania', () => {
  assert.deepEqual(
    extractPrintNumbers('Głosowanie proceduralne dotyczące druku nr 2848'),
    ['2848'],
  );
});

test('ten sam druk w tytule i temacie nie dubluje sie', () => {
  // Sonda 22 zwracala "druk 2848,2848" wlasnie z tego powodu.
  assert.deepEqual(
    extractPrintNumbers(
      'Głosowanie proceduralne dotyczące druku nr 2848',
      'wniosek o skrócenie terminu w sprawie przedłożenia z druku nr 2848',
    ),
    ['2848'],
  );
});

test('kilka drukow w jednym zdaniu', () => {
  assert.deepEqual(extractPrintNumbers('sprawozdanie komisji (druki nr 2600 i 2811)'), ['2600', '2811']);
  assert.deepEqual(extractPrintNumbers('druki nr 2600, 2811 oraz 2862'), ['2600', '2811', '2862']);
});

test('odmiana slowa "druk" nie gubi numeru', () => {
  for (const t of ['druk nr 100', 'druku nr 100', 'drukiem nr 100', 'drukach nr 100', 'druk 100']) {
    assert.deepEqual(extractPrintNumbers(t), ['100'], `nie zadzialalo dla: ${t}`);
  }
});

test('sortowanie jest numeryczne, nie tekstowe', () => {
  // '10' przed '9' rozwalaloby porownania i wyglad na osi czasu.
  assert.deepEqual(extractPrintNumbers('druki nr 9, 10, 100'), ['9', '10', '100']);
});

test('brak druku daje pusta liste, nie falszywe trafienie', () => {
  assert.deepEqual(extractPrintNumbers('Wniosek o odroczenie posiedzenia'), []);
  assert.deepEqual(extractPrintNumbers(undefined, null), []);
});

// --- mapowanie glosowania ------------------------------------------------

const GLOSOWANIE_63_1: SejmVoting = {
  term: 10, sitting: 63, sittingDay: 1, votingNumber: 1,
  date: '2026-07-29T10:10:41',
  title: 'Głosowanie proceduralne dotyczące druku nr 2848',
  topic: 'wniosek o skrócenie terminu, o którym mowa w art. 37 ust. 4 regulaminu Sejmu',
  kind: 'ELECTRONIC', majorityType: 'SIMPLE_MAJORITY', majorityVotes: 251,
  yes: 183, no: 250, abstain: 0, notParticipating: 27, totalVoted: 433,
  links: [{ rel: 'pdf', href: 'https://api.sejm.gov.pl/sejm/term10/votings/63/1/pdf' }],
  votes: [
    { MP: 1, firstName: 'Andrzej', lastName: 'Adamczyk', club: 'PiS', vote: 'NO' },
    { MP: 2, firstName: 'Anna', lastName: 'Nowak', club: 'KO', vote: 'YES' },
    { MP: 3, firstName: 'Jan', lastName: 'Kowalski', club: 'KO', vote: 'ABSENT' },
  ],
};

test('mapVoting bierze oficjalny PDF z links[rel=pdf] jako zrodlo', () => {
  const row = mapVoting(GLOSOWANIE_63_1, 'uuid');
  assert.equal(row.pdf_url, 'https://api.sejm.gov.pl/sejm/term10/votings/63/1/pdf');
  assert.deepEqual(row.print_numbers, ['2848']);
  assert.equal(row.sitting, 63);
  assert.equal(row.voting_number, 1);
  assert.equal(row.yes, 183);
});

test('brak links[rel=pdf] nie zostawia pustego zrodla', () => {
  const row = mapVoting({ ...GLOSOWANIE_63_1, links: undefined }, 'uuid');
  assert.match(row.pdf_url ?? '', /\/votings\/63\/1\/pdf$/);
});

test('klub zapisujemy z GLOSU, nie z profilu posla', () => {
  // Posel zmienia klub w trakcie kadencji. Lojalnosc historyczna musi
  // porownywac go z klubem, w ktorym byl W MOMENCIE glosowania.
  const clubSeq = new Map([['PiS', 1], ['KO', 2]]);
  const { votes } = mapVotes(GLOSOWANIE_63_1, { votingId: 100, clubSeq });
  assert.equal(votes.length, 3);
  assert.deepEqual(votes[0], { voting_id: 100, mp_id: 1, club_seq: 1, value: 'NO' });
  assert.deepEqual(votes[1], { voting_id: 100, mp_id: 2, club_seq: 2, value: 'YES' });
});

test('nieznany kod klubu daje NULL, nie wysypuje importu', () => {
  const { votes } = mapVotes(GLOSOWANIE_63_1, { votingId: 100, clubSeq: new Map() });
  assert.equal(votes[0]!.club_seq, null);
});

// --- glosowania listowe (ON_LIST) ---------------------------------------

const GLOSOWANIE_LISTOWE: SejmVoting = {
  ...GLOSOWANIE_63_1,
  votingNumber: 7, kind: 'ON_LIST',
  yes: 0, no: 0, abstain: 0, notParticipating: 1, totalVoted: 2,
  votes: [
    { MP: 1, firstName: 'A', lastName: 'B', club: 'PiS', vote: undefined as never, listVotes: { '1': 'YES', '2': 'NO' } },
    { MP: 2, firstName: 'C', lastName: 'D', club: 'KO', vote: undefined as never, listVotes: {} },
  ],
};

test('glos listowy liczy sie jako uczestnictwo, nie jako nieobecnosc', () => {
  // TO JEST PULAPKA, ktora po cichu zanizylaby frekwencje: przy ON_LIST pole
  // `vote` bywa puste, a decyzje siedza w listVotes.
  const { votes } = mapVotes(GLOSOWANIE_LISTOWE, { votingId: 7, clubSeq: new Map([['PiS', 1], ['KO', 2]]) });
  assert.equal(votes[0]!.value, 'PRESENT', 'posel glosowal na liscie — to obecnosc bez stanowiska');
  assert.equal(votes[1]!.value, 'ABSENT', 'pusta lista i brak vote — realna nieobecnosc');
});

// --- dziedzina wartosci glosu -------------------------------------------

test('PRESENT to obecnosc, ale NIE stanowisko', () => {
  // Backfill posiedzenia 63 wywalil sie na tej wartosci. Gorsze od bledu byloby
  // wpuszczenie jej do lojalnosci: posel obecny bez stanowiska wyszedlby na
  // nielojalnego wobec wiekszosci klubu — zarzut za glos, ktorego nie oddal.
  assert.equal(jestObecnoscia('PRESENT'), true, 'frekwencja: obecny');
  assert.equal(jestStanowiskiem('PRESENT'), false, 'lojalnosc: brak stanowiska');

  for (const v of ['YES', 'NO', 'ABSTAIN']) {
    assert.equal(jestStanowiskiem(v), true, `${v} jest stanowiskiem`);
    assert.equal(jestObecnoscia(v), true);
  }
  assert.equal(jestObecnoscia('ABSENT'), false);
  assert.equal(jestStanowiskiem('ABSENT'), false);
});

test('nowa, nieznana wartosc NIE wchodzi do lojalnosci sama z siebie', () => {
  // Lista dozwolonych, nie zakazanych — to jest cala roznica.
  assert.equal(jestStanowiskiem('COS_NOWEGO_OD_SEJMU'), false);
});

test('nieznane wartosci sa wykrywane i posortowane', () => {
  assert.deepEqual(nieznaneWartosci(['YES', 'NO', 'PRESENT', 'ABSENT']), []);
  assert.deepEqual(nieznaneWartosci(['YES', 'ZULU', 'ALFA', 'ZULU', undefined, null]), ['ALFA', 'ZULU']);
});

test('kontrola dziedziny przeglada cale posiedzenie, takze listVotes', () => {
  const podejrzane: SejmVoting = {
    ...GLOSOWANIE_63_1,
    votes: [
      { MP: 1, firstName: 'A', lastName: 'B', club: 'X', vote: 'PRESENT' },
      { MP: 2, firstName: 'C', lastName: 'D', club: 'X', vote: 'YES', listVotes: { '1': 'NOWA_WARTOSC' as never } },
    ],
  };
  assert.deepEqual(unknownVoteValues([GLOSOWANIE_63_1, podejrzane]), ['NOWA_WARTOSC']);
  assert.deepEqual(unknownVoteValues([GLOSOWANIE_63_1]), [], 'znane wartosci nie zglaszaja nic');
});

test('szczegoly listy trafiaja do osobnej tabeli i nic nie ginie', () => {
  const { listVotes } = mapVotes(GLOSOWANIE_LISTOWE, { votingId: 7, clubSeq: new Map() });
  assert.equal(listVotes.length, 2);
  assert.deepEqual(listVotes[0], { voting_id: 7, mp_id: 1, option_key: '1', value: 'YES' });
  assert.deepEqual(listVotes[1], { voting_id: 7, mp_id: 1, option_key: '2', value: 'NO' });
});

// --- kontrola spojnosci --------------------------------------------------

test('zgodne sumy nie zglaszaja problemu', () => {
  const v: SejmVoting = {
    ...GLOSOWANIE_63_1,
    yes: 1, no: 1, abstain: 0, notParticipating: 1,
    votes: [
      { MP: 1, firstName: 'A', lastName: 'B', club: 'X', vote: 'YES' },
      { MP: 2, firstName: 'C', lastName: 'D', club: 'X', vote: 'NO' },
      { MP: 3, firstName: 'E', lastName: 'F', club: 'X', vote: 'ABSENT' },
    ],
  };
  assert.equal(checkVotingConsistency(v), null);
});

test('rozjazd sumy imiennej z licznikiem API jest wykrywany', () => {
  // Gdyby API podalo 200 na "za", a imiennie bylo 183, nie wolno tego zapisac
  // jako faktu przy nazwisku posla bez ostrzezenia w logu.
  const problem = checkVotingConsistency({ ...GLOSOWANIE_63_1, yes: 200 });
  assert.ok(problem, 'powinien zwrocic opis problemu');
  assert.match(problem!, /za: imiennie 1 vs licznik 200/);
});

test('glosowania listowe sa wylaczone z kontroli sum', () => {
  // Przy ON_LIST liczniki zbiorcze odnosza sie do pozycji listy, nie do za/przeciw.
  assert.equal(checkVotingConsistency(GLOSOWANIE_LISTOWE), null);
});

test('glosowanie bez tablicy votes nie wywraca kontroli', () => {
  assert.equal(checkVotingConsistency({ ...GLOSOWANIE_63_1, votes: undefined }), null);
});
