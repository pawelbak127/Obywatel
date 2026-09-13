/**
 * Formatowanie na potrzeby interfejsu. Bez zaleznosci, bez dostepu do bazy.
 *
 * DLACZEGO OSOBNY PLIK, A NIE FUNKCJA W page.tsx.
 * Next.js App Router dopuszcza w pliku `page.tsx` tylko ustalony zestaw
 * eksportow (`default`, `metadata`, `revalidate`, `generateStaticParams`…).
 * Kazdy inny eksport wywala generowana kontrole typow:
 *
 *   Property 'polskieDaty' is incompatible with index signature.
 *   Type '(tekst: string) => string' is not assignable to type 'never'.
 *
 * Blad wskazuje na `.next/types/...`, wiec wyglada jak usterka frameworka,
 * a jest zwyklym naruszeniem kontraktu pliku strony.
 */

/**
 * Daty w bazie i w widokach sa w ISO (2023-12-13) — tak sie je sortuje
 * i porownuje. Czytelnikowi pokazujemy 13.12.2023, tak samo jak w naglowku
 * profilu. Zamiana jest wylacznie prezentacyjna i nie wraca do bazy.
 *
 * Dziala na calym zdaniu, bo `funkcje_panstwowe` przychodzi jako gotowy tekst
 * zlozony w SQL: "Prezes Rady Ministrow (od 2023-12-13)".
 */
export function polskieDaty(tekst: string): string {
  return tekst.replace(/(\d{4})-(\d{2})-(\d{2})/g, '$3.$2.$1');
}

/**
 * Inicjały do zastępczego portretu — dla posłów, u których Sejm API nie ma
 * zdjęcia (migracja 0018 sprawdza to HEAD-em przy imporcie).
 *
 * Nie jest to `full_name.slice(0, 2)`. Polskie nazwiska bywają dwuczłonowe
 * („Kosiniak-Kamysz"), a imiona złożone („Anna Maria"), więc bierzemy pierwszą
 * literę pierwszego członu i pierwszą literę OSTATNIEGO. Wielkie litery
 * podnosimy z locale, bo `toUpperCase()` bez niego psuje część alfabetów.
 */
export function inicjaly(pelneImie: string): string {
  const czlony = pelneImie
    .split(/[\s ]+/)
    .map((c) => c.replace(/^[^\p{L}]+/u, ''))
    .filter(Boolean);

  if (czlony.length === 0) return '?';

  const pierwszy = czlony[0]!;
  const ostatni = czlony[czlony.length - 1]!;
  const litery = czlony.length === 1 ? pierwszy.slice(0, 1) : pierwszy.slice(0, 1) + ostatni.slice(0, 1);
  return litery.toLocaleUpperCase('pl-PL');
}

/**
 * Liczba w zapisie polskim (przecinek dziesiętny) albo półpauza.
 *
 * Półpauza, a nie „0" i nie „brak danych": w kolumnie liczb zero czyta się jako
 * „zmierzyliśmy zero", a półpauza jako „nie mamy tej wartości". To są dwie różne
 * informacje i mylenie ich jest w tym serwisie błędem merytorycznym, nie
 * literówką.
 */
export function procent(n: number | null | undefined, miejsc = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toFixed(miejsc).replace('.', ',');
}

/**
 * Skala paska dla metryki o wąskim zakresie.
 *
 * Niezgodność z klubem mieści się w praktyce między 0 a 34% (pomiar na pełnej
 * bazie). Pasek rysowany od 0 do 100 dałby 499 niemal identycznych kresek —
 * czyli wykres, z którego nic nie wynika. Rysowanie „od najmniejszej do
 * największej wartości" jest jednak przeciwnym błędem: rozciąga półtora punktu
 * różnicy na całą szerokość i sugeruje przepaść, której nie ma.
 *
 * Kompromis: skala ZAWSZE zaczyna się od zera (inaczej długość paska przestaje
 * być proporcjonalna do wartości), a kończy na wartości zaokrąglonej w górę do
 * dziesiątki ponad maksimum. Górna granica jest podpisana w interfejsie —
 * wykres bez opisanej skali to wykres, któremu nie wolno ufać.
 */
export function skalaDo(wartosci: readonly (number | null)[], minimum = 10): number {
  const max = wartosci.reduce<number>((a, v) => (v !== null && v > a ? v : a), 0);
  return Math.max(minimum, Math.ceil(max / 10) * 10);
}

/**
 * Odmiana rzeczownika po liczbie — polska, czyli trzyformowa.
 *
 * POWSTALO Z BLEDU. Pierwsza wersja licznika na /poslowie miala warunek
 * `n < 5 ? 'poslow' : 'poslow'` i pisala „2 poslow" zamiast „2 poslowie".
 * Reguly nie da sie zalatwic progiem, bo zalezy ona od OSTATNIEJ CYFRY,
 * z wyjatkiem nastolatek:
 *
 *   1                      -> posel
 *   2, 3, 4, 22, 23, 104   -> poslowie
 *   0, 5..21, 25, 112..114 -> poslow
 *
 * Pulapka siedzi w 12, 13, 14: koncza sie na 2, 3, 4, a biora forme trzecia.
 * Dlatego wyjatek na reszte z dzielenia przez 100.
 *
 * Serwis, ktory prosi czytelnika o zaufanie do liczb, nie moze sie przy
 * liczbach myslic w gramatyce — to pierwsza rzecz, ktora widac golym okiem.
 */
export function odmien(n: number, formy: readonly [string, string, string]): string {
  const abs = Math.abs(Math.trunc(n));
  if (abs === 1) return formy[0];

  const dziesiatki = abs % 100;
  if (dziesiatki >= 12 && dziesiatki <= 14) return formy[2];

  const jednosci = abs % 10;
  return jednosci >= 2 && jednosci <= 4 ? formy[1] : formy[2];
}

/**
 * Skrot klubu do WYSWIETLENIA. W bazie `clubs.id` jest kluczem i zostaje
 * nietkniety — tu zamieniamy tylko podkreslenie na spacje.
 *
 * Rejestr Sejmu zapisuje kod Kola Poselskiego Konfederacji Korony Polskiej
 * jako `Konfederacja_KP`. Podkreslenie jest znakiem technicznym: w naglowku
 * strony klubu i w kazdym wierszu listy czytalo sie jak niedokonczony import,
 * a nie jak nazwa. Klucz musi zostac, bo stoi w adresach i w `mps.club_seq`.
 */
export function skrotKlubu(id: string): string {
  return id.replace(/_/g, ' ');
}
