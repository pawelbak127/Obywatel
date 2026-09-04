/**
 * Czyste funkcje przeksztalcajace odpowiedz Sejm API na wiersze naszej bazy.
 *
 * Zero wejscia/wyjscia, zero zaleznosci od Supabase - dzieki temu daja sie
 * przetestowac bez sieci i bez bazy (`ingest/mappers/mp.test.mjs`).
 */

import type { SejmMP, SejmClub } from '../lib/sejm-client.js';
import { mpPhotoUrl } from '../lib/sejm-client.js';

export type ClubRow = {
  id: string;
  name: string;
  phone: string | null;
  fax: string | null;
  email: string | null;
  members_count: number | null;
  from_dictionary: boolean;
  note: string | null;
  source_id: string;
};

export type MpRow = {
  id: number;
  term: number;
  first_name: string;
  second_name: string | null;
  last_name: string;
  slug: string;
  club_seq: number | null;
  district_num: number | null;
  district_name: string | null;
  voivodeship: string | null;
  profession: string | null;
  education_level: string | null;
  birth_date: string | null;
  birth_location: string | null;
  number_of_votes: number | null;
  oath_date: string | null;
  mandate_expiry_date: string | null;
  waiver_desc: string | null;
  active: boolean;
  inactive_cause: string | null;
  photo_url: string | null;
  source_id: string;
};

/** Puste stringi z API zamieniamy na NULL - "" w bazie to falszywa informacja. */
const nz = (v: string | undefined | null): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

/** API zwraca daty jako 'YYYY-MM-DD'; pilnujemy, zeby smiec nie trafil do kolumny date. */
const asDate = (v: string | undefined | null): string | null => {
  const t = nz(v);
  return t && /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null;
};

export function mapClub(c: SejmClub, sourceId: string): ClubRow {
  return {
    id: c.id,
    name: c.name,
    phone: nz(c.phone),
    fax: nz(c.fax),
    email: nz(c.email),
    members_count: Number.isFinite(c.membersCount) ? c.membersCount : null,
    from_dictionary: true,
    note: null,
    source_id: sourceId,
  };
}

/**
 * Klub, ktorego NIE MA w /clubs, a ktory wystapil w polu MP.club albo w glosie.
 *
 * Pierwszy import znalazl dokladnie jeden taki przypadek: "Polska2050-TD"
 * przy jednym posle, podczas gdy slownik zna tylko "Polska2050".
 *
 * Nie zgadujemy, ze to ten sam klub — przypisanie posla do Polska2050 byloby
 * wymysleniem danych, ktorych zrodlo nie podaje. Tworzymy klub z kodu, ktory
 * naprawde przyszedl, i zostawiamy slad, ze pochodzi z wnioskowania.
 */
export function mapInferredClub(code: string, sourceId: string): ClubRow {
  return {
    id: code,
    name: code,
    phone: null,
    fax: null,
    email: null,
    members_count: null,
    from_dictionary: false,
    note: 'Kod wystapil w danych posla, ale nie ma go w /sejm/termN/clubs. Wymaga sprawdzenia recznego.',
    source_id: sourceId,
  };
}

export function mapMP(
  mp: SejmMP,
  ctx: { term: number; slug: string; clubSeq: number | null; sourceId: string },
): MpRow {
  return {
    id: mp.id,
    term: ctx.term,
    first_name: mp.firstName,
    second_name: nz(mp.secondName),
    last_name: mp.lastName,
    slug: ctx.slug,
    club_seq: ctx.clubSeq,
    district_num: Number.isFinite(mp.districtNum) ? mp.districtNum : null,
    district_name: nz(mp.districtName),
    voivodeship: nz(mp.voivodeship),
    profession: nz(mp.profession),
    education_level: nz(mp.educationLevel),
    birth_date: asDate(mp.birthDate),
    birth_location: nz(mp.birthLocation),
    number_of_votes: Number.isFinite(mp.numberOfVotes) ? mp.numberOfVotes : null,
    oath_date: asDate(mp.oathDate),
    mandate_expiry_date: asDate(mp.mandateExpiryDate),
    waiver_desc: nz(mp.waiverDesc),
    active: Boolean(mp.active),
    inactive_cause: nz(mp.inactiveCause),
    photo_url: mpPhotoUrl(mp.id),
    source_id: ctx.sourceId,
  };
}

/**
 * Kontrola sanity przed zapisem. Import, ktory po cichu wstawi 3 poslow zamiast
 * 460, jest gorszy od importu, ktory sie wywali - bo strona bedzie wygladac
 * na dzialajaca. Stad twarde progi.
 */
export function assertPlausible(mps: readonly SejmMP[]): void {
  if (mps.length < 400) {
    throw new Error(`Sejm API zwrocilo ${mps.length} poslow. Oczekiwane ~460-500. Przerywam import.`);
  }
  const active = mps.filter((m) => m.active).length;
  if (active < 400 || active > 470) {
    throw new Error(`Aktywnych poslow: ${active}. Poza zakresem 400-470. Przerywam import.`);
  }
  const broken = mps.filter((m) => !m.id || !m.firstName || !m.lastName);
  if (broken.length) {
    throw new Error(`${broken.length} rekordow bez id/imienia/nazwiska. Przerywam import.`);
  }
}
