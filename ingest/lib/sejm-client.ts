/**
 * Typowany klient Sejm API. Wszystkie ksztalty pochodza z pomiaru na zywym API
 * (sondy 01, 11, 22), nie z dokumentacji - dokumentacja deklaruje wiecej pol,
 * niz API realnie zwraca.
 */

import { getJson } from './http.js';

export const SEJM_BASE = 'https://api.sejm.gov.pl/sejm';
export const TERM = Number(process.env.SEJM_TERM ?? 10);

/** Zmierzone pokrycie pol na 499 rekordach kadencji X - patrz komentarze. */
export type SejmMP = {
  id: number;
  firstName: string;
  lastName: string;
  secondName?: string;      // 66% rekordow
  firstLastName: string;
  lastFirstName: string;
  club: string;
  districtNum: number;
  districtName: string;
  voivodeship: string;
  profession?: string;      // 99%
  educationLevel: string;
  birthDate: string;
  birthLocation: string;
  numberOfVotes: number;
  oathDate?: string;
  email: string;
  active: boolean;
  inactiveCause?: string;   // 7%
  mandateExpiryDate?: string; // 8%
  waiverDesc?: string;      // 8%
};

export type SejmClub = {
  id: string;
  name: string;
  phone?: string;
  fax?: string;
  email?: string;
  membersCount: number;
};

export type SejmVoting = {
  term: number;
  sitting: number;
  sittingDay: number;
  votingNumber: number;
  date: string;
  title: string;
  topic?: string;
  description?: string;
  kind: string;
  majorityType?: string;
  majorityVotes?: number;
  yes: number;
  no: number;
  abstain: number;
  notParticipating: number;
  totalVoted: number;
  links?: Array<{ rel: string; href: string }>;
  votes?: SejmVote[];
};

export type SejmVote = {
  MP: number;
  firstName: string;
  lastName: string;
  secondName?: string;
  club: string;
  // 'PRESENT' pojawilo sie na zywych danych (posiedzenie 63), a nie ma go
  // w schemacie OpenAPI — dziedzine tego pola kontroluje zrodlo, nie my.
  // Kontrola nieznanych wartosci siedzi w ingest/lib/vote-values.ts.
  vote: 'YES' | 'NO' | 'ABSTAIN' | 'ABSENT' | 'PRESENT' | 'VOTE_VALID' | 'VOTE_INVALID';
  listVotes?: Record<string, string>;
};

export type SejmProceeding = {
  number: number;
  title: string;
  dates: string[];
  current: boolean;
  agenda?: string;
};

const term = (path: string) => `${SEJM_BASE}/term${TERM}${path}`;

/**
 * Lista poslow. Sonda 01 udowodnila, ze detal /MP/{id} NIE ma ani jednego pola
 * wiecej niz lista - wiec cala tabela `mps` to jedno zapytanie, a nie 499.
 */
export const fetchMPs = () => getJson<SejmMP[]>(term('/MP'));

export const fetchClubs = () => getJson<SejmClub[]>(term('/clubs'));

/** Numer 0 oznacza posiedzenie zapowiedziane, bez glosowan - filtrujemy je u zrodla. */
export async function fetchProceedings() {
  const res = await getJson<SejmProceeding[]>(term('/proceedings'));
  return {
    ...res,
    data: res.data.filter((p) => Number.isFinite(p.number) && p.number > 0).sort((a, b) => a.number - b.number),
  };
}

export const fetchVotingList = (sitting: number) => getJson<SejmVoting[]>(term(`/votings/${sitting}`));

export const fetchVoting = (sitting: number, votingNumber: number) =>
  getJson<SejmVoting>(term(`/votings/${sitting}/${votingNumber}`));

/**
 * Wyszukiwarka glosowan. `dateFrom` DZIALA (sonda 22) - to jest podstawa
 * nocnego importu przyrostowego. Uwaga: `sort_by` jest ignorowane, a wyniki
 * przychodza od najstarszych, wiec paginujemy po `offset` do skutku.
 */
export const searchVotings = (params: { dateFrom?: string; dateTo?: string; limit?: number; offset?: number }) => {
  const sp = new URLSearchParams();
  if (params.dateFrom) sp.set('dateFrom', params.dateFrom);
  if (params.dateTo) sp.set('dateTo', params.dateTo);
  sp.set('limit', String(params.limit ?? 200));
  if (params.offset) sp.set('offset', String(params.offset));
  return getJson<SejmVoting[]>(term(`/votings/search?${sp}`));
};

export const mpPhotoUrl = (mpId: number) => term(`/MP/${mpId}/photo`);

/** Oficjalny protokol glosowania w PDF. 74/74 glosowan go ma (sonda 22). */
export function votingPdfUrl(v: SejmVoting): string {
  return v.links?.find((l) => l.rel === 'pdf')?.href
    ?? term(`/votings/${v.sitting}/${v.votingNumber}/pdf`);
}

// ---------------------------------------------------------------------------
// PROCESY LEGISLACYJNE (Sprint 4, sondy 30 i 31)
// ---------------------------------------------------------------------------

/**
 * Lista procesow jest STRONICOWANA i to nie jest oczywiste.
 *
 * Zmierzone: bez parametrow endpoint zwraca 50 pozycji i naglowek
 *     content-range: items 0-50/1662
 *     x-total-count: 1662
 * Importer, ktory wzialby sama odpowiedz bez parametrow, zaimportowalby 3%
 * kadencji — bez bledu, bez ostrzezenia i z poprawna kontrola sum.
 *
 * `limit=500` dziala, `offset` dziala. `page` i `from` sa IGNOROWANE
 * (zwracaja pierwsza strone), wiec paginujemy wylacznie po offsecie.
 *
 * Numery procesow NIE sa ciagle: pierwsze 500 rekordow ma numery 1-772,
 * a /processes/2000 zwraca 404. Iterowanie po zakresie liczbowym pominie
 * czesc procesow i pobierze setki nieistniejacych — dlatego chodzimy po LISCIE.
 */
export const PROCESY_NA_STRONE = 500;

export async function fetchProcessPage(offset: number, limit = PROCESY_NA_STRONE) {
  const res = await getJson<SejmProcessListItem[]>(term(`/processes?limit=${limit}&offset=${offset}`));
  return res;
}

export type SejmProcessListItem = { number: string; term: number; title: string; changeDate?: string };

/** Szczegoly procesu — JEDYNE miejsce, w ktorym przychodza etapy. */
export const fetchProcess = (numer: string) => getJson<unknown>(term(`/processes/${numer}`));
