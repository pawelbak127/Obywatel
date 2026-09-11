/**
 * Sonda 32 — KONTROLA KONTRAKTU z Sejm API.
 *
 *   npm run probe:sejm
 *   npm run probe:sejm -- --procesy=60      wieksza probka procesow
 *
 * PO CO. Poprzedni model nie mial dostepu do sieci: ksztalty odpowiedzi opisane
 * w `ingest/lib/sejm-client.ts`, `ingest/mappers/process.ts` i w
 * `docs/zrodla-danych.md` pochodza z sond uruchamianych recznie przez Pawla.
 * Ta sonda sprawdza, czy te opisy nadal zgadzaja sie z zywym API — i wypisuje
 * ROZBIEZNOSCI, nie propozycje zmian.
 *
 * CZEGO TA SONDA NIE ROBI.
 *
 * 1. Nie dotyka bazy. Nie zapisuje ani jednego wiersza, nie czyta .env.local.
 * 2. Nie odpytuje UOKiK ani SUDOP (decyzja D13). Wylacznie api.sejm.gov.pl.
 * 3. NIE TRAKTUJE WLASNEJ PROBKI JAKO PRAWDY. To jest najwazniejsza zasada
 *    w tym pliku. Slowniki `ZNANE_STAGE_TYPES` i `ZNANE_DOCUMENT_TYPES`
 *    wyprowadzono z PELNEGO importu 1 662 procesow; probka 40 procesow dala
 *    w swoim czasie 12 typow etapu z 19 istniejacych. Wartosc znana kodowi,
 *    ktorej nie ma w probce, NIE JEST wiec rozbieznoscia — jest brakiem
 *    pokrycia probki i tak jest opisywana. Rozbieznoscia jest wylacznie
 *    wartosc, ktora przyszla z API, a kod jej nie zna.
 *
 * Ta sama zasada dotyczy pokrycia pol: `secondName` w 66% rekordow to pomiar
 * na 499 poslach, wiec porownujemy z nim caly zbior, a nie probke.
 *
 * WYNIK. Na koncu stoi lista rozbieznosci. Pusta lista znaczy: kod opisuje
 * API zgodnie ze stanem na dzis. Kazda pozycja jest do OCENY CZLOWIEKA,
 * a nie do automatycznej poprawki.
 */

const TERM = Number(process.env.SEJM_TERM ?? 10);
const BAZA = `https://api.sejm.gov.pl/sejm/term${TERM}`;
const UA =
  process.env.INGEST_USER_AGENT ??
  'Obywatel2.0/0.1 (+https://github.com/obywatel; civic-tech, dane publiczne)';

/** Ile procesow pobrac w szczegolach. Domyslnie malo — to kontrola, nie import. */
const PROBKA_PROCESOW =
  Number(process.argv.find((a) => a.startsWith('--procesy='))?.split('=')[1] ?? 0) || 40;

/**
 * Odstep miedzy zapytaniami. Sonda chodzi SEKWENCYJNIE i wolniej niz importer:
 * to jest narzedzie diagnostyczne uruchamiane recznie, nie ma powodu sie spieszyc
 * na serwerze Kancelarii Sejmu.
 */
const ODSTEP_MS = 120;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let zapytan = 0;

async function get(sciezka) {
  await sleep(ODSTEP_MS);
  zapytan++;
  const url = sciezka.startsWith('http') ? sciezka : `${BAZA}${sciezka}`;
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    const tekst = await res.text();
    const ms = Date.now() - t0;
    if (!res.ok) return { ok: false, status: res.status, ms, url, tekst: tekst.slice(0, 200) };
    try {
      return { ok: true, status: res.status, ms, url, dane: JSON.parse(tekst), naglowki: res.headers, bajty: tekst.length };
    } catch {
      return { ok: false, status: res.status, ms, url, tekst: tekst.slice(0, 200) };
    }
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, url, tekst: String(e?.message ?? e) };
  }
}

// =====================================================================
// Zbieranie rozbieznosci
// =====================================================================

const rozbieznosci = [];

/**
 * @param waga 'BLOKUJE'  — kod zalozyl cos, czego API nie robi; import moze
 *                          zapisac bzdure albo sie wywrocic
 *             'UWAGA'    — rozjazd wart decyzji czlowieka
 *             'DRYF'     — liczby sie ruszyly zgodnie z oczekiwaniem (nowe
 *                          glosowania, nowe procesy); informacja, nie problem
 */
