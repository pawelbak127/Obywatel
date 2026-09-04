#!/usr/bin/env node
/**
 * SONDA 26 - naprawa parsera oswiadczen majatkowych.
 *
 * Sonda 23 zwrocila bzdury: "216 = 190", "004 = 183". Moj regex braly liczbe
 * z sasiedniej kolumny tabeli zamiast nazwiska, i zlapal 14 wpisow zamiast ~460.
 * Stad tez 0% dopasowania do mps.id - nie bylo czego dopasowywac.
 *
 * Ta wersja nie zgaduje: rozbija HTML na wiersze <tr>, wypisuje WSZYSTKIE komorki
 * pierwszych wierszy i dopiero na tej podstawie wybiera kolumne z nazwiskiem.
 * Dodatkowo obsluguje paginacje (?page=1..7), ktora sonda 23 zignorowala.
 *
 * Uruchomienie: node scripts/probes/26-oswiadczenia-parser.mjs
 */

import { mkdir, writeFile } from 'node:fs/promises';

const HOST = 'https://www.sejm.gov.pl';
const TERM = Number(process.env.TERM ?? 10);
const BASE = `${HOST}/sejm${TERM}.nsf/`;
const UA = 'Obywatel2.0-PoC/0.4 (civic-tech research)';

const get = (url) =>
  fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } }).then(async (r) => ({
    status: r.status,
    html: await r.text(),
  }));

const strip = (s) =>
  s.replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

