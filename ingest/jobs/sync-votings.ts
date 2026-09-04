/**
 * SPRINT 2 — nocny import przyrostowy.
 *
 *   npx tsx --env-file=.env.local ingest/jobs/sync-votings.ts
 *   npx tsx --env-file=.env.local ingest/jobs/sync-votings.ts --days 30
 *
 * To jest zadanie, ktore chodzi codziennie o 03:15 w GitHub Actions.
 *
 * Backfill kosztuje ~4 200 zapytan. Ten job kosztuje kilkanascie — bo
 * /votings/search?dateFrom= dziala (sprawdzone sonda 22, a pierwsze zero
 * wynikow bylo prawda, nie bledem: w sierpniu Sejm nie obradowal).
 *
 * Punkt startowy bierzemy z bazy: max(voted_at) minus dzien zapasu na wypadek
 * glosowan doksieganych z opoznieniem.
 */

import { searchVotings, fetchVoting, TERM, SEJM_BASE } from '../lib/sejm-client.js';
import { recordSource, writeCursor } from '../lib/source-recorder.js';
import { mapVoting, mapVotes, checkVotingConsistency, unknownVoteValues } from '../mappers/voting.js';
import { komunikatONieznanych } from '../lib/vote-values.js';
import { mapLimit } from '../lib/http.js';
import { assertSchema } from '../lib/preflight.js';
import { db } from '../lib/db.js';

const JOB = 'votings';
const args = process.argv.slice(2);
const DAYS = args.includes('--days') ? Number(args[args.indexOf('--days') + 1]) : undefined;
const PAGE = 200;

const t0 = Date.now();
const log = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

/** Od kiedy szukac: ostatnie glosowanie w bazie minus dzien zapasu. */
async function punktStartu(): Promise<string> {
  if (DAYS) return new Date(Date.now() - DAYS * 864e5).toISOString().slice(0, 10);

  const r = await db().from('votings').select('voted_at').order('voted_at', { ascending: false }).limit(1);
  if (r.error) throw new Error(`votings.select: ${r.error.message}`);

  const ostatnie = (r.data as Array<{ voted_at: string }>)[0]?.voted_at;
  if (!ostatnie) {
    log('baza jest pusta — uruchom najpierw backfill-votings.ts');
    process.exit(1);
  }
  return new Date(new Date(ostatnie).getTime() - 864e5).toISOString().slice(0, 10);
}