function zglos(waga, obszar, opis, szczegol) {
  rozbieznosci.push({ waga, obszar, opis, szczegol });
}

const naglowek = (t) => {
  console.log('');
  console.log(`=== ${t} ${'='.repeat(Math.max(0, 66 - t.length))}`);
};

const pokrycie = (rekordy, klucz) => {
  const ile = rekordy.filter((r) => {
    const v = r?.[klucz];
    return v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);
  }).length;
  return { ile, pct: rekordy.length ? Math.round((ile / rekordy.length) * 100) : 0 };
};

/** Wszystkie klucze wystepujace w zbiorze rekordow. */
const kluczeZbioru = (rekordy) => {
  const s = new Set();
  for (const r of rekordy) for (const k of Object.keys(r ?? {})) s.add(k);
  return [...s].sort();
};

// =====================================================================
// To, co kod DEKLARUJE — przepisane recznie z plikow zrodlowych.
//
// Celowo skopiowane, a nie zaimportowane: sonda ma porownywac API z tym,
// co jest w plikach, takze wtedy gdy ktos te pliki wlasnie psuje. Gdyby
// importowala `ZNANE_STAGE_TYPES`, sprawdzalaby tautologie.
// =====================================================================

/** ingest/lib/sejm-client.ts — typ SejmMP. Gwiazdka = pole opcjonalne. */
const POLA_MP_WYMAGANE = [
  'id', 'firstName', 'lastName', 'firstLastName', 'lastFirstName', 'club',
  'districtNum', 'districtName', 'voivodeship', 'educationLevel', 'birthDate',
  'birthLocation', 'numberOfVotes', 'email', 'active',
];
const POLA_MP_OPCJONALNE = ['secondName', 'profession', 'oathDate', 'inactiveCause', 'mandateExpiryDate', 'waiverDesc'];

/** docs/zrodla-danych.md — pomiar na 499 rekordach. */
const POKRYCIE_ZMIERZONE = { secondName: 66, profession: 99, inactiveCause: 7, mandateExpiryDate: 8, waiverDesc: 8 };

/** ingest/lib/sejm-client.ts — dziedzina pola `vote`. */
const ZNANE_VOTE = ['YES', 'NO', 'ABSTAIN', 'ABSENT', 'PRESENT', 'VOTE_VALID', 'VOTE_INVALID'];
/** D7 — do lojalnosci wchodza WYLACZNIE te trzy. Lista dozwolonych, nie zakazanych. */
const STANOWISKA = ['YES', 'NO', 'ABSTAIN'];

/** ingest/mappers/process.ts — z PELNEGO importu 1 662 procesow. */
const ZNANE_STAGE_TYPES = [
  'Start', 'Referral', 'ReadingReferral', 'SejmReading', 'Voting', 'End',
  'CommitteeReport', 'CommitteeWork', 'SenatePosition', 'ToPresident',
  'PresidentSignature', 'GovermentPosition',
  'Opinion', 'PresidentMotionConsideration', 'PresidentToTribunal',
  'PublicHearing', 'Reading', 'SenatePositionConsideration', 'Veto',
];
const ZNANE_DOCUMENT_TYPES = [
  'projekt ustawy', 'projekt uchwały', 'wniosek', 'lista kandydatów',
  'informacja innych organów', 'informacja rządowa', 'sprawozdanie',
  'wniosek (bez druku)', 'zawiadomienie',
];

/** docs/zrodla-danych.md + HANDOFF.md §3.1 — stan zmierzony, wrzesien 2026. */
const ZMIERZONE = {
  poslow: 499,
  aktywnych: 460,
  klubow: 12,
  roznychKodowKlubu: 13,
  procesow: 1662,
  glosowan: 4569,
  posiedzenZGlosowaniami: 64,
  proceedingsZero: 11,
};

// =====================================================================
console.log('SONDA 32 — kontrola kontraktu z Sejm API');
console.log(`Kadencja ${TERM}, baza ${BAZA}`);
console.log(`Probka procesow: ${PROBKA_PROCESOW}. Zadnych zapytan do UOKiK/SUDOP (D13).`);

