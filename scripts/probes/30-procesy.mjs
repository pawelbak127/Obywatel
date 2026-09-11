/**
 * Sonda 30 — procesy legislacyjne w Sejm API. Start Sprintu 4.
 *
 *   npm run probe:procesy
 *
 * PO CO. Tabele `legislative_processes` i `process_stages` powstaly w migracji
 * 0001 na podstawie rekonesansu, ale NIGDY nie zostaly zapelnione. Zanim napisze
 * importer, musze zobaczyc, co endpoint naprawde zwraca — nie co pamietam
 * z rekonesansu i nie co sugeruja nazwy kolumn w moim wlasnym schemacie.
 *
 * W tym projekcie szesc razy wyciagnalem wniosek z wyobrazenia o danych zamiast
 * z danych. Ta sonda istnieje po to, zeby siodmy raz nie byl w Sprincie 4.
 *
 * Sonda NICZEGO nie zapisuje. Pobiera, mierzy i wypisuje.
 */

const TERM = Number(process.env.SEJM_TERM ?? 10);
const BAZA = `https://api.sejm.gov.pl/sejm/term${TERM}`;
const UA = 'Obywatel2.0/0.1 (+civic-tech, dane publiczne)';
const PROBKA_SZCZEGOLOW = 12;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(sciezka) {
  const url = `${BAZA}${sciezka}`;
  const t0 = Date.now();
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  const tekst = await res.text();
  const ms = Date.now() - t0;
  if (!res.ok) return { ok: false, status: res.status, ms, tekst: tekst.slice(0, 300), bajty: tekst.length };
  try {
    return { ok: true, status: res.status, ms, dane: JSON.parse(tekst), bajty: tekst.length };
  } catch {
    return { ok: false, status: res.status, ms, tekst: tekst.slice(0, 300), bajty: tekst.length };
  }
}

/** Ile procent rekordow ma dane pole wypelnione — najwazniejsza liczba w tej sondzie. */
function pokrycie(rekordy, klucz) {
  const ile = rekordy.filter((r) => {
    const v = r?.[klucz];
    return v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);
  }).length;
  return { ile, pct: ((ile / rekordy.length) * 100).toFixed(0) };
}

function wypiszPokrycie(rekordy, tytul) {
  const klucze = [...new Set(rekordy.flatMap((r) => Object.keys(r ?? {})))].sort();
  console.log('');
  console.log(`${tytul} — ${rekordy.length} rekordow, ${klucze.length} roznych pol`);
  console.log('  pole                          pokrycie   przyklad');
  for (const k of klucze) {
    const { ile, pct } = pokrycie(rekordy, k);
    const przyklad = rekordy.find((r) => r?.[k] !== undefined && r?.[k] !== null && r?.[k] !== '')?.[k];
    let opis = '—';
    if (przyklad !== undefined) {
      if (Array.isArray(przyklad)) opis = `[${przyklad.length}] ${JSON.stringify(przyklad[0] ?? null).slice(0, 60)}`;
      else if (typeof przyklad === 'object') opis = JSON.stringify(przyklad).slice(0, 60);
      else opis = String(przyklad).slice(0, 60);
    }
    console.log(`  ${k.padEnd(30)} ${String(pct).padStart(3)}% ${String(ile).padStart(5)}   ${opis}`);
  }
}

