/**
 * Testy mappera procesow. Bez sieci, bez bazy.
 *   npx tsx --test ingest/mappers/process.test.ts
 *
 * Dane wejsciowe to REALNE odpowiedzi z sond 30 i 31 (kadencja X, proces nr 1),
 * przepisane bez zmian. Nie wymyslone.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  mapProcess,
  mapStages,
  nieznaneWartosci,
  ZNANE_STAGE_TYPES,
  ZNANE_DOCUMENT_TYPES,
  type SejmProcess,
} from './process.js';

const ZRODLO = '00000000-0000-0000-0000-000000000001';

/** Proces nr 1, kadencja X — dokladnie tak, jak zwrocila sonda 31. */
const PROCES_1: SejmProcess = {
  ELI: 'MP/2023/1261',
  UE: 'NO',
  changeDate: '2023-11-14T11:44:49',
  closureDate: '2023-11-13',
  documentType: 'projekt uchwały',
  documentTypeEnum: 'DRAFT_RESOLUTION',
  legislativeCommittee: false,
  links: [
    { href: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WMP20230001261', rel: 'isap' },
    { href: 'https://eli.gov.pl/eli/MP/2023/1261/ogl', rel: 'eli' },
    { href: 'https://api.sejm.gov.pl/eli/acts/MP/2023/1261', rel: 'eli-api' },
  ],
  number: '1',
  passed: true,
  principleOfSubsidiarity: false,
  printsConsideredJointly: ['2'],
  processStartDate: '2023-11-13',
  shortenProcedure: false,
  term: 10,
  title: 'Poselski projekt uchwały w sprawie ustalenia liczby wicemarszałków Sejmu Rzeczypospolitej Polskiej',
  titleFinal: 'w sprawie ustalenia liczby wicemarszałków Sejmu',
  urgencyStatus: 'NORMAL',
  stages: [
    { date: '2023-11-13', stageName: 'Projekt wpłynął do Sejmu', printNumber: '1', stageType: 'Start' },
    {
      date: '2023-11-13',
      stageName: 'Skierowano do I czytania na posiedzeniu Sejmu',
      stageType: 'ReadingReferral',
      children: [
        { date: '2023-11-13', stageName: 'Skierowanie', committeeCode: 'Sejm', stageType: 'Referral' },
      ],
    },
    {
      date: '2023-11-13',
      stageName: 'Rozpatrywanie na forum Sejmu',
      stageType: 'SejmReading',
      children: [
        {
          date: '2023-11-13',
          stageName: 'Głosowanie',
          stageType: 'Voting',
          decision: 'podjęto uchwałę',
          sittingNum: 1,
          voting: {
            term: 10,
            sitting: 1,
            sittingDay: 1,
            votingNumber: 2,
            date: '2023-11-13T18:02:12',
            description: 'w sprawie ustalenia liczby wicemarszałków Sejmu',
            topic: 'głosowanie nad całością projektu.',
          } as never,
        },
      ],
    },
  ],
};

// --- proces --------------------------------------------------------------

test('realny proces mapuje sie na komplet pol', () => {
  const p = mapProcess(PROCES_1, ZRODLO);
  assert.equal(p.print_number, '1');
  assert.equal(p.term, 10);
  assert.equal(p.title_final, 'w sprawie ustalenia liczby wicemarszałków Sejmu');
  assert.equal(p.document_type, 'projekt uchwały');
  assert.equal(p.process_start, '2023-11-13');
  assert.equal(p.closure_date, '2023-11-13');
  assert.equal(p.passed, true);
  assert.equal(p.eli_address, 'MP/2023/1261');
  assert.equal(p.ue, 'NO');
  assert.equal(p.shorten_procedure, false);
  assert.equal(p.source_id, ZRODLO);
});

test('isap_url bierzemy z links[rel=isap], nie z pierwszego linku', () => {
  // W tablicy sa trzy linki i isap NIE jest jedynym. Wziecie links[0]
  // dzialaloby na tej probce i psulo sie na innej.
  const p = mapProcess(PROCES_1, ZRODLO);
  assert.equal(p.isap_url, 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WMP20230001261');
});

test('brak linkow nie wywraca mappera', () => {
  const p = mapProcess({ ...PROCES_1, links: undefined }, ZRODLO);
  assert.equal(p.isap_url, null);
});

test('changeDate zostaje momentem, daty procesu sa dniami', () => {
  const p = mapProcess(PROCES_1, ZRODLO);
  assert.equal(p.change_date, '2023-11-14T11:44:49');
  assert.equal(p.process_start, '2023-11-13', 'data dzienna bez czesci czasowej');
});

test('proces nie jest rozpatrywany lacznie sam ze soba', () => {
  // API potrafi wymienic wlasny numer na liscie. Bez odsiania proces 34
  // odsylalby sam do siebie w interfejsie.
  const p = mapProcess({ ...PROCES_1, printsConsideredJointly: ['1', '2'] }, ZRODLO);
  assert.deepEqual(p.prints_jointly, ['2']);
});

test('proces bez numeru albo bez tytulu przerywa', () => {
  assert.throws(() => mapProcess({ ...PROCES_1, number: '' }, ZRODLO), /bez numeru/);
  assert.throws(() => mapProcess({ ...PROCES_1, title: '  ' }, ZRODLO), /bez tytulu/);
});

// --- etapy ---------------------------------------------------------------

const bezDopasowania = () => null;

test('drzewo etapow splaszcza sie z zachowaniem kolejnosci i poziomu', () => {
  const e = mapStages('1', PROCES_1.stages, bezDopasowania);
  assert.equal(e.length, 5, '3 etapy glowne + 2 podetapy');
  assert.deepEqual(
    e.map((x) => [x.ordinal, x.depth, x.stage_name]),
    [
      [0, 1, 'Projekt wpłynął do Sejmu'],
      [1, 1, 'Skierowano do I czytania na posiedzeniu Sejmu'],
      [2, 2, 'Skierowanie'],
      [3, 1, 'Rozpatrywanie na forum Sejmu'],
      [4, 2, 'Głosowanie'],
    ],
    'podetap stoi tuz za swoim rodzicem',
  );
});

test('etap glosowania niesie surowe wspolrzedne', () => {
  const e = mapStages('1', PROCES_1.stages, bezDopasowania);
  const g = e.find((x) => x.stage_type === 'Voting')!;
  assert.equal(g.voting_sitting, 1);
  assert.equal(g.voting_number, 2);
  assert.equal(g.decision, 'podjęto uchwałę');
  assert.equal(g.sitting_num, 1);
});

test('voting_id jest wypelniane, gdy glosowanie jest w bazie', () => {
  const e = mapStages('1', PROCES_1.stages, (s, n) => (s === 1 && n === 2 ? 4242 : null));
  assert.equal(e.find((x) => x.stage_type === 'Voting')!.voting_id, 4242);
});

test('brak dopasowania NIE kasuje surowych wspolrzednych', () => {
  // To jest cala roznica miedzy "etap nie ma glosowania" a "nie umielismy
  // go dopasowac". Bez tego drugi przypadek znika bez sladu.
  const e = mapStages('1', PROCES_1.stages, bezDopasowania);
  const g = e.find((x) => x.stage_type === 'Voting')!;
  assert.equal(g.voting_id, null);
  assert.equal(g.voting_sitting, 1);
  assert.equal(g.voting_number, 2);
});

test('etapy bez glosowania maja puste wszystkie trzy pola', () => {
  const e = mapStages('1', PROCES_1.stages, () => 999);
  const start = e[0]!;
  assert.equal(start.voting_sitting, null);
  assert.equal(start.voting_number, null);
  assert.equal(start.voting_id, null, 'dopasowanie nie moze byc wolane bez wspolrzednych');
});

test('glebokosc 3 tez sie splaszcza — nie zakladamy zmierzonych dwoch poziomow', () => {
  const e = mapStages(
    '9',
    [{ stageName: 'A', children: [{ stageName: 'B', children: [{ stageName: 'C' }] }] }],
    bezDopasowania,
  );
  assert.deepEqual(e.map((x) => [x.depth, x.stage_name]), [[1, 'A'], [2, 'B'], [3, 'C']]);
});

test('etap bez nazwy jest pomijany, a numeracja zostaje ciagla', () => {
  const e = mapStages('9', [{ stageName: 'A' }, { stageName: '  ' }, { stageName: 'C' }], bezDopasowania);
  assert.deepEqual(e.map((x) => [x.ordinal, x.stage_name]), [[0, 'A'], [1, 'C']]);
});

test('brak etapow daje pusta liste, nie wyjatek', () => {
  assert.deepEqual(mapStages('9', undefined, bezDopasowania), []);
});

// --- slowniki ------------------------------------------------------------

test('zmierzone slowniki nie zglaszaja nic nowego', () => {
  const e = mapStages('1', PROCES_1.stages, bezDopasowania);
  assert.deepEqual(nieznaneWartosci(e, 'stage_type', ZNANE_STAGE_TYPES), []);
  assert.deepEqual(nieznaneWartosci([mapProcess(PROCES_1, ZRODLO)], 'document_type', ZNANE_DOCUMENT_TYPES), []);
});

test('nowy typ etapu jest zglaszany', () => {
  const e = mapStages('9', [{ stageName: 'X', stageType: 'ConstitutionalTribunal' }], bezDopasowania);
  assert.deepEqual(nieznaneWartosci(e, 'stage_type', ZNANE_STAGE_TYPES), ['ConstitutionalTribunal']);
});

test('literowka API w GovermentPosition jest zachowana', () => {
  // "Goverment" zamiast "Government" — tak zwraca API. Poprawienie tego
  // po naszej stronie sprawiloby, ze kazdy taki etap raportowalby sie
  // jako nieznany typ.
  assert.ok((ZNANE_STAGE_TYPES as readonly string[]).includes('GovermentPosition'));
});

test('slowniki obejmuja wartosci z PELNEGO importu, nie tylko z probki', () => {
  // Sonda 31 przejrzala 40 procesow i znalazla 12 typow etapu. Pelny import
  // 1 662 procesow (15 724 etapow) dolozyl siedem kolejnych, a wsrod typow
  // dokumentu piec. To jest argument za tym, zeby importer RAPORTOWAL nieznane
  // wartosci zamiast na nich przerywac: probka nigdy nie pokaze calego slownika.
  const zEtapow = ['Veto', 'PublicHearing', 'PresidentToTribunal', 'Opinion', 'Reading'];
  for (const t of zEtapow) {
    assert.ok((ZNANE_STAGE_TYPES as readonly string[]).includes(t), `brakuje ${t}`);
  }
  const zDokumentow = ['sprawozdanie', 'zawiadomienie', 'informacja rządowa', 'wniosek (bez druku)'];
  for (const t of zDokumentow) {
    assert.ok((ZNANE_DOCUMENT_TYPES as readonly string[]).includes(t), `brakuje ${t}`);
  }
});