// ---------------------------------------------------------------------
naglowek('1. POSLOWIE  /MP');
// ---------------------------------------------------------------------
const mp = await get('/MP');
if (!mp.ok) {
  zglos('BLOKUJE', '/MP', `Endpoint nie odpowiedzial poprawnie (status ${mp.status}).`, mp.tekst);
  console.log(`  BLAD ${mp.status}: ${mp.tekst}`);
} else {
  const poslowie = mp.dane;
  const aktywni = poslowie.filter((p) => p.active).length;
  console.log(`  rekordow: ${poslowie.length}  (zmierzone wczesniej: ${ZMIERZONE.poslow})`);
  console.log(`  aktywnych: ${aktywni}  (zmierzone: ${ZMIERZONE.aktywnych})`);
  console.log(`  czas: ${mp.ms} ms, ${(mp.bajty / 1024).toFixed(0)} kB`);

  if (poslowie.length !== ZMIERZONE.poslow) {
    zglos('UWAGA', '/MP', `Liczba poslow ${poslowie.length}, a dokumentacja mowi ${ZMIERZONE.poslow}.`,
      'Sprawdz, czy to wygasniecie/objecie mandatu, czy zmiana zakresu odpowiedzi.');
  }
  if (aktywni !== ZMIERZONE.aktywnych) {
    zglos('DRYF', '/MP', `Aktywnych ${aktywni} zamiast ${ZMIERZONE.aktywnych}.`,
      'Mandaty wygasaja w trakcie kadencji — to sie ma prawo zmieniac. Zaktualizuj liczbe w docs/zrodla-danych.md.');
  }

  // --- pola wymagane przez nasz typ -----------------------------------
  const braki = POLA_MP_WYMAGANE.filter((k) => pokrycie(poslowie, k).pct < 100);
  if (braki.length) {
    for (const k of braki) {
      const p = pokrycie(poslowie, k);
      zglos('BLOKUJE', '/MP', `Pole "${k}" jest w typie SejmMP WYMAGANE, a API wypelnia je w ${p.pct}%.`,
        `${p.ile}/${poslowie.length} rekordow. Mapper moze zapisac undefined w kolumnie NOT NULL.`);
    }
  } else {
    console.log(`  pola wymagane przez SejmMP: komplet, 100% pokrycia (${POLA_MP_WYMAGANE.length} pol)`);
  }

  // --- pokrycie pol opcjonalnych wobec pomiaru ------------------------
  console.log('  pokrycie pol opcjonalnych:');
  for (const k of POLA_MP_OPCJONALNE) {
    const p = pokrycie(poslowie, k);
    const oczek = POKRYCIE_ZMIERZONE[k];
    const opis = oczek === undefined ? '' : `  (zmierzone: ${oczek}%)`;
    console.log(`    ${k.padEnd(20)} ${String(p.pct).padStart(3)}%  ${String(p.ile).padStart(3)}/${poslowie.length}${opis}`);
    // Prog 5 punktow: pokrycie drga naturalnie przy wygasnieciu mandatu.
    if (oczek !== undefined && Math.abs(p.pct - oczek) > 5) {
      zglos('UWAGA', '/MP', `Pokrycie "${k}" to ${p.pct}%, a zmierzono ${oczek}%.`,
        'Roznica ponad 5 punktow. Przy inactiveCause/waiverDesc to normalny dryf kadencji; przy secondName/profession raczej zmiana po stronie API.');
    }
  }

  // --- pola, ktorych nasz typ NIE ZNA ---------------------------------
  const znane = new Set([...POLA_MP_WYMAGANE, ...POLA_MP_OPCJONALNE]);
  const nowe = kluczeZbioru(poslowie).filter((k) => !znane.has(k));
  if (nowe.length) {
    console.log(`  pola spoza typu SejmMP: ${nowe.join(', ')}`);
    zglos('UWAGA', '/MP', `API zwraca pola, ktorych typ SejmMP nie opisuje: ${nowe.join(', ')}.`,
      'To nie psuje importu (nadmiarowe pola sa ignorowane), ale moze zawierac cos, co nam sie przyda.');
  }

  // --- kluby: kod klubu spoza slownika (D5) ---------------------------
  const kluby = await get('/clubs');
  if (!kluby.ok) {
    zglos('UWAGA', '/clubs', `Endpoint nie odpowiedzial (status ${kluby.status}).`, kluby.tekst);
  } else {
    const kodySlownika = new Set(kluby.dane.map((c) => c.id));
    const kodyUPoslow = [...new Set(poslowie.map((p) => p.club).filter(Boolean))];
    const poza = kodyUPoslow.filter((k) => !kodySlownika.has(k));
    console.log(`  klubow w /clubs: ${kluby.dane.length}  (zmierzone: ${ZMIERZONE.klubow})`);
    console.log(`  roznych kodow w MP.club: ${kodyUPoslow.length}  (zmierzone: ${ZMIERZONE.roznychKodowKlubu})`);
    console.log(`  kody spoza slownika: ${poza.length ? poza.join(', ') : '(brak)'}`);

    if (poza.length === 0) {
      zglos('UWAGA', '/clubs', 'Nie ma juz zadnego kodu klubu spoza slownika /clubs.',
        'Decyzja D5 opisuje klub "Polska2050-TD" z flaga from_dictionary=false. Jesli zrodlo naprawilo niespojnosc, D5 dalej obowiazuje jako zasada, ale jej przyklad jest historyczny.');
    } else if (!poza.includes('Polska2050-TD')) {
      zglos('UWAGA', '/clubs', `Kody spoza slownika sie ZMIENILY: ${poza.join(', ')}.`,
        'D5 opisuje Polska2050-TD. Nowy kod spoza slownika trafi do clubs z from_dictionary=false — sprawdz widok clubs_poza_slownikiem.');
    }
  }

  // --- ETag / Last-Modified (docs mowia: nie ma) ----------------------
  const etag = mp.naglowki.get('etag');
  const lastMod = mp.naglowki.get('last-modified');
  console.log(`  ETag: ${etag ?? '(brak)'}   Last-Modified: ${lastMod ?? '(brak)'}`);
  if (etag || lastMod) {
    zglos('UWAGA', '/MP', 'Lista ma teraz ETag albo Last-Modified — dokumentacja mowi, ze ich nie ma.',
      'Jesli to prawda, import moglby uzywac warunkowego GET zamiast hashowac caly ladunek. Warte sprawdzenia, ale nie automatycznej zmiany.');
  }
}