async function main() {
  console.log('='.repeat(78));
  console.log(`SONDA 30 — procesy legislacyjne, kadencja ${TERM}`);
  console.log('='.repeat(78));

  // --- 1. Ktore endpointy w ogole odpowiadaja ---------------------------
  console.log('\n--- 1. Dostepnosc endpointow');
  for (const s of ['/processes', '/prints']) {
    const r = await get(s);
    console.log(
      `  ${s.padEnd(14)} HTTP ${r.status}  ${String(r.ms).padStart(5)} ms  ${(r.bajty / 1024).toFixed(0)} KB  ${
        r.ok ? `${Array.isArray(r.dane) ? r.dane.length : 'nie tablica'} pozycji` : r.tekst
      }`,
    );
    await sleep(300);
  }

  const lista = await get('/processes');
  if (!lista.ok || !Array.isArray(lista.dane) || !lista.dane.length) {
    console.log('\nEndpoint /processes nie zwrocil listy. Dalej nie ma po co isc.');
    return;
  }
  const procesy = lista.dane;

  // --- 2. Ksztalt rekordu z listy --------------------------------------
  console.log('\n--- 2. Pierwszy rekord z listy, w calosci');
  console.log(JSON.stringify(procesy[0], null, 2).slice(0, 1400));

  wypiszPokrycie(procesy, '--- 3. Pokrycie pol na CALEJ liscie');

  // --- 4. Czy lista niesie juz etapy, czy trzeba dobierac szczegoly -----
  const zEtapami = procesy.filter((p) => Array.isArray(p.stages) && p.stages.length).length;
  console.log('');
  console.log(`--- 4. Etapy w liscie: ${zEtapami} z ${procesy.length} rekordow ma niepuste "stages"`);
  console.log(
    zEtapami === 0
      ? '    Trzeba bedzie odpytac kazdy proces osobno — to zmienia budzet importu.'
      : '    Lista wystarczy, nie trzeba osobnego zapytania na proces.',
  );

  // --- 5. Szczegoly kilku procesow -------------------------------------
  const numer = (p) => p.number ?? p.printNumber ?? p.print ?? p.id;
  const probka = procesy.slice(0, PROBKA_SZCZEGOLOW);
  console.log(`\n--- 5. Szczegoly ${probka.length} procesow (${probka.map(numer).join(', ')})`);

  const szczegoly = [];
  let sumaMs = 0;
  let sumaBajtow = 0;
  for (const p of probka) {
    const r = await get(`/processes/${numer(p)}`);
    sumaMs += r.ms;
    sumaBajtow += r.bajty;
    if (r.ok) szczegoly.push(r.dane);
    else console.log(`  ${numer(p)}: HTTP ${r.status} ${r.tekst}`);
    await sleep(250);
  }

  if (szczegoly.length) {
    console.log('\n  Pierwszy szczegol, w calosci:');
    console.log(JSON.stringify(szczegoly[0], null, 2).slice(0, 2000));
    wypiszPokrycie(szczegoly, '  --- 5a. Pokrycie pol w szczegolach');

    const etapy = szczegoly.flatMap((s) => (Array.isArray(s.stages) ? s.stages : []));
    if (etapy.length) {
      wypiszPokrycie(etapy, `  --- 5b. Pokrycie pol w ETAPACH (${etapy.length} etapow z ${szczegoly.length} procesow)`);
      console.log('\n  Przykladowy etap, w calosci:');
      console.log(JSON.stringify(etapy[0], null, 2).slice(0, 900));

      // Etap zagniezdzony? Niektore API zwracaja etapy w drzewie.
      const zDziecmi = etapy.filter((e) => Array.isArray(e.children) && e.children.length).length;
      console.log(`\n  Etapow z zagniezdzonymi "children": ${zDziecmi} — jesli >0, import musi je splaszczyc.`);
    } else {
      console.log('\n  UWAGA: w szczegolach NIE MA pola "stages". Etapy sa gdzie indziej albo pod inna nazwa.');
    }
  }

  // --- 6. Budzet importu -----------------------------------------------
  const sredniaMs = szczegoly.length ? Math.round(sumaMs / szczegoly.length) : 0;
  const sredniaKB = szczegoly.length ? sumaBajtow / szczegoly.length / 1024 : 0;
  console.log('');
  console.log('--- 6. Budzet importu (ekstrapolacja z probki)');
  console.log(`  procesow razem:        ${procesy.length}`);
  console.log(`  srednio na zapytanie:  ${sredniaMs} ms, ${sredniaKB.toFixed(1)} KB`);
  if (zEtapami === 0) {
    const minuty = ((procesy.length * sredniaMs) / 1000 / 60).toFixed(1);
    console.log(`  pelny import szczegolow: ~${minuty} min przy jednym watku, ~${(procesy.length * sredniaKB / 1024).toFixed(0)} MB pobrania`);
    console.log('  (przy CONCURRENCY=8 z ingest/lib/http.ts bedzie okolo osiem razy szybciej)');
  }

  // --- 7. Czy da sie polaczyc z glosowaniami ----------------------------
  console.log('\n--- 7. Polaczenie z glosowaniami');
  console.log('  Mamy w bazie votings.print_numbers (93% trafien przy 4 569 glosowaniach).');
  const numery = procesy.map(numer).filter(Boolean).map(String);
  console.log(`  Numery procesow: ${numery.length}, przyklady: ${numery.slice(0, 8).join(', ')}`);
  console.log(`  Format: ${numery.every((n) => /^\d+$/.test(n)) ? 'same cyfry — zgodny z print_numbers' : 'NIE same cyfry — sprawdz mapowanie'}`);

  console.log('');
  console.log('='.repeat(78));
  console.log('Wklej CALE wyjscie. Na jego podstawie napisze mapper i importer —');
  console.log('tym razem przeciwko zmierzonemu ksztaltowi, a nie przeciwko nazwom');
  console.log('kolumn, ktore sam wymyslilem w migracji 0001.');
  console.log('='.repeat(78));
}

main().catch((e) => {
  console.error(`\nBLAD SONDY: ${e.message}`);
  process.exit(1);
});
