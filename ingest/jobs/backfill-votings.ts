/**
 * SPRINT 2 — jednorazowy import calej kadencji.
 *
 *   npx tsx --env-file=.env.local ingest/jobs/backfill-votings.ts
 *   npx tsx --env-file=.env.local ingest/jobs/backfill-votings.ts --from 1   (od poczatku)
 *   npx tsx --env-file=.env.local ingest/jobs/backfill-votings.ts --only 63  (jedno posiedzenie)
 *
 * Skala zmierzona sondami: 64 posiedzenia, ~4 150 glosowan, ~1,9 mln wierszy
 * w tabeli `votes`, ~4 200 zapytan do Sejm API, okolo 3 minuty samego pobierania.
 *
 * DLACZEGO KURSOR, A NIE PETLA. Zapis 1,9 mln wierszy przez PostgREST to kilka
 * tysiecy zadan HTTP. Cokolwiek moze paść w polowie: sieć, limit czasu, laptop.
 * Po kazdym ukonczonym posiedzeniu zapisujemy numer w `sync_state`, wiec
 * ponowne uruchomienie podejmuje prace tam, gdzie stanela — bez duplikatow
 * i bez zaczynania od zera.
 */

import { fetchProceedings, fetchVotingList, fetchVoting, TERM, SEJM_BASE } from '../lib/sejm-client.js';
import { recordSource, readCursor, writeCursor } from '../lib/source-recorder.js';
import { mapVoting, mapVotes, checkVotingConsistency, unknownVoteValues } from '../mappers/voting.js';
import { komunikatONieznanych } from '../lib/vote-values.js';
import { mapLimit } from '../lib/http.js';
import { assertSchema } from '../lib/preflight.js';
import { db } from '../lib/db.js';

const JOB = 'votings_backfill';
const args = process.argv.slice(2);
const argVal = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : undefined;
};
const FROM = argVal('--from');
const ONLY = argVal('--only');
const CHUNK = Number(process.env.INGEST_VOTES_CHUNK ?? 2000);

const t0 = Date.now();
const log = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

async function clubMap(): Promise<Map<string, number>> {
  const r = await db().from('clubs').select('id, seq');
  if (r.error) throw new Error(`clubs.select: ${r.error.message}`);
  return new Map((r.data as Array<{ id: string; seq: number }>).map((c) => [c.id, c.seq]));
}

