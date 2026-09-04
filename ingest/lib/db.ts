/**
 * Klient bazy dla skryptow importu. Osobny od `src/lib/supabase/admin.ts`,
 * bo tamten ma `import 'server-only'` i nie da sie go uzyc poza Next.js.
 *
 * Uzywa klucza service_role - OMIJA RLS. To jedyne miejsce w projekcie,
 * ktore ma prawo zapisywac fakty.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { normalizeSupabaseUrl } from '../../src/lib/supabase-url.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { zaladujEnv } from './env.js';

let cached: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (cached) return cached;

  // Dzieki temu `npm run ingest:*` dziala tak samo jak wariant z --env-file.
  zaladujEnv();

  // Rzuca czytelnym bledem, gdy w zmiennej jest adres ze sciezka /rest/v1.
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    const gdzie = process.cwd();
    throw new Error(
      [
        'Brak NEXT_PUBLIC_SUPABASE_URL lub SUPABASE_SERVICE_ROLE_KEY.',
        '',
        `Szukalem pliku .env.local w: ${gdzie}`,
        `Znaleziony: ${existsSync(resolve(gdzie, '.env.local')) ? 'tak' : 'NIE — uruchamiasz z innego katalogu niz katalog projektu'}`,
        '',
        'W Actions zmienne przychodza z sekretow repozytorium, nie z pliku.',
      ].join('\n'),
    );
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'X-Client-Info': 'obywatel-ingest' } },
  });
  return cached;
}

/** Rzuca z czytelnym komunikatem zamiast cichego `null` w danych. */
export function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  if (res.data === null) throw new Error(`${what}: brak danych`);
  return res.data;
}
