/**
 * JEDYNA funkcja w projekcie, ktora tworzy wiersze w tabeli `sources`.
 *
 * Dlaczego jedyna: wymog "zawsze do zrodla" dziala tylko wtedy, gdy nie da sie
 * go obejsc przypadkiem. Baza wymusza `source_id NOT NULL`, a ten modul jest
 * jedynym dostawca tych identyfikatorow. Jesli kiedys ktos bedzie chcial wstawic
 * fakt bez zrodla, bedzie musial swiadomie napisac drugi taki modul - i to widac
 * w code review.
 *
 * Drugie zadanie: wykrywanie zmian. Sejm API nie zwraca ani ETag, ani
 * Last-Modified (zmierzone), wiec SHA-256 ladunku jest jedynym mechanizmem delty.
 * Bez niego kazda noc przepisywalaby cala baze.
 */

import { createHash } from 'node:crypto';
import { db } from './db.js';

export type SourceKind =
  | 'sejm_api' | 'eli_api' | 'sudop_api' | 'sudop_csv' | 'dane_gov' | 'gus_bdl'
  | 'sejm_pdf' | 'sejm_nsf' | 'video' | 'press' | 'user_submission';

export type RecordedSource = {
  sourceId: string;
  sha256: string;
  /** false = identyczny ladunek juz byl w bazie, mozna pominac przetwarzanie */
  changed: boolean;
};

export function sha256(payload: string | Buffer): string {
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Zapisuje fakt pobrania zasobu i zwraca jego identyfikator.
 *
 * @param url          adres OFICJALNEGO rejestru - ten link trafia na frontend
 * @param rawPayload   dokladnie te bajty, ktore przyszly z serwera
 */
export async function recordSource(args: {
  kind: SourceKind;
  url: string;
  apiEndpoint?: string;
  httpStatus?: number;
  rawPayload: string | Buffer;
  snapshotUrl?: string;
  /**
   * Moment pobrania zasobu, ISO. Domyslnie `now()` — i dla zapytan HTTP to jest
   * prawda. Nieprawda robi sie przy plikach pobranych recznie: eksport CSV
   * z SUDOP moze lezec na dysku od tygodnia, a UOKiK wymaga przy republikacji
   * podania daty, kiedy dane naprawde pozyskano. Importer pliku podaje tu
   * czas modyfikacji pliku albo wartosc z flagi `--pobrano`.
   */
  retrievedAt?: string;
}): Promise<RecordedSource> {
  const hash = sha256(args.rawPayload);
  const supabase = db();

  // Unikalny indeks na (url, payload_sha256) sprawia, ze ten sam ladunek
  // pod tym samym adresem nie tworzy drugiego wiersza.
  const existing = await supabase
    .from('sources')
    .select('id')
    .eq('url', args.url)
    .eq('payload_sha256', hash)
    .maybeSingle();

  if (existing.error) throw new Error(`sources.select: ${existing.error.message}`);
  if (existing.data) {
    return { sourceId: existing.data.id as string, sha256: hash, changed: false };
  }

  const inserted = await supabase
    .from('sources')
    .insert({
      kind: args.kind,
      url: args.url,
      api_endpoint: args.apiEndpoint ?? null,
      http_status: args.httpStatus ?? 200,
      payload_sha256: hash,
      snapshot_url: args.snapshotUrl ?? null,
      retrieved_at: args.retrievedAt ?? new Date().toISOString(),
    })
    .select('id')
    .single();

  if (inserted.error) throw new Error(`sources.insert: ${inserted.error.message}`);
  return { sourceId: inserted.data.id as string, sha256: hash, changed: true };
}

/** Odczyt/zapis kursora importu przyrostowego. */
export async function readCursor(job: string) {
  const r = await db().from('sync_state').select('*').eq('job', job).maybeSingle();
  if (r.error) throw new Error(`sync_state.select: ${r.error.message}`);
  return r.data as { job: string; cursor_at: string | null; cursor_num: number | null } | null;
}

export async function writeCursor(job: string, patch: { cursorAt?: string; cursorNum?: number; error?: string | null }) {
  const r = await db().from('sync_state').upsert(
    {
      job,
      ...(patch.cursorAt !== undefined ? { cursor_at: patch.cursorAt } : {}),
      ...(patch.cursorNum !== undefined ? { cursor_num: patch.cursorNum } : {}),
      last_run: new Date().toISOString(),
      last_error: patch.error ?? null,
    },
    { onConflict: 'job' },
  );
  if (r.error) throw new Error(`sync_state.upsert: ${r.error.message}`);
}
