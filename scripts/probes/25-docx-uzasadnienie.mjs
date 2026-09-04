#!/usr/bin/env node
/**
 * SONDA 25 - poprawka do mojej wlasnej rekomendacji.
 *
 * Twierdzilem, ze uzasadnienie z druku sejmowego bedzie tanszym wsadem dla LLM
 * niz tekst ustawy. Raport 3 pokazal cos odwrotnego: druk 2698.pdf ma 299 stron
 * i 197 502 znaki (~65 800 tokenow), a sama ustawa 48 stron i 68 557 znakow
 * (~22 900 tokenow). Druk to komplet: projekt + uzasadnienie + OSR + opinie.
 *
 * ALE w zalacznikach byly TRZY pliki, nie jeden:
 *   2698.pdf, 2698-uzasadnienie.docx, 2698-ustawa.docx
 *
 * Uzasadnienie jest wiec dostepne OSOBNO, tylko jako DOCX. Moj analizator PDF
 * nie umial go otworzyc (DOCX to archiwum ZIP z XML-em w srodku) i dlatego
 * wypisal "0 znakow". Ta sonda czyta DOCX i mierzy, ile realnie kosztuje.
 *
 * Uruchomienie: node scripts/probes/25-docx-uzasadnienie.mjs
 *               PRINT=2600 node scripts/probes/25-docx-uzasadnienie.mjs
 */

import zlib from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';

const SEJM = 'https://api.sejm.gov.pl/sejm';
const TERM = Number(process.env.TERM ?? 10);
const PRINT = process.env.PRINT ?? '2698';
const UA = 'Obywatel2.0-PoC/0.4 (civic-tech research)';

/** Minimalny czytnik ZIP - wystarczy do wyjecia jednego pliku z DOCX. */
function unzipEntry(buf, wanted) {
  const SIG = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  let i = 0;
  while ((i = buf.indexOf(SIG, i)) !== -1) {
    const method = buf.readUInt16LE(i + 8);
    const compSize = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const nameStart = i + 30;
    const name = buf.subarray(nameStart, nameStart + nameLen).toString('utf8');
    const dataStart = nameStart + nameLen + extraLen;

    if (name === wanted) {
      // compSize == 0 oznacza deskryptor danych na koncu - czytamy do nastepnej sygnatury.
      let end = dataStart + compSize;
      if (compSize === 0) {
        const next = buf.indexOf(SIG, dataStart + 1);
        end = next === -1 ? buf.length : next;
      }
      const data = buf.subarray(dataStart, end);
      if (method === 0) return data;
      try { return zlib.inflateRawSync(data); } catch { return null; }
    }
    // UWAGA: wpisy katalogow maja compSize = 0, a kolejny naglowek zaczyna sie
    // DOKLADNIE w dataStart. Przeskok o +1 zgubilby go - stad zwykle dodanie compSize.
    i = dataStart + compSize;
  }
  return null;
}

/** DOCX -> czysty tekst. Akapity rozdzielamy nowa linia, zeby dalo sie to czytac. */
function docxToText(buf) {
  const xml = unzipEntry(buf, 'word/document.xml');
  if (!xml) return null;
  return xml
    .toString('utf8')
    .replace(/<w:p[ >]/g, '\n<w:p ')
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  return { status: r.status, buf: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type') ?? '' };
}

console.log(`\nDruk nr ${PRINT} - porownanie wsadow dla LLM\n${'='.repeat(60)}`);

const meta = await fetch(`${SEJM}/term${TERM}/prints/${PRINT}`, { headers: { 'User-Agent': UA } }).then((r) => r.json());
const atts = meta.attachments ?? [];
console.log(`Tytul: ${(meta.title ?? '').slice(0, 100)}`);
console.log(`Zalaczniki: ${atts.join(', ')}\n`);

await mkdir('scripts/probes/out', { recursive: true });
const results = [];

for (const att of atts) {
  const url = `${SEJM}/term${TERM}/prints/${PRINT}/${att}`;
  const { status, buf, type } = await get(url);
  if (status !== 200) { console.log(`  ${att}: HTTP ${status}`); continue; }
  await writeFile(`scripts/probes/out/${PRINT}-${att}`, buf);

  let text = null;
  if (att.endsWith('.docx')) text = docxToText(buf);
  else if (att.endsWith('.pdf')) text = '(PDF - zmierzony w sondzie 21)';

  const chars = typeof text === 'string' && !text.startsWith('(') ? text.length : null;
  console.log(`  ${att}`);
  console.log(`     ${(buf.length / 1024).toFixed(0)} KB | ${type.split(';')[0]}`);
  if (chars !== null) {
    const tok = Math.round(chars / 3);
    console.log(`     znakow: ${chars.toLocaleString('pl-PL')} | tokenow: ~${tok.toLocaleString('pl-PL')} | koszt wejscia @3$/1M: ~$${((tok / 1e6) * 3).toFixed(4)}`);
    console.log(`     poczatek: ${text.slice(0, 220).replace(/\n/g, ' ')}`);
    console.log(`     polskie znaki: ${/[ąćęłńóśźż]/i.test(text) ? 'TAK' : 'NIE'}`);
    results.push({ att, chars, tok });
    await writeFile(`scripts/probes/out/${PRINT}-${att}.txt`, text);
  } else if (text === null) {
    console.log('     !! nie udalo sie odczytac word/document.xml');
  }
  console.log('');
}

console.log('='.repeat(60));
if (results.length) {
  const best = results.sort((a, b) => a.tok - b.tok)[0];
  console.log(`Najtanszy wsad: ${best.att} (~${best.tok.toLocaleString('pl-PL')} tok.)`);
  console.log('Dla porownania: pelny tekst ustawy z ELI to ~22 900 tok., caly druk PDF ~65 800 tok.');
  console.log('\nDECYZJA: jesli uzasadnienie.docx jest wyraznie tansze i merytorycznie pelne,');
  console.log('pipeline Sprintu 5 czyta DOCX, a nie PDF - prostsze i tansze naraz.');
} else {
  console.log('Brak plikow DOCX do porownania - zostajemy przy PDF z ELI.');
}
