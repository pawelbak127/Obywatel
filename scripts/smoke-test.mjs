#!/usr/bin/env node
/**
 * TEST WYJSCIA SPRINTU 0.
 *
 * Sprawdza, ze obietnice zapisane w schemacie faktycznie obowiazuja na zywej bazie.
 * To nie jest test jednostkowy dla porzadku - to weryfikacja dwoch wymogow prawnych
 * z dokumentacji projektu, ktore w wersji 0.1 byly tylko akapitem w Wordzie:
 *
 *   1. "Zawsze do zrodla"  -> nie da sie wstawic faktu bez source_id
 *   2. "Disclaimer AI"     -> nie da sie zapisac tresci AI bez modelu i adnotacji
 *
 * Plus higiena: klucz anon nie moze pisac niczego poza zgloszeniami bledow.
 *
 * Uruchomienie:
 *   node --env-file=.env.local scripts/smoke-test.mjs
 * albo (Node < 20.6):
 *   NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... npm run smoke
 */

import { createClient } from '@supabase/supabase-js';

const RAW_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!RAW_URL || !ANON || !SERVICE) {
  console.error('Brak zmiennych. Potrzebne: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY');
  console.error('Podpowiedz: node --env-file=.env.local scripts/smoke-test.mjs');
  process.exit(2);
}

/**
 * Adres MUSI byc samym origin. supabase-js doklada /rest/v1/ sam, wiec
 * "https://xxx.supabase.co/rest/v1/" daje /rest/v1/rest/v1/ i 404 PGRST125 —
 * blad, ktory wyglada jak problem z uprawnieniami. Sprawdzamy przed startem.
 */
let SUPA_URL;
try {
  const u = new URL(RAW_URL);
  if (u.pathname.replace(/\/+$/, '')) {
    console.error(`\nNEXT_PUBLIC_SUPABASE_URL zawiera sciezke "${u.pathname}".`);
    console.error(`  jest:     ${RAW_URL}`);
    console.error(`  powinno:  ${u.origin}`);
    console.error('  supabase-js sam doklada /rest/v1/ — inaczej kazde zapytanie konczy sie 404 PGRST125.\n');
    process.exit(2);
  }
  SUPA_URL = u.origin;
} catch {
  console.error(`NEXT_PUBLIC_SUPABASE_URL nie jest poprawnym adresem: "${RAW_URL}"`);
  process.exit(2);
}

const anon = createClient(SUPA_URL, ANON, { auth: { persistSession: false } });
const admin = createClient(SUPA_URL, SERVICE, { auth: { persistSession: false } });

let passed = 0;
let failed = 0;
const cleanup = [];

/**
 * NAPRAWA FALSZYWEGO ZIELONEGO.
 *
 * Pierwsza wersja `mustFail` zaliczala KAZDY blad jako sukces. Przy pierwszym
 * uruchomieniu na zywym projekcie zwrocilo to osiem zielonych "ok" na bledach
 * PGRST125 — a PGRST125 to HTTP 404 "Invalid path specified in request URL",
 * czyli zadanie w ogole nie doszlo do bazy. Test twierdzil, ze RLS chroni
 * tabele, ktorych PostgREST nawet nie widzial.
 *
 * Test bezpieczenstwa, ktory swieci na zielono, gdy infrastruktura jest zepsuta,
 * jest gorszy niz brak testu — bo daje spokoj sumienia.
 *
 * Dlatego rozrozniamy teraz dwa rodzaje bledow:
 *   - SQLSTATE (piec znakow, np. 42501, 23502, 23514) = baza swiadomie odmowila.
 *     TYLKO to zalicza `mustFail`.
 *   - PGRST*** = warstwa HTTP/routingu. To awaria srodowiska, nie dowod ochrony.
 */
const SQLSTATE = /^[0-9A-Z]{5}$/;

function opisz(error) {
  const kod = error.code ?? '—';
  return `${kod}: ${error.message}`;
}

/** Czy to odmowa POCHODZACA Z BAZY, a nie z warstwy transportu? */
function toOdmowaBazy(error) {
  return typeof error.code === 'string' && SQLSTATE.test(error.code);
}

/** Test, ktory ma sie UDAC. */
async function ok(name, fn) {
  const { error } = await fn();
  if (!error) { console.log(`  ok    ${name}`); passed++; return; }
  console.log(`  FAIL  ${name}\n        ${opisz(error)}`);
  if (String(error.code).startsWith('PGRST')) {
    console.log('        ^ blad warstwy API, nie bazy — uruchom: node --env-file=.env.local scripts/diagnose.mjs');
  }
  failed++;
}

