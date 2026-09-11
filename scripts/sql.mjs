/**
 * Uruchamianie SQL na bazie Supabase przez Management API.
 *
 *   node scripts/sql.mjs plik.sql
 *   node scripts/sql.mjs --sql="select count(*) from mps"
 *   node scripts/sql.mjs supabase/migrations/0021_cos.sql --pozwol-na-destrukcje
 *
 * POWOD ISTNIENIA. Do tej pory kazde zapytanie do bazy szlo przez Pawla:
 * model pisal SQL, Pawel wklejal do edytora Supabase i odsylal tabelke.
 * Przy migracjach to jest sensowna bramka kontroli, ale przy DIAGNOSTYCE
 * oznaczalo, ze model zglasza hipotezy zamiast je rozstrzygac — w audycie
 * z 11.09.2026 dwa pytania o dane zostaly otwarte wylacznie z tego powodu.
 *
 * Decyzja Pawla (11.09.2026): model moze dzialac na bazie przez Management API.
 *
 * ---------------------------------------------------------------------
 * CZEGO TEN SKRYPT NIE POKAZUJE.
 *
 * Tokenu ani zadnego klucza. `.env.local` jest wczytywany tak samo jak
 * w `scripts/gen-types.mjs` — przez `process.loadEnvFile`, czyli wartosci
 * trafiaja do `process.env` i sa uzywane, ale nigdy nie sa wypisywane.
 * Przy bledzie autoryzacji skrypt mowi "token odrzucony", a nie jaki token.
 *
 * ---------------------------------------------------------------------
 * BEZPIECZNIK. `SUPABASE_ACCESS_TOKEN` ma pelne prawa do projektu, wiec
 * literowka w zapytaniu moze skasowac tabele z 2,1 mln glosow. Skrypt
 * odmawia wykonania polecen kasujacych DANE, dopoki nie poda sie jawnie
 * `--pozwol-na-destrukcje`.
 *
 * `drop view` jest DOZWOLONY bez flagi i to nie jest niedopatrzenie:
 * wzorzec C tego projektu (HANDOFF §3.3) wymaga `drop view` + `create view`
 * przy kazdej zmianie kolumn, wiec normalna migracja by sie o ten bezpiecznik
 * potykala. Widok nie trzyma danych — mozna go odtworzyc z pliku migracji.
 * Tabela, kolumna i wiersze to co innego.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// --- konfiguracja, bez wypisywania wartosci -------------------------------
for (const nazwa of ['.env.local', '.env']) {
  if (existsSync(resolve(nazwa))) {
    try {
      process.loadEnvFile(resolve(nazwa));
    } catch {
      /* zmienne moga byc juz w srodowisku */
    }
  }
}

const POPRAWNY_REF = /^[a-z0-9]{20}$/;

/** Ten sam sposob ustalania ref-u co w gen-types.mjs — jawny albo z adresu. */
function idProjektu() {
  const jawny = process.env.SUPABASE_PROJECT_ID?.trim();
  if (jawny && POPRAWNY_REF.test(jawny)) return jawny;
  const m = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().match(
    /^https:\/\/([a-z0-9]{20})\.supabase\.(co|in)/i,
  );
  return m ? m[1].toLowerCase() : null;
}

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN?.trim();
const REF = idProjektu();

function zakoncz(komunikat) {
  console.error(`\n${komunikat}\n`);
  process.exit(1);
}

if (!TOKEN) {
  zakoncz(
    'Brak SUPABASE_ACCESS_TOKEN w .env.local.\n' +
      'Wygeneruj token: https://supabase.com/dashboard/account/tokens',
  );
}
if (!REF) {
  zakoncz(
    'Nie umiem ustalic Reference ID projektu.\n' +
      'Ustaw SUPABASE_PROJECT_ID (20 malych liter i cyfr) albo NEXT_PUBLIC_SUPABASE_URL.',
  );
}

// --- skad brac SQL --------------------------------------------------------
const argv = process.argv.slice(2);
const pozwolNaDestrukcje = argv.includes('--pozwol-na-destrukcje');
const cicho = argv.includes('--cicho');
const jakoJson = argv.includes('--json');
const wprost = argv.find((a) => a.startsWith('--sql='))?.slice(6);
const plik = argv.find((a) => !a.startsWith('--'));

if (!wprost && !plik) {
  zakoncz(
    'Uzycie:\n' +
      '  node scripts/sql.mjs <plik.sql>\n' +
      '  node scripts/sql.mjs --sql="select 1"\n' +
      '\nFlagi: --json, --cicho, --pozwol-na-destrukcje',
  );
}

let sql;
if (wprost) {
  sql = wprost;
} else {
  const sciezka = resolve(plik);
  if (!existsSync(sciezka)) zakoncz(`Nie ma pliku: ${plik}`);
  sql = readFileSync(sciezka, 'utf8');
}

if (!sql.trim()) zakoncz('Puste zapytanie.');

// --- bezpiecznik ----------------------------------------------------------
/**
 * Komentarze wycinamy PRZED sprawdzeniem, inaczej zdanie "-- nie robimy tu
 * drop table" w naglowku migracji blokowaloby caly plik. Wycinamy tez teksty
 * w apostrofach, zeby komunikat bledu ze slowem "delete" nie wywolal alarmu.
 */