// ---------------------------------------------------------------------
naglowek('2. POSIEDZENIA  /proceedings');
// ---------------------------------------------------------------------
const proc = await get('/proceedings');
if (!proc.ok) {
  zglos('UWAGA', '/proceedings', `Endpoint nie odpowiedzial (status ${proc.status}).`, proc.tekst);
} else {
  const zerowe = proc.dane.filter((p) => !(Number(p.number) > 0));
  console.log(`  wpisow: ${proc.dane.length}`);
  console.log(`  z number = 0 (zapowiedziane, filtrowane u zrodla): ${zerowe.length}  (zmierzone: ${ZMIERZONE.proceedingsZero})`);
  if (zerowe.length === 0) {
    zglos('UWAGA', '/proceedings', 'Nie ma juz wpisow z number = 0.',
      'fetchProceedings() je odfiltrowuje. Filtr jest nieszkodliwy, ale zalozenie z dokumentacji przestalo obowiazywac.');
  } else if (zerowe.length !== ZMIERZONE.proceedingsZero) {
    zglos('DRYF', '/proceedings', `Wpisow z number = 0 jest ${zerowe.length}, dokumentacja mowi ${ZMIERZONE.proceedingsZero}.`,
      'Zapowiedziane posiedzenia dostaja numer, gdy sie odbeda — ta liczba ma prawo sie ruszac. Filtr w fetchProceedings() dziala niezaleznie od niej.');
  }
}

// ---------------------------------------------------------------------
naglowek('3. GLOSOWANIA  /votings');
// ---------------------------------------------------------------------
const posiedzenia = proc.ok
  ? proc.dane.filter((p) => Number(p.number) > 0).map((p) => Number(p.number)).sort((a, b) => b - a)
  : [];