/** Test, ktory MUSI sie nie udac — i to z wlasciwego powodu. */
async function mustFail(name, fn, expect) {
  const { error } = await fn();

  if (!error) {
    console.log(`  FAIL  ${name}\n        operacja PRZESZLA, a nie powinna! To luka.`);
    failed++;
    return;
  }

  if (!toOdmowaBazy(error)) {
    console.log(`  FAIL  ${name}`);
    console.log(`        odrzucone przez warstwe API, nie przez baze: ${opisz(error)}`);
    console.log('        To NIE jest dowod, ze RLS dziala. Zadanie nie doszlo do bazy.');
    console.log('        Uruchom: node --env-file=.env.local scripts/diagnose.mjs');
    failed++;
    return;
  }

  const msg = `${error.message} ${error.details ?? ''} ${error.hint ?? ''}`.toLowerCase();
  if (expect && !msg.includes(expect.toLowerCase())) {
    console.log(`  ~     ${name}\n        odrzucone przez baze, ale innym mechanizmem: ${opisz(error)}`);
    passed++;
    return;
  }
  console.log(`  ok    ${name} (${error.code})`);
  passed++;
}

console.log('\n=== A. Odczyt publiczny (RLS: select using(true)) ===');
/**
 * DRUGI FALSZYWY ZIELONY, znaleziony po diagnostyce u Pawla.
 *
 * `select('*', { head: true })` wysyla zadanie HEAD, a odpowiedz HEAD nie ma ciala.
 * postgrest-js nie ma wiec czego sparsowac i przy 404 zwraca `error: null, count: null`.
 * Zmierzone na atrapie serwera: osiem tabel swiecilo na zielono, gdy KAZDE zapytanie
 * lecialo w 404. Dlatego liczy sie nie brak bledu, tylko obecnosc licznika.
 */
async function czytaTabele(t) {
  const { error, count } = await anon.from(t).select('*', { count: 'exact', head: true });
  if (error) return { error };
  if (count === null) {
    return { error: { code: 'HEAD-NULL', message: `brak licznika — zapytanie HEAD do "${t}" nie doszlo do bazy` } };
  }
  return { error: null };
}
for (const t of ['mps', 'clubs', 'votings', 'votes', 'sources', 'mp_stats',
                 'legislative_processes', 'process_stages']) {
  await ok(`anon czyta ${t}`, () => czytaTabele(t));
}

console.log('\n=== B. Zapis kluczem anon jest zamkniety ===');
await mustFail('anon NIE zapisze posla', () =>
  anon.from('mps').insert({ id: 9999, first_name: 'X', last_name: 'Y', slug: 'x-y' }),
);
await mustFail('anon NIE zapisze glosowania', () =>
  anon.from('votings').insert({ term: 10, sitting: 1, voting_number: 1, voted_at: new Date().toISOString(), title: 'X' }),
);
await mustFail('anon NIE zapisze tresci AI', () =>
  anon.from('ai_contents').insert({ kind: 'act_summary', eli_address: 'DU/2026/1', body_md: 'x', ai_model: 'm', ai_prompt_ver: 'v1' }),
);
await ok('anon MOZE zglosic blad', async () => {
  const r = await anon.from('error_reports').insert({ entity_type: 'mp', entity_id: '1', message: 'smoke test' });
  return r;
});

console.log('\n=== B2. Stan wewnetrzny importu jest niewidoczny (migracja 0002) ===');
// sync_state ma wlaczone RLS i ZERO polityk. Komunikaty bledow importu
// potrafia zdradzic strukture zaplecza - nie ma powodu, zeby wyciekaly.
await mustFail('anon NIE czyta sync_state', () => anon.from('sync_state').select('*'));
await mustFail('anon NIE wywola refresh_mp_stats', () => anon.rpc('refresh_mp_stats'));
await ok('service_role CZYTA sync_state', () => admin.from('sync_state').select('*'));

console.log('\n=== C. Wymog "zawsze do zrodla" ===');
await mustFail('posel bez source_id odrzucony', () =>
  admin.from('mps').insert({ id: 9999, first_name: 'X', last_name: 'Y', slug: 'x-y-9999' }),
  'source_id',
);

