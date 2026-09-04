/**
 * Wczytanie `.env.local` bez zaleznosci i bez flagi w kazdym poleceniu.
 *
 * POWOD. Do tej pory kazdy import trzeba bylo uruchamiac tak:
 *     npx tsx --env-file=.env.local ingest/jobs/sync-mps.ts
 * a `npm run ingest:mps` konczylo sie komunikatem "Brak zmiennej
 * NEXT_PUBLIC_SUPABASE_URL" mimo poprawnie wypelnionego pliku. To byla pulapka
 * na pamiec, nie na wiedze — polecenie i skrot robily co innego.
 *
 * `process.loadEnvFile` jest w Node od 20.12 i czyta ten sam format co flaga.
 * Zmienne juz obecne w srodowisku maja pierwszenstwo, wiec sekrety w GitHub
 * Actions (gdzie `.env.local` nie istnieje) nie zostana niczym nadpisane,
 * a brak pliku nie jest bledem.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

let zaladowano = false;

export function zaladujEnv(): void {
  if (zaladowano) return;
  zaladowano = true;

  // Kolejnosc jak w Next.js: plik lokalny wygrywa nad wspoldzielonym.
  for (const nazwa of ['.env.local', '.env']) {
    const sciezka = resolve(process.cwd(), nazwa);
    if (!existsSync(sciezka)) continue;
    try {
      (process as unknown as { loadEnvFile: (p: string) => void }).loadEnvFile(sciezka);
    } catch (e) {
      // Nie przerywamy: zmienne moga byc juz w srodowisku (Actions, --env-file).
      console.warn(`Nie udalo sie wczytac ${nazwa}: ${(e as Error).message}`);
    }
  }
}