/*
  Cofamy sie do NAJNOWSZEGO POSIEDZENIA, KTORE MA GLOSOWANIA.
  Najnowsze posiedzenie bywa dopiero zapowiedziane albo trwa i jeszcze nie
  glosowalo — pierwsza wersja tej sondy brala je na sztywno, trafila na zero
  glosowan i po cichu pominela kontrole dziedziny pola `vote`. A to jest
  najwazniejszy test w tym pliku: wartosc `PRESENT` spoza schematu OpenAPI
  kosztowala ten projekt przerwany backfill i decyzje D7.
*/
let lista = null;
let ostatniePosiedzenie = null;
for (const nr of posiedzenia.slice(0, 8)) {
  const r = await get(`/votings/${nr}`);
  if (r.ok && Array.isArray(r.dane) && r.dane.length) {
    lista = r;
    ostatniePosiedzenie = nr;
    break;
  }
  console.log(`  posiedzenie ${nr}: ${r.ok ? '0 glosowan' : `status ${r.status}`} — cofam sie do wczesniejszego`);
}

if (ostatniePosiedzenie === null) {
  zglos('UWAGA', '/votings', 'Zadne z osmiu ostatnich posiedzen nie ma glosowan — pomijam kontrole dziedziny pola vote.',
    'To moze byc dluga przerwa w obradach, ale moze tez znaczyc, ze zmienil sie ksztalt /votings/{sitting}.');
} else {
  {
    console.log(`  sprawdzam posiedzenie nr ${ostatniePosiedzenie} (najnowsze z glosowaniami)`);
    console.log(`  glosowan na posiedzeniu: ${lista.dane.length}`);

    // Glosy imienne sa WYLACZNIE w szczegolach — to jest zalozenie importera.
    const wListzie = lista.dane.filter((v) => Array.isArray(v.votes) && v.votes.length).length;
    console.log(`  glosowan z polem votes juz w LISCIE: ${wListzie} (oczekiwane 0 — glosy sa w szczegolach)`);
    if (wListzie > 0) {
      zglos('UWAGA', '/votings', 'Lista glosowan zawiera juz glosy imienne.',
        'Importer pobiera szczegoly kazdego glosowania osobno. Jesli lista je niesie, dalo by sie oszczedzic tysiace zapytan — do sprawdzenia, czy to pelny komplet, czy wycinek.');
    }

    const pierwsze = lista.dane[0];
    if (pierwsze) {
      const szcz = await get(`/votings/${pierwsze.sitting}/${pierwsze.votingNumber}`);
      if (!szcz.ok) {
        zglos('BLOKUJE', '/votings/{s}/{n}', `Szczegol glosowania ${pierwsze.sitting}/${pierwsze.votingNumber} — status ${szcz.status}.`, szcz.tekst);
      } else {
        const v = szcz.dane;
        const glosy = Array.isArray(v.votes) ? v.votes : [];
        console.log(`  szczegol ${v.sitting}/${v.votingNumber}: ${glosy.length} glosow imiennych, kind=${v.kind}`);

        // --- dziedzina pola vote --------------------------------------
        const licznik = {};
        for (const g of glosy) licznik[g.vote] = (licznik[g.vote] ?? 0) + 1;
        const wartosci = Object.keys(licznik).sort();
        console.log(`  wartosci vote: ${wartosci.map((w) => `${w}=${licznik[w]}`).join('  ')}`);

        const nieznane = wartosci.filter((w) => !ZNANE_VOTE.includes(w));
        if (nieznane.length) {
          zglos('BLOKUJE', 'vote', `NIEZNANA wartosc pola vote: ${nieznane.join(', ')}.`,
            'D7: do lojalnosci wchodza wylacznie YES/NO/ABSTAIN (lista dozwolonych), wiec nowa wartosc NIE zafalszuje lojalnosci sama z siebie. Ale ingest/lib/vote-values.ts ma kontrole dziedziny i przerwie import — dopisz wartosc swiadomie, po ustaleniu, co znaczy.');
        } else {
          console.log(`  wszystkie wartosci vote sa znane kodowi (lista dozwolonych do lojalnosci: ${STANOWISKA.join('/')})`);
        }

        // --- klub przy glosie (D4) ------------------------------------
        const bezKlubu = glosy.filter((g) => !g.club).length;
        console.log(`  glosow bez pola club: ${bezKlubu} (D4: klub bierzemy z GLOSU, nie z profilu)`);
        if (bezKlubu > 0) {
          zglos('UWAGA', 'vote.club', `${bezKlubu} glosow nie ma pola club.`,
            'D4 opiera lojalnosc historyczna na klubie z momentu glosowania. Brak pola oznacza glosy, ktorych nie da sie przypisac do zadnego klubu.');
        }

        // --- protokol PDF jako zrodlo (D1) ----------------------------
        const pdf = v.links?.find((l) => l.rel === 'pdf')?.href ?? null;
        console.log(`  links[rel=pdf]: ${pdf ? 'jest' : 'BRAK'}`);
        if (!pdf) {
          zglos('UWAGA', '/votings', 'Glosowanie nie ma links[rel="pdf"].',
            'votingPdfUrl() ma sklejany adres zapasowy, wiec import przejdzie. Ale D1 wymaga dzialajacego linku do zrodla — sprawdz, czy adres zapasowy nadal odpowiada.');
        }
      }
    }
  }

  // --- import przyrostowy: /votings/search?dateFrom= -------------------
  const odKiedy = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
  const szukaj = await get(`/votings/search?dateFrom=${odKiedy}&limit=10`);
  if (!szukaj.ok) {
    zglos('BLOKUJE', '/votings/search', `Wyszukiwarka glosowan nie odpowiada (status ${szukaj.status}).`,
      'To jest podstawa nocnego importu przyrostowego (ingest:votings). Bez niej zostaje tylko pelny backfill.');
  } else {
    const daty = szukaj.dane.map((v) => v.date).filter(Boolean).sort();
    console.log(`  search?dateFrom=${odKiedy}: ${szukaj.dane.length} wynikow, zakres dat ${daty[0] ?? '—'} … ${daty[daty.length - 1] ?? '—'}`);
    const zaStare = szukaj.dane.filter((v) => v.date && v.date < odKiedy).length;
    if (zaStare > 0) {
      zglos('BLOKUJE', '/votings/search', `Parametr dateFrom NIE filtruje: ${zaStare} wynikow jest starszych niz ${odKiedy}.`,
        'Import przyrostowy opiera sie na tym filtrze. Jesli przestal dzialac, nocny cron pobiera cala kadencje albo pomija nowe glosowania.');
    } else if (szukaj.dane.length === 0) {
      console.log('  (zero wynikow nie musi byc bledem — w przerwie miedzy posiedzeniami Sejm nie glosuje)');
    }
  }
}

