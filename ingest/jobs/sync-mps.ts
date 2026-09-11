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
import { headExists, mapLimit } from '../lib/http.js';

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

/**
 * SPRAWDZENIE ZDJEC (migracja 0018).
 *
 * `photo_url` jest SKLADANY z id posla (`/MP/{id}/photo`), a nie pobierany
 * z API — nikt wiec nie zagwarantowal, ze pod tym adresem cokolwiek jest.
 * Dopoki zdjec nie pokazywalismy, nie mialo to znaczenia. Od chwili, gdy
 * miniatura wchodzi na liste rankingowa, kazdy nieistniejacy plik to zepsuty
 * obrazek w serwisie, ktorego cala teza brzmi "kazda informacja ma pokrycie".
 *
 * HEAD, wiec bez sciagania obrazow: ~460 zapytan, kilkanascie sekund.
 * Powtarzamy nie czesciej niz raz na 30 dni — zdjecia poslow sie nie zmieniaja,
 * a Kancelaria Sejmu nie ma powodu ogladac tego co noc.
 *
 * Trzy stany, nie dwa. `null` z `headExists` znaczy "serwer nie odpowiedzial
 * jednoznacznie" (429, 500, timeout) i wtedy NIE zapisujemy nic — inaczej
 * jedna chwila slabej sieci skasowalaby zdjecia polowie Sejmu.
 */
const DNI_WAZNOSCI = 30;

async function checkPhotos(): Promise<void> {
  const prog = new Date(Date.now() - DNI_WAZNOSCI * 86_400_000).toISOString();

  const q = db().from('mps').select('id, photo_url, photo_checked_at').not('photo_url', 'is', null);
  const { data, error } = FORCE ? await q : await q.or(`photo_checked_at.is.null,photo_checked_at.lt.${prog}`);
  if (error) {
    // Baza bez migracji 0018 nie ma tych kolumn. To nie powod, zeby wywalic
    // caly import poslow — mowimy glosno i idziemy dalej.
    log(`zdjecia: pomijam sprawdzenie (${error.message})`);
    return;
  }

  const doSprawdzenia = (data ?? []) as Array<{ id: number; photo_url: string }>;
  if (!doSprawdzenia.length) {
    log(`zdjecia: wszystkie sprawdzone w ciagu ostatnich ${DNI_WAZNOSCI} dni — pomijam`);
    return;
  }

  log(`zdjecia: sprawdzam ${doSprawdzenia.length} adresow (HEAD)…`);
  const teraz = new Date().toISOString();
  const wyniki = await mapLimit(doSprawdzenia, async (m) => ({
    id: m.id,
    istnieje: await headExists(m.photo_url),
  }));

  const jest = wyniki.filter((w) => w.istnieje === true);
  const niema = wyniki.filter((w) => w.istnieje === false);
  const nieWiadomo = wyniki.filter((w) => w.istnieje === null);

  // ------------------------------------------------------------------
  // ZAPIS: UPDATE, nie UPSERT. To nie jest kosmetyka.
  //
  // Pierwsza wersja robila `upsert({ id, photo_exists, photo_checked_at })`
  // i wywalala sie na zywej bazie:
  //
  //     null value in column "first_name" of relation "mps"
  //     violates not-null constraint
  //
  // PostgREST tlumaczy upsert na INSERT ... ON CONFLICT DO UPDATE, a Postgres
  // sprawdza poprawnosc krotki WSTAWIANEJ, zanim w ogole dojdzie do konfliktu.
  // Trzy kolumny to za malo na wiersz posla — i nie ma znaczenia, ze ten wiersz
  // od dawna istnieje. Upsert sluzy do wstawiania-albo-nadpisywania CALYCH
  // rekordow; do zmiany dwoch pol w istniejacych wierszach sluzy UPDATE.
  //
  // Zamiast 460 osobnych zapytan grupujemy po wyniku: wszystkie "ma zdjecie"
  // jednym UPDATE ... WHERE id IN (...), wszystkie "nie ma" drugim. Porcje po
  // 200 id, zeby nie budowac kilometrowego adresu.
  //
  // Zapisujemy WYLACZNIE rozstrzygniete. Przypadki "nie wiem" zostaja
  // nietkniete i wroca przy nastepnym uruchomieniu.
  // ------------------------------------------------------------------
  const zapisz = async (grupa: typeof jest, wartosc: boolean) => {
    for (let i = 0; i < grupa.length; i += 200) {
      const ids = grupa.slice(i, i + 200).map((w) => w.id);
      const res = await db()
        .from('mps')
        .update({ photo_exists: wartosc, photo_checked_at: teraz })
        .in('id', ids);
      if (res.error) {
        throw new Error(`mps.update (zdjecia, ${wartosc ? 'jest' : 'brak'}) [${i}]: ${res.error.message}`);
      }
    }
  };
  await zapisz(jest, true);
  await zapisz(niema, false);

  log(`zdjecia: jest ${jest.length}, brak ${niema.length}, nierozstrzygnietych ${nieWiadomo.length}`);
  if (niema.length) {
    log(`   poslowie bez zdjecia (id): ${niema.map((w) => w.id).join(', ')}`);
    log('   -> interfejs pokaze dla nich inicjaly, nie zepsuty obrazek');
  }
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
    // PO zapisie poslow: `photo_url` musi juz byc w bazie, zanim go sprawdzimy.
    await checkPhotos();
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
