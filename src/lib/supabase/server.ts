import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { publicEnv } from '@/lib/env';
import type { Database } from '@/types/db';

/**
 * Klient dla Server Components i route handlerow. Nadal klucz anon i pelne RLS -
 * "serwerowy" nie znaczy "uprzywilejowany". Sesje uzytkownika trzymamy w ciasteczkach.
 *
 * W Next 15 cookies() jest asynchroniczne, stad await.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: CookieOptions }>) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Wywolanie z Server Component, ktory nie moze ustawiac ciasteczek.
          // Odswiezanie sesji obsluzy middleware - to bezpieczne do zignorowania.
        }
      },
    },
  });
}
