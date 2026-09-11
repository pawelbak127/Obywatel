/**
 * Mapper procesow legislacyjnych. Napisany PO sondach 30 i 31, przeciwko
 * zmierzonemu ksztaltowi odpowiedzi — nie przeciwko nazwom kolumn, ktore
 * sam wymyslilem w migracji 0001.
 *
 * ZMIERZONE, na czym to stoi:
 *   * 1 662 procesy (naglowek x-total-count), stronicowane po `limit`/`offset`
 *   * numery NIE sa ciagle: limit=500 zwraca numery 1-772, /processes/2000 daje 404
 *   * etapy przychodza WYLACZNIE ze szczegolow procesu, nie z listy
 *   * drzewo etapow ma glebokosc 2 (153 etapy poziomu 1, 68 poziomu 2 w probce 40)
 *   * 11 z 221 etapow niesie pelny obiekt `voting` z polami `sitting`
 *     i `votingNumber` — czyli kluczem `votings (term, sitting, voting_number)`
 */

export type SejmProcessStage = {
  stageName: string;
  stageType?: string;
  date?: string;
  decision?: string;
  printNumber?: string;
  committeeCode?: string;
  sittingNum?: number;
  children?: SejmProcessStage[];
  voting?: {
    term?: number;
    sitting?: number;
    votingNumber?: number;
    date?: string;
    title?: string;
    topic?: string;
  };
};

export type SejmProcess = {
  number: string;
  term: number;
  title: string;
  titleFinal?: string;
  description?: string;
  comments?: string;
  documentType?: string;
  documentTypeEnum?: string;
  processStartDate?: string;
  closureDate?: string;
  changeDate?: string;
  passed?: boolean;
  urgencyStatus?: string;
  UE?: string;
  shortenProcedure?: boolean;
  legislativeCommittee?: boolean;
  principleOfSubsidiarity?: boolean;
  ELI?: string;
  printsConsideredJointly?: string[];
  links?: { rel: string; href: string }[];
  stages?: SejmProcessStage[];
};

export type WierszProcesu = {
  print_number: string;
  term: number;
  title: string;
  title_final: string | null;
  description: string | null;
  comments: string | null;
  document_type: string | null;
  document_type_enum: string | null;
  process_start: string | null;
  closure_date: string | null;
  change_date: string | null;
  passed: boolean | null;
  urgency_status: string | null;
  ue: string | null;
  shorten_procedure: boolean | null;
  legislative_committee: boolean | null;
  principle_of_subsidiarity: boolean | null;
  eli_address: string | null;
  isap_url: string | null;
  prints_jointly: string[] | null;
  source_id: string;
};

export type WierszEtapu = {
  print_number: string;
  ordinal: number;
  depth: number;
  stage_date: string | null;
  stage_type: string | null;
  stage_name: string;
  decision: string | null;
  child_print: string | null;
  committee_code: string | null;
  sitting_num: number | null;
  voting_sitting: number | null;
  voting_number: number | null;
  voting_id: number | null;
};

const tekst = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
};

/** Data z API bywa dniem ("2023-11-13") albo momentem ("2023-11-14T11:44:49"). */
const dzien = (v: unknown): string | null => {
  const t = tekst(v);
  if (!t) return null;
  const m = t.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1]! : null;
};

const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);

export function mapProcess(p: SejmProcess, sourceId: string): WierszProcesu {
  const numer = tekst(p.number);
  if (!numer) throw new Error('Proces bez numeru — nie ma czym go zaadresowac.');
  if (!tekst(p.title)) throw new Error(`Proces ${numer} bez tytulu.`);

  return {
    print_number: numer,
    term: Number(p.term),
    title: p.title.trim(),
    title_final: tekst(p.titleFinal),
    description: tekst(p.description),
    comments: tekst(p.comments),
    document_type: tekst(p.documentType),
    document_type_enum: tekst(p.documentTypeEnum),
    process_start: dzien(p.processStartDate),
    closure_date: dzien(p.closureDate),
    change_date: tekst(p.changeDate),
    passed: bool(p.passed),
    urgency_status: tekst(p.urgencyStatus),
    ue: tekst(p.UE),
    shorten_procedure: bool(p.shortenProcedure),
    legislative_committee: bool(p.legislativeCommittee),
    principle_of_subsidiarity: bool(p.principleOfSubsidiarity),
    eli_address: tekst(p.ELI),
    isap_url: p.links?.find((l) => l.rel === 'isap')?.href ?? null,
    // Sam siebie proces nie rozpatruje lacznie ze soba — API czasem tak podaje.
    prints_jointly: Array.isArray(p.printsConsideredJointly)
      ? p.printsConsideredJointly.map(String).filter((n) => n !== numer)
      : null,
    source_id: sourceId,
  };
}

