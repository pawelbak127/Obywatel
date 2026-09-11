/**
 * Import funkcji panstwowych poslow do `mp_roles`.
 *
 *   npm run ingest:role            (czyta data/mp-roles.csv)
 *   npm run ingest:role -- --sucho (sprawdza i raportuje, nic nie zapisuje)
 *
 * `mp_roles` jest jedyna tabela w projekcie, do ktorej tresc wpisuje CZLOWIEK,
 * a nie rejestr panstwowy. Dlatego kontrola jest tu ostrzejsza niz gdziekolwiek
 * indziej — komplet regul i uzasadnienie w ingest/mappers/mp-roles.ts.
 *
 * Kazdy wiersz pliku dostaje WLASNY wpis w `sources` z adresem dokumentu
 * powolania. Dzieki temu na stronie posla przy zdaniu "Prezes Rady Ministrow
 * od 13 grudnia 2023" stoi link do postanowienia, a nie do naszego pliku CSV.
 */

import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import { db } from '../lib/db.js';
import { assertSchema } from '../lib/preflight.js';
import { recordSource } from '../lib/source-recorder.js';
import { wczytajCsv } from '../lib/csv.js';
import { mapujRole, sprawdzNaglowekRol, niezgodneNazwiska, type WierszRoli } from '../mappers/mp-roles.js';

const DOMYSLNY_PLIK = 'data/mp-roles.csv';

async function main() {
  const argv = process.argv.slice(2);
  const sucho = argv.includes('--sucho') || argv.includes('--dry');
  const plik = argv.find((a: string) => !a.startsWith('--')) ?? DOMYSLNY_PLIK;
  const sciezka = resolve(plik);

  let bajty: Buffer;
  try {
    bajty = await readFile(sciezka);
  } catch (e) {
    if ((e as { code?: string }).code === 'ENOENT') {
      throw new Error(
        [
          '',
          `Nie ma pliku ${sciezka}`,
          '',
          'Skopiuj wzor i wypelnij:',
          '  copy data\\mp-roles.example.csv data\\mp-roles.csv',
          '',
          'Kazdy wiersz wymaga linku do dokumentu powolania z oficjalnego rejestru.',
          '',
        ].join('\n'),
      );
    }
    throw e;
  }
  const info = await stat(sciezka);

  console.log(`Plik: ${plik}  (${bajty.length} B, zmieniony ${info.mtime.toISOString().slice(0, 10)})`);
  await assertSchema();

  const { naglowki, wiersze, kodowanie, wierszyWPliku } = wczytajCsv(bajty);
  console.log(`Kodowanie: ${kodowanie}, wierszy: ${wierszyWPliku}`);
  sprawdzNaglowekRol(naglowki);

  // --- 1. Kontrola formalna: wszystko przed jakimkolwiek zapisem --------
  const role: WierszRoli[] = [];
  const bledy: string[] = [];
  for (const [i, w] of wiersze.entries()) {
    try {
      role.push(mapujRole(w, i + 2));
    } catch (e) {
      bledy.push(`  ${(e as Error).message}`);
    }
  }
  if (bledy.length) {
    throw new Error(['', `${bledy.length} wierszy nie przechodzi kontroli — NIC nie zapisano.`, '', ...bledy, ''].join('\n'));
  }
  if (!role.length) {
    console.log('Plik nie zawiera zadnych wierszy poza naglowkiem.');
    return;
  }

  // --- 2. Kontrola zgodnosci z baza -------------------------------------
  const slugi = [...new Set(role.map((r) => r.slug))];
  const res = await db().from('mps').select('id, slug, full_name').in('slug', slugi);
  if (res.error) throw new Error(`mps.select: ${res.error.message}`);

  const poSlugu = new Map<string, { id: number; full_name: string }>();
  for (const r of (res.data ?? []) as { id: number; slug: string; full_name: string }[]) {
    poSlugu.set(r.slug, { id: r.id, full_name: r.full_name });
  }
  const nazwiskaWBazie = new Map([...poSlugu].map(([s, v]) => [s, v.full_name]));

  const niezgodne = niezgodneNazwiska(role, nazwiskaWBazie);
  if (niezgodne.length) {
    throw new Error(
      [
        '',
        'NIEZGODNOSC Z BAZA — nic nie zapisano.',
        '',
        ...niezgodne,
        '',
        'Nazwisko w pliku sluzy wlasnie do tego: zeby funkcja panstwowa nie trafila',
        'do niewlasciwego posla przez literowke w slugu. To nie jest blad, ktory',
        'zlapie kompilator — to jest blad, ktory zobaczy czytelnik.',
        '',
      ].join('\n'),
    );
  }

  // --- 3. Raport przed zapisem ------------------------------------------
  console.log('');
  console.log('Do zapisania:');
  for (const r of role) {
    const okres = `${r.date_from} … ${r.date_to ?? 'trwa'}`;
    console.log(`  ${r.imie_nazwisko.padEnd(28)} ${r.role_name}  [${r.role_kind}]  ${okres}`);
    console.log(`  ${' '.repeat(28)} zrodlo: ${r.zrodlo_url}`);
  }

  if (sucho) {
    console.log('');
    console.log('--sucho: nic nie zapisano.');
    return;
  }

  // --- 4. Zapis: kazda rola z wlasnym zrodlem ----------------------------
  let nowe = 0;
  let byly = 0;
  for (const r of role) {
    const zrodlo = await recordSource({
      kind: 'press', // dokument powolania spoza naszych API — rodzaj ogolny
      url: r.zrodlo_url,
      rawPayload: `${r.slug}|${r.role_name}|${r.date_from}|${r.date_to ?? ''}`,
    });

    const wpis = await db()
      .from('mp_roles')
      .upsert(
        {
          mp_id: poSlugu.get(r.slug)!.id,
          role_name: r.role_name,
          role_kind: r.role_kind,
          date_from: r.date_from,
          date_to: r.date_to,
          source_id: zrodlo.sourceId,
        },
        { onConflict: 'mp_id,role_name,date_from', ignoreDuplicates: false },
      )
      .select('id');

    if (wpis.error) throw new Error(`mp_roles.upsert (${r.slug}): ${wpis.error.message}`);
    if (zrodlo.changed) nowe++;
    else byly++;
  }

  const licz = await db().from('mp_roles').select('id', { count: 'exact' }).limit(0);
  if (licz.error) throw new Error(`mp_roles.count: ${licz.error.message}`);

  console.log('');
  console.log(`Zapisano ${role.length} funkcji (${nowe} nowych zrodel, ${byly} juz znanych).`);
  console.log(`Funkcji w bazie razem: ${licz.count}`);
  console.log('');
  console.log('Teraz przelicz kontekst:  select refresh_absence_monthly();');
}

main().catch((e) => {
  console.error(`\n${(e as Error).message}`);
  process.exit(1);
});