/** Jedno posiedzenie: lista glosowan -> szczegoly -> zapis. */
async function importSitting(sitting: number, clubSeq: Map<string, number>): Promise<{ votings: number; votes: number; problemy: string[] }> {
  const list = await fetchVotingList(sitting);
  if (!Array.isArray(list.data) || list.data.length === 0) {
    return { votings: 0, votes: 0, problemy: [] };
  }

  // Szczegoly kazdego glosowania — dopiero one zawieraja glosy imienne.
  const detale = await mapLimit(list.data, async (v) => {
    const d = await fetchVoting(sitting, v.votingNumber);
    return d;
  });

  // PRZED zapisem: czy w tym posiedzeniu nie ma wartosci glosu, ktorej nie zna enum.
  // Bez tego dowiadujemy sie o niej przy porcji nr 2000, gdy czesc danych jest juz w bazie.
  const nieznane = unknownVoteValues(detale.map((d) => d.data));
  if (nieznane.length) {
    throw new Error(komunikatONieznanych(nieznane, `posiedzenie ${sitting}`));
  }

  const problemy: string[] = [];
  const src = await recordSource({
    kind: 'sejm_api',
    url: `${SEJM_BASE}/term${TERM}/votings/${sitting}`,
    apiEndpoint: `/sejm/term${TERM}/votings/${sitting}`,
    httpStatus: 200,
    // Hash liczymy z polaczonych surowych odpowiedzi calego posiedzenia.
    rawPayload: detale.map((d) => d.raw).join('\n'),
  });

  // 1. Glosowania. Klucz naturalny (term, sitting, voting_number) rozstrzyga konflikt.
  const votingRows = detale.map((d) => mapVoting(d.data, src.sourceId));
  const up = await db().from('votings').upsert(votingRows, { onConflict: 'term,sitting,voting_number' });
  if (up.error) throw new Error(`votings.upsert (posiedzenie ${sitting}): ${up.error.message}`);

  // 2. Identyfikatory nadane przez baze — potrzebne jako klucz obcy w `votes`.
  const ids = await db()
    .from('votings')
    .select('id, voting_number')
    .eq('term', TERM)
    .eq('sitting', sitting);
  if (ids.error) throw new Error(`votings.select (posiedzenie ${sitting}): ${ids.error.message}`);
  const idByNumber = new Map(
    (ids.data as Array<{ id: number; voting_number: number }>).map((r) => [r.voting_number, r.id]),
  );

  // 3. Glosy imienne.
  const votes = [];
  const listVotes = [];
  for (const d of detale) {
    const problem = checkVotingConsistency(d.data);
    if (problem) problemy.push(problem);

    const votingId = idByNumber.get(d.data.votingNumber);
    if (!votingId) { problemy.push(`brak id dla glosowania ${sitting}/${d.data.votingNumber}`); continue; }

    const m = mapVotes(d.data, { votingId, clubSeq });
    votes.push(...m.votes);
    listVotes.push(...m.listVotes);
  }

  for (let i = 0; i < votes.length; i += CHUNK) {
    const res = await db().from('votes').upsert(votes.slice(i, i + CHUNK), { onConflict: 'voting_id,mp_id' });
    if (res.error) throw new Error(`votes.upsert (posiedzenie ${sitting}, ${i}): ${res.error.message}`);
  }
  if (listVotes.length) {
    for (let i = 0; i < listVotes.length; i += CHUNK) {
      const res = await db().from('list_votes').upsert(listVotes.slice(i, i + CHUNK), { onConflict: 'voting_id,mp_id,option_key' });
      if (res.error) throw new Error(`list_votes.upsert (posiedzenie ${sitting}): ${res.error.message}`);
    }
    log(`   posiedzenie ${sitting}: ${listVotes.length} glosow listowych (ON_LIST) do osobnej tabeli`);
  }

  return { votings: votingRows.length, votes: votes.length, problemy };
}

