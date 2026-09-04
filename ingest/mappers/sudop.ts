/**
 * Mapper eksportu CSV z SUDOP (UOKiK) — pomoc publiczna i de minimis.
 *
 * ZRODLO. Czlowiek pobiera plik z `sudop.uokik.gov.pl` przyciskiem "zapisz do CSV"
 * (decyzja D13: nie automatyzujemy wyszukiwarki). Ten modul zamienia jego bajty
 * na wiersze tabeli `subsidies` i przerywa, zanim cokolwiek trafi do bazy,
 * jesli plik nie jest tym, czym myslimy, ze jest.
 *
 * KONTRAKT NAGLOWKA. Nazwy kolumn sa przepisane co do znaku z prawdziwego
 * eksportu, razem z literowka urzedu w "Wartosc nominana pomocy [PLN]".
 * Nie poprawiamy jej. Gdyby UOKiK ja kiedys naprawil, import ma sie ZATRZYMAC
 * i powiedziec o tym czlowiekowi — bo skoro zmienil sie naglowek, mogla zmienic
 * sie tez kolejnosc albo znaczenie kolumn, a tego z pliku nie widac.
 *
 * To ten sam mechanizm co przy `vote_value`: dziedzine kontroluje zrodlo, wiec
 * sprawdzamy ja przed zapisem calej paczki, a nie w polowie.
 */

export const NAGLOWKI_SUDOP = [
  'Nazwa beneficjenta pomocy',
  'NIP beneficjenta',
  'Podmiot udzielający pomocy',
  'Ustawa',
  'Numer środka pomocowego',
  'Dzień udzielenia pomocy',
  'Wielkość beneficjenta',
  'Identyfikator terytorialny siedziby beneficjenta',
  'Klasa PKD',
  'Wartość nominana pomocy [PLN]', // literowka jest w zrodle — celowo zachowana
  'Wartość pomocy brutto [PLN]',
  'Wartość pomocy brutto [EURO]',
  'Forma pomocy',
  'Przeznaczenie pomocy',
] as const;

export type WierszDotacji = {
  beneficiary_name: string;
  beneficiary_nip: string | null;
  nip_valid: boolean;
  beneficiary_size: string | null;
  teryt: string | null;
  pkd: string | null;
  grantor_name: string;
  legal_basis: string | null;
  measure_number: string | null;
  granted_on: string;              // ISO YYYY-MM-DD
  value_nominal_pln: number | null;
  value_gross_pln: number | null;
  value_gross_eur: number | null;
  aid_form: string | null;
  aid_purpose: string | null;
  row_sha256: string;
};

// --- kontrakt naglowka ---------------------------------------------------

export class ZlyNaglowek extends Error {
  constructor(readonly otrzymane: string[]) {
    super(komunikatONaglowku(otrzymane));
    this.name = 'ZlyNaglowek';
  }
}

export function sprawdzNaglowek(naglowki: string[]): void {
  const ok =
    naglowki.length === NAGLOWKI_SUDOP.length &&
    NAGLOWKI_SUDOP.every((n, i) => naglowki[i] === n);
  if (!ok) throw new ZlyNaglowek(naglowki);
}

function komunikatONaglowku(otrzymane: string[]): string {
  const linie = ['', 'NAGLOWEK PLIKU NIE ZGADZA SIE Z KONTRAKTEM — nic nie zapisano.', ''];
  const n = Math.max(otrzymane.length, NAGLOWKI_SUDOP.length);
  for (let i = 0; i < n; i++) {
    const ocz = NAGLOWKI_SUDOP[i] ?? '(brak kolumny)';
    const jest = otrzymane[i] ?? '(brak kolumny)';
    linie.push(`  ${String(i).padStart(2)}  ${ocz === jest ? 'ok  ' : 'ROZN'}  oczekiwane: ${ocz}`);
    if (ocz !== jest) linie.push(`                otrzymane:  ${jest}`);
  }
  linie.push(
    '',
    'Mozliwe przyczyny, w kolejnosci prawdopodobienstwa:',
    '  1. To eksport z innej strony SUDOP (aidSource ma inne kolumny niz aidEvent).',
    '  2. Plik zostal otwarty i zapisany w Excelu — Excel potrafi przekodowac i przenumerowac kolumny.',
    '  3. UOKiK zmienil format eksportu.',
    '',
    'W przypadku 3: popraw NAGLOWKI_SUDOP w ingest/mappers/sudop.ts, ale NAJPIERW',
    'sprawdz recznie, czy kolejnosc i znaczenie kolumn sa te same. Zamiana miejscami',
    'kwoty nominalnej i brutto nie rzuci zadnego bledu — po prostu opublikujemy',
    'nieprawdziwe liczby przy czyims nazwisku.',
    '',
  );
  return linie.join('\n');
}

// --- parsery pol ---------------------------------------------------------

/**
 * Kwota w formacie urzedowym: "184 122,10".
 * Separator tysiecy to spacja — zwykla (0x20) w zmierzonej probce, ale
 * dopuszczamy tez twarda spacje (U+00A0) i waska (U+202F), bo eksporty
 * z JSF potrafia je wstawiac zamiennie. Przecinek jest dziesietny.
 */
