/**
 * Czyste funkcje: odpowiedz Sejm API -> wiersze tabel `votings`, `votes`, `list_votes`.
 * Bez sieci i bez bazy, wiec w calosci testowalne (`voting.test.ts`).
 */

import type { SejmVoting, SejmVote } from '../lib/sejm-client.js';
import { votingPdfUrl } from '../lib/sejm-client.js';
import { nieznaneWartosci } from '../lib/vote-values.js';

export type VotingRow = {
  term: number;
  sitting: number;
  sitting_day: number | null;
  voting_number: number;
  voted_at: string;
  title: string;
  topic: string | null;
  description: string | null;
  kind: string | null;
  majority_type: string | null;
  majority_votes: number | null;
  yes: number;
  no: number;
  abstain: number;
  not_participating: number;
  total_voted: number;
  pdf_url: string | null;
  print_numbers: string[] | null;
  source_id: string;
};

export type VoteRow = {
  voting_id: number;
  mp_id: number;
  club_seq: number | null;
  value: SejmVote['vote'];
};

export type ListVoteRow = {
  voting_id: number;
  mp_id: number;
  option_key: string;
  value: SejmVote['vote'];
};

const nz = (v: string | undefined | null): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

/**
 * Wyluskuje numery drukow sejmowych z tytulu i tematu glosowania.
 *
 * To jest sciezka zapasowa dla "Osi Czasu Obietnic": proces legislacyjny
 * (/processes/{nr}) niesie numer glosowania wprost, ale nie kazdy proces go ma.
 * Zmierzone na posiedzeniu 63: regex trafia w 69 z 74 glosowan, czyli 93%.
 *
 * Przyklady z realnych danych:
 *   "Głosowanie proceduralne dotyczące druku nr 2848"
 *   "...w sprawie przedłożenia z druku nr 2848"
 *   "...o zmianie ustawy (druki nr 2600 i 2811)"
 */
const DRUK_RE = /druk(?:ach|ami|ow|ów|iem|em|u|i|a)?\s*(?:nr\s*)?(\d{1,4}(?:\s*(?:,|i|oraz)\s*\d{1,4})*)/gi;

export function extractPrintNumbers(...texts: Array<string | undefined | null>): string[] {
  const found = new Set<string>();
  for (const t of texts) {
    if (!t) continue;
    for (const m of t.matchAll(DRUK_RE)) {
      for (const n of m[1]!.split(/\s*(?:,|i|oraz)\s*/)) {
        const num = n.trim();
        if (num) found.add(num);
      }
    }
  }
  // Sortowanie numeryczne — inaczej '10' wypada przed '9' i porownania sie sypia.
  return [...found].sort((a, b) => Number(a) - Number(b));
}

export function mapVoting(v: SejmVoting, sourceId: string): VotingRow {
  return {
    term: v.term,
    sitting: v.sitting,
    sitting_day: Number.isFinite(v.sittingDay) ? v.sittingDay : null,
    voting_number: v.votingNumber,
    voted_at: v.date,
    title: v.title,
    topic: nz(v.topic),
    description: nz(v.description),
    kind: nz(v.kind),
    majority_type: nz(v.majorityType),
    majority_votes: Number.isFinite(v.majorityVotes) ? (v.majorityVotes ?? null) : null,
    yes: v.yes ?? 0,
    no: v.no ?? 0,
    abstain: v.abstain ?? 0,
    not_participating: v.notParticipating ?? 0,
    total_voted: v.totalVoted ?? 0,
    pdf_url: votingPdfUrl(v),
    print_numbers: nullIfEmpty(extractPrintNumbers(v.title, v.topic, v.description)),
    source_id: sourceId,
  };
}

const nullIfEmpty = <T>(a: T[]): T[] | null => (a.length ? a : null);