// ---------------------------------------------------------------------
naglowek('4. PROCESY LEGISLACYJNE  /processes');
// ---------------------------------------------------------------------
const lista1 = await get('/processes');
if (!lista1.ok) {
  zglos('BLOKUJE', '/processes', `Endpoint nie odpowiedzial (status ${lista1.status}).`, lista1.tekst);
} else {
  const totalCount = Number(lista1.naglowki.get('x-total-count') ?? 0) || null;
  const contentRange = lista1.naglowki.get('content-range');
  console.log(`  bez parametrow: ${lista1.dane.length} pozycji w ciele odpowiedzi`);
  console.log(`  x-total-count: ${totalCount ?? '(BRAK)'}   content-range: ${contentRange ?? '(brak)'}`);

  if (!totalCount) {
    zglos('BLOKUJE', '/processes', 'Brak naglowka x-total-count.',
      'sync-processes.ts czyta z niego rozmiar zbioru i na nim opiera kontrole sum. Bez niego import konczy sie "sukcesem" z 3% kadencji — dokladnie ten blad opisuje komentarz w ingest/lib/sejm-client.ts.');
  } else {
    const roznica = totalCount - ZMIERZONE.procesow;
    if (roznica !== 0) {
      zglos(roznica > 0 ? 'DRYF' : 'UWAGA', '/processes',
        `API deklaruje ${totalCount} procesow, dokumentacja mowi ${ZMIERZONE.procesow} (${roznica > 0 ? '+' : ''}${roznica}).`,
        roznica > 0
          ? 'Wzrost jest normalny — Sejm wnosi nowe druki. Zaktualizuj liczbe w docs/zrodla-danych.md i HANDOFF.md §3.1.'
          : 'SPADEK liczby procesow jest nietypowy. Sprawdz, zanim uruchomisz import — kontrola sum w sync-processes.ts przerwie przy rozjezdzie.');
    }
  }

  // --- paginacja: limit/offset dzialaja, page/from sa ignorowane -------
  const zLimitem = await get('/processes?limit=500&offset=0');
  const zOffsetem = await get('/processes?limit=500&offset=500');
  if (zLimitem.ok && zOffsetem.ok) {
    const a = new Set(zLimitem.dane.map((p) => String(p.number)));
    const b = zOffsetem.dane.map((p) => String(p.number));
    const nakladka = b.filter((n) => a.has(n)).length;
    console.log(`  limit=500 -> ${zLimitem.dane.length} pozycji;  offset=500 -> ${zOffsetem.dane.length} pozycji`);
    console.log(`  nakladka miedzy stronami: ${nakladka} (oczekiwane 0)`);
    if (nakladka > 0) {
      zglos('BLOKUJE', '/processes', `Strony 1 i 2 nachodza na siebie w ${nakladka} pozycjach — offset nie dziala tak, jak zaklada importer.`,
        'sync-processes.ts skleja strony po offsecie i deduplikuje po numerze, wiec nie zapisze duplikatow, ale MOZE NIE DOCIAGNAC konca zbioru.');
    }
    if (zLimitem.dane.length < Math.min(500, totalCount ?? 500)) {
      zglos('UWAGA', '/processes', `limit=500 zwrocil tylko ${zLimitem.dane.length} pozycji.`,
        'Jesli API scielo limit, PROCESY_NA_STRONE w sejm-client.ts jest za duze i import bedzie dlugi, ale poprawny (kontrola sum go zlapie).');
    }
  }
}

