import 'server-only';

import { createClient } from '@/lib/supabase/server';

/**
 * Warstwa dostepu do danych dla stron publicznych.
 *
 * Wszystko czyta kluczem anon przez RLS — strona nie ma i nie potrzebuje
 * uprawnien wiekszych niz przypadkowy uzytkownik. Jesli cos tu przestanie
 * dzialac po zmianie polityk, to znaczy, ze polityki sa za ciasne, a nie
 * ze strona potrzebuje service_role.
 *
 * Typy sa recznie opisane, bo `src/types/db.ts` to na razie atrapa.
 * Po `npm run db:types` mozna je zastapic wygenerowanymi.
 */

/**
 * Brak obiektu w bazie to NIE jest awaria aplikacji — to brakujaca migracja.
 * Zamiast stosu wywolan pokazujemy, co uruchomic.
 *
 * PGRST205 = "Could not find the table ... in the schema cache". Dwie przyczyny:
 * migracja nie zostala wykonana albo PostgREST ma stary cache.
 */
export class BrakObiektuWBazie extends Error {
  constructor(
    readonly obiekt: string,
    readonly migracja: string,
    readonly szczegol?: string,
  ) {
    super(
      `Schemat bazy jest starszy niz kod ("${obiekt}"). Uruchom supabase/migrations/${migracja}, ` +
        "a jesli juz to zrobiles — przeladuj cache: notify pgrst, 'reload schema';" +
        (szczegol ? ` [${szczegol}]` : ''),
    );
    this.name = 'BrakObiektuWBazie';
  }
}

const MIGRACJE: Record<string, string> = {
  mp_obecnosc_kontekst: '0011_widok_pelny_kontrakt.sql',
  mp_absence_monthly: '0010_kontekst_nieobecnosci.sql',
  mp_stats_ranking: '0009_przedzialy_ufnosci.sql',
  mp_stats: '0002_rls_hardening.sql',
};

function sprawdzBlad(obiekt: string, error: { code?: string; message: string } | null): void {
  if (!error) return;
  // Brak obiektu ALBO brak kolumny w obiekcie to ten sam problem z punktu widzenia
  // uzytkownika: schemat bazy jest starszy niz kod. Widok mp_obecnosc_kontekst
  // w migracji 0010 nie przekazywal siedmiu kolumn, o ktore pyta ta warstwa —
  // komunikat "column ... does not exist" wygladal jak blad aplikacji, a byl
  // brakiem migracji 0011.
  const brakSchematu =
    error.code === 'PGRST205' ||
    error.code === '42703' ||
    /schema cache/i.test(error.message) ||
    /does not exist/i.test(error.message);

  if (brakSchematu) {
    throw new BrakObiektuWBazie(obiekt, MIGRACJE[obiekt] ?? 'najnowsza migracja', error.message);
  }
  throw new Error(`${obiekt}: ${error.message}`);
}

export type ZakresMandatu = 'pelna kadencja' | 'ponad polowa kadencji' | 'czesc kadencji' | 'krotki mandat';

export type KsztaltNieobecnosci =
  | 'brak istotnych nieobecnosci'
  | 'nieobecnosc ciagla — sprawdz funkcje panstwowa lub przerwe w mandacie'
  | 'nieobecnosc czesciowo skupiona w czasie'
  | 'nieobecnosc rozproszona';

export type MpKontekst = {
  id: number;
  full_name: string;
  slug: string;
  klub: string | null;
  active: boolean;
  votes_total: number;
  attendance_pct: number | null;
  attendance_lo: number | null;
  attendance_hi: number | null;
  voted_pct: number | null;
  present_count: number | null;
  absent_count: number | null;
  loyalty_pct: number | null;
  loyalty_lo: number | null;
  loyalty_hi: number | null;
  loyalty_votings: number | null;
  niepewnosc_pkt: number | null;
  zakres_mandatu: ZakresMandatu;
  first_voted_at: string | null;
  last_voted_at: string | null;
  miesiecy_lacznie: number | null;
  miesiecy_prawie_bez_obecnosci: number | null;
  ksztalt_nieobecnosci: KsztaltNieobecnosci;
  funkcje_panstwowe: string | null;
};

export type MiesiacNieobecnosci = {
  month: string;
  votings: number;
  present: number;
  absent: number;
  absent_pct: number | null;
};

const KOLUMNY_KONTEKST =
  'id, full_name, slug, klub, active, votes_total, attendance_pct, attendance_lo, attendance_hi, ' +
  'voted_pct, present_count, absent_count, loyalty_pct, loyalty_lo, loyalty_hi, loyalty_votings, ' +
  'niepewnosc_pkt, zakres_mandatu, first_voted_at, last_voted_at, ' +
  'miesiecy_lacznie, miesiecy_prawie_bez_obecnosci, ksztalt_nieobecnosci, funkcje_panstwowe';

export async function pobierzPosla(slug: string): Promise<MpKontekst | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('mp_obecnosc_kontekst')
    .select(KOLUMNY_KONTEKST)
    .eq('slug', slug)
    .maybeSingle();
  sprawdzBlad('mp_obecnosc_kontekst', error);
  return (data as MpKontekst | null) ?? null;
}

/**
 * Ranking. Sortowanie po DOLNEJ granicy przedzialu, nie po surowym procencie —
 * inaczej lista czolowa jest lista krotkich mandatow, a nie zachowan.
 */
export async function pobierzRanking(opts: { kierunek?: 'najgorsi' | 'najlepsi'; limit?: number } = {}) {
  const { kierunek = 'najgorsi', limit = 100 } = opts;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('mp_obecnosc_kontekst')
    .select(KOLUMNY_KONTEKST)
    .not('attendance_lo', 'is', null)
    .order('attendance_lo', { ascending: kierunek === 'najgorsi' })
    .limit(limit);
  sprawdzBlad('mp_obecnosc_kontekst', error);
  return (data ?? []) as MpKontekst[];
}

export async function pobierzNieobecnosciMiesieczne(mpId: number): Promise<MiesiacNieobecnosci[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('mp_absence_monthly')
    .select('month, votings, present, absent, absent_pct')
    .eq('mp_id', mpId)
    .order('month', { ascending: true });
  sprawdzBlad('mp_absence_monthly', error);
  return (data ?? []) as MiesiacNieobecnosci[];
}

/** Wszystkie slugi — do generateStaticParams. */
export async function pobierzSlugi(): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('mps').select('slug');
  if (error) throw new Error(`pobierzSlugi: ${error.message}`);
  return (data ?? []).map((r: { slug: string }) => r.slug);
}

export type Glosowanie = {
  id: number;
  sitting: number;
  voting_number: number;
  voted_at: string;
  title: string;
  topic: string | null;
  kind: string | null;
  pdf_url: string | null;
  print_numbers: string[] | null;
};

/** Ostatnie glosowania posla wraz z jego glosem. */
export async function pobierzGlosyPosla(mpId: number, limit = 30) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('votes')
    .select('value, votings!inner(id, sitting, voting_number, voted_at, title, topic, kind, pdf_url, print_numbers)')
    .eq('mp_id', mpId)
    .order('voted_at', { ascending: false, referencedTable: 'votings' })
    .limit(limit);
  if (error) throw new Error(`pobierzGlosyPosla(${mpId}): ${error.message}`);
  return (data ?? []) as Array<{ value: string; votings: Glosowanie }>;
}