/**
 * Splaszczenie drzewa etapow.
 *
 * Zmierzona glebokosc to 2, ale funkcja schodzi rekurencyjnie na dowolna —
 * ograniczanie sie do dwoch poziomow oznaczaloby, ze trzeci poziom zniknie
 * po cichu, a to jest gorsze niz blad. `ordinal` numeruje etapy w kolejnosci
 * odwiedzania, wiec podetapy stoja tuz za swoim rodzicem.
 *
 * `dopasujGlosowanie` dostaje (sitting, votingNumber) i zwraca nasze
 * `votings.id` albo null. Null NIE jest bledem: glosowanie moze byc jeszcze
 * niezaimportowane. Dlatego surowe wspolrzedne zapisujemy zawsze — inaczej
 * "etap nie ma glosowania" i "nie umielismy go dopasowac" wygladaja tak samo.
 */
export function mapStages(
  printNumber: string,
  stages: SejmProcessStage[] | undefined,
  dopasujGlosowanie: (sitting: number, votingNumber: number) => number | null,
): WierszEtapu[] {
  const out: WierszEtapu[] = [];
  let ordinal = 0;

  const zejdz = (lista: SejmProcessStage[], depth: number) => {
    for (const s of lista) {
      const nazwa = tekst(s.stageName);
      if (!nazwa) continue; // etap bez nazwy nie niesie zadnej informacji

      const vs = typeof s.voting?.sitting === 'number' ? s.voting.sitting : null;
      const vn = typeof s.voting?.votingNumber === 'number' ? s.voting.votingNumber : null;

      out.push({
        print_number: printNumber,
        ordinal: ordinal++,
        depth,
        stage_date: dzien(s.date),
        stage_type: tekst(s.stageType),
        stage_name: nazwa,
        decision: tekst(s.decision),
        child_print: tekst(s.printNumber),
        committee_code: tekst(s.committeeCode),
        sitting_num: typeof s.sittingNum === 'number' ? s.sittingNum : null,
        voting_sitting: vs,
        voting_number: vn,
        voting_id: vs !== null && vn !== null ? dopasujGlosowanie(vs, vn) : null,
      });

      if (Array.isArray(s.children) && s.children.length) zejdz(s.children, depth + 1);
    }
  };

  zejdz(stages ?? [], 1);
  return out;
}

/**
 * Slowniki zmierzone sonda 31. NIE sa enumami w bazie — kolumny sa tekstowe,
 * bo to opisy, a nie wartosci, na ktorych cokolwiek liczymy.
 *
 * Importer i tak raportuje wartosci spoza tej listy. Nie po to, zeby przerwac,
 * tylko zeby nowy typ etapu nie pojawil sie na stronie bez niczyjej wiedzy.
 */
export const ZNANE_STAGE_TYPES = [
  // zmierzone sonda 31 na probce 40 procesow
  'Start', 'Referral', 'ReadingReferral', 'SejmReading', 'Voting', 'End',
  'CommitteeReport', 'CommitteeWork', 'SenatePosition', 'ToPresident',
  'PresidentSignature', 'GovermentPosition', // literowka jest w API — zachowana
  // dopisane po PELNYM imporcie 1 662 procesow (15 724 etapow) — probka
  // czterdziestu procesow ich nie zawierala
  'Opinion', 'PresidentMotionConsideration', 'PresidentToTribunal',
  'PublicHearing', 'Reading', 'SenatePositionConsideration', 'Veto',
] as const;

export const ZNANE_DOCUMENT_TYPES = [
  'projekt ustawy', 'projekt uchwały', 'wniosek', 'lista kandydatów',
  // z pelnego importu
  'informacja innych organów', 'informacja rządowa', 'sprawozdanie',
  'wniosek (bez druku)', 'zawiadomienie',
] as const;

export function nieznaneWartosci<T extends Record<string, unknown>>(
  rekordy: readonly T[],
  klucz: keyof T,
  znane: readonly string[],
): string[] {
  const zbior = new Set(znane);
  const nowe = new Set<string>();
  for (const r of rekordy) {
    const v = r[klucz];
    if (typeof v === 'string' && v !== '' && !zbior.has(v)) nowe.add(v);
  }
  return [...nowe].sort();
}