// ---------------------------------------------------------------------
naglowek(`5. ETAPY PROCESOW — probka ${PROBKA_PROCESOW}`);
// ---------------------------------------------------------------------
if (lista1.ok && lista1.dane.length) {
  const numery = lista1.dane.slice(0, PROBKA_PROCESOW).map((p) => String(p.number));
  const typyEtapow = new Map();
  const typyDokumentow = new Map();
  let etapow = 0;
  let maxGlebokosc = 0;
  let zGlosowaniem = 0;
  let bezNazwy = 0;
  let uchwalonych = 0;
  let zAdresem = 0;

  for (const nr of numery) {
    const r = await get(`/processes/${nr}`);
    if (!r.ok) {
      zglos('UWAGA', '/processes/{nr}', `Szczegol procesu ${nr} — status ${r.status}.`, r.tekst);
      continue;
    }
    const p = r.dane;
    if (p.documentType) typyDokumentow.set(p.documentType, (typyDokumentow.get(p.documentType) ?? 0) + 1);
    if (p.passed === true) {
      uchwalonych++;
      if (p.ELI || p.links?.some((l) => l.rel === 'isap')) zAdresem++;
    }

    const zejdz = (lista, depth) => {
      for (const s of lista ?? []) {
        etapow++;
        maxGlebokosc = Math.max(maxGlebokosc, depth);
        if (!s.stageName || !String(s.stageName).trim()) bezNazwy++;
        if (s.stageType) typyEtapow.set(s.stageType, (typyEtapow.get(s.stageType) ?? 0) + 1);
        if (typeof s.voting?.sitting === 'number' && typeof s.voting?.votingNumber === 'number') zGlosowaniem++;
        if (Array.isArray(s.children) && s.children.length) zejdz(s.children, depth + 1);
      }
    };
    zejdz(p.stages, 1);
  }

  console.log(`  procesow w probce: ${numery.length}`);
  console.log(`  etapow po splaszczeniu: ${etapow}, maksymalna glebokosc drzewa: ${maxGlebokosc}`);
  console.log(`  etapow niosacych (sitting, votingNumber): ${zGlosowaniem}`);
  console.log(`  etapow bez stageName (mapper je POMIJA): ${bezNazwy}`);
  console.log(`  uchwalonych (passed=true): ${uchwalonych}, w tym z adresem aktu: ${zAdresem}`);

  if (maxGlebokosc > 2) {
    console.log(`  UWAGA: drzewo glebsze niz zmierzone 2 poziomy — mapStages() schodzi rekurencyjnie, wiec to obsluguje.`);
    zglos('UWAGA', 'process_stages', `Drzewo etapow ma glebokosc ${maxGlebokosc}, dokumentacja mowi o 2.`,
      'mapStages() jest rekurencyjny i to zniesie. Warto poprawic liczbe w komentarzu mappera i w docs/zrodla-danych.md.');
  }
  if (bezNazwy > 0) {
    zglos('UWAGA', 'process_stages', `${bezNazwy} etapow nie ma stageName i zostanie POMINIETYCH przez mapStages().`,
      'Dzis to swiadoma decyzja ("etap bez nazwy nie niesie informacji"), ale jesli liczba rosnie, tracimy etapy w ciszy.');
  }

  // --- SLOWNIKI: tu obowiazuje zasada z naglowka pliku -----------------
  const typy = [...typyEtapow.keys()].sort();
  const nowe = typy.filter((t) => !ZNANE_STAGE_TYPES.includes(t));
  const nieobecne = ZNANE_STAGE_TYPES.filter((t) => !typyEtapow.has(t));

  console.log(`  typow etapu w probce: ${typy.length} z ${ZNANE_STAGE_TYPES.length} znanych kodowi`);
  if (nieobecne.length) {
    console.log(`  nieobecne w probce (to NIE jest rozbieznosc): ${nieobecne.join(', ')}`);
  }
  if (nowe.length) {
    console.log(`  >>> NOWE TYPY ETAPU: ${nowe.join(', ')}`);
    zglos('UWAGA', 'stage_type', `Typy etapu nieznane kodowi: ${nowe.join(', ')}.`,
      'Import ich NIE odrzuci (kolumna jest tekstowa, importer tylko raportuje). Ale widok proces_los rozpoznaje los po KODACH etapu — sprawdz, czy nowy typ nie zmienia znaczenia "weto" albo "podpis", zanim dopiszesz go do ZNANE_STAGE_TYPES.');
  }

  const dokumenty = [...typyDokumentow.keys()].sort();
  const noweDok = dokumenty.filter((t) => !ZNANE_DOCUMENT_TYPES.includes(t));
  if (noweDok.length) {
    console.log(`  >>> NOWE TYPY DOKUMENTU: ${noweDok.join(', ')}`);
    zglos('UWAGA', 'document_type', `Typy dokumentu nieznane kodowi: ${noweDok.join(', ')}.`, 'Kolumna tekstowa — import przejdzie, slownik do uzupelnienia.');
  }

  // --- kody etapow, na ktorych stoi widok proces_los (0019/0020) -------
  naglowek('6. KODY ETAPOW, NA KTORYCH STOI WIDOK proces_los');
  const KLUCZOWE = ['PresidentSignature', 'Veto', 'PresidentToTribunal', 'PresidentMotionConsideration'];
  console.log('  (widok wyprowadza los procesu WYLACZNIE z tych kodow — migracje 0019 i 0020)');
  for (const k of KLUCZOWE) {
    const ile = typyEtapow.get(k) ?? 0;
    console.log(`    ${k.padEnd(30)} ${String(ile).padStart(4)} wystapien w probce`);
  }
  console.log('  Pelne liczby z bazy (zmierzone przy 0020): PresidentSignature 491, Veto 63,');
  console.log('  PresidentToTribunal 10, PresidentMotionConsideration 15.');
  console.log('  Probka tej wielkosci NIE MOZE ich potwierdzic ani obalic — to kontrola obecnosci kodow, nie liczb.');
}

// =====================================================================
naglowek('PODSUMOWANIE');
// =====================================================================
console.log(`Zapytan do api.sejm.gov.pl: ${zapytan}. Do UOKiK/SUDOP: 0.`);
console.log('');

if (!rozbieznosci.length) {
  console.log('BRAK ROZBIEZNOSCI.');
  console.log('Kod i dokumentacja opisuja Sejm API zgodnie ze stanem na dzis.');
} else {
  const kolejnosc = { BLOKUJE: 0, UWAGA: 1, DRYF: 2 };
  rozbieznosci.sort((a, b) => kolejnosc[a.waga] - kolejnosc[b.waga]);
  console.log(`ROZBIEZNOSCI: ${rozbieznosci.length}`);
  console.log('');
  for (const [i, r] of rozbieznosci.entries()) {
    console.log(`${String(i + 1).padStart(2)}. [${r.waga}] ${r.obszar}`);
    console.log(`    ${r.opis}`);
    if (r.szczegol) console.log(`    -> ${r.szczegol}`);
    console.log('');
  }
  console.log('Zadna z tych pozycji NIE JEST poleceniem zmiany kodu.');
  console.log('Slowniki wyprowadzono z pelnych importow; probka ich nie obala.');
}