const bezKomentarzy = sql
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/--[^\n]*/g, ' ')
  .replace(/'(?:[^']|'')*'/g, "''");

const NIEBEZPIECZNE = [
  [/\bdrop\s+(table|schema|database|type|index|function|trigger)\b/i, 'drop table/schema/… — usuwa obiekt razem z zawartoscia'],
  [/\balter\s+table\b[\s\S]{0,200}?\bdrop\s+(column|constraint)\b/i, 'alter table … drop column — usuwa dane z kolumny'],
  [/\btruncate\b/i, 'truncate — czysci cala tabele'],
  [/\bdelete\s+from\b(?![\s\S]{0,400}?\bwhere\b)/i, 'delete from bez where — kasuje wszystkie wiersze'],
  /*
    `update ... set` bez `where`. Negatywny lookbehind na `do` wycina
    `insert ... on conflict (id) do update set ...`, czyli upsert — ta konstrukcja
    z definicji dotyczy wiersza, ktory wlasnie wszedl w konflikt, i nigdy nie
    tknie calej tabeli. Bez tego wyjatku bezpiecznik blokowal migracje 0023,
    ktora zaklada kubelek w storage.buckets przez zwykly upsert.
  */
  [/(?<!\bdo\s{0,5})\bupdate\b[\s\S]{0,200}?\bset\b(?![\s\S]{0,400}?\bwhere\b)/i, 'update … set bez where — nadpisuje wszystkie wiersze'],
];

if (!pozwolNaDestrukcje) {
  const trafienia = NIEBEZPIECZNE.filter(([re]) => re.test(bezKomentarzy)).map(([, opis]) => opis);
  if (trafienia.length) {
    zakoncz(
      'ODMAWIAM — zapytanie kasuje dane albo obiekty:\n' +
        trafienia.map((t) => `  • ${t}`).join('\n') +
        '\n\nJesli to jest zamierzone, powtorz z flaga --pozwol-na-destrukcje.\n' +
        '(`drop view` jest dozwolony bez flagi — widok odtwarza sie z migracji.)',
    );
  }
}

// --- wykonanie ------------------------------------------------------------
if (!cicho) {
  console.log(`— projekt ${REF}, ${sql.trim().split('\n').length} linii SQL`);
}

const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query: sql }),
});

const tekst = await res.text();

if (!res.ok) {
  let szczegol = tekst.slice(0, 2000);
  try {
    const j = JSON.parse(tekst);
    szczegol = j.message ?? j.error ?? szczegol;
  } catch {
    /* zostaje surowy tekst */
  }
  if (res.status === 401 || res.status === 403) {
    zakoncz(
      `Management API odrzucilo token (HTTP ${res.status}).\n` +
        'Sprawdz, czy SUPABASE_ACCESS_TOKEN nie wygasl i czy ma dostep do tego projektu.\n' +
        `Odpowiedz serwera: ${szczegol}`,
    );
  }
  zakoncz(`Blad SQL (HTTP ${res.status}):\n${szczegol}`);
}

/*
  Ponizej NIE MA `process.exit(0)` i to jest celowe. Na Windowsie zakonczenie
  procesu przez `process.exit()` tuz po zapytaniu HTTP trafia w gniazdo, ktore
  jeszcze sie zamyka, i Node wypisuje:

      Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\win\async.c

  Wyglada to jak awaria skryptu, a jest wylacznie skutkiem zbyt wczesnego
  wyjscia. Bez `exit` proces konczy sie sam, gdy petla zdarzen opustoszeje.
  `zakoncz()` uzywa `process.exit(1)` swiadomie — tam chodzi o kod bledu.
*/
let dane = null;
let surowy = null;
try {
  dane = JSON.parse(tekst);
} catch {
  surowy = tekst;
}

/** Wypisanie wyniku jako wyrownanej tabelki. */
function wypiszTabelke(wiersze) {
  const kolumny = [...new Set(wiersze.flatMap((r) => Object.keys(r ?? {})))];
  const komorka = (v) => (v === null ? 'NULL' : v === undefined ? '' : String(v));
  const szer = kolumny.map((k) => Math.max(k.length, ...wiersze.map((r) => komorka(r?.[k]).length)));
  const linia = szer.map((s) => '-'.repeat(s + 2)).join('+');
  const wiersz = (wartosci) => wartosci.map((v, i) => ` ${v.padEnd(szer[i])} `).join('|');

  console.log('');
  console.log(wiersz(kolumny));
  console.log(linia);
  for (const r of wiersze) console.log(wiersz(kolumny.map((k) => komorka(r?.[k]))));
  console.log('');
  console.log(`${wiersze.length} ${wiersze.length === 1 ? 'wiersz' : wiersze.length < 5 ? 'wiersze' : 'wierszy'}`);
}

if (surowy !== null) {
  console.log(surowy);
} else if (jakoJson) {
  console.log(JSON.stringify(dane, null, 2));
} else if (!Array.isArray(dane) || dane.length === 0) {
  console.log('OK — zapytanie wykonane, brak wierszy do pokazania.');
} else {
  wypiszTabelke(dane);
}
