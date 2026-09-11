/**
 * Sonda 28 — SUDOP API zgodnie z JEGO WLASNA specyfikacja OpenAPI.
 *
 *   node scripts/probes/28-sudop-openapi.mjs
 *
 * PO CO. Specyfikacja opublikowana pod https://api-sudop.uokik.gov.pl/sudop-api/v3/api-docs
 * zawiera sciezki, ktorych nigdy nie probowalismy, i opisuje protokol inny niz ten,
 * ktory zalozylem:
 *
 *   /api/przypadki-pomocy              -> HTTP 303 "Zarejestrowano wyszukanie" + Location
 *   /api/kolejka/{queueId}             -> stan kolejki
 *   /api/wynik/{requestId}?csv=true    -> WYNIKI, opcjonalnie od razu jako CSV
 *   /api/przypadki-pomocy-bez-kolejki  -> te same parametry, BEZ kolejki
 *
 * W specyfikacji NIE MA zadnego `securitySchemes` — czyli klucz nie jest wymagany.
 *
 * DLACZEGO TEGO NIE ZOBACZYLISMY. `fetch()` domyslnie SAM podaza za przekierowaniem.
 * Odpowiedz 303 z naglowkiem Location zostala polknieta, sonda pokazala HTTP 200
 * z trescia "Przygotowywanie odpowiedzi, przewidywany czas to 60 sekund" — i na tej
 * podstawie zapisalem w dokumentacji, ze "odpowiedzi nie zawieraja naglowka Location,
 * nie ma wiec mozliwosci powiazania ponownego zapytania ze zgloszeniem". Naglowek byl.
 * Nie zobaczylem go, bo klient go za mnie skonsumowal.
 *
 * Ta sonda uzywa `redirect: 'manual'` i wypisuje KAZDY skok osobno.
 */

const BAZY = ['https://api-sudop.uokik.gov.pl/sudop-api', 'https://api-sudop.uokik.gov.pl'];
const NIP = '6150022153'; // PGE Elektrownia Turow — wiemy, ze ma dane
const UA = 'Obywatel2.0/0.1 (+civic-tech, dane publiczne)';
const PAUZA = 1500; // deklarowane 8 zapytan/s; celowo idziemy duzo wolniej

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function strzal(url, { opis = '' } = {}) {
  console.log('');
  console.log(`--> ${url}`);
  if (opis) console.log(`    (${opis})`);
  try {
    const res = await fetch(url, {
      redirect: 'manual', // <- CALA RZECZ W TYM
      headers: { 'User-Agent': UA, Accept: 'application/json, text/csv, */*' },
    });
    console.log(`    HTTP ${res.status} ${res.statusText}`);
    for (const [k, v] of res.headers.entries()) console.log(`    ${k}: ${v}`);
    const tekst = await res.text();
    const skrot = tekst.length > 700 ? `${tekst.slice(0, 700)}\n    …(${tekst.length} znakow lacznie)` : tekst;
    console.log(`    CIALO: ${skrot || '(puste)'}`);
    return { status: res.status, headers: res.headers, tekst };
  } catch (e) {
    console.log(`    BLAD SIECI: ${e.message}`);
    return null;
  }
}

function pelnyUrl(baza, location) {
  if (!location) return null;
  if (/^https?:\/\//.test(location)) return location;
  const host = 'https://api-sudop.uokik.gov.pl';
  return location.startsWith('/') ? host + location : `${baza}/${location}`;
}

async function main() {
  console.log('='.repeat(72));
  console.log('SONDA 28 — SUDOP API wg opublikowanej specyfikacji OpenAPI');
  console.log('='.repeat(72));

  for (const baza of BAZY) {
    console.log('');
    console.log('#'.repeat(72));
    console.log(`# BAZA: ${baza}`);
    console.log('#'.repeat(72));

    // --- 1. Wersja: najtanszy sprawdzian, czy ta baza w ogole odpowiada ---
    await strzal(`${baza}/wersja`, { opis: 'sciezka /wersja ze specyfikacji' });
    await sleep(PAUZA);

    // --- 2. BEZ KOLEJKI — to jest sciezka, ktorej nigdy nie probowalismy ---
    const bezKolejki = `${baza}/api/przypadki-pomocy-bez-kolejki?nip-beneficjenta=${NIP}&strona=1`;
    const bk = await strzal(bezKolejki, { opis: 'przypadki-pomocy-bez-kolejki — nowa sciezka' });
    await sleep(PAUZA);

    if (bk && bk.status === 303) {
      const loc = pelnyUrl(baza, bk.headers.get('location'));
      console.log(`    -> 303 wskazuje na: ${loc}`);
      if (loc) {
        await strzal(loc, { opis: 'cel przekierowania z bez-kolejki' });
        await sleep(PAUZA);
      }
    }

    // --- 3. Z KOLEJKA — tym razem widzimy 303 i Location ---
    const zKolejka = `${baza}/api/przypadki-pomocy?nip-beneficjenta=${NIP}&strona=1`;
    const zk = await strzal(zKolejka, { opis: 'przypadki-pomocy — teraz BEZ auto-podazania za 303' });
    await sleep(PAUZA);

    if (!zk) continue;

    let nastepny = pelnyUrl(baza, zk.headers.get('location'));
    if (!nastepny && zk.status === 200) {
      console.log('');
      console.log('    UWAGA: brak naglowka Location przy HTTP 200.');
      console.log('    Sprawdz cialo powyzej — identyfikator zgloszenia moze byc w tresci.');
    }

    // --- 4. Odpytywanie kolejki az do wyniku -----------------------------
    for (let proba = 1; nastepny && proba <= 8; proba++) {
      console.log('');
      console.log(`    [kolejka, proba ${proba}/8]`);
      const r = await strzal(nastepny, { opis: 'stan zgloszenia' });
      if (!r) break;

      if (r.status === 303) {
        const dalej = pelnyUrl(baza, r.headers.get('location'));
        console.log(`    -> gotowe, wynik pod: ${dalej}`);
        if (dalej) {
          await sleep(PAUZA);
          await strzal(dalej, { opis: 'WYNIK (JSON)' });
          await sleep(PAUZA);
          const csv = dalej.includes('?') ? `${dalej}&csv=true` : `${dalej}?csv=true`;
          await strzal(csv, { opis: 'WYNIK (CSV) — parametr csv=true ze specyfikacji' });
        }
        break;
      }

      if (r.status === 200 && r.tekst.trim().startsWith('{')) {
        console.log('    -> odpowiedz jest JSON-em; jesli to juz wynik, konczymy');
        break;
      }

      await sleep(5000); // kolejka deklaruje ~60 s, ale sprawdzamy czesciej
    }
  }

  console.log('');
  console.log('='.repeat(72));
  console.log('KONIEC. Wklej CALE powyzsze wyjscie — istotne sa statusy i naglowki,');
  console.log('nie tylko tresc odpowiedzi.');
  console.log('='.repeat(72));
}

main();
