/**
 * Jedno miejsce, w ktorym czytamy zmienne srodowiskowe.
 *
 * Rozdzial jest celowy i wazny dla bezpieczenstwa:
 *   publicEnv  - trafia do przegladarki (prefiks NEXT_PUBLIC_)
 *   serverEnv  - NIGDY nie opuszcza serwera; import z komponentu klienckiego
 *                wywali build, bo funkcja rzuca na starcie
 *
 * SUPABASE_SERVICE_ROLE_KEY omija RLS. Jesli kiedykolwiek wycieknie do
 * bundla frontendu, kazdy moze przepisac cala baze faktow.
 */

import { normalizeSupabaseUrl } from './supabase-url';

function need(name: string, value: string | undefined): string {
  const v = value?.trim();
  if (!v || v.length < 8) {
    throw new Error(
      `Brak zmiennej srodowiskowej ${name}. Skopiuj .env.example do .env.local i uzupelnij.`,
    );
  }
  return v;
}

/**
 * Adres normalizujemy leniwie: build musi przejsc z wartosciami zastepczymi,
 * a bledna konfiguracja ma sie ujawnic jako czytelny komunikat na stronie,
 * nie jako 404 z warstwy API.
 */
function safeUrl(raw: string | undefined): string {
  try {
    return normalizeSupabaseUrl(raw, 'NEXT_PUBLIC_SUPABASE_URL');
  } catch {
    return (raw ?? '').trim().replace(/\/+$/, '');
  }
}

export const publicEnv = {
  supabaseUrl: safeUrl(process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim(),
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
};

/**
 * Czy adres serwisu wyglada na lokalny, mimo ze budujemy produkcje.
 *
 * `siteUrl` spada po cichu na `http://localhost:3000`, gdy brakuje
 * `NEXT_PUBLIC_SITE_URL`. Do 13.09.2026 nic z tego nie wynikalo, bo nikt
 * tego adresu nie uzywal poza `metadataBase`. Od czasu, gdy powstala MAPA
 * WITRYNY, wynika bardzo duzo: niepoprawna zmienna na Vercelu sprawi, ze
 * zglosimy wyszukiwarce 559 adresow pod `localhost:3000` — czyli adresow,
 * ktorych nie ma. To sie NIE OBJAWI bledem: build przejdzie, strona bedzie
 * dzialac, a zepsute bedzie dokladnie to, po co mape robimy.
 *
 * Dlatego sprawdzenie jest osobna funkcja, a nie komentarzem w mapie.
 */
export function siteUrlWygladaNaLokalny(): boolean {
  if (process.env.NODE_ENV !== 'production') return false;
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/i.test(publicEnv.siteUrl);
}

/** Blad konfiguracji adresu — do pokazania na stronie statusu zamiast pustej tabeli. */
export function urlConfigError(): string | null {
  try {
    normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Wolac WYLACZNIE w kodzie serwerowym (Server Components, route handlers, skrypty). */
export function serverEnv() {
  return {
    supabaseUrl: normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL'),
    serviceRoleKey: need('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY),
  };
}

/** Czy da sie w ogole polaczyc z baza - do lagodnego degradowania strony statusu. */
export const hasPublicConfig =
  publicEnv.supabaseUrl.length > 8 && publicEnv.supabaseAnonKey.length > 8;