async function main() {
  log(`start — backfill glosowan, kadencja ${TERM}`);
  await assertSchema();

  const clubSeq = await clubMap();
  if (clubSeq.size === 0) throw new Error('Tabela clubs jest pusta. Uruchom najpierw sync-mps.ts.');
  log(`kluby w mapie: ${clubSeq.size}`);

  const proc = await fetchProceedings();
  const wszystkie = proc.data.map((p) => p.number);
  log(`posiedzen z glosowaniami: ${wszystkie.length} (numery ${wszystkie[0]}–${wszystkie.at(-1)})`);

  const kursor = await readCursor(JOB);
  const start = FROM ?? (kursor?.cursor_num ? kursor.cursor_num + 1 : wszystkie[0]!);
  const doZrobienia = ONLY ? [ONLY] : wszystkie.filter((n) => n >= start);

  if (kursor?.cursor_num && !FROM && !ONLY) {
    log(`wznawiam od posiedzenia ${start} (ostatnie ukonczone: ${kursor.cursor_num})`);
  }
  if (!doZrobienia.length) { log('nic do zrobienia — backfill juz ukonczony'); return; }

  let sumaVotings = 0;
  let sumaVotes = 0;
  const wszystkieProblemy: string[] = [];

  for (const [i, sitting] of doZrobienia.entries()) {
    const t = Date.now();
    const r = await importSitting(sitting, clubSeq);
    sumaVotings += r.votings;
    sumaVotes += r.votes;
    wszystkieProblemy.push(...r.problemy);

    if (!ONLY) await writeCursor(JOB, { cursorNum: sitting, error: null });

    const sek = (Date.now() - t) / 1000;
    const zostalo = doZrobienia.length - i - 1;
    const eta = zostalo * ((Date.now() - t0) / 1000 / (i + 1));
    log(
      `posiedzenie ${String(sitting).padStart(2)}: ${String(r.votings).padStart(3)} glosowan, ` +
      `${String(r.votes).padStart(6)} glosow, ${sek.toFixed(1)}s` +
      (zostalo ? `  |  zostalo ${zostalo}, ETA ~${Math.round(eta / 60)} min` : ''),
    );
  }

  log(`zapisano: ${sumaVotings} glosowan, ${sumaVotes.toLocaleString('pl-PL')} glosow imiennych`);

  if (wszystkieProblemy.length) {
    log(`!! NIEZGODNOSCI (${wszystkieProblemy.length}) — sumy imienne rozjezdzaja sie z licznikami API:`);
    for (const p of wszystkieProblemy.slice(0, 20)) log(`   ${p}`);
    if (wszystkieProblemy.length > 20) log(`   … i ${wszystkieProblemy.length - 20} wiecej`);
  } else {
    log('kontrola spojnosci: wszystkie sumy imienne zgadzaja sie z licznikami API');
  }

  // Przeliczenie metryk NIE moze wywrocic calego importu. Dane sa juz zapisane
  // i spojne; jesli statystyki nie przelicza sie teraz, przeliczymy je osobno.
  // Pierwszy pelny backfill skonczyl sie wlasnie tak: 2,1 mln glosow w bazie,
  // a komunikat sugerowal porazke calego zadania.
  log('przeliczam mp_stats…');
  const t = Date.now();
  const stats = await db().rpc('refresh_mp_stats');
  if (stats.error) {
    log(`!! mp_stats NIE przeliczone: ${stats.error.message}`);
    log('   Dane glosowan sa zapisane i spojne — brakuje wylacznie statystyk.');
    log('   Uruchom w SQL Editorze:   select refresh_mp_stats();');
    log('   Jesli tam tez przekracza limit, brakuje migracji 0008_refresh_wydajnosc.sql.');
  } else {
    log(`mp_stats: przeliczone w ${((Date.now() - t) / 1000).toFixed(1)}s`);
  }

  // Ksztalt nieobecnosci w czasie. Bez tego "50% obecnosci" premiera i "50%"
  // posla, ktory nie przychodzi, wygladaja na profilu identycznie.
  const t2 = Date.now();
  const abs = await db().rpc('refresh_absence_monthly');
  if (abs.error) {
    log(`!! mp_absence_monthly NIE przeliczone: ${abs.error.message}`);
    log('   Uruchom w SQL Editorze:   select refresh_absence_monthly();');
  } else {
    log(`mp_absence_monthly: przeliczone w ${((Date.now() - t2) / 1000).toFixed(1)}s`);
  }

  const counts = await Promise.all(
    ['votings', 'votes', 'list_votes', 'mp_stats'].map(async (tbl) => {
      const r = await db().from(tbl).select('*', { count: 'exact', head: true });
      return `${tbl}=${(r.count ?? 0).toLocaleString('pl-PL')}`;
    }),
  );
  log(`gotowe. ${counts.join(' ')}`);
  log('Kontrola koncowa w SQL Editorze:  select count(*) from votings_niezgodne;   -- ma byc 0');
}

main().catch(async (err) => {
  const msg = err instanceof Error ? err.message : String(err);
  await writeCursor(JOB, { error: msg }).catch(() => {});
  console.error(`\nBLAD: ${msg}`);
  // Wazne rozroznienie: zapisujemy TRESC BLEDU, a nie postep.
  // Poprzednia wersja pisala "kursor zapisany", co brzmialo jakby przerwane
  // posiedzenie zostalo zaliczone. Kursor przesuwa sie wylacznie po UDANYM posiedzeniu.
  console.error('Postep NIE zostal przesuniety — przerwane posiedzenie zostanie powtorzone.');
  console.error('Upserty sa idempotentne, wiec czesciowo zapisane dane zostana uzupelnione.');
  process.exit(1);
});
