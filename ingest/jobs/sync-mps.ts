/**
 * SPRINT 1 - import poslow i klubow.
 *
 * Uruchomienie lokalnie:
 *   npx tsx --env-file=.env.local ingest/jobs/sync-mps.ts
 *   npx tsx --env-file=.env.local ingest/jobs/sync-mps.ts --force   (pomija skrot po hashu)
 *
 * Przebieg:
 *   1. kluby   -> zrodlo -> upsert -> mapa id klubu na club_seq
 *   2. poslowie -> zrodlo -> slugi (stabilne!) -> upsert
 *
 * Idempotencja stoi na dwoch nogach:
 *   - hash ladunku: identyczna odpowiedz API konczy prace bez dotykania bazy
 *   - stabilne slugi: raz nadany adres URL nigdy sie nie zmienia
 */

import { fetchMPs, fetchClubs, TERM, SEJM_BASE } from '../lib/sejm-client.js';
import { recordSource, writeCursor } from '../lib/source-recorder.js';
import { assignSlugs } from '../lib/slug.js';
import { mapClub, mapInferredClub, mapMP, assertPlausible } from '../mappers/mp.js';
import { db } from '../lib/db.js';
import { assertSchema } from '../lib/preflight.js';

const FORCE = process.argv.includes('--force');
const t0 = Date.now();

function log(msg: string) {
  console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);
}

async function syncClubs(): Promise<Map<string, number>> {
  const url = `${SEJM_BASE}/term${TERM}/clubs`;
  const { data, raw, status } = await fetchClubs();
  log(`kluby: pobrano ${data.length}`);

  const src = await recordSource({
    kind: 'sejm_api',
    url,
    apiEndpoint: `/sejm/term${TERM}/clubs`,
    httpStatus: status,
    rawPayload: raw,
  });

  if (src.changed || FORCE) {
    const rows = data.map((c) => mapClub(c, src.sourceId));
    const res = await db().from('clubs').upsert(rows, { onConflict: 'id' });
    if (res.error) throw new Error(`clubs.upsert: ${res.error.message}`);
    log(`kluby: zapisano ${rows.length}`);
  } else {
    log('kluby: bez zmian (ten sam hash) — pomijam zapis');
  }

  const all = await db().from('clubs').select('id, seq');
  if (all.error) throw new Error(`clubs.select: ${all.error.message}`);
  return new Map((all.data as Array<{ id: string; seq: number }>).map((c) => [c.id, c.seq]));
}

/**
 * Uzupelnia tabele `clubs` o kody, ktore wystapily w danych, ale nie w slowniku.
 *
 * Sejm API zwraca w /clubs dwanascie klubow, a w polu MP.club trzynascie roznych
 * wartosci. Niespojnosc jest po stronie zrodla, nie u nas. Zostawienie NULL-a
 * urwaloby temu poslowi klub na profilu i wylaczylo liczenie lojalnosci,
 * a przypisanie go "na oko" do podobnie brzmiacego klubu byloby zmyslaniem danych.
 *
 * Tworzymy wiec klub z kodu, ktory naprawde przyszedl, z flaga from_dictionary=false.
 * Migracja 0004 dokłada do tego prog: przy klubie ponizej 3 glosujacych lojalnosc
 * jest NULL, a nie 100% — bo posel nie moze byc wlasna wiekszoscia.
 *
 * MUTUJE przekazana mape, zeby wolajacy widzial nowe kody.
 */
async function ensureClubs(codes: readonly string[], clubSeq: Map<string, number>, sourceId: string): Promise<void> {
  const brakujace = [...new Set(codes.filter((c) => c && !clubSeq.has(c)))];
  if (!brakujace.length) return;

  log(`kluby spoza slownika (${brakujace.length}): ${brakujace.join(', ')}`);
  log('   -> zapisuje z from_dictionary=false; frontend ma to oznaczyc, a lojalnosc pominie male kluby');

  const res = await db()
    .from('clubs')
    .upsert(brakujace.map((c) => mapInferredClub(c, sourceId)), { onConflict: 'id' });
  if (res.error) throw new Error(`clubs.upsert (spoza slownika): ${res.error.message}`);

  const all = await db().from('clubs').select('id, seq');
  if (all.error) throw new Error(`clubs.select: ${all.error.message}`);
  clubSeq.clear();
  for (const c of all.data as Array<{ id: string; seq: number }>) clubSeq.set(c.id, c.seq);
}

