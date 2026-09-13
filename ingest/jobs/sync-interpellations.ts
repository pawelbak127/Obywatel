/**
 * Interpelacje i zapytania poselskie — pierwszy zbior w serwisie, ktory mowi
 * cos o RZADZIE, a nie o pośle. Pelne uzasadnienie w naglowku migracji
 * 0032_interpelacje.sql — przeczytaj je, zanim zaczniesz zmieniac ten plik.
 *
 *   npm run ingest:interpelacje              pelny import
 *   npm run ingest:interpelacje -- --ile=50  tylko pierwsze N z KAZDEGO zrodla
 *   npm run ingest:interpelacje -- --sucho   pobiera i sprawdza, NIC nie zapisuje
 *
 * ---------------------------------------------------------------------
 * DWA ZRODLA, JEDNA TABELA. `kind` odroznia interpelacje od zapytan, a klucz
 * glowny jest PARA (kind, num) — patrz naglowek migracji, dlaczego sam numer
 * gubilby polowe zbioru.
 *
 * ---------------------------------------------------------------------
 * STRONICOWANIE PRZEZ OFFSET, DO SKUTKU. Zmierzone 13.09.2026:
 *
 *   interpelacje  limit=10000  offset=0     -> 10 000 pozycji
 *                 limit=10000  offset=10000 ->  9 756 pozycji
 *                 limit=10000  offset=20000 ->      0 pozycji  (koniec)
 *   zapytania     limit=10000  offset=0     ->  3 971 pozycji
 *                 limit=10000  offset=10000 ->      0 pozycji  (koniec)
 *
 * Zbior ROSNIE (kazdy dzien sejmowy dodaje interpelacje), wiec nie zakladamy
 * tych liczb na sztywno — petla idzie offsetem, az strona wroci PUSTA, a nie
 * dopoki `data.length < limit`. Ta druga wersja wygladalaby na rownowazna,
 * ale ubezpiecza sie tylko na typowy przypadek REST-owego stronicowania;
 * `x-total-count` z pierwszej strony daje dodatkowa, niezalezna kontrole
 * sumy (ten sam wzorzec co w sync-processes.ts) i przerywa import, gdyby
 * kiedys nie zgadzalo sie to, co zebralismy, z tym, co deklaruje API.
 *
 * ---------------------------------------------------------------------
 * KONTROLA DZIEDZINY PRZED ZAPISEM (CLAUDE.md §7.1). `num` ma byc liczba
 * calkowita, `title` niepusty — sprawdzane na CALEJ pobranej porcji, zanim
 * cokolwiek trafi do bazy. Naruszenie przerywa caly import: to nie jest
 * pojedynczy zly wiersz, tylko sygnal, ze ksztalt odpowiedzi API sie zmienil.
 *
 * AUTOR SPOZA `mps` JEST RAPORTOWANY, NIE PRZERYWA (§7.2). `from` bywa
 * tablica napisow, ktore nie musza byc liczbami (zmierzone: w praktyce zawsze
 * sa, ale nic tego nie gwarantuje) — taki wpis liczymy osobno i pomijamy.
 * Dokument i tak trafia do bazy; ginie wylacznie POWIAZANIE z tym autorem.
 *
 * ---------------------------------------------------------------------
 * KOLEJNOSC ZAPISU. `interpellation_authors` ma klucz obcy do
 * `interpellations` (kind, num) — dokumenty musza byc w bazie PIERWSZE,
 * inaczej kazdy wiersz autora wywroci sie na `foreign_key_violation`.
 *
 * AUTORZY NIE SA CZYSZCZENI PRZED ZAPISEM (w odroznieniu od etapow procesow
 * w sync-processes.ts). Tam etapy renumeruje samo API miedzy przebiegami.
 * Tu autorstwo interpelacji jest ustalone raz, w momencie zlozenia, i pozniej
 * sie nie zmienia — dopisywane bywaja wylacznie odpowiedzi. `upsert` na pelnym
 * kluczu (kind, num, mp_id) jest wiec zwyklym „wstaw, jesli jeszcze nie ma",
 * tanszym niz delete+insert 41 tysiecy wierszy przy kazdym przebiegu.
 *
 * ---------------------------------------------------------------------
 * `--sucho` KONCZY SIE PRZED `writeCursor`. W sync-sitting-days.ts kursor
 * zapisuje sie NIEZALEZNIE od `--sucho`, wiec probny przebieg wyglada tam na
 * /status jak udany import, ktory niczego nie zapisal. Tutaj — jak
 * w sync-processes.ts — `--sucho` konczy dzialanie wczesniejszym `return`,
 * zanim dojdzie do zapisu stanu.
 */

