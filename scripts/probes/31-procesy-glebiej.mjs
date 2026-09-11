/**
 * Sonda 31 — cztery rzeczy, ktorych sonda 30 nie rozstrzygnela.
 *
 *   npm run probe:procesy2
 *
 * 1. STRONICOWANIE. `/processes` zwrocilo 50 pozycji o numerach 1-50, a `/prints`
 *    3 275. Pieciedziesiat procesow na cala kadencje to nie jest liczba, w ktora
 *    wierze — wyglada na domyslny rozmiar strony. Od tego zalezy caly budzet
 *    importu, wiec sprawdzam to zanim cokolwiek napisze.
 *
 * 2. PELNY KSZTALT OBIEKTU `voting` W ETAPIE. Sonda 30 uciela go w polowie.
 *    To jest najwazniejszy obiekt w calym Sprincie 4: jesli da sie z niego
 *    wyprowadzic nasze `votings.id`, to etap procesu laczy sie z konkretnym
 *    glosowaniem imiennym — i dopiero wtedy "obietnica -> ustawa -> glos posla"
 *    przestaje byc rysunkiem na tablicy.
 *
 * 3. SLOWNIKI. Wszystkie wartosci `stageType`, `documentType`, `urgencyStatus`
 *    i `decision` na wiekszej probce — zeby kolumny tekstowe nie okazaly sie
 *    enumami z dziura, jak `vote_value` przy `PRESENT`.
 *
 * 4. GLEBOKOSC ZAGNIEZDZENIA. 15 z 37 etapow ma `children`. Czy dzieci maja
 *    wlasne dzieci? Splaszczanie drzewa o nieznanej glebokosci pisze sie inaczej
 *    niz splaszczanie dwoch poziomow.
 */

const TERM = Number(process.env.SEJM_TERM ?? 10);
const BAZA = `https://api.sejm.gov.pl/sejm/term${TERM}`;
const UA = 'Obywatel2.0/0.1 (+civic-tech, dane publiczne)';
const PROBKA = 40;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(sciezka) {
  const url = `${BAZA}${sciezka}`;
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    const tekst = await res.text();
    const ms = Date.now() - t0;
    const naglowki = {};
    for (const [k, v] of res.headers.entries()) {
      if (/link|total|count|page|range/i.test(k)) naglowki[k] = v;
    }
    if (!res.ok) return { ok: false, status: res.status, ms, naglowki, tekst: tekst.slice(0, 200) };
    return { ok: true, status: res.status, ms, naglowki, dane: JSON.parse(tekst), bajty: tekst.length };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, blad: e.message };
  }
}

const numery = (t) => (Array.isArray(t) ? t.map((p) => Number(p.number)).filter(Number.isFinite) : []);
const zakres = (t) => {
  const n = numery(t);
  return n.length ? `${Math.min(...n)}–${Math.max(...n)}` : 'brak';
};

