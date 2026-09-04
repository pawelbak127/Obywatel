#!/usr/bin/env node
/**
 * DIAGNOSTYKA POLACZENIA Z SUPABASE.
 *
 * Powod powstania: smoke test zwrocil PGRST125 na wszystkich zapisach.
 * To NIE jest odmowa uprawnien — to HTTP 404 "Invalid path specified in request URL".
 * Czyli zadanie nie doszlo tam, gdzie mialo dojsc, a nie zostalo odrzucone przez RLS.
 *
 * Ten skrypt omija supabase-js i strzela surowym fetch-em, zeby pokazac
 * dokladnie: jaki URL, jaka metoda, jaki status, jakie cialo odpowiedzi.
 *
 *   node --env-file=.env.local scripts/diagnose.mjs
 */

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const line = (s = '') => console.log(s);
const hr = () => line('-'.repeat(70));

line('\n=== 1. Zmienne srodowiskowe ===');
for (const [name, val] of [['NEXT_PUBLIC_SUPABASE_URL', URL_], ['NEXT_PUBLIC_SUPABASE_ANON_KEY', ANON], ['SUPABASE_SERVICE_ROLE_KEY', SERVICE]]) {
  if (!val) { line(`  ${name}: BRAK`); continue; }
  // Ukryte znaki to najczestsza przyczyna dziwnych bledow przy .env na Windowsie.
  const dziwne = [...val].filter((c) => c.charCodeAt(0) < 32 || c === ' ').length;
  line(`  ${name}:`);
  line(`     dlugosc ${val.length}, poczatek "${val.slice(0, 28)}…", koniec "…${val.slice(-6)}"`);
  if (dziwne) line(`     !! ${dziwne} bialych/sterujacych znakow w wartosci (CR z CRLF? spacja na koncu?)`);
  if (name.endsWith('_URL')) {
    try {
      const u = new URL(val.trim());
      const sciezka = u.pathname.replace(/\/+$/, '');
      if (sciezka) {
        line(`     !! BLAD: adres zawiera sciezke "${u.pathname}"`);
        line(`        powinno byc samo:  ${u.origin}`);
        line('        supabase-js doklada /rest/v1/ SAM — ze sciezka w zmiennej powstaje');
        line('        /rest/v1/rest/v1/ i kazde zapytanie konczy sie 404 PGRST125.');
      } else if (val.endsWith('/')) {
        line('     ! konczy sie ukosnikiem — nieszkodliwe, ale lepiej usunac');
      }
    } catch { line('     !! nie jest poprawnym adresem URL'); }
  }
}

if (!URL_ || !ANON || !SERVICE) { line('\nUzupelnij .env.local i uruchom ponownie.'); process.exit(2); }

line('\n=== 2. Rodzaj kluczy ===');
function opiszKlucz(name, key) {
  if (key.startsWith('sb_publishable_')) return line(`  ${name}: nowy klucz PUBLISHABLE (jawny, do przegladarki)`);
  if (key.startsWith('sb_secret_'))      return line(`  ${name}: nowy klucz SECRET (omija RLS — tylko serwer)`);
  const part = key.split('.');
  if (part.length === 3) {
    try {
      const p = JSON.parse(Buffer.from(part[1], 'base64url').toString());
      const exp = p.exp ? new Date(p.exp * 1000).toISOString().slice(0, 10) : '?';
      return line(`  ${name}: klucz JWT, role="${p.role}", wazny do ${exp}`);
    } catch { /* ignore */ }
  }
  line(`  ${name}: nierozpoznany format`);
}
opiszKlucz('anon        ', ANON);
opiszKlucz('service_role', SERVICE);
if (ANON === SERVICE) line('  !! OBA KLUCZE SA IDENTYCZNE — to na pewno blad kopiowania.');

