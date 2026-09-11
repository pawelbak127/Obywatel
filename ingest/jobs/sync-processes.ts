/**
 * Import procesow legislacyjnych — pierwszy etap Sprintu 4.
 *
 *   npm run ingest:procesy              pelny import
 *   npm run ingest:procesy -- --ile=50  tylko pierwsze N (do sprawdzenia)
 *   npm run ingest:procesy -- --sucho   pobiera i raportuje, NIC nie zapisuje
 *
 * BUDZET, ZMIERZONY. 1 662 procesy, etapy wylacznie ze szczegolow, ~800 ms
 * na zapytanie. Sekwencyjnie to 22 minuty; przy CONCURRENCY=8 z lib/http.ts
 * okolo trzech. Mieszczy sie w GitHub Actions bez kombinowania.
 *
 * DWIE RZECZY, KTORE MOGA POJSC ZLE PO CICHU — i co je lapie:
 *
 * 1. STRONICOWANIE. Bez `limit`/`offset` API oddaje 50 pozycji i nic o tym
 *    nie mowi w ciele odpowiedzi. Import zakonczylby sie sukcesem, majac 3%
 *    kadencji. Dlatego czytamy `x-total-count` i na koncu POROWNUJEMY liczbe
 *    zapisanych procesow z ta deklaracja. Rozjazd przerywa import.
 *
 * 2. POWIAZANIE Z GLOSOWANIAMI. Etap typu Voting niesie (sitting, votingNumber).
 *    Jesli glosowania nie ma jeszcze w naszej bazie, `voting_id` zostaje puste,
 *    ale surowe wspolrzedne zapisujemy zawsze — inaczej "etap nie ma glosowania"
 *    i "nie umielismy dopasowac" wygladaja identycznie.
 */

import { db } from '../lib/db.js';
import { assertSchema, WYMOGI_PROCESY } from '../lib/preflight.js';
import { recordSource } from '../lib/source-recorder.js';
import { mapLimit } from '../lib/http.js';
import { fetchProcessPage, fetchProcess, PROCESY_NA_STRONE, TERM } from '../lib/sejm-client.js';
import {
  mapProcess,
  mapStages,
  nieznaneWartosci,
  ZNANE_STAGE_TYPES,
  ZNANE_DOCUMENT_TYPES,
  type SejmProcess,
  type WierszProcesu,
  type WierszEtapu,
} from '../mappers/process.js';

const PACZKA = 200;

function flaga(nazwa: string): string | undefined {
  return process.argv.find((a: string) => a.startsWith(`--${nazwa}=`))?.split('=')[1];
}

/** Mapa (sitting, voting_number) -> votings.id. Jeden odczyt, potem O(1). */
async function mapaGlosowan(): Promise<Map<string, number>> {
  const mapa = new Map<string, number>();
  let od = 0;
  for (;;) {
    const r = await db()
      .from('votings')
      .select('id, sitting, voting_number')
      .eq('term', TERM)
      .order('id', { ascending: true })
      .range(od, od + 999);
    if (r.error) throw new Error(`votings.select: ${r.error.message}`);
    const dane = (r.data ?? []) as { id: number; sitting: number; voting_number: number }[];
    for (const v of dane) mapa.set(`${v.sitting}/${v.voting_number}`, v.id);
    if (dane.length < 1000) break;
    od += 1000;
  }
  return mapa;
}