export function parsujKwote(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const oczyszczone = t.replace(/[\s   ]/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(oczyszczone)) {
    throw new Error(`Kwota w nierozpoznanym formacie: ${JSON.stringify(s)}`);
  }
  return Number(oczyszczone);
}

/** Data w formacie dd.mm.rrrr. Sprawdzamy, czy istnieje — "31.02.2020" ma polec. */
export function parsujDate(s: string): string {
  const m = s.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) throw new Error(`Data w nierozpoznanym formacie (oczekiwane dd.mm.rrrr): ${JSON.stringify(s)}`);
  const [, dd, mm, rrrr] = m;
  const iso = `${rrrr}-${mm}-${dd}`;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) {
    throw new Error(`Data nie istnieje w kalendarzu: ${JSON.stringify(s)}`);
  }
  return iso;
}

/**
 * Suma kontrolna NIP.
 *
 * Po co nam ona, skoro dane sa z rejestru panstwowego: NIP jest JEDYNYM
 * identyfikatorem, po ktorym wolno nam laczyc dotacje z czymkolwiek innym
 * (ryzyko zniesławienia przy zbieznosci nazwisk — sekcja 5 w docs/sudop.md).
 * Laczenie po NIP-ie z bledna suma kontrolna to laczenie po literowce.
 * Taki wiersz zapisujemy — to dane urzedu, nie nasze — ale oznaczamy
 * `nip_valid = false` i nie wolno go uzyc do zadnego zestawienia.
 */
export function nipPoprawny(nip: string): boolean {
  if (!/^\d{10}$/.test(nip)) return false;
  const wagi = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const suma = wagi.reduce((acc, w, i) => acc + w * Number(nip[i]), 0) % 11;
  return suma !== 10 && suma === Number(nip[9]);
}

/** TERYT gminy: 7 cyfr (WWPPGGR), np. 0264011 = Wroclaw. Zera wiodace istotne. */
export function terytPoprawny(t: string): boolean {
  return /^\d{7}$/.test(t);
}

// --- mapowanie wiersza ---------------------------------------------------

const pusty = (s: string | undefined): string | null => {
  const t = (s ?? '').trim();
  return t === '' ? null : t;
};

export function mapujWiersz(kolumny: string[], hash: (s: string) => string): WierszDotacji {
  if (kolumny.length !== NAGLOWKI_SUDOP.length) {
    throw new Error(`Wiersz ma ${kolumny.length} kolumn zamiast ${NAGLOWKI_SUDOP.length}.`);
  }
  const k = (i: number): string => kolumny[i] ?? '';

  const nazwa = pusty(k(0));
  const organ = pusty(k(2));
  if (!nazwa) throw new Error('Pusta nazwa beneficjenta.');
  if (!organ) throw new Error('Pusty podmiot udzielajacy pomocy.');

  const nipSurowy = k(1).replace(/[\s-]/g, '').trim();
  const teryt = k(7).trim();

  return {
    beneficiary_name: nazwa,
    beneficiary_nip: nipSurowy === '' ? null : nipSurowy,
    nip_valid: nipPoprawny(nipSurowy),
    beneficiary_size: pusty(k(6)),
    teryt: terytPoprawny(teryt) ? teryt : null,
    pkd: pusty(k(8)),
    grantor_name: organ,
    legal_basis: pusty(k(3)),
    measure_number: pusty(k(4)),
    granted_on: parsujDate(k(5)),
    value_nominal_pln: parsujKwote(k(9)),
    value_gross_pln: parsujKwote(k(10)),
    value_gross_eur: parsujKwote(k(11)),
    aid_form: pusty(k(12)),
    aid_purpose: pusty(k(13)),
    // Klucz deduplikacji. Ten sam wiersz przyjdzie ponownie przy kazdym kolejnym
    // eksporcie tego samego srodka pomocowego — a bedziemy je pobierac po kawalku.
    // Hash liczymy z pol PO przycieciu bialych znakow, zeby "  X" i "X" byly
    // tym samym wierszem, ale PRZED zamiana kwot na liczby, zeby nie zalezal
    // od zaokraglen zmiennoprzecinkowych.
    row_sha256: hash(kolumny.map((k) => k.trim()).join('')),
  };
}

/**
 * Wielkosc beneficjenta to slownik po stronie UOKiK, ale w eksporcie przychodzi
 * jako tekst. Nie robimy z tego enuma — zamiast tego raportujemy wartosci spoza
 * znanych, zeby czlowiek zobaczyl nowa kategorie, zamiast zeby import padl.
 */
