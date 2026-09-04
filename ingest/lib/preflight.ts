/**
 * Kontrola schematu przed startem importu.
 *
 * POWOD. Uruchomienie importu na bazie bez migracji 0004 dalo komunikat:
 *     Could not find the 'from_dictionary' column of 'clubs' in the schema cache
 *
 * To jest prawda, ale bezuzyteczna: nie mowi ani ktora migracja jej brakuje,
 * ani ze drugim mozliwym powodem jest nieodswiezony cache PostgREST-a.
 * Do tego blad wyskoczyl w polowie pracy, gdy czesc rzeczy byla juz zapisana.
 *
 * Sprawdzamy wiec WSZYSTKO na starcie, zbieramy braki naraz i mowimy wprost,
 * co uruchomic. Koszt: kilka zapytan z `limit 0`, czyli ulamek sekundy.
 */

import { db } from './db.js';

export type Wymog = { tabela: string; kolumna: string; migracja: string; po_co: string };

/**
 * Wymogi modulu SUDOP. CELOWO poza lista ogolna: nocny import glosowan z Sejmu
 * nie ma zadnego powodu przestac dzialac dlatego, ze ktos nie uruchomil migracji
 * dotyczacej dotacji. Sprawdza je wylacznie job importu CSV, przez
 * `assertSchema(WYMOGI_SUDOP)`.
 */
export const WYMOGI_SUDOP: Wymog[] = [
  { tabela: 'subsidies',   kolumna: 'row_sha256', migracja: '0012_sudop_dotacje.sql', po_co: 'deduplikacja wierszy miedzy eksportami' },
  { tabela: 'subsidies',   kolumna: 'nip_valid',  migracja: '0012_sudop_dotacje.sql', po_co: 'laczenie po NIP tylko przy poprawnej sumie kontrolnej' },
  { tabela: 'sudop_gminy', kolumna: 'nazwa',      migracja: '0012_sudop_dotacje.sql', po_co: 'nazwa gminy dla kodu TERYT' },
];

const WYMOGI: Wymog[] = [
  { tabela: 'sources',  kolumna: 'payload_sha256',  migracja: '0001_init.sql',              po_co: 'wykrywanie zmian po hashu' },
  { tabela: 'votings',  kolumna: 'pdf_url',         migracja: '0001_init.sql',              po_co: 'oficjalny protokol jako zrodlo' },
  { tabela: 'sync_state', kolumna: 'cursor_at',     migracja: '0001_init.sql',              po_co: 'kursor importu przyrostowego' },
  { tabela: 'mp_stats', kolumna: 'computed_at',     migracja: '0002_rls_hardening.sql',     po_co: 'mp_stats jako tabela, nie matview' },
  { tabela: 'clubs',    kolumna: 'from_dictionary', migracja: '0004_clubs_and_loyalty.sql', po_co: 'kluby spoza slownika /clubs' },
  { tabela: 'mp_stats', kolumna: 'loyalty_votings', migracja: '0004_clubs_and_loyalty.sql', po_co: 'prog wiarygodnosci lojalnosci' },
  { tabela: 'list_votes', kolumna: 'option_key',    migracja: '0005_list_votes.sql',        po_co: 'glosowania listowe (ON_LIST)' },
  { tabela: 'mp_stats', kolumna: 'loyalty_skipped_onlist', migracja: '0005_list_votes.sql', po_co: 'wylaczenie ON_LIST z lojalnosci' },
  { tabela: 'mp_stats', kolumna: 'loyalty_skipped_nostance', migracja: '0006_vote_value_present.sql', po_co: 'wartosc PRESENT i lojalnosc ze stanowisk' },
  { tabela: 'mp_stats', kolumna: 'voted_pct', migracja: '0007_frekwencja_vs_udzial.sql', po_co: 'udzial w glosowaniach obok obecnosci' },
  { tabela: 'mp_stats', kolumna: 'first_voted_at', migracja: '0008_refresh_wydajnosc.sql', po_co: 'porownywalnosc poslow z niepelna kadencja' },
  { tabela: 'mp_stats', kolumna: 'attendance_lo', migracja: '0009_przedzialy_ufnosci.sql', po_co: 'rankingi po dolnej granicy, nie po surowym procencie' },
  { tabela: 'mp_absence_monthly', kolumna: 'absent_pct', migracja: '0010_kontekst_nieobecnosci.sql', po_co: 'ksztalt nieobecnosci w czasie' },
  { tabela: 'mp_obecnosc_kontekst', kolumna: 'voted_pct', migracja: '0011_widok_pelny_kontrakt.sql', po_co: 'komplet kolumn dla profilu posla' },
];

export async function assertSchema(dodatkowe: Wymog[] = []): Promise<void> {
  const braki: Wymog[] = [];

  for (const w of [...WYMOGI, ...dodatkowe]) {
    // limit(0) nie sciaga zadnych danych — sprawdzamy wylacznie, czy kolumna istnieje.
    const { error } = await db().from(w.tabela).select(w.kolumna).limit(0);
    if (error) braki.push(w);
  }

  if (!braki.length) return;

  const migracje = [...new Set(braki.map((b) => b.migracja))].sort();

  const linie = [
    '',
    'SCHEMAT BAZY JEST NIEAKTUALNY — import nie wystartuje.',
    '',
    'Brakujace kolumny:',
    ...braki.map((b) => `  ${b.tabela}.${b.kolumna}  (${b.po_co})`),
    '',
    'Sa dwie mozliwe przyczyny:',
    '',
    `1. Nie uruchomiles migracji. W SQL Editorze wykonaj po kolei:`,
    ...migracje.map((m) => `     supabase/migrations/${m}`),
    '',
    '2. Migracja przeszla, ale PostgREST ma stary cache schematu.',
    '   W SQL Editorze:   notify pgrst, \'reload schema\';',
    '   albo w panelu:    Settings > API > Reload schema cache',
    '',
    'Sprawdz najpierw punkt 2 — jesli kolumna jest w Table Editorze, to on.',
    '',
  ];

  throw new Error(linie.join('\n'));
}