const { data: src, error: srcErr } = await admin
  .from('sources')
  .insert({ kind: 'sejm_api', url: 'https://api.sejm.gov.pl/sejm/term10/MP', api_endpoint: '/sejm/term10/MP', http_status: 200 })
  .select('id')
  .single();
if (srcErr) { console.log(`  FAIL  utworzenie zrodla: ${srcErr.message}`); failed++; }
else { console.log('  ok    zrodlo utworzone'); passed++; cleanup.push(() => admin.from('sources').delete().eq('id', src.id)); }

await mustFail('zrodlo z adresem nie-http odrzucone', () =>
  admin.from('sources').insert({ kind: 'sejm_api', url: 'ftp://gdzies/plik' }),
);

if (src) {
  await ok('posel Z source_id przyjety', async () => {
    const r = await admin.from('mps').insert({
      id: 9999, first_name: 'Test', last_name: 'Smoke', slug: 'test-smoke-9999', source_id: src.id,
    });
    if (!r.error) cleanup.push(() => admin.from('mps').delete().eq('id', 9999));
    return r;
  });
}

console.log('\n=== D. Wymog "disclaimer AI" ===');
if (src) {
  await mustFail('tresc AI z pustym disclaimerem odrzucona', () =>
    admin.from('ai_contents').insert({
      kind: 'act_summary', eli_address: 'DU/2026/1', body_md: 'x',
      ai_model: 'm', ai_prompt_ver: 'v1', ai_disclaimer: '', source_id: src.id,
    }),
  );
  await mustFail('tresc AI z ai_generated=false odrzucona', () =>
    admin.from('ai_contents').insert({
      kind: 'act_summary', eli_address: 'DU/2026/1', body_md: 'x', ai_generated: false,
      ai_model: 'm', ai_prompt_ver: 'v1', source_id: src.id,
    }),
  );
  await mustFail('tresc AI bez source_id odrzucona', () =>
    admin.from('ai_contents').insert({
      kind: 'act_summary', eli_address: 'DU/2026/1', body_md: 'x', ai_model: 'm', ai_prompt_ver: 'v1',
    }),
  );
  await mustFail('tresc AI z dwoma celami naraz odrzucona', () =>
    admin.from('ai_contents').insert({
      kind: 'act_summary', eli_address: 'DU/2026/1', promise_id: '00000000-0000-0000-0000-000000000000',
      body_md: 'x', ai_model: 'm', ai_prompt_ver: 'v1', source_id: src.id,
    }),
  );

  let aiId = null;
  await ok('poprawna tresc AI przyjeta', async () => {
    const r = await admin.from('ai_contents').insert({
      kind: 'act_summary', eli_address: 'DU/2026/1123', body_md: 'Streszczenie testowe.',
      ai_model: 'claude-sonnet-4-5', ai_prompt_ver: 'summarize-act@v1', source_id: src.id,
    }).select('id').single();
    if (r.data) { aiId = r.data.id; cleanup.push(() => admin.from('ai_contents').delete().eq('id', aiId)); }
    return r;
  });

  console.log('\n=== E. Widok publiczny nie przecieka ===');
  await ok('nieopublikowana tresc AI niewidoczna dla anon', async () => {
    const { data, error } = await anon.from('public_ai_contents').select('id').eq('id', aiId ?? '');
    if (error) return { error };
    return data && data.length === 0
      ? { error: null }
      : { error: { message: `widok zwrocil ${data?.length} wierszy, powinien 0` } };
  });
}

console.log('\n=== F. Sprzatanie ===');
for (const fn of cleanup.reverse()) await fn();
await admin.from('error_reports').delete().eq('message', 'smoke test');
console.log('  ok    usunieto dane testowe');

console.log(`\n${'='.repeat(50)}`);
console.log(`WYNIK: ${passed} przeszlo, ${failed} nie przeszlo`);
console.log('='.repeat(50));
if (failed > 0) {
  console.log('\nSprint 0 NIE jest zamkniety. FAIL oznacza jedno z trzech:');
  console.log('  - migracja nie zostala wykonana w calosci (0001, 0002, 0003),');
  console.log('  - RLS ma dziure,');
  console.log('  - albo warstwa API nie dziala (kody PGRST***) — wtedy:');
  console.log('      node --env-file=.env.local scripts/diagnose.mjs');
  process.exit(1);
}
console.log('\nSprint 0 domkniety: zrodla i metki AI sa wymuszone przez baze, nie przez dobre chęci.');
