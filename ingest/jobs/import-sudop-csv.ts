/**
 * Import eksportu CSV z SUDOP.
 *
 *   npx tsx --env-file=.env.local ingest/jobs/import-sudop-csv.ts \
 *       C:\Users\...\przypadki_pomocy.csv --z=aidEvent
 *
 * Flagi:
 *   --z=aidEvent|aidSource|aidBeneficiary   z ktorej strony wyszukiwarki jest plik
 *   --zrodlo=<pelny URL>                    zamiast --z, gdy adres jest inny
 *   --pobrano=RRRR-MM-DD                    kiedy CZLOWIEK pobral plik
 *                                           (domyslnie: czas modyfikacji pliku)
 *   --sucho                                 przetworz i zaraportuj, nic nie zapisuj
 *
 * DLACZEGO PLIK, A NIE SKROBANIE (decyzja D13). To jest projekt o rozliczalnosci
 * instytucji publicznych. Pierwsze pytanie przy pierwszym tekscie o czyichs
 * dotacjach bedzie dotyczylo pochodzenia danych, a "automatyzowalismy interfejs
 * przeznaczony dla ludzi" to zla odpowiedz. Czlowiek pobiera oficjalny eksport,
 * my importujemy plik.
 *
 * KOLEJNOSC KONTROLI. Wszystko, co moze przerwac import, dzieje sie PRZED
 * pierwszym zapisem: schemat bazy, kontrakt naglowka, mapowanie wszystkich
 * wierszy. Jesli wiersz nr 4 000 ma date "31.02.2020", dowiesz sie o tym zanim
 * do bazy trafi wiersz nr 1. Ta sama zasada co przy `vote_value` — tam nauczyla
 * nas jej awaria w polowie zapisu 1,9 mln glosow.
 */

