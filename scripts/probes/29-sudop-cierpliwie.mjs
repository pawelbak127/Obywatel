/**
 * Sonda 29 — to samo co 28, ale CIERPLIWIE i bez tworzenia nowych zgłoszeń.
 *
 *   node scripts/probes/29-sudop-cierpliwie.mjs
 *
 * CO POKAZALA SONDA 28
 *
 *   /api/przypadki-pomocy-bez-kolejki  -> 303  Location: /api/wynik/{uuid}
 *   /api/przypadki-pomocy              -> 303  Location: /api/kolejka/{uuid}
 *   /api/kolejka/{uuid}                -> 200  "Przygotowywanie odpowiedzi,
 *                                               przewidywany czas to 60 sekund"
 *
 * Czyli protokol dziala i identyfikatory istnieja. Zostaly dwa bledy, oba moje.
 *
 * BLAD PIERWSZY — starsze sondy tworzyly nowe zgloszenie zamiast odpytywac stare.
 * Poprzednie sondy "ponawialy zapytanie co 30-60 sekund przez ponad cztery minuty".
 * Ponawialy jednak adres `/api/przypadki-pomocy`, a kazde takie wywolanie
 * REJESTRUJE NOWE WYSZUKANIE z nowym identyfikatorem. Odpytywalismy wiec
 * za kazdym razem swiezo utworzone zadanie, ktore rzecz jasna nie bylo gotowe.
 * Ani razu nie sprawdzilismy tego samego identyfikatora dwa razy.
 *
 * BLAD DRUGI — sonda 28 poddala sie przed czasem deklarowanym przez serwer.
 * Osiem prob co piec sekund to okolo 40 sekund. Serwer prosi o 60.
 *
 * Ta sonda:
 *   1. wysyla KAZDE z dwoch zapytan DOKLADNIE RAZ,
 *   2. zapamietuje identyfikatory,
 *   3. odpytuje je na przemian przez 6 minut, co 10 sekund,
 *   4. po sukcesie prosi jeszcze o ten sam wynik z `?csv=true`.
 *
 * Zadne odpytanie stanu nie tworzy nowego zadania, wiec obciazenie serwera
 * to dwa wyszukania na cale uruchomienie sondy.
 */

const BAZA = 'https://api-sudop.uokik.gov.pl/sudop-api';
const NIP = '6150022153'; // PGE Elektrownia Turow
const UA = 'Obywatel2.0/0.1 (+civic-tech, dane publiczne)';

const CO_ILE_MS = 10_000;
const BUDZET_MS = 6 * 60_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const czas = () => new Date().toISOString().slice(11, 19);

async function strzal(url, opis) {
  console.log('');
  console.log(`[${czas()}] --> ${opis}`);
  console.log(`            ${url}`);
  try {
    const res = await fetch(url, {
      redirect: 'manual',
      headers: { 'User-Agent': UA, Accept: 'application/json, text/csv, */*' },
    });
    const tekst = await res.text();
    const loc = res.headers.get('location');
    console.log(`            HTTP ${res.status}${loc ? `  Location: ${loc}` : ''}`);
    const skrot = tekst.length > 900 ? `${tekst.slice(0, 900)}\n            …(${tekst.length} znakow lacznie)` : tekst;
    if (tekst) console.log(`            ${skrot}`);
    return { status: res.status, loc, tekst };
  } catch (e) {
    console.log(`            BLAD SIECI: ${e.message}`);
    return null;
  }
}