/** Rozbija tabele na wiersze i komorki - bez zgadywania, ktora kolumna jest ktora. */
function parseRows(html) {
  return [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((tr) => {
    const cells = [...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((td) => ({
      text: strip(td[1]),
      hrefs: [...td[1].matchAll(/href="([^"]+)"/gi)].map((m) => m[1].replace(/&amp;/g, '&')),
    }));
    return cells;
  }).filter((cells) => cells.length > 1);
}

await mkdir('scripts/probes/out', { recursive: true });

console.log('\nKROK 1 - struktura tabeli na liscie poslow');
console.log('='.repeat(64));
const agentUrl = `${BASE}agent.xsp?symbol=ROSWIADCZENIA&NrKadencji=${TERM}&Typ=OSW`;
const agent = await get(agentUrl);
console.log(`HTTP ${agent.status}, ${(agent.html.length / 1024).toFixed(1)} KB`);
await writeFile('scripts/probes/out/agent.html', agent.html);

const rows = parseRows(agent.html);
console.log(`wierszy <tr> z co najmniej 2 komorkami: ${rows.length}\n`);
console.log('PIERWSZE 5 WIERSZY, KOMORKA PO KOMORCE — to jest to, czego mi brakowalo:');
for (const [i, cells] of rows.slice(0, 5).entries()) {
  console.log(`  [${i}] ${cells.length} komorek:`);
  for (const [j, c] of cells.entries()) {
    console.log(`      (${j}) "${c.text.slice(0, 60)}"${c.hrefs.length ? ` -> ${c.hrefs[0].slice(0, 80)}` : ''}`);
  }
}

// Kolumna z nazwiskiem to ta, ktora najczesciej wyglada jak "Nazwisko Imie".
const looksLikeName = (t) => /^[A-ZŁŚŻŹĆĄĘÓŃ][\p{L}-]+\s+[A-ZŁŚŻŹĆĄĘÓŃ][\p{L}-]+/u.test(t);
const scores = {};
for (const cells of rows) {
  for (const [j, c] of cells.entries()) if (looksLikeName(c.text)) scores[j] = (scores[j] ?? 0) + 1;
}
const nameCol = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
console.log(`\nkolumna z nazwiskiem: ${nameCol ? `#${nameCol[0]} (trafien: ${nameCol[1]})` : 'NIE ROZPOZNANO'}`);

const people = [];
for (const cells of rows) {
  const idHref = cells.flatMap((c) => c.hrefs).find((h) => /ROSW_LISTA/.test(h));
  const nsfId = idHref?.match(/[?&]id=(\d+)/)?.[1];
  const name = nameCol ? cells[Number(nameCol[0])]?.text : cells.find((c) => looksLikeName(c.text))?.text;
  if (nsfId && name) people.push({ nsfId, name, href: idHref });
}
console.log(`sparowanych (id_nsf + nazwisko): ${people.length}`);
for (const p of people.slice(0, 8)) console.log(`   ${p.nsfId} = ${p.name}`);

console.log('\nKROK 2 - mapa id_nsf <-> mp_id');
console.log('='.repeat(64));
const mps = await fetch(`https://api.sejm.gov.pl/sejm/term${TERM}/MP`, { headers: { 'User-Agent': UA } }).then((r) => r.json());
const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const idx = new Map();
for (const m of mps) {
  idx.set(norm(`${m.lastName} ${m.firstName}`), m.id);
  idx.set(norm(`${m.firstName} ${m.lastName}`), m.id);
  if (m.secondName) idx.set(norm(`${m.lastName} ${m.firstName} ${m.secondName}`), m.id);
}
const mapped = [];
const misses = [];
for (const p of people) {
  const id = idx.get(norm(p.name));
  if (id) mapped.push({ ...p, mpId: id }); else misses.push(p.name);
}
console.log(`dopasowanych: ${mapped.length}/${people.length}${people.length ? ` (${Math.round((mapped.length / people.length) * 100)}%)` : ''}`);
if (misses.length) console.log(`niedopasowane (${misses.length}): ${misses.slice(0, 12).join(' | ')}`);
await writeFile('scripts/probes/out/mapa-nsf.json', JSON.stringify(mapped, null, 2));

console.log('\nKROK 3 - zejscie do dokumentu jednego posla (z paginacja)');
console.log('='.repeat(64));
const target = mapped[0] ?? people[0];
if (!target) {
  console.log('Brak wpisow do sprawdzenia. Wyslij mi scripts/probes/out/agent.html.');
} else {
  console.log(`posel: ${target.name} (id_nsf=${target.nsfId}${target.mpId ? `, mp_id=${target.mpId}` : ''})`);
  const seen = new Set();
  const docs = [];
  for (let page = 1; page <= 8; page++) {
    const url = new URL(`interpelacje.xsp?symbol=ROSW_LISTA&view=8&id=${target.nsfId}&page=${page}`, BASE).toString();
    const r = await get(url);
    if (r.status !== 200) break;
    if (page === 1) await writeFile(`scripts/probes/out/lista-${target.nsfId}.html`, r.html);
    const before = docs.length;
    for (const m of r.html.matchAll(/href="([^"]+)"/gi)) {
      const h = m[1].replace(/&amp;/g, '&');
      if (seen.has(h)) continue;
      seen.add(h);
      if (/\.pdf|ROSW_DOK|attachment|Zalacznik|\/\$FILE\//i.test(h)) docs.push(h);
    }
    console.log(`   strona ${page}: +${docs.length - before} linkow dokumentowych`);
    if (docs.length - before === 0 && page > 2) break;
    await new Promise((r2) => setTimeout(r2, 400));
  }
  console.log(`\nlinkow do dokumentow: ${docs.length}`);
  for (const d of docs.slice(0, 12)) console.log(`   ${d.slice(0, 150)}`);

  const pdf = docs.find((d) => /\.pdf/i.test(d));
  if (pdf) {
    const url = new URL(pdf, BASE).toString();
    console.log(`\nPobieram: ${url.slice(0, 130)}`);
    const r = await fetch(url, { headers: { 'User-Agent': UA, Referer: agentUrl } });
    const buf = Buffer.from(await r.arrayBuffer());
    await writeFile(`scripts/probes/out/oswiadczenie-${target.nsfId}.pdf`, buf);
    const s = buf.toString('latin1');
    const jpeg = (s.match(/\/DCTDecode/g) ?? []).length;
    const ccitt = (s.match(/\/CCITTFaxDecode/g) ?? []).length;
    const fonts = (s.match(/\/Font/g) ?? []).length;
    console.log(`   ${(buf.length / 1024).toFixed(0)} KB | /Font: ${fonts} | JPEG: ${jpeg} | CCITT: ${ccitt}`);
    console.log(`   >>> ${jpeg + ccitt > 0 && fonts === 0 ? 'SKAN - majatek poza MVP, wejscie reczne.' : 'Sa fonty - moze byc tekstowy. Sprawdz plikiem w out/.'}`);
  } else {
    console.log('\nNadal brak bezposredniego .pdf. Otworz w przegladarce:');
    console.log(`   ${new URL(`interpelacje.xsp?symbol=ROSW_LISTA&view=8&id=${target.nsfId}`, BASE)}`);
    console.log('   kliknij dowolne oswiadczenie i przyslij mi link z paska adresu.');
  }
}