import { db } from '../lib/db.js';
import { writeCursor } from '../lib/source-recorder.js';
import { getJson } from '../lib/http.js';
import { assertSchema, WYMOGI_INTERPELACJE } from '../lib/preflight.js';
import { TERM as TERM_DOMYSLNY } from '../lib/sejm-client.js';

const PACZKA = 1000;
const LIMIT_STRONY = 10_000;

type Rodzaj = 'interpelacja' | 'zapytanie';

type DokumentApi = {
  num: number;
  title: string;
  term?: number;
  from: string[];
  to?: string[];
  receiptDate?: string;
  sentDate?: string;
  answerDelayedDays?: number;
  replies?: unknown[];
  lastModified?: string;
  links?: Array<{ href: string; rel: string }>;
};

type WierszDokumentu = {
  kind: Rodzaj;
  num: number;
  term: number;
  title: string;
  recipients: string[];
  receipt_date: string | null;
  sent_date: string | null;
  delayed_days: number | null;
  replies_count: number;
  sejm_url: string | null;
  last_modified: string | null;
};

type WierszAutora = { kind: Rodzaj; num: number; mp_id: number };

function flaga(nazwa: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${nazwa}=`))?.split('=')[1];
}

/**
 * Pobiera CALY zbior spod jednej sciezki, stronicujac offsetem do pustej
 * odpowiedzi. Przy `--ile` przerywa wczesniej, na dokladnie tylu pozycjach,
 * ile poproszono — po to jest ten limit, zeby proba nie sciagala 27 MB JSON-a.
 */
async function pobierzWszystkie(
  sciezka: string,
  ile: number,
): Promise<{ dane: DokumentApi[]; raw: string[] }> {
  const limitStrony = ile ? Math.min(ile, LIMIT_STRONY) : LIMIT_STRONY;
  const wszystkie: DokumentApi[] = [];
  const raw: string[] = [];
  let deklarowane: number | null = null;

  for (let offset = 0; ; offset += limitStrony) {
    const url = `https://api.sejm.gov.pl/sejm/term${TERM_DOMYSLNY}/${sciezka}?limit=${limitStrony}&offset=${offset}`;
    const odp = await getJson<DokumentApi[]>(url);
    raw.push(odp.raw);
    if (offset === 0) deklarowane = Number(odp.headers.get('x-total-count') ?? NaN) || null;

    if (!odp.data.length) break;
    wszystkie.push(...odp.data);
    process.stdout.write(`\r  ${sciezka}: pobrano ${wszystkie.length}${deklarowane ? `/${deklarowane}` : ''}`);
    if (ile && wszystkie.length >= ile) break;
  }
  process.stdout.write('\n');

  const dane = ile ? wszystkie.slice(0, ile) : wszystkie;

  // Kontrola sumy z naglowkiem — wylacznie przy pelnym przebiegu. `--ile`
  // z zalozenia bierze niepelny zbior, wiec porownanie nie mialoby sensu.
  if (!ile && deklarowane !== null && dane.length !== deklarowane) {
    throw new Error(
      `Stronicowanie ${sciezka}: pobrano ${dane.length} pozycji, API deklaruje ${deklarowane}. ` +
        'Przerywam, zeby nie zapisac niepelnego zbioru.',
    );
  }

  return { dane, raw };
}

