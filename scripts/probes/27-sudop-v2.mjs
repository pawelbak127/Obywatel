#!/usr/bin/env node
/**
 * SUDOP — PODEJSCIE DRUGIE. Poprzednie zamkniecie sprawy bylo przedwczesne.
 *
 * CO USTALILEM Z DOKUMENTACJI UOKiK (archiwum.uokik.gov.pl/sudop.php):
 *
 * 1. SCIEZKI SA INNE, niz uzywalem.
 *      dokumentacja:  /sudop-api/api/przypadki-pomocy
 *      ja probowalem: /sudop-api/v1/api/przypadki-pomocy      <- nadmiarowe /v1
 *      slowniki:      /sudop-api/slownik/forma-pomocy         <- nie /v1/api/slowniki
 *
 * 2. NAZWY PARAMETROW SA INNE, niz zgadywalem. Dokumentacja wymienia:
 *      nip-beneficjenta, nip-udzielajacego-pomocy, srodek-pomocowy-numer,
 *      forma-pomocy-kod, przeznaczenie-pomocy-kod, sektor-dzialalnosci-kod,
 *      gmina-siedziby-kod,
 *      dzien-udzielenia-pomocy-od, dzien-udzielenia-pomocy-do,
 *      strona
 *
 *    Czyli filtrowanie PO GMINIE i PO DACIE ISTNIEJE. Moj wniosek, ze go nie ma,
 *    byl bledny — testowalem nazwy "rok", "data-od", "nip-podmiotu-udzielajacego",
 *    ktore faktycznie nie istnieja, i uznalem brak parametru za brak funkcji.
 *    To jest dokladnie ten sam blad co przy "PRESENT": wniosek z wlasnego
 *    wyobrazenia zamiast z dokumentacji.
 *
 * 3. Do 10 000 wierszy na strone. To API nadaje sie do importu wsadowego.
 *
 * 4. GLOWNA HIPOTEZA co do kolejki: wymaga CIASTECZKA SESJI.
 *    Uzytkownik z forum pisal, ze zapytanie dziala w przegladarce i w Postmanie,
 *    a nie dziala z PHP cURL. Przegladarka i Postman trzymaja ciasteczka
 *    domyslnie, cURL i node:fetch — nie. System kolejkowy musi jakos powiazac
 *    "przyjdz po odpowiedz za 60 s" z konkretnym zgloszeniem, a jedynym
 *    nosnikiem tego powiazania w naszych zapytaniach moze byc wlasnie cookie.
 *
 *    Moje poprzednie sondy odpytywaly ten sam URL bez odsylania Set-Cookie,
 *    wiec za kazdym razem zakladaly NOWE zgloszenie w kolejce. Stad ten sam
 *    komunikat przez 4,5 minuty.
 *
 * Uruchomienie (z katalogu projektu):
 *   npm run probe:sudop
 *   NIP=5252248481 npm run probe:sudop
 *   GMINA=1465011 npm run probe:sudop     (kod TERYT gminy)
 */

import { writeFile, mkdir } from 'node:fs/promises';

const BASE = 'https://api-sudop.uokik.gov.pl/sudop-api';
const NIP = process.env.NIP ?? '5213111513';
const GMINA = process.env.GMINA ?? '1465011'; // Warszawa
const UA = 'Obywatel2.0/0.1 (+civic-tech; kontakt: kubusiowecynamonki@gmail.com)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const linia = (s = '') => console.log(s);
const naglowek = (t) => { linia('\n' + '='.repeat(72)); linia(t); linia('='.repeat(72)); };

/** Prosty sloik ciasteczek — to jest sedno tej sondy. */
const ciasteczka = new Map();

function zapiszCiasteczka(res) {
  const raw = res.headers.getSetCookie?.() ?? [];
  for (const c of raw) {
    const [para] = c.split(';');
    const i = para.indexOf('=');
    if (i > 0) ciasteczka.set(para.slice(0, i).trim(), para.slice(i + 1).trim());
  }
  return raw;
}

const naglowekCookie = () =>
  [...ciasteczka.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

async function strzal(sciezka, { pokazCialo = true, maxCialo = 400 } = {}) {
  const url = BASE + sciezka;
  const headers = { 'User-Agent': UA, Accept: 'application/json' };
  const c = naglowekCookie();
  if (c) headers.Cookie = c;

  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers, redirect: 'follow' });
    const nowe = zapiszCiasteczka(res);
    const text = await res.text();
    const ms = Date.now() - t0;

    linia(`  ${String(res.status).padEnd(4)} ${ms.toString().padStart(5)}ms  ${sciezka.slice(0, 90)}`);
    if (nowe.length) linia(`       Set-Cookie: ${nowe.map((x) => x.split(';')[0]).join(', ')}`);
    if (pokazCialo && text) linia(`       ${text.slice(0, maxCialo).replace(/\s+/g, ' ')}`);

    let json = null;
    try { json = JSON.parse(text); } catch { /* nie JSON albo tekst */ }
    const kolejka = /Przygotowywanie odpowiedzi|przewidywany czas/i.test(text);
    return { status: res.status, text, json, kolejka, ms };
  } catch (e) {
    linia(`  ---        ${sciezka}  BLAD: ${e instanceof Error ? e.message : e}`);
    return { status: 0, text: '', json: null, kolejka: false, ms: Date.now() - t0 };
  }
}

