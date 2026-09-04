import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { serverEnv } from '@/lib/env';
import type { Database } from '@/types/db';

/**
 * Klient z kluczem service_role. OMIJA RLS.
 *
 * Wolno go uzywac WYLACZNIE w zadaniach importujacych dane (GitHub Actions,
 * skrypty lokalne). Nigdy w kodzie obslugujacym zadanie uzytkownika - jedna
 * pomylka i formularz "Zglos blad" pozwala nadpisac wynik glosowania.
 *
 * Import 'server-only' sprawia, ze proba wciagniecia tego pliku do bundla
 * klienckiego konczy sie bledem builda, a nie wyciekiem klucza na produkcji.
 */
export function createAdminClient() {
  const { supabaseUrl, serviceRoleKey } = serverEnv();

  return createSupabaseClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'X-Client-Info': 'obywatel-ingest' } },
  });
}