/**
 * Pojedyncze glosy posla.
 *
 * PULAPKA, ktora psuje frekwencje po cichu: przy glosowaniu listowym
 * (kind = ON_LIST) pole `vote` bywa puste, a decyzje siedza w `listVotes`.
 * Zapisanie takiego glosu jako ABSENT zanizyloby frekwencje posla, ktory
 * najzwyczajniej glosowal. Traktujemy obecnosc `listVotes` jako uczestnictwo.
 */
export function mapVotes(
  v: SejmVoting,
  ctx: { votingId: number; clubSeq: Map<string, number> },
): { votes: VoteRow[]; listVotes: ListVoteRow[] } {
  const votes: VoteRow[] = [];
  const listVotes: ListVoteRow[] = [];

  for (const x of v.votes ?? []) {
    const pozycje = Object.entries(x.listVotes ?? {});
    const glosowalNaLiscie = pozycje.length > 0;

    // Gdy API nie poda `vote`, a sa decyzje na liscie — to obecnosc bez stanowiska.
    // Uzywamy tej samej wartosci, ktorej uzywa samo API w takiej sytuacji: PRESENT.
    const value: SejmVote['vote'] = x.vote ?? (glosowalNaLiscie ? 'PRESENT' : 'ABSENT');

    votes.push({
      voting_id: ctx.votingId,
      mp_id: x.MP,
      club_seq: ctx.clubSeq.get(x.club) ?? null,
      value,
    });

    for (const [option_key, val] of pozycje) {
      listVotes.push({ voting_id: ctx.votingId, mp_id: x.MP, option_key, value: val as SejmVote['vote'] });
    }
  }

  return { votes, listVotes };
}

/**
 * Kontrola spojnosci na zywych danych.
 *
 * Sejm API podaje liczniki zbiorcze (yes/no/abstain) NIEZALEZNIE od tablicy
 * glosow imiennych. Jesli sie rozjezdzaja, to albo zle parsujemy, albo zrodlo
 * ma blad — w obu przypadkach nie wolno tego zapisac jako fakt przy nazwisku posla.
 *
 * Glosowania listowe pomijamy: tam liczniki zbiorcze odnosza sie do pozycji listy,
 * a nie do prostego za/przeciw.
 */
/**
 * Zbiera wartosci glosu, ktorych nie zna nasz enum — z CALEGO posiedzenia naraz.
 *
 * Wolane PRZED jakimkolwiek zapisem. Import posiedzenia 63 wywalil sie na
 * "PRESENT" dopiero przy porcji nr 2000, gdy czesc danych byla juz w bazie.
 * Jedno sprawdzenie w pamieci kosztuje milisekundy i oszczedza taki stan.
 */
export function unknownVoteValues(votings: readonly SejmVoting[]): string[] {
  const wszystkie: string[] = [];
  for (const v of votings) {
    for (const x of v.votes ?? []) {
      if (x.vote) wszystkie.push(x.vote);
      for (const val of Object.values(x.listVotes ?? {})) wszystkie.push(val);
    }
  }
  return nieznaneWartosci(wszystkie);
}

export function checkVotingConsistency(v: SejmVoting): string | null {
  if (!Array.isArray(v.votes) || v.votes.length === 0) return null;
  if (v.kind === 'ON_LIST') return null;

  const licz = (val: string) => v.votes!.filter((x) => x.vote === val).length;
  const roznice: string[] = [];
  if (licz('YES') !== v.yes) roznice.push(`za: imiennie ${licz('YES')} vs licznik ${v.yes}`);
  if (licz('NO') !== v.no) roznice.push(`przeciw: imiennie ${licz('NO')} vs licznik ${v.no}`);
  if (licz('ABSTAIN') !== v.abstain) roznice.push(`wstrzymalo: imiennie ${licz('ABSTAIN')} vs licznik ${v.abstain}`);

  return roznice.length ? `posiedzenie ${v.sitting}, glosowanie ${v.votingNumber}: ${roznice.join('; ')}` : null;
}
