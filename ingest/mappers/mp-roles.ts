/**
 * Mapper funkcji panstwowych poslow (`mp_roles`).
 *
 * PO CO TA TABELA. Ranking obecnosci postawil obok siebie posla, ktory nie
 * przychodzi do pracy, i urzedujacego Prezesa Rady Ministrow. Obie liczby sa
 * poprawne, powody krancowo rozne, a Sejm API nie podaje powodu (decyzja D11).
 * `mp_roles` jest jedynym miejscem, w ktorym wolno nam dopisac powod — i tylko
 * wtedy, gdy jest udokumentowany.
 *
 * DLACZEGO KONTROLA JEST TAK OSTRA. To jest najbardziej zapalne pole w calym
 * projekcie. Wpis "minister od marca 2024" bez linku do powolania to nasza
 * wlasna narracja podpieta pod czyjes nazwisko. Dlatego:
 *
 *   - zrodlo jest WYMAGANE i musi byc https,
 *   - host zrodla musi byc oficjalnym rejestrem panstwowym (lista nizej),
 *   - nazwisko w pliku musi zgadzac sie z nazwiskiem w bazie, inaczej import
 *     przerywa — chroni przed wpisaniem funkcji nie temu poslowi,
 *   - daty musza istniec w kalendarzu i miec sens (koniec nie przed poczatkiem).
 *
 * Zadnej z tych kontroli nie da sie wylaczyc flaga. Jesli kiedys bedzie trzeba
 * dopuscic inne zrodlo, trzeba to dopisac do kodu i uzasadnic w code review.
 */

export const NAGLOWKI_ROL = [
  'slug',
  'imie_nazwisko',
  'funkcja',
  'rodzaj',
  'od',
  'do',
  'zrodlo_url',
] as const;

/** Rodzaje funkcji — te same wartosci, co w kolumnie `mp_roles.role_kind`. */
export const RODZAJE = ['rzad', 'prezydium_sejmu', 'ue', 'inne'] as const;
export type Rodzaj = (typeof RODZAJE)[number];

/**
 * Hosty uznawane za oficjalny rejestr panstwowy.
 *
 * Wikipedia, portal informacyjny ani strona partii nie sa zrodlem powolania.
 * Moga byc pomocne przy szukaniu, ale do bazy trafia link do dokumentu.
 */
export const OFICJALNE_HOSTY = [
  'monitorpolski.gov.pl',
  'dziennikustaw.gov.pl',
  'isap.sejm.gov.pl',
  'api.sejm.gov.pl',
  'sejm.gov.pl',
  'senat.gov.pl',
  'prezydent.pl',
  'premier.gov.pl',
  'gov.pl',
  'europarl.europa.eu',
  'pkw.gov.pl',
  'nbp.pl',
  'nik.gov.pl',
  'brpo.gov.pl',
] as const;

export type WierszRoli = {
  slug: string;
  imie_nazwisko: string;
  role_name: string;
  role_kind: Rodzaj;
  date_from: string;
  date_to: string | null;
  zrodlo_url: string;
};

export function sprawdzNaglowekRol(naglowki: string[]): void {
  const ok = naglowki.length === NAGLOWKI_ROL.length && NAGLOWKI_ROL.every((n, i) => naglowki[i] === n);
  if (!ok) {
    throw new Error(
      [
        '',
        'NAGLOWEK PLIKU Z FUNKCJAMI NIE ZGADZA SIE — nic nie zapisano.',
        '',
        `Oczekiwane: ${NAGLOWKI_ROL.join(';')}`,
        `Otrzymane:  ${naglowki.join(';')}`,
        '',
        'Wzor: data/mp-roles.example.csv',
        '',
      ].join('\n'),
    );
  }
}