const pelny = (loc) => (loc ? (/^https?:\/\//.test(loc) ? loc : `https://api-sudop.uokik.gov.pl${loc}`) : null);

async function pobierzWynik(url, etykieta) {
  console.log('');
  console.log('='.repeat(72));
  console.log(`SUKCES (${etykieta}) — pobieram wynik`);
  console.log('='.repeat(72));
  const json = await strzal(url, `${etykieta}: wynik jako JSON`);
  await sleep(2000);
  await strzal(url.includes('?') ? `${url}&csv=true` : `${url}?csv=true`, `${etykieta}: ten sam wynik jako CSV`);
  return json;
}

async function main() {
  console.log('='.repeat(72));
  console.log('SONDA 29 — cierpliwe odpytywanie JEDNEGO zgloszenia');
  console.log(`Budzet: ${BUDZET_MS / 60000} min, odpytanie co ${CO_ILE_MS / 1000} s.`);
  console.log('Kazde z dwoch wyszukan rejestrujemy DOKLADNIE RAZ.');
  console.log('='.repeat(72));

  // --- Rejestracja obu wyszukan, po jednym razie -----------------------
  const a = await strzal(
    `${BAZA}/api/przypadki-pomocy-bez-kolejki?nip-beneficjenta=${NIP}&strona=1`,
    'REJESTRACJA A: bez-kolejki',
  );
  await sleep(2000);
  const b = await strzal(
    `${BAZA}/api/przypadki-pomocy?nip-beneficjenta=${NIP}&strona=1`,
    'REJESTRACJA B: z kolejka',
  );

  const sledzone = [];
  if (a?.status === 303 && a.loc) sledzone.push({ etykieta: 'A/bez-kolejki', url: pelny(a.loc), gotowe: false });
  if (b?.status === 303 && b.loc) sledzone.push({ etykieta: 'B/kolejka', url: pelny(b.loc), gotowe: false });

  if (!sledzone.length) {
    console.log('');
    console.log('Zadne z zapytan nie zwrocilo 303 z Location. Wklej wyjscie — to nowa sytuacja.');
    return;
  }

  console.log('');
  console.log('Sledze:');
  for (const s of sledzone) console.log(`  ${s.etykieta}  ${s.url}`);

  // --- Odpytywanie na przemian ----------------------------------------
  const start = Date.now();
  let runda = 0;

  while (Date.now() - start < BUDZET_MS && sledzone.some((s) => !s.gotowe)) {
    runda++;
    await sleep(CO_ILE_MS);

    for (const s of sledzone) {
      if (s.gotowe) continue;
      const uplynelo = Math.round((Date.now() - start) / 1000);
      const r = await strzal(s.url, `${s.etykieta} — runda ${runda}, ${uplynelo}s od rejestracji`);
      if (!r) continue;

      // Kolejka gotowa: przekierowanie na wynik.
      if (r.status === 303 && r.loc) {
        s.url = pelny(r.loc);
        console.log(`            -> zgloszenie gotowe, wynik pod ${s.url}`);
        await pobierzWynik(s.url, s.etykieta);
        s.gotowe = true;
        continue;
      }

      // Wynik gotowy: JSON z danymi zamiast komunikatu.
      if (r.status === 200 && r.tekst.trim().startsWith('{')) {
        console.log(`            -> to juz wyglada na dane, nie na komunikat`);
        await pobierzWynik(s.url, s.etykieta);
        s.gotowe = true;
        continue;
      }

      // 404 na /wynik/ tuz po rejestracji znaczy "jeszcze nie policzone".
      if (r.status === 404) {
        console.log('            -> jeszcze nie ma rekordu, czekam dalej');
      }
    }
  }

  console.log('');
  console.log('='.repeat(72));
  for (const s of sledzone) {
    console.log(`${s.etykieta}: ${s.gotowe ? 'ZWROCIL DANE' : `BRAK DANYCH po ${Math.round((Date.now() - start) / 1000)} s`}`);
  }
  console.log('');
  console.log('Wklej cale wyjscie. Jesli oba skonczyly sie brakiem danych mimo');
  console.log('szesciu minut na JEDNYM identyfikatorze — dopiero to jest twardy dowod,');
  console.log('ze anonimowy dostep nie konczy wyszukiwan, i tak zapiszemy to w pismie.');
  console.log('='.repeat(72));
}

main();