async function syncMPs(clubSeq: Map<string, number>): Promise<void> {
  const url = `${SEJM_BASE}/term${TERM}/MP`;
  const { data, raw, status } = await fetchMPs();
  log(`poslowie: pobrano ${data.length} (aktywnych ${data.filter((m) => m.active).length})`);

  assertPlausible(data);

  const src = await recordSource({
    kind: 'sejm_api',
    url,
    apiEndpoint: `/sejm/term${TERM}/MP`,
    httpStatus: status,
    rawPayload: raw,
  });

  // PRZED skrotem po hashu. Kody klubow spoza slownika trzeba domknac takze wtedy,
  // gdy ladunek sie nie zmienil — inaczej baza zalozona przed migracja 0004
  // zostalaby z NULL-em na zawsze i wymagalaby --force.
  await ensureClubs(data.map((m) => m.club), clubSeq, src.sourceId);

  if (!src.changed && !FORCE) {
    log('poslowie: bez zmian (ten sam hash) — pomijam zapis');
    // Jesli ensureClubs cos dolozylo, poslowie z tym kodem maja jeszcze NULL.
    const sieroty = await db().from('mps').select('id', { count: 'exact', head: true }).is('club_seq', null);
    if ((sieroty.count ?? 0) > 0) {
      log(`   ale ${sieroty.count} poslow ma club_seq = NULL — domykam mimo braku zmian`);
    } else {
      return;
    }
  }

  // Slugi juz zapisane maja pierwszenstwo. Zmiana adresu /posel/... lamie
  // linki krazace po X i uniewaznia cache grafik OG - nie robimy tego nigdy.
  const current = await db().from('mps').select('id, slug');
  if (current.error) throw new Error(`mps.select: ${current.error.message}`);
  const existing = new Map((current.data as Array<{ id: number; slug: string }>).map((m) => [m.id, m.slug]));

  const slugs = assignSlugs(
    data.map((m) => ({ id: m.id, firstName: m.firstName, lastName: m.lastName, districtNum: m.districtNum })),
    existing,
  );

  const nowe = [...slugs.entries()].filter(([id]) => !existing.has(id)).length;
  const kolizje = [...slugs.values()].filter((s) => /-\d+$/.test(s)).length;
  log(`slugi: ${nowe} nowych, ${kolizje} z sufiksem rozrozniajacym (imiennicy)`);

  const rows = data.map((m) =>
    mapMP(m, {
      term: TERM,
      slug: slugs.get(m.id)!,
      clubSeq: clubSeq.get(m.club) ?? null,
      sourceId: src.sourceId,
    }),
  );

  const bezKlubu = rows.filter((r) => r.club_seq === null);
  if (bezKlubu.length) {
    // Nie powinno sie zdarzyc po ensureClubs(), ale gdyby — musi byc glosno.
    log(`!! ${bezKlubu.length} poslow nadal bez club_seq — to blad, zglos go.`);
  }

  // Porcjami po 200 - jeden upsert 499 wierszy potrafi przekroczyc limit zapytania.
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const res = await db().from('mps').upsert(chunk, { onConflict: 'id' });
    if (res.error) throw new Error(`mps.upsert [${i}..${i + chunk.length}]: ${res.error.message}`);
  }
  log(`poslowie: zapisano ${rows.length}`);
}

async function main() {
  log(`start — kadencja ${TERM}${FORCE ? ' (--force)' : ''}`);
  try {
    // Zanim cokolwiek pobierzemy i zapiszemy: czy baza ma komplet migracji.
    // Lepiej stanac na starcie z konkretna instrukcja niz w polowie zapisu
    // z komunikatem PostgREST-a o "schema cache".
    await assertSchema();

    const clubSeq = await syncClubs();
    await syncMPs(clubSeq);
    await writeCursor('mps', { cursorAt: new Date().toISOString(), error: null });

    const counts = await Promise.all(
      ['mps', 'clubs', 'sources'].map(async (t) => {
        const r = await db().from(t).select('*', { count: 'exact', head: true });
        return `${t}=${r.count ?? '?'}`;
      }),
    );
    log(`gotowe. ${counts.join(' ')}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await writeCursor('mps', { error: msg }).catch(() => {});
    console.error(`\nBLAD: ${msg}`);
    process.exit(1);
  }
}

void main();
