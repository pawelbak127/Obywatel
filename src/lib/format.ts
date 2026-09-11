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