// =====================================================================
naglowek('A. SLOWNIKI — sciezka /slownik/..., nie /v1/api/slowniki');
// Slowniki sa male. Jesli one wracaja natychmiast, to kolejka dotyczy
// wylacznie zapytan o przypadki pomocy, a nie calego API.
// =====================================================================
const slowniki = ['forma-pomocy', 'przeznaczenie-pomocy', 'srodek-pomocowy', 'sektor-dzialalnosci', 'gmina-siedziby'];
const wyniki = {};
for (const s of slowniki) {
  const r = await strzal(`/slownik/${s}`, { maxCialo: 220 });
  if (r.json) wyniki[s] = Array.isArray(r.json) ? r.json.length : Object.keys(r.json).length;
  await sleep(1500);
}
if (Object.keys(wyniki).length) {
  linia('');
  linia('  ROZMIARY SLOWNIKOW: ' + JSON.stringify(wyniki));
  linia('  >>> Slowniki dzialaja => kolejka dotyczy tylko przypadkow pomocy.');
}

// =====================================================================
naglowek('B. PRZYPADKI POMOCY — poprawna sciezka /api/..., BEZ /v1');
// =====================================================================
const zapytanie = `/api/przypadki-pomocy?nip-beneficjenta=${NIP}&strona=1`;
const pierwszy = await strzal(zapytanie);

// =====================================================================
naglowek('C. KOLEJKA Z CIASTECZKIEM — glowna hipoteza tej sondy');
linia('Odpytujemy TEN SAM adres, odsylajac ciasteczka z pierwszej odpowiedzi.');
linia(`Ciasteczka w sloiku: ${ciasteczka.size ? [...ciasteczka.keys()].join(', ') : 'BRAK — hipoteza upada'}`);
// =====================================================================
let dane = pierwszy.json && !pierwszy.kolejka ? pierwszy.json : null;

if (!dane) {
  const czekania = [30, 45, 60, 60, 60];
  for (const [i, w] of czekania.entries()) {
    linia(`\n  czekam ${w}s…`);
    await sleep(w * 1000);
    const r = await strzal(zapytanie, { maxCialo: 300 });
    if (!r.kolejka && r.json) { dane = r.json; linia('  >>> KOLEJKA ODDALA DANE'); break; }
    if (!r.kolejka && r.status === 200) { linia(`  >>> odpowiedz nie-JSON: ${r.text.slice(0, 200)}`); break; }
    linia(`  proba ${i + 1}/${czekania.length}: nadal kolejka`);
  }
}

// =====================================================================
naglowek('D. PARAMETRY Z DOKUMENTACJI — czy filtrowanie po gminie i dacie DZIALA');
linia('Poprzednio testowalem zle nazwy (rok, data-od) i uznalem brak parametru');
linia('za brak funkcji. To sa nazwy z dokumentacji UOKiK:');
// =====================================================================
const doTestu = [
  `/api/przypadki-pomocy?nip-beneficjenta=${NIP}&strona=1`,
  `/api/przypadki-pomocy?gmina-siedziby-kod=${GMINA}&strona=1`,
  `/api/przypadki-pomocy?dzien-udzielenia-pomocy-od=2025-01-01&dzien-udzielenia-pomocy-do=2025-01-31&strona=1`,
  `/api/przypadki-pomocy?gmina-siedziby-kod=${GMINA}&dzien-udzielenia-pomocy-od=2025-01-01&dzien-udzielenia-pomocy-do=2025-12-31&strona=1`,
  `/api/przypadki-pomocy?nip-udzielajacego-pomocy=5261645015&strona=1`,
  `/api/przypadki-pomocy?forma-pomocy-kod=A1.1&strona=1`,
];
for (const q of doTestu) {
  await sleep(2000);
  await strzal(q, { maxCialo: 260 });
}

// =====================================================================
naglowek('E. WNIOSKI');
// =====================================================================
await mkdir('scripts/probes/out', { recursive: true });
if (dane) {
  await writeFile('scripts/probes/out/sudop-dane.json', JSON.stringify(dane, null, 2));
  const arr = Array.isArray(dane) ? dane : (dane.content ?? dane.items ?? dane.wyniki ?? dane.przypadkiPomocy ?? []);
  linia(`  MAMY DANE. Rekordow: ${Array.isArray(arr) ? arr.length : '?'}`);
  if (Array.isArray(arr) && arr[0]) {
    linia('  Pola rekordu: ' + Object.keys(arr[0]).join(', '));
    linia('  Pierwszy rekord:');
    linia('  ' + JSON.stringify(arr[0], null, 1).split('\n').join('\n  '));
  }
  linia('  -> zapisano scripts/probes/out/sudop-dane.json');
  linia('');
  linia('  "Radar Sasiedzki" WRACA do planu.');
} else {
  linia('  Kolejka nadal nie oddala danych, mimo poprawnych sciezek i ciasteczek.');
  linia('  Jesli sekcja A (slowniki) dzialala, problem dotyczy WYLACZNIE zapytan');
  linia('  o przypadki pomocy — czyli po stronie UOKiK, nie u nas.');
  linia('  Wtedy wniosek o klucz API ma mocna podstawe: mozemy napisac wprost,');
  linia('  ze dostep anonimowy nie zwraca danych mimo poprawnych zapytan.');
}