async function strzal(label, { path, method = 'GET', key, body, prefer }) {
  const url = `${URL_.replace(/\/$/, '')}${path}`;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    ...(body ? { 'Content-Type': 'application/json' } : {}),
    ...(prefer ? { Prefer: prefer } : {}),
  };
  try {
    const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    line(`  ${method.padEnd(4)} ${res.status}  ${label}`);
    line(`       ${url}`);
    if (text) line(`       ${text.slice(0, 260).replace(/\s+/g, ' ')}`);
    return { status: res.status, text };
  } catch (e) {
    line(`  ${method.padEnd(4)} ---  ${label}  BLAD SIECI: ${e instanceof Error ? e.message : e}`);
    return { status: 0, text: '' };
  }
}

line('\n=== 3. Odczyt (to dzialalo w smoke tescie) ===');
hr();
await strzal('lista poslow, klucz anon', { path: '/rest/v1/mps?select=id&limit=1', key: ANON });
await strzal('lista poslow, klucz service_role', { path: '/rest/v1/mps?select=id&limit=1', key: SERVICE });

line('\n=== 4. Zapis (tu leci PGRST125) ===');
hr();
await strzal('zgloszenie bledu, klucz anon', {
  path: '/rest/v1/error_reports', method: 'POST', key: ANON,
  body: { entity_type: 'mp', entity_id: '1', message: 'diagnostyka polaczenia — do usuniecia' },
  prefer: 'return=minimal',
});
await strzal('zrodlo, klucz service_role', {
  path: '/rest/v1/sources', method: 'POST', key: SERVICE,
  body: { kind: 'sejm_api', url: 'https://api.sejm.gov.pl/diagnostyka' },
  prefer: 'return=representation',
});

line('\n=== 5. Tabele, ktore moga byc niewystawione w Data API ===');
hr();
await strzal('sync_state, klucz service_role', { path: '/rest/v1/sync_state?select=job', key: SERVICE });
await strzal('mp_stats, klucz anon', { path: '/rest/v1/mp_stats?select=mp_id&limit=1', key: ANON });

line('\n=== 5b. Sprzatanie po diagnostyce ===');
hr();
// Testy z sekcji 4 zapisuja realne wiersze. `sources` to nasz slad audytowy —
// smiec w nim jest gorszy niz brak diagnostyki. Kasujemy natychmiast.
await strzal('usuwam testowe zrodlo', {
  path: '/rest/v1/sources?url=eq.https://api.sejm.gov.pl/diagnostyka',
  method: 'DELETE', key: SERVICE, prefer: 'return=minimal',
});
await strzal('usuwam testowe zgloszenie', {
  path: `/rest/v1/error_reports?message=eq.${encodeURIComponent('diagnostyka polaczenia — do usuniecia')}`,
  method: 'DELETE', key: SERVICE, prefer: 'return=minimal',
});

line('\n=== 6. Co PostgREST w ogole wystawia ===');
hr();
const root = await strzal('katalog glowny API', { path: '/rest/v1/', key: SERVICE });
if (root.status === 200) {
  try {
    const spec = JSON.parse(root.text);
    const paths = Object.keys(spec.paths ?? {}).filter((p) => p !== '/').map((p) => p.slice(1));
    line(`  wystawionych zasobow: ${paths.length}`);
    line(`  ${paths.join(', ')}`);
    for (const t of ['error_reports', 'sync_state', 'sources', 'mp_stats']) {
      line(`  ${t}: ${paths.includes(t) ? 'JEST' : '>>> BRAK w schemacie API <<<'}`);
    }
  } catch { line('  (odpowiedz nie jest specyfikacja OpenAPI — patrz wyzej)'); }
}

line('\n=== JAK CZYTAC WYNIK ===');
line('  404 PGRST125 na POST, a 200 na GET  -> Data API odrzuca zapisy;');
line('     sprawdz Settings > API > Data API, czy nie jest w trybie tylko do odczytu.');
line('  404 na konkretnej tabeli            -> nie ma jej w schemacie API;');
line('     przeladuj cache: Settings > API > "Reload schema cache",');
line('     albo w SQL Editor:  notify pgrst, \'reload schema\';');
line('  401/403                             -> zly klucz albo zla rola.');
line('  42501 / "row-level security"        -> RLS dziala poprawnie, o to nam chodzi.\n');