async function main() {
  log(`start — import przyrostowy, kadencja ${TERM}`);
  await assertSchema();

  const clubs = await db().from('clubs').select('id, seq');
  if (clubs.error) throw new Error(`clubs.select: ${clubs.error.message}`);
  const clubSeq = new Map((clubs.data as Array<{ id: string; seq: number }>).map((c) => [c.id, c.seq]));

  const dateFrom = await punktStartu();
  log(`szukam glosowan od ${dateFrom}`);

  // Wyszukiwarka zwraca od najstarszych i ignoruje sort_by — paginujemy po offset.
  const znalezione = [];
  for (let offset = 0; ; offset += PAGE) {
    const r = await searchVotings({ dateFrom, limit: PAGE, offset });
    const strona = Array.isArray(r.data) ? r.data : [];
    znalezione.push(...strona);
    if (strona.length < PAGE) break;
    if (offset > 5000) { log('!! przekroczono 5000 rekordow — przerywam paginacje'); break; }
  }
  log(`znaleziono ${znalezione.length} glosowan w oknie czasowym`);

  if (!znalezione.length) {
    await writeCursor(JOB, { cursorAt: new Date().toISOString(), error: null });
    log('nic nowego — Sejm nie glosowal w tym okresie');
    return;
  }

  // Ktore z nich juz mamy? Bez tego pobieralibysmy szczegoly niepotrzebnie.
  const istniejace = await db()
    .from('votings')
    .select('sitting, voting_number')
    .eq('term', TERM)
    .gte('voted_at', dateFrom);
  if (istniejace.error) throw new Error(`votings.select: ${istniejace.error.message}`);
  const mamy = new Set(
    (istniejace.data as Array<{ sitting: number; voting_number: number }>).map((v) => `${v.sitting}/${v.voting_number}`),
  );

  const nowe = znalezione.filter((v) => !mamy.has(`${v.sitting}/${v.votingNumber}`));
  log(`nowych do pobrania: ${nowe.length} (juz w bazie: ${znalezione.length - nowe.length})`);
  if (!nowe.length) {
    await writeCursor(JOB, { cursorAt: new Date().toISOString(), error: null });
    log('wszystko aktualne');
    return;
  }

  const detale = await mapLimit(nowe, (v) => fetchVoting(v.sitting, v.votingNumber));

  // Kontrola dziedziny przed zapisem — ta sama, ktora zatrzymala backfill na "PRESENT".
  const nieznane = unknownVoteValues(detale.map((d) => d.data));
  if (nieznane.length) throw new Error(komunikatONieznanych(nieznane, `import przyrostowy od ${dateFrom}`));

  const src = await recordSource({
    kind: 'sejm_api',
    url: `${SEJM_BASE}/term${TERM}/votings/search?dateFrom=${dateFrom}`,
    apiEndpoint: `/sejm/term${TERM}/votings/search`,
    httpStatus: 200,
    rawPayload: detale.map((d) => d.raw).join('\n'),
  });

  const problemy = detale.map((d) => checkVotingConsistency(d.data)).filter((x): x is string => Boolean(x));

  const votingRows = detale.map((d) => mapVoting(d.data, src.sourceId));
  const up = await db().from('votings').upsert(votingRows, { onConflict: 'term,sitting,voting_number' });
  if (up.error) throw new Error(`votings.upsert: ${up.error.message}`);

  // Identyfikatory z bazy dla nowo wstawionych glosowan.
  const sittings = [...new Set(votingRows.map((v) => v.sitting))];
  const ids = await db().from('votings').select('id, sitting, voting_number').eq('term', TERM).in('sitting', sittings);
  if (ids.error) throw new Error(`votings.select: ${ids.error.message}`);
  const idFor = new Map(
    (ids.data as Array<{ id: number; sitting: number; voting_number: number }>)
      .map((r) => [`${r.sitting}/${r.voting_number}`, r.id]),
  );

  const votes = [];
  const listVotes = [];
  for (const d of detale) {
    const votingId = idFor.get(`${d.data.sitting}/${d.data.votingNumber}`);
    if (!votingId) continue;
    const m = mapVotes(d.data, { votingId, clubSeq });
    votes.push(...m.votes);
    listVotes.push(...m.listVotes);
  }

  for (let i = 0; i < votes.length; i += 2000) {
    const r = await db().from('votes').upsert(votes.slice(i, i + 2000), { onConflict: 'voting_id,mp_id' });
    if (r.error) throw new Error(`votes.upsert: ${r.error.message}`);
  }
  if (listVotes.length) {
    const r = await db().from('list_votes').upsert(listVotes, { onConflict: 'voting_id,mp_id,option_key' });
    if (r.error) throw new Error(`list_votes.upsert: ${r.error.message}`);
  }

  log(`zapisano ${votingRows.length} glosowan i ${votes.length.toLocaleString('pl-PL')} glosow`);
  if (problemy.length) {
    log(`!! NIEZGODNOSCI (${problemy.length}):`);
    for (const p of problemy.slice(0, 10)) log(`   ${p}`);
  }

  log('przeliczam mp_stats…');
  const stats = await db().rpc('refresh_mp_stats');
  if (stats.error) throw new Error(`refresh_mp_stats: ${stats.error.message}`);

  const abs = await db().rpc('refresh_absence_monthly');
  if (abs.error) throw new Error(`refresh_absence_monthly: ${abs.error.message}`);

  await writeCursor(JOB, { cursorAt: new Date().toISOString(), error: null });
  log('gotowe');
}

main().catch(async (err) => {
  const msg = err instanceof Error ? err.message : String(err);
  await writeCursor(JOB, { error: msg }).catch(() => {});
  console.error(`\nBLAD: ${msg}`);
  process.exit(1);
});