import { readFile, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

import { db } from '../lib/db.js';
import { assertSchema, WYMOGI_SUDOP } from '../lib/preflight.js';
import { recordSource, sha256 } from '../lib/source-recorder.js';
import { wczytajCsv } from '../lib/csv.js';
import { mapujWiersz, sprawdzNaglowek, nieznaneWielkosci, type WierszDotacji } from '../mappers/sudop.js';

const STRONY: Record<string, string> = {
  aidEvent: 'https://sudop.uokik.gov.pl/results/aidEvent',
  aidSource: 'https://sudop.uokik.gov.pl/results/aidSource',
  aidBeneficiary: 'https://sudop.uokik.gov.pl/results/aidBeneficiary',
};

const PACZKA = 500;

function argi(argv: string[]) {
  const pozycyjne = argv.filter((a) => !a.startsWith('--'));
  const flaga = (n: string) => argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
  return {
    plik: pozycyjne[0],
    z: flaga('z'),
    zrodlo: flaga('zrodlo'),
    pobrano: flaga('pobrano'),
    sucho: argv.includes('--sucho') || argv.includes('--dry'),
  };
}

function pomoc(powod: string): never {
  console.error(
    [
      '',
      powod,
      '',
      'Uzycie:',
      '  npx tsx --env-file=.env.local ingest/jobs/import-sudop-csv.ts <plik.csv> --z=aidEvent',
      '',
      'Skad plik: sudop.uokik.gov.pl -> wyszukaj -> na stronie wynikow zaznacz wiersze',
      '-> "Format zapisu: CSV" -> zapisz. Nie otwieraj go po drodze w Excelu.',
      '',
      `Wartosci --z:  ${Object.keys(STRONY).join(' | ')}`,
      'Albo --zrodlo=<pelny URL strony, z ktorej pochodzi eksport>.',
      '',
      'Adres zrodla trafia na frontend przy KAZDEJ kwocie z tego pliku (decyzja D1),',
      'wiec nie ma tu wartosci domyslnej — musisz go podac swiadomie.',
      '',
    ].join('\n'),
  );
  process.exit(1);
  throw new Error(powod); // nieosiagalne — dla kompilatora, ktory nie zna typu process.exit
}

async function main() {
  const a = argi(process.argv.slice(2));
  if (!a.plik) pomoc('Nie podano pliku CSV.');

  const url = a.zrodlo ?? (a.z ? STRONY[a.z] : undefined);
  if (!url) pomoc(a.z ? `Nieznana strona: ${a.z}` : 'Nie podano --z ani --zrodlo.');

  const sciezka = resolve(a.plik);
  const bajty = await readFile(sciezka);
  const info = await stat(sciezka);

  // Data pobrania. UOKiK wymaga jej przy republikacji, a `now()` bylby nieprawda:
  // plik mogl lezec na dysku tydzien. Czas modyfikacji pliku to moment zapisu
  // przez przegladarke, czyli dokladnie to, o co chodzi.
  const pobrano = a.pobrano ? new Date(`${a.pobrano}T12:00:00Z`) : info.mtime;
  if (Number.isNaN(pobrano.getTime())) pomoc(`--pobrano nie jest data: ${a.pobrano}`);

  console.log(`Plik:     ${basename(sciezka)}  (${(bajty.length / 1024).toFixed(1)} KB)`);
  console.log(`Zrodlo:   ${url}`);
  console.log(`Pobrano:  ${pobrano.toISOString().slice(0, 10)}${a.pobrano ? ' (z flagi)' : ' (czas modyfikacji pliku)'}`);
  console.log(`Hash:     ${sha256(bajty).slice(0, 16)}…`);

  await assertSchema(WYMOGI_SUDOP);

  // --- 1. Odczyt i kontrakt --------------------------------------------
  const { naglowki, wiersze, kodowanie, wierszyWPliku } = wczytajCsv(bajty);
  console.log(`Kodowanie: ${kodowanie}, kolumn: ${naglowki.length}, wierszy danych: ${wierszyWPliku}`);
  sprawdzNaglowek(naglowki); // rzuca z pelnym porownaniem kolumna po kolumnie

  // --- 2. Mapowanie wszystkiego przed jakimkolwiek zapisem --------------
  const zmapowane: WierszDotacji[] = [];
  const bledy: string[] = [];
  for (const [i, w] of wiersze.entries()) {
    try {
      zmapowane.push(mapujWiersz(w, sha256));
    } catch (e) {
      // +2 bo numerujemy jak w edytorze: wiersz 1 to naglowek.
      bledy.push(`  wiersz ${i + 2}: ${(e as Error).message}`);
      if (bledy.length >= 20) { bledy.push('  … (dalsze pominieto)'); break; }
    }
  }
  if (bledy.length) {
    throw new Error(
      ['', `${bledy.length} wierszy nie da sie odczytac — NIC nie zapisano.`, '', ...bledy, ''].join('\n'),
    );
  }

  // --- 3. Raport przed zapisem ------------------------------------------
  const wPliku = new Map<string, WierszDotacji>();
  let duplikatyWPliku = 0;
  for (const w of zmapowane) {
    if (wPliku.has(w.row_sha256)) duplikatyWPliku++;
    else wPliku.set(w.row_sha256, w);
  }
  const doZapisu = [...wPliku.values()];

  const bezNip = doZapisu.filter((w) => !w.beneficiary_nip).length;
  const zlyNip = doZapisu.filter((w) => w.beneficiary_nip && !w.nip_valid).length;
  const bezTeryt = doZapisu.filter((w) => !w.teryt).length;
  const nowe = nieznaneWielkosci(doZapisu);
  const kwota = doZapisu.reduce((s, w) => s + (w.value_gross_pln ?? 0), 0);
  const daty = doZapisu.map((w) => w.granted_on).sort();

  console.log('');
  console.log(`Wierszy unikalnych:   ${doZapisu.length}${duplikatyWPliku ? `  (+${duplikatyWPliku} duplikatow w samym pliku)` : ''}`);
  console.log(`Zakres dat:           ${daty[0]} … ${daty[daty.length - 1]}`);
  console.log(`Suma pomocy brutto:   ${kwota.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} PLN`);
  console.log(`Bez NIP-u:            ${bezNip}`);
  console.log(`NIP z bledna suma:    ${zlyNip}${zlyNip ? '  <- te wiersze NIE beda laczone z niczym' : ''}`);
  console.log(`Bez kodu TERYT:       ${bezTeryt}`);
  if (nowe.length) {
    console.log('');
    console.log(`UWAGA: nieznane wartosci "Wielkosc beneficjenta": ${nowe.join(', ')}`);
    console.log('Import przechodzi (to zwykly tekst), ale dopisz je do ZNANE_WIELKOSCI');
    console.log('w ingest/mappers/sudop.ts, zeby nastepnym razem nie krzyczalo.');
  }

  // Kody TERYT spoza slownika gmin. Nie blad — gminy sie lacza, a dotacje
  // siegaja 2007 roku. Ale warto o tym wiedziec przed publikacja modulu lokalnego.
  const teryty = [...new Set(doZapisu.map((w) => w.teryt).filter(Boolean))] as string[];
  if (teryty.length) {
    const g = await db().from('sudop_gminy').select('teryt').in('teryt', teryty);
    if (g.error) throw new Error(`sudop_gminy.select: ${g.error.message}`);
    const znane = new Set((g.data ?? []).map((r: { teryt: string }) => r.teryt));
    const obce = teryty.filter((t) => !znane.has(t));
    if (obce.length) {
      console.log('');
      console.log(`UWAGA: ${obce.length} kodow TERYT nie ma w slowniku gmin: ${obce.slice(0, 10).join(', ')}${obce.length > 10 ? ' …' : ''}`);
      console.log(znane.size === 0
        ? 'Slownik jest pusty — uruchom najpierw:  npm run ingest:sudop-gminy'
        : 'Prawdopodobnie gminy zlikwidowane albo polaczone. Zostana bez nazwy.');
    }
  }

  if (a.sucho) {
    console.log('');
    console.log('--sucho: nic nie zapisano.');
    return;
  }

  // --- 4. Zrodlo, potem fakty -------------------------------------------
  const zrodlo = await recordSource({
    kind: 'sudop_csv',
    url,
    rawPayload: bajty,
    retrievedAt: pobrano.toISOString(),
  });
  console.log('');
  console.log(zrodlo.changed
    ? `Zrodlo zapisane: ${zrodlo.sourceId}`
    : `Ten sam plik byl juz importowany — uzywam istniejacego zrodla ${zrodlo.sourceId}`);

  const przed = await policz();
  let wyslane = 0;
  for (let i = 0; i < doZapisu.length; i += PACZKA) {
    const paczka = doZapisu.slice(i, i + PACZKA).map((w) => ({ ...w, source_id: zrodlo.sourceId }));
    // ignoreDuplicates: wiersz, ktory juz mamy z innego eksportu, zostaje przy
    // SWOIM pierwotnym zrodle. Nadpisanie source_id skasowaloby informacje,
    // skad ta liczba wziela sie po raz pierwszy.
    const r = await db().from('subsidies').upsert(paczka, { onConflict: 'row_sha256', ignoreDuplicates: true });
    if (r.error) throw new Error(`subsidies.upsert (paczka od ${i}): ${r.error.message}`);
    wyslane += paczka.length;
    process.stdout.write(`\r  zapisano ${wyslane}/${doZapisu.length}`);
  }
  process.stdout.write('\n');

  // --- 5. Kontrola sum ---------------------------------------------------
  const po = await policz();
  const dodane = po - przed;
  const juzByly = doZapisu.length - dodane;

  console.log('');
  console.log(`Wierszy w pliku:      ${wierszyWPliku}`);
  console.log(`Duplikaty w pliku:    ${duplikatyWPliku}`);
  console.log(`Nowych w bazie:       ${dodane}`);
  console.log(`Bylo juz wczesniej:   ${juzByly}`);
  console.log(`Razem w subsidies:    ${po}`);

  if (dodane + juzByly + duplikatyWPliku !== wierszyWPliku) {
    throw new Error(
      `KONTROLA SUM NIE WYCHODZI: ${dodane} + ${juzByly} + ${duplikatyWPliku} != ${wierszyWPliku}. ` +
        'Sprawdz baze przed publikacja czegokolwiek z tego importu.',
    );
  }
  console.log('Kontrola sum: OK.');
}

async function policz(): Promise<number> {
  const r = await db().from('subsidies').select('id', { count: 'exact', head: false }).limit(0);
  if (r.error) throw new Error(`subsidies.count: ${r.error.message}`);
  if (r.count === null) throw new Error('subsidies.count zwrocil null — to zwykle znaczy zly URL Supabase.');
  return r.count;
}

main().catch((e) => {
  console.error(`\n${(e as Error).message}`);
  process.exit(1);
});
