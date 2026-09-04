'use client';

import { createBrowserClient } from '@supabase/ssr';
import { publicEnv } from '@/lib/env';
import type { Database } from '@/types/db';

/**
 * Klient dla komponentow klienckich. Klucz anon, pelne RLS.
 * Tym klientem uzytkownik moze CZYTAC opublikowane fakty i oddac swoj glos
 * w crowd-checkingu (Sprint 4). Nie moze zapisac zadnego faktu.
 */
export function createClient() {
  return createBrowserClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey);
}