async function main() {
  const sucho = process.argv.includes('--sucho') || process.argv.includes('--dry');
  const limitProcesow = Number(flaga('ile') ?? 0) || 0;

  await assertSchema(WYMOGI_PROCESY);

  // --- 1. Lista procesow, ze stronicowaniem ------------------------------
  console.log(`Kadencja ${TERM}. Pobieram liste procesow…`);
  const pierwsza = await fetchProcessPage(0);
  const deklarowane = Number(pierwsza.headers.get('x-total-count') ?? 0) || null;

  const wszystkie: { number: string }[] = [...pierwsza.data];
  for (let off = PROCESY_NA_STRONE; ; off += PROCESY_NA_STRONE) {
    if (deklarowane && off >= deklarowane) break;
    const strona = await fetchProcessPage(off);
    if (!strona.data.length) break;
    wszystkie.push(...strona.data);
    process.stdout.write(`\r  pobrano ${wszystkie.length}${deklarowane ? `/${deklarowane}` : ''} pozycji listy`);
    if (!deklarowane && strona.data.length < PROCESY_NA_STRONE) break;
  }
  process.stdout.write('\n');

  const numery = [...new Set(wszystkie.map((p) => String(p.number)))];
  console.log(`Lista: ${numery.length} unikalnych numerow${deklarowane ? `, API deklaruje ${deklarowane}` : ''}`);

  if (deklarowane && numery.length < deklarowane) {
    throw new Error(
      `Lista ma ${numery.length} pozycji, a API deklaruje ${deklarowane}. ` +
        'Stronicowanie nie dociagnelo calosci — przerywam, zeby nie zapisac niepelnej kadencji.',
    );
  }

  const doPobrania = limitProcesow ? numery.slice(0, limitProcesow) : numery;
  if (limitProcesow) console.log(`--ile=${limitProcesow}: pobieram tylko ${doPobrania.length} procesow.`);

  // --- 2. Szczegoly (jedyne zrodlo etapow) -------------------------------
  console.log(`Pobieram szczegoly ${doPobrania.length} procesow…`);
  let pobrane = 0;
  const szczegoly = await mapLimit(doPobrania, async (nr) => {
    const r = await fetchProcess(nr);
    pobrane++;
    if (pobrane % 100 === 0) process.stdout.write(`\r  ${pobrane}/${doPobrania.length}`);
    return { nr, dane: r.data as SejmProcess, raw: r.raw };
  });
  process.stdout.write('\n');

  // --- 3. Mapowanie PRZED zapisem ----------------------------------------
  const glosowania = await mapaGlosowan();
  console.log(`Glosowan w bazie do dopasowania: ${glosowania.size}`);

  const zrodlo = await recordSource({
    kind: 'sejm_api',
    url: `https://api.sejm.gov.pl/sejm/term${TERM}/processes`,
    apiEndpoint: '/processes',
    rawPayload: szczegoly.map((s) => s.raw).join('\n'),
  });

  const procesy: WierszProcesu[] = [];
  const etapy: WierszEtapu[] = [];
  const bledy: string[] = [];

  for (const s of szczegoly) {
    try {
      procesy.push(mapProcess(s.dane, zrodlo.sourceId));
      etapy.push(...mapStages(String(s.dane.number), s.dane.stages, (si, vn) => glosowania.get(`${si}/${vn}`) ?? null));
    } catch (e) {
      bledy.push(`  proces ${s.nr}: ${(e as Error).message}`);
    }
  }

  if (bledy.length) {
    throw new Error(['', `${bledy.length} procesow nie da sie zmapowac — NIC nie zapisano.`, '', ...bledy.slice(0, 20), ''].join('\n'));
  }

  // --- 4. Raport ---------------------------------------------------------
  const zGlosowaniem = etapy.filter((e) => e.voting_sitting !== null);
  const dopasowane = zGlosowaniem.filter((e) => e.voting_id !== null);
  const nowyTyp = nieznaneWartosci(etapy, 'stage_type', ZNANE_STAGE_TYPES);
  const nowyDok = nieznaneWartosci(procesy, 'document_type', ZNANE_DOCUMENT_TYPES);

  console.log('');
  console.log(`Procesow:                 ${procesy.length}`);
  console.log(`Etapow (po splaszczeniu): ${etapy.length}`);
  console.log(`  w tym poziom 2:         ${etapy.filter((e) => e.depth > 1).length}`);
  console.log(`Etapow z glosowaniem:     ${zGlosowaniem.length}`);
  console.log(`  dopasowanych do bazy:   ${dopasowane.length}${zGlosowaniem.length ? ` (${((dopasowane.length / zGlosowaniem.length) * 100).toFixed(1)}%)` : ''}`);
  console.log(`Procesow zakonczonych:    ${procesy.filter((p) => p.closure_date).length}`);
  console.log(`  uchwalonych (passed):   ${procesy.filter((p) => p.passed).length}`);
  console.log(`Z drukami lacznymi:       ${procesy.filter((p) => p.prints_jointly?.length).length}`);

  if (dopasowane.length < zGlosowaniem.length) {
    const brak = zGlosowaniem.filter((e) => e.voting_id === null).slice(0, 5);
    console.log('');
    console.log(`UWAGA: ${zGlosowaniem.length - dopasowane.length} etapow wskazuje glosowanie, ktorego nie ma w bazie.`);
    console.log('Przyklady (posiedzenie/numer): ' + brak.map((e) => `${e.voting_sitting}/${e.voting_number}`).join(', '));
    console.log('To nie jest blad importu procesow — to znaczy, ze `npm run ingest:votings`');
    console.log('nie objal tych posiedzen. Surowe wspolrzedne sa zapisane, wiec po imporcie');
    console.log('glosowan wystarczy uruchomic ten job ponownie.');
  }
  if (nowyTyp.length) {
    console.log('');
    console.log(`UWAGA: nowe wartosci stage_type: ${nowyTyp.join(', ')}`);
    console.log('Import przechodzi (to kolumna tekstowa), ale dopisz je do ZNANE_STAGE_TYPES.');
  }
  if (nowyDok.length) console.log(`UWAGA: nowe wartosci document_type: ${nowyDok.join(', ')}`);

  if (sucho) {
    console.log('\n--sucho: nic nie zapisano.');
    return;
  }

  // --- 5. Zapis ----------------------------------------------------------
  for (let i = 0; i < procesy.length; i += PACZKA) {
    const r = await db().from('legislative_processes').upsert(procesy.slice(i, i + PACZKA), { onConflict: 'print_number' });
    if (r.error) throw new Error(`legislative_processes.upsert (od ${i}): ${r.error.message}`);
    process.stdout.write(`\r  procesy ${Math.min(i + PACZKA, procesy.length)}/${procesy.length}`);
  }
  process.stdout.write('\n');

  // Etapy sa przepisywane w calosci dla importowanych procesow: API moze
  // przenumerowac drzewo miedzy przebiegami, wiec upsert po (print_number,
  // ordinal) zostawilby ogony po poprzedniej wersji.
  const numeryDoCzyszczenia = [...new Set(procesy.map((p) => p.print_number))];
  for (let i = 0; i < numeryDoCzyszczenia.length; i += PACZKA) {
    const r = await db().from('process_stages').delete().in('print_number', numeryDoCzyszczenia.slice(i, i + PACZKA));
    if (r.error) throw new Error(`process_stages.delete: ${r.error.message}`);
  }
  for (let i = 0; i < etapy.length; i += PACZKA) {
    const r = await db().from('process_stages').insert(etapy.slice(i, i + PACZKA));
    if (r.error) throw new Error(`process_stages.insert (od ${i}): ${r.error.message}`);
    process.stdout.write(`\r  etapy ${Math.min(i + PACZKA, etapy.length)}/${etapy.length}`);
  }
  process.stdout.write('\n');

  // --- 6. Kontrola sum ---------------------------------------------------
  const lp = await db().from('legislative_processes').select('print_number', { count: 'exact' }).limit(0);
  const ls = await db().from('process_stages').select('print_number', { count: 'exact' }).limit(0);
  if (lp.error || ls.error) throw new Error(`kontrola sum: ${lp.error?.message ?? ls.error?.message}`);

  console.log('');
  console.log(`W bazie: ${lp.count} procesow, ${ls.count} etapow.`);

  if (!limitProcesow && deklarowane && lp.count !== deklarowane) {
    throw new Error(
      `KONTROLA SUM: w bazie ${lp.count} procesow, API deklaruje ${deklarowane}. ` +
        'Sprawdz, zanim cokolwiek z tego trafi na strone.',
    );
  }
  console.log('Kontrola sum: OK.');
}

main().catch((e) => {
  console.error(`\n${(e as Error).message}`);
  process.exit(1);
});