async function main() {
  const sucho = process.argv.includes('--sucho') || process.argv.includes('--dry');
  const ile = Number(flaga('ile') ?? 0) || 0;

  await assertSchema(WYMOGI_INTERPELACJE);

  console.log(`Kadencja ${TERM_DOMYSLNY}. Pobieram interpelacje i zapytania…`);
  if (sucho) console.log('--sucho: niczego nie zapiszemy.');
  if (ile) console.log(`--ile=${ile}: pobieram tylko pierwsze ${ile} pozycji z KAZDEGO zrodla.`);
  console.log('');

  const interpelacje = await pobierzWszystkie('interpellations', ile);
  const zapytania = await pobierzWszystkie('writtenQuestions', ile);

  const surowe: Array<{ kind: Rodzaj; rekord: DokumentApi }> = [
    ...interpelacje.dane.map((rekord) => ({ kind: 'interpelacja' as const, rekord })),
    ...zapytania.dane.map((rekord) => ({ kind: 'zapytanie' as const, rekord })),
  ];

  console.log(`Pobrano lacznie: ${surowe.length} (interpelacje: ${interpelacje.dane.length}, zapytania: ${zapytania.dane.length}).`);

  // --- KONTROLA DZIEDZINY PRZED ZAPISEM (§7.1) — cala porcja naraz --------
  const zle = surowe.filter(({ rekord }) => !Number.isInteger(rekord.num) || !rekord.title?.trim());
  if (zle.length) {
    const przyklady = zle.slice(0, 5).map((z) => `  ${z.kind} num=${JSON.stringify(z.rekord.num)} title=${JSON.stringify(z.rekord.title)}`);
    throw new Error(
      [
        '',
        `Kontrola dziedziny: ${zle.length} rekordow ma niepoprawny "num" (nie liczba calkowita) `
          + 'lub pusty "title". NIC nie zapisano.',
        '',
        'Przyklady:',
        ...przyklady,
        '',
      ].join('\n'),
    );
  }

  // --- Zbior istniejacych poslow — do kontroli klucza obcego PRZED zapisem
  const mpsRes = await db().from('mps').select('id');
  if (mpsRes.error) throw new Error(`mps.select: ${mpsRes.error.message}`);
  const idyPoslow = new Set((mpsRes.data ?? []).map((r) => (r as { id: number }).id));

  // --- Mapowanie -----------------------------------------------------------
  const dokumenty: WierszDokumentu[] = [];
  const autorzy: WierszAutora[] = [];
  let autorowNienumerycznych = 0;
  let autorowSpozaBazy = 0;

  for (const { kind, rekord } of surowe) {
    dokumenty.push({
      kind,
      num: rekord.num,
      term: rekord.term ?? TERM_DOMYSLNY,
      title: rekord.title,
      recipients: rekord.to ?? [],
      receipt_date: rekord.receiptDate ?? null,
      sent_date: rekord.sentDate ?? null,
      delayed_days: rekord.answerDelayedDays ?? null,
      replies_count: rekord.replies?.length ?? 0,
      sejm_url: rekord.links?.find((l) => l.rel === 'web-description')?.href ?? null,
      last_modified: rekord.lastModified ?? null,
    });

    // Deduplikacja w obrebie jednego dokumentu — `from` nie powtarza sie
    // w zmierzonych danych, ale wiersz laczacy ma klucz (kind, num, mp_id)
    // i powtorka wywrocilaby caly batch na konflikcie klucza glownego.
    const jużDodani = new Set<number>();
    for (const surowyAutor of rekord.from ?? []) {
      if (!/^\d+$/.test(surowyAutor)) {
        autorowNienumerycznych++;
        continue;
      }
      const mpId = Number(surowyAutor);
      if (jużDodani.has(mpId)) continue;
      jużDodani.add(mpId);

      if (!idyPoslow.has(mpId)) {
        autorowSpozaBazy++;
        continue;
      }
      autorzy.push({ kind, num: rekord.num, mp_id: mpId });
    }
  }

  console.log('');
  console.log(`Dokumentow do zapisu:     ${dokumenty.length}`);
  console.log(`Powiazan autor-dokument:  ${autorzy.length}`);
  if (autorowNienumerycznych) {
    console.log(`UWAGA: ${autorowNienumerycznych} wpisow w "from" nie jest liczba calkowita — pominieto (dokument zapisany).`);
  }
  if (autorowSpozaBazy) {
    console.log(`UWAGA: ${autorowSpozaBazy} autorow wskazuje posla, ktorego nie ma w tabeli mps — powiazanie pominieto, dokument zapisany.`);
  }

  if (sucho) {
    console.log('\n--sucho: nic nie zapisano.');
    return;
  }

  // --- Zapis: dokumenty PRZED autorami (klucz obcy) -----------------------
  for (let i = 0; i < dokumenty.length; i += PACZKA) {
    const paczka = dokumenty.slice(i, i + PACZKA);
    const r = await db().from('interpellations').upsert(paczka, { onConflict: 'kind,num' });
    if (r.error) throw new Error(`interpellations.upsert (od ${i}): ${r.error.message}`);
    process.stdout.write(`\r  dokumenty ${Math.min(i + PACZKA, dokumenty.length)}/${dokumenty.length}`);
  }
  if (dokumenty.length) process.stdout.write('\n');

  for (let i = 0; i < autorzy.length; i += PACZKA) {
    const paczka = autorzy.slice(i, i + PACZKA);
    const r = await db().from('interpellation_authors').upsert(paczka, { onConflict: 'kind,num,mp_id' });
    if (r.error) throw new Error(`interpellation_authors.upsert (od ${i}): ${r.error.message}`);
    process.stdout.write(`\r  powiazania ${Math.min(i + PACZKA, autorzy.length)}/${autorzy.length}`);
  }
  if (autorzy.length) process.stdout.write('\n');

  // --- Kontrola sum po zapisie ---------------------------------------------
  const li = await db().from('interpellations').select('num', { count: 'exact', head: true }).eq('kind', 'interpelacja');
  const lz = await db().from('interpellations').select('num', { count: 'exact', head: true }).eq('kind', 'zapytanie');
  const la = await db().from('interpellation_authors').select('mp_id', { count: 'exact', head: true });
  if (li.error || lz.error || la.error) {
    throw new Error(`kontrola sum: ${li.error?.message ?? lz.error?.message ?? la.error?.message}`);
  }

  console.log('');
  console.log(`W bazie: ${li.count} interpelacji, ${lz.count} zapytan, ${la.count} powiazan.`);

  if (!ile) {
    const oczekiwaneInterpelacje = dokumenty.filter((d) => d.kind === 'interpelacja').length;
    const oczekiwaneZapytania = dokumenty.filter((d) => d.kind === 'zapytanie').length;
    if (li.count !== oczekiwaneInterpelacje || lz.count !== oczekiwaneZapytania) {
      throw new Error(
        `KONTROLA SUM: w bazie ${li.count}/${lz.count} (interpelacje/zapytania), ` +
          `a ten przebieg pobral ${oczekiwaneInterpelacje}/${oczekiwaneZapytania}. Sprawdz przed uzyciem tych danych.`,
      );
    }
    console.log('Kontrola sum: OK.');
  }

  /*
    ZAPIS STANU IMPORTU — stoi na KONCU, po kontroli sum (§7.1 tego pliku
    i wzorzec z sync-sitting-days.ts / sync-processes.ts): import, ktory
    wywrocil sie na niezgodnosci, nie ma prawa zapisac sie jako udany.
  */
  await writeCursor('interpellations', { cursorAt: new Date().toISOString(), error: null });
}

main().catch(async (e) => {
  const msg = (e as Error).message;
  console.error(`\n${msg}`);
  // Blad TEZ trafia do sync_state — inaczej /status pokazywalby date
  // ostatniego UDANEGO przebiegu jako date ostatniego przebiegu w ogole.
  await writeCursor('interpellations', { error: msg }).catch(() => {});
  process.exit(1);
});