export function parsujDateIso(s: string, pole: string): string {
  const t = s.trim();
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`${pole}: oczekiwana data RRRR-MM-DD, otrzymano ${JSON.stringify(s)}`);
  const d = new Date(`${t}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t) {
    throw new Error(`${pole}: data nie istnieje w kalendarzu — ${JSON.stringify(s)}`);
  }
  return t;
}

/** Zrodlo musi byc https i pochodzic z oficjalnego rejestru. */
export function sprawdzZrodlo(url: string): void {
  const t = url.trim();
  if (!t) {
    throw new Error(
      'Brak zrodla. Funkcja panstwowa bez linku do dokumentu powolania nie moze trafic do bazy ' +
        '(decyzja D12) — tak samo jak kwota z oswiadczenia majatkowego bez skanu.',
    );
  }
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    throw new Error(`Zrodlo nie jest poprawnym adresem: ${JSON.stringify(url)}`);
  }
  if (u.protocol !== 'https:') throw new Error(`Zrodlo musi byc https: ${t}`);

  const host = u.hostname.toLowerCase();
  const oficjalne = OFICJALNE_HOSTY.some((h) => host === h || host.endsWith(`.${h}`));
  if (!oficjalne) {
    throw new Error(
      [
        `Zrodlo spoza oficjalnych rejestrow: ${host}`,
        '',
        'Dopuszczalne hosty:',
        ...OFICJALNE_HOSTY.map((h) => `  ${h}`),
        '',
        'Encyklopedia, portal informacyjny ani strona partii nie sa dokumentem powolania.',
        'Moga pomoc w znalezieniu dokumentu — do bazy trafia link do dokumentu.',
      ].join('\n'),
    );
  }
}

export function mapujRole(kolumny: string[], nr: number): WierszRoli {
  if (kolumny.length !== NAGLOWKI_ROL.length) {
    throw new Error(`wiersz ${nr}: ${kolumny.length} kolumn zamiast ${NAGLOWKI_ROL.length}`);
  }
  const k = (i: number) => (kolumny[i] ?? '').trim();

  const slug = k(0);
  const imie = k(1);
  const funkcja = k(2);
  const rodzaj = k(3);

  if (!slug) throw new Error(`wiersz ${nr}: pusty slug`);
  if (!imie) throw new Error(`wiersz ${nr}: puste imie i nazwisko (sluzy do kontroli, nie da sie pominac)`);
  if (!funkcja) throw new Error(`wiersz ${nr}: pusta nazwa funkcji`);
  if (!(RODZAJE as readonly string[]).includes(rodzaj)) {
    throw new Error(`wiersz ${nr}: rodzaj "${rodzaj}" spoza listy ${RODZAJE.join(', ')}`);
  }

  const date_from = parsujDateIso(k(4), `wiersz ${nr}, kolumna "od"`);
  const date_to = k(5) ? parsujDateIso(k(5), `wiersz ${nr}, kolumna "do"`) : null;
  if (date_to && date_to < date_from) {
    throw new Error(`wiersz ${nr}: koniec funkcji (${date_to}) przed jej poczatkiem (${date_from})`);
  }

  try {
    sprawdzZrodlo(k(6));
  } catch (e) {
    throw new Error(`wiersz ${nr}: ${(e as Error).message}`);
  }

  return {
    slug,
    imie_nazwisko: imie,
    role_name: funkcja,
    role_kind: rodzaj as Rodzaj,
    date_from,
    date_to,
    zrodlo_url: k(6).trim(),
  };
}

/**
 * Kontrola spojnosci z baza: slug musi istniec, a nazwisko sie zgadzac.
 *
 * Porownanie jest odporne na wielkosc liter i podwojne spacje, ale NIE na
 * inne nazwisko. Wpisanie funkcji ministra nie temu poslowi, co trzeba, to blad,
 * ktorego zaden test jednostkowy nie zlapie, a ktory zobaczy kazdy czytelnik.
 */
export function niezgodneNazwiska(
  wiersze: readonly WierszRoli[],
  wBazie: ReadonlyMap<string, string>,
): string[] {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const problemy: string[] = [];
  for (const w of wiersze) {
    const nazwa = wBazie.get(w.slug);
    if (nazwa === undefined) {
      problemy.push(`  ${w.slug}: nie ma takiego posla w bazie`);
    } else if (norm(nazwa) !== norm(w.imie_nazwisko)) {
      problemy.push(`  ${w.slug}: w pliku "${w.imie_nazwisko}", w bazie "${nazwa}"`);
    }
  }
  return problemy;
}
