/**
 * Generowanie typow TypeScript ze schematu bazy.
 *
 *   npm run db:types
 *
 * POWOD, DLA KTOREGO TO JEST SKRYPT, A NIE JEDNA LINIA W package.json.
 * Poprzednia wersja brzmiala:
 *
 *   supabase gen types typescript --project-id $SUPABASE_PROJECT_ID … > src/types/db.ts
 *
 * i mialaby trzy wady, z ktorych kazda wyszla na Windowsie:
 *
 *   1. `supabase` musi byc zainstalowany globalnie — nie jest i nie musi byc.
 *   2. `$ZMIENNA` to skladnia powloki uniksowej. W PowerShellu ani w cmd sie
 *      nie rozwinie, wiec nawet po instalacji CLI poleciałoby z pustym id.
 *   3. NAJGORSZE: `> src/types/db.ts` tworzy pusty plik ZANIM polecenie ruszy.
 *      Gdy polecenie nie istnieje, plik zostaje pusty — i tak wlasnie zniknely
 *      typy z tego projektu. Ten skrypt zapisuje plik dopiero po udanym
 *      generowaniu, a przy bledzie nie dotyka istniejacego.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DOCELOWY = resolve('src/types/db.ts');

for (const nazwa of ['.env.local', '.env']) {
  if (existsSync(resolve(nazwa))) {
    try {
      process.loadEnvFile(resolve(nazwa));
    } catch { /* zmienne moga byc juz w srodowisku */ }
  }
}

/**
 * Reference ID projektu Supabase: dokladnie 20 malych liter i cyfr.
 *
 * Walidacja jest tu dlatego, ze pierwsze uruchomienie posylalo do CLI wartosc
 * `cli_Kornelia@DESKTOP-..._1788558430` — czyli NAZWE tokenu dostepowego wpisana
 * omylkowo w SUPABASE_PROJECT_ID. Bez tej kontroli skrypt wolal CLI ze smieciem
 * i pokazywal blad, ktory o niczym nie mowil.
 */
const POPRAWNY_REF = /^[a-z0-9]{20}$/;

function zUrl() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const m = url?.match(/^https:\/\/([a-z0-9]{20})\.supabase\.(co|in)/i);
  return m ? m[1].toLowerCase() : null;
}

function idProjektu() {
  const jawny = process.env.SUPABASE_PROJECT_ID?.trim();
  const zAdresu = zUrl();

  if (jawny && POPRAWNY_REF.test(jawny)) return jawny;

  if (jawny && zAdresu) {
    console.warn('');
    console.warn(`SUPABASE_PROJECT_ID nie wyglada na Reference ID: ${JSON.stringify(jawny)}`);
    console.warn('Reference ID to 20 malych liter i cyfr, bez znakow specjalnych.');
    console.warn(`Biore identyfikator z NEXT_PUBLIC_SUPABASE_URL: ${zAdresu}`);
    console.warn('Usun bledna linie z .env.local, zeby to ostrzezenie zniknelo.');
    console.warn('');
    return zAdresu;
  }

  if (zAdresu) return zAdresu;

  console.error(
    [
      '',
      'Nie wiem, z ktorego projektu generowac typy.',
      jawny ? `SUPABASE_PROJECT_ID zawiera ${JSON.stringify(jawny)} — to nie jest Reference ID.` : '',
      '',
      'Najprosciej: NIC nie dopisuj. Skrypt sam wyciagnie identyfikator',
      'z NEXT_PUBLIC_SUPABASE_URL, jesli ma on postac',
      '  https://<20-znakow>.supabase.co',
      '',
      'Reference ID znajdziesz tez w Supabase → Project Settings → General.',
      'To NIE jest nazwa tokenu dostepowego ani adres e-mail.',
      '',
    ]
      .filter(Boolean)
      .join('\n'),
  );
  process.exit(1);
}

const ref = idProjektu();
const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();

console.log(`Projekt: ${ref}`);
console.log(token ? 'Token: z SUPABASE_ACCESS_TOKEN' : 'Token: z zalogowanego CLI (npx supabase login)');

/**
 * URUCHOMIENIE NPX NA WINDOWSIE.
 *
 * `spawnSync('npx.cmd', …)` zwraca EINVAL na Node 20.12+ i 22. To nie jest usterka,
 * tylko poprawka bezpieczenstwa (CVE-2024-27980): Node odmawia uruchamiania plikow
 * .cmd i .bat bez powloki, bo ich argumenty daja sie wstrzykiwac.
 *
 * Dlatego na Windowsie idziemy przez `shell: true`. Jedyny argument pochodzacy
 * spoza kodu to `ref`, a ten przeszedl juz walidacje na 20 znakow [a-z0-9] —
 * nie da sie w nim przemycic sredniika ani cudzyslowu.
 */
const args = ['--yes', 'supabase@latest', 'gen', 'types', 'typescript', '--project-id', ref, '--schema', 'public'];
const win = process.platform === 'win32';

const wynik = spawnSync(win ? `npx ${args.join(' ')}` : 'npx', win ? [] : args, {
  encoding: 'utf8',
  shell: win,
  env: token ? { ...process.env, SUPABASE_ACCESS_TOKEN: token } : process.env,
  maxBuffer: 32 * 1024 * 1024,
});

if (wynik.error) {
  console.error(`\nNie udalo sie uruchomic npx: ${wynik.error.message}`);
  console.error('Sprawdz, czy `npx --version` dziala w tym samym oknie terminala.');
  process.exit(1);
}

if (wynik.status !== 0) {
  console.error('');
  console.error('Generowanie typow nie powiodlo sie. Istniejacy plik zostaje NIETKNIETY.');
  console.error('');
  console.error(wynik.stderr?.trim() || '(brak komunikatu z CLI)');
  console.error('');
  console.error('Najczestsza przyczyna: brak autoryzacji. Dwie drogi:');
  console.error('  a) npx supabase login          — otworzy przegladarke');
  console.error('  b) w .env.local dopisz SUPABASE_ACCESS_TOKEN=<token>');
  console.error('     (Supabase → ikona konta → Access Tokens → Generate new token)');
  console.error('');
  process.exit(wynik.status ?? 1);
}

const tresc = wynik.stdout ?? '';
if (!tresc.includes('export type Database') && !tresc.includes('export interface Database')) {
  console.error('');
  console.error('CLI zwrocilo cos, co nie wyglada na definicje typow — nie nadpisuje pliku.');
  console.error(`Pierwsze 300 znakow:\n${tresc.slice(0, 300)}`);
  process.exit(1);
}

const bylo = existsSync(DOCELOWY) ? readFileSync(DOCELOWY, 'utf8').length : 0;
writeFileSync(DOCELOWY, tresc, 'utf8');
console.log(`Zapisano src/types/db.ts (${tresc.length} B, poprzednio ${bylo} B).`);
console.log('Teraz:  npm run typecheck');