async function main() {
  console.log('='.repeat(78));
  console.log('SONDA 31 — stronicowanie, glosowania w etapach, slowniki');
  console.log('='.repeat(78));

  // --- 1. STRONICOWANIE -------------------------------------------------
  console.log('\n--- 1. Czy /processes jest stronicowane');
  const warianty = [
    '/processes',
    '/processes?limit=500',
    '/processes?limit=500&offset=0',
    '/processes?offset=50',
    '/processes?page=2',
    '/processes?from=51',
  ];
  const wyniki = {};
  for (const w of warianty) {
    const r = await get(w);
    wyniki[w] = r;
    const ile = r.ok && Array.isArray(r.dane) ? r.dane.length : '—';
    const zak = r.ok ? zakres(r.dane) : '';
    const nag = Object.keys(r.naglowki ?? {}).length ? `  naglowki: ${JSON.stringify(r.naglowki)}` : '';
    console.log(`  ${w.padEnd(34)} HTTP ${r.status}  ${String(ile).padStart(5)} poz.  numery ${zak}${nag}`);
    await sleep(400);
  }

  const bazowa = wyniki['/processes'];
  const zLimitem = wyniki['/processes?limit=500'];
  if (bazowa?.ok && zLimitem?.ok) {
    const a = Array.isArray(bazowa.dane) ? bazowa.dane.length : 0;
    const b = Array.isArray(zLimitem.dane) ? zLimitem.dane.length : 0;
    console.log('');
    if (b > a) console.log(`  WNIOSEK: stronicowane. Bez parametru ${a}, z limit=500 juz ${b}.`);
    else if (a === b && a === 50) console.log('  WNIOSEK: limit nie dziala albo procesow naprawde jest 50. Patrz punkt 1a.');
    else console.log(`  WNIOSEK: ${a} vs ${b} — sprawdz recznie.`);
  }

  // --- 1a. Czy istnieje proces o numerze spoza pierwszej piecdziesiatki --
  console.log('\n--- 1a. Czy istnieja procesy o wyzszych numerach (test wprost)');
  for (const n of [51, 100, 500, 1000, 2000, 3000, 3275]) {
    const r = await get(`/processes/${n}`);
    const tytul = r.ok ? String(r.dane?.title ?? '').slice(0, 58) : r.tekst?.slice(0, 58) ?? r.blad;
    console.log(`  /processes/${String(n).padEnd(5)} HTTP ${r.status}  ${tytul}`);
    await sleep(350);
  }
  console.log('  Jesli te numery odpowiadaja 200 — procesow jest tyle co drukow,');
  console.log('  a lista bez parametrow po prostu zwraca pierwsza strone.');

  // --- 2, 3, 4 — na probce szczegolow -----------------------------------
  console.log(`\n--- 2. Probka ${PROBKA} procesow: glosowania, slowniki, zagniezdzenie`);
  const szczegoly = [];
  for (let n = 1; n <= PROBKA; n++) {
    const r = await get(`/processes/${n}`);
    if (r.ok) szczegoly.push(r.dane);
    await sleep(200);
  }
  console.log(`  pobrano ${szczegoly.length} procesow`);

  // splaszczenie drzewa etapow z pomiarem glebokosci
  const plaskie = [];
  let maxGlebokosc = 0;
  const zejdz = (etapy, glebokosc, sciezka) => {
    maxGlebokosc = Math.max(maxGlebokosc, glebokosc);
    for (const [i, e] of (etapy ?? []).entries()) {
      plaskie.push({ ...e, _glebokosc: glebokosc, _sciezka: `${sciezka}${i}` });
      if (Array.isArray(e.children) && e.children.length) zejdz(e.children, glebokosc + 1, `${sciezka}${i}.`);
    }
  };
  for (const s of szczegoly) zejdz(s.stages, 1, '');

  console.log(`\n  Etapow po splaszczeniu: ${plaskie.length}`);
  console.log(`  Maksymalna glebokosc zagniezdzenia: ${maxGlebokosc}`);
  const naPoziomach = {};
  for (const e of plaskie) naPoziomach[e._glebokosc] = (naPoziomach[e._glebokosc] ?? 0) + 1;
  console.log(`  Rozklad po poziomach: ${JSON.stringify(naPoziomach)}`);

  // --- 2a. Obiekt voting w calosci --------------------------------------
  const zGlosowaniem = plaskie.filter((e) => e.voting);
  console.log(`\n--- 2a. Etapow z obiektem "voting": ${zGlosowaniem.length} z ${plaskie.length}`);
  if (zGlosowaniem.length) {
    console.log('  PELNY obiekt voting z pierwszego takiego etapu:');
    console.log(JSON.stringify(zGlosowaniem[0].voting, null, 2));
    console.log('\n  Klucze obiektu voting we wszystkich probkach:');
    const klucze = [...new Set(zGlosowaniem.flatMap((e) => Object.keys(e.voting)))].sort();
    for (const k of klucze) {
      const ile = zGlosowaniem.filter((e) => e.voting[k] !== undefined && e.voting[k] !== null).length;
      const przyklad = zGlosowaniem.find((e) => e.voting[k] != null)?.voting[k];
      console.log(
        `    ${k.padEnd(22)} ${String(ile).padStart(4)}/${zGlosowaniem.length}   ${JSON.stringify(przyklad).slice(0, 70)}`,
      );
    }
    console.log('\n  Linki PDF (z nich wyprowadzimy posiedzenie i numer glosowania):');
    for (const e of zGlosowaniem.slice(0, 6)) {
      const pdf = (e.voting.links ?? []).find((l) => l.rel === 'pdf')?.href ?? '(brak)';
      console.log(`    ${pdf}`);
    }
  } else {
    console.log('  UWAGA: w tej probce zaden etap nie ma obiektu voting.');
  }

  // --- 3. Slowniki ------------------------------------------------------
  const zbierz = (tab, klucz) => {
    const m = new Map();
    for (const x of tab) {
      const v = x?.[klucz];
      if (v === undefined || v === null || v === '') continue;
      m.set(String(v), (m.get(String(v)) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };

  console.log('\n--- 3. Slowniki (wartosc — ile razy)');
  for (const [tytul, tab, klucz] of [
    ['stageType (etapy)', plaskie, 'stageType'],
    ['stageName (etapy)', plaskie, 'stageName'],
    ['decision (etapy)', plaskie, 'decision'],
    ['documentType (procesy)', szczegoly, 'documentType'],
    ['documentTypeEnum (procesy)', szczegoly, 'documentTypeEnum'],
    ['urgencyStatus (procesy)', szczegoly, 'urgencyStatus'],
    ['UE (procesy)', szczegoly, 'UE'],
  ]) {
    const w = zbierz(tab, klucz);
    console.log(`\n  ${tytul} — ${w.length} roznych wartosci`);
    for (const [v, ile] of w.slice(0, 25)) console.log(`    ${String(ile).padStart(4)}  ${v.slice(0, 68)}`);
    if (w.length > 25) console.log(`    … i ${w.length - 25} dalszych`);
  }

  // --- 4. printsConsideredJointly ---------------------------------------
  const jointly = szczegoly.filter((s) => Array.isArray(s.printsConsideredJointly) && s.printsConsideredJointly.length);
  console.log(`\n--- 4. printsConsideredJointly: ${jointly.length} z ${szczegoly.length} procesow`);
  for (const s of jointly.slice(0, 8)) {
    console.log(`    proces ${s.number} rozpatrywany lacznie z: ${s.printsConsideredJointly.join(', ')}`);
  }
  console.log('    To ma znaczenie: glosowanie moze cytowac druk 2, gdy proces ma numer 1.');
  console.log('    Bez tej kolumny czesc powiazan glosowanie-proces po prostu zginie.');

  console.log('\n' + '='.repeat(78));
  console.log('Wklej cale wyjscie. Po nim pisze migracje 0016, mapper i importer —');
  console.log('bez ani jednego pola zgadnietego.');
  console.log('='.repeat(78));
}

main().catch((e) => {
  console.error(`\nBLAD SONDY: ${e.message}`);
  process.exit(1);
});