/**
 * ZMIERZONE na prawdziwych eksportach. Lista, ktora tu wczesniej stala, byla
 * zgadnieta i tylko jedna pozycja z niej sie potwierdzila.
 *
 * Sformulowanie „nienalezacy do kategorii okreslonych kodem od 0 do 2" zdradza
 * slownik zrodlowy: 0 = mikro, 1 = male, 2 = srednie, a wszystko powyzej nie ma
 * wlasnej nazwy. To samo pojecie wystepuje w danych w co najmniej trzech
 * brzmieniach, bo eksport niesie tekst z epoki, w ktorej wpis powstal.
 *
 * NIE sprowadzamy tych brzmien do jednej kategorii. „Duzy przedsiebiorca"
 * i „beneficjent nienalezacy do kategorii 0-2" to nie jest dowodliwie to samo —
 * drugie moze obejmowac podmioty, ktore w ogole nie sa przedsiebiorcami
 * (fundacje, jednostki badawcze). Jesli kiedys bedziemy filtrowac po wielkosci,
 * zrobimy osobna mape z komentarzem, a nie ciche zlepienie przy imporcie.
 */
export const ZNANE_WIELKOSCI = [
  // potwierdzone w eksportach
  'małe przedsiębiorstwo',
  'duży przedsiębiorca',
  'beneficjent nienależący do kategorii określonych kodem od 0 do 2',
  'przedsiębiorstwo nienależące do kategorii określonych kodem od 0 do 2',
  // spodziewane, jeszcze niewidziane — zostaja, bo ich pojawienie sie
  // nie jest zaskoczeniem wymagajacym uwagi czlowieka
  'mikroprzedsiębiorstwo',
  'mikroprzedsiębiorca',
  'średnie przedsiębiorstwo',
  'mały przedsiębiorca',
  'średni przedsiębiorca',
] as const;

// --- slownik gmin --------------------------------------------------------

export type PozycjaGminy = { teryt: string; nazwa: string; koniec: string };

/**
 * Deduplikacja slownika gmin po kodzie TERYT.
 *
 * POWOD. Pierwszy przebieg importu slownika wywalil sie na:
 *     ON CONFLICT DO UPDATE command cannot affect row a second time
 * Postgres odmawia zaktualizowania tego samego wiersza dwa razy w jednej
 * kwerendzie — i ma racje. Przy dwoch roznych nazwach dla jednego kodu nie ma
 * powodu zakladac, ze wygrywa ta, ktora akurat przyszla pozniej w tablicy.
 *
 * Rozstrzygamy po dacie konca obowiazywania (najpozniejsza = aktualna). Gdy dat
 * nie ma, zostaje pierwszy wpis, ale kazdy przypadek ROZNYCH nazw pod jednym
 * kodem trafia do listy `konflikty` — zeby wybor byl widoczny, a nie cichy.
 *
 * ZMIERZONE NA ZYWYM SLOWNIKU: 4 170 pozycji, 4 155 unikalnych kodow,
 * 11 kodow z roznymi nazwami. Wszystkie 11 to ta sama jednostka pod stara
 * i nowa nazwa (Swieta Katarzyna / Siechnice, Stargard Szczecinski / Stargard,
 * Wabrzezno / Rynsk...). To POTWIERDZA, ze `number` jest kodem TERYT — dwie
 * rozne gminy nigdy nie dzielily tu jednego kodu.
 *
 * Slownik nie ma daty obowiazywania, wiec z samego API nie da sie ustalic,
 * ktora nazwa jest dzisiejsza. Dlatego ZADNEJ nie wyrzucamy: odrzucone wracaja
 * w `warianty` i ida do kolumny `sudop_gminy.nazwy_alternatywne`. Dzieki temu
 * wyszukiwanie po "Siechnice" trafi w gmine zapisana jako "Swieta Katarzyna",
 * zamiast nie trafiac w nic.
 */
export function dedupujGminy(surowe: readonly PozycjaGminy[]): {
  wybrane: (PozycjaGminy & { warianty: string[] })[];
  konflikty: string[];
} {
  const wg = new Map<string, PozycjaGminy[]>();
  for (const w of surowe) {
    const lista = wg.get(w.teryt);
    if (lista) lista.push(w);
    else wg.set(w.teryt, [w]);
  }

  const konflikty: string[] = [];
  const wybrane = [...wg.values()].map((grupa) => {
    const wybrany = grupa.length === 1 ? grupa[0]! : [...grupa].sort((a, b) => b.koniec.localeCompare(a.koniec))[0]!;
    if (grupa.length > 1 && new Set(grupa.map((g) => g.nazwa)).size > 1) {
      konflikty.push(
        `  ${wybrany.teryt}: ${grupa.map((g) => `"${g.nazwa}"${g.koniec ? ` (do ${g.koniec})` : ''}`).join(' | ')}  -> "${wybrany.nazwa}"`,
      );
    }
    // Nazwy odrzucone nie gina — ida do `nazwy_alternatywne`, zeby dalo sie
    // znalezc gmine po kazdej nazwie, pod ktora wystepuje w danych o dotacjach.
    const warianty = [...new Set(grupa.map((g) => g.nazwa))].filter((n) => n !== wybrany.nazwa).sort();
    return { ...wybrany, warianty };
  });

  return { wybrane, konflikty };
}

export function nieznaneWielkosci(wiersze: readonly WierszDotacji[]): string[] {
  const znane = new Set<string>(ZNANE_WIELKOSCI);
  const nowe = new Set<string>();
  for (const w of wiersze) if (w.beneficiary_size && !znane.has(w.beneficiary_size)) nowe.add(w.beneficiary_size);
  return [...nowe].sort();
}
