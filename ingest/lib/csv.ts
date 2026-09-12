/**
 * Parser CSV dla eksportow z rejestrow panstwowych.
 *
 * Nie uzywamy biblioteki z npm z dwoch powodow. Pierwszy: dodatkowa zaleznosc
 * w warstwie, ktora czyta dane wchodzace do bazy, to dodatkowa powierzchnia
 * zaufania. Drugi wazniejszy: i tak musimy sami sterowac dekodowaniem bajtow,
 * bo pliki z UOKiK nie sa w UTF-8, a wiekszosc parserow przyjmuje juz string.
 *
 * KODOWANIE. Zmierzone na prawdziwym eksporcie SUDOP (`przypadki_pomocy.csv`):
 * bajt 0xB9 w slowie "udzielajacy". W CP1250 (Windows-1250) 0xB9 to `a-ogonek`,
 * w ISO-8859-2 to `a-ogonek` pod innym kodem (0xB1). Plik jest wiec w CP1250,
 * bez BOM. `TextDecoder('windows-1250')` obsluguje to w Node natywnie (pelne ICU),
 * wiec zero zaleznosci.
 *
 * Zgadywanie kodowania jest w tym projekcie zabronione — patrz `wykryjKodowanie`.
 * Jesli plik przyjdzie w UTF-8 (bo UOKiK cos zmieni), poznamy to po BOM albo po
 * poprawnym dekodowaniu, a nie po tym, ze "wyglada dobrze".
 */

/** Kodowania, ktore realnie wystepuja w polskich eksportach urzedowych. */
export type Kodowanie = 'utf-8' | 'windows-1250';

export type WynikCsv = {
  naglowki: string[];
  wiersze: string[][];
  /** Wykryte kodowanie — trafia do logu importu, zeby dalo sie je odtworzyc. */
  kodowanie: Kodowanie;
  /** Liczba wierszy danych w pliku (bez naglowka). Do kontroli sum. */
  wierszyWPliku: number;
};

/**
 * Wykrywa kodowanie na podstawie bajtow, nie na podstawie wygladu tekstu.
 *
 * Kolejnosc: BOM (jednoznaczny) -> proba scislego UTF-8 -> CP1250.
 * Scisly dekoder UTF-8 rzuca na nieprawidlowej sekwencji, a bajty z zakresu
 * 0x80-0xBF (polskie znaki w CP1250) prawie zawsze taka sekwencje tworza.
 */
export function wykryjKodowanie(bajty: Buffer): Kodowanie {
  if (bajty.length >= 3 && bajty[0] === 0xef && bajty[1] === 0xbb && bajty[2] === 0xbf) return 'utf-8';
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bajty);
    return 'utf-8';
  } catch {
    return 'windows-1250';
  }
}

export function dekoduj(bajty: Buffer, kodowanie: Kodowanie): string {
  // BOM nie trzeba zdejmowac recznie — TextDecoder (ignoreBOM domyslnie false)
  // robi to sam przy dekodowaniu. Sprawdzone na bajtach EF BB BF: w galezi
  // 'utf-8' decoder zwraca tekst juz bez BOM, w galezi 'windows-1250' te same
  // bajty i tak nigdy nie trafiaja tutaj z BOM (wykryjKodowanie lapie BOM
  // pierwsze i zwraca 'utf-8'), a gdyby trafily, dekoduja sie na trzy inne
  // znaki, zaden nie jest U+FEFF.
  return new TextDecoder(kodowanie).decode(bajty);
}

/**
 * Parser CSV — pelny automat stanowy, nie `split(';')`.
 *
 * `split` wystarczylby dla wiersza, ktory dostalismy na probke, ale nazwy firm
 * zawieraja srednik ("Jan Kowalski; Wspolnicy sp. j." to legalna nazwa w KRS),
 * a nazwy ustaw zawieraja przecinki i cudzyslowy. Pierwszy taki wiersz przesunalby
 * wszystkie kolumny o jedna pozycje i wpisal NIP do pola z nazwa organu.
 *
 * Obsluguje: cudzyslowy, podwojony cudzyslow jako znak ucieczki, znaki nowej linii
 * wewnatrz pola, CRLF i LF.
 */
export function parsujCsv(tekst: string, separator = ';'): string[][] {
  const wiersze: string[][] = [];
  let pole = '';
  let wiersz: string[] = [];
  let wCudzyslowie = false;

  for (let i = 0; i < tekst.length; i++) {
    const z = tekst[i];

    if (wCudzyslowie) {
      if (z === '"') {
        if (tekst[i + 1] === '"') { pole += '"'; i++; }  // "" -> "
        else wCudzyslowie = false;
      } else pole += z;
      continue;
    }

    if (z === '"') { wCudzyslowie = true; continue; }
    if (z === separator) { wiersz.push(pole); pole = ''; continue; }
    if (z === '\r') { if (tekst[i + 1] === '\n') i++; wiersz.push(pole); wiersze.push(wiersz); wiersz = []; pole = ''; continue; }
    if (z === '\n') { wiersz.push(pole); wiersze.push(wiersz); wiersz = []; pole = ''; continue; }
    pole += z;
  }

  if (pole !== '' || wiersz.length) { wiersz.push(pole); wiersze.push(wiersz); }
  // Ostatnia linia pliku to zwykle sam CRLF — usuwamy pusty wiersz, ale tylko taki.
  return wiersze.filter((w) => !(w.length === 1 && (w[0] ?? '').trim() === ''));
}

export function wczytajCsv(bajty: Buffer, separator = ';'): WynikCsv {
  const kodowanie = wykryjKodowanie(bajty);
  const tekst = dekoduj(bajty, kodowanie);
  const [naglowki, ...wiersze] = parsujCsv(tekst, separator);
  if (!naglowki) throw new Error('Plik CSV jest pusty — nie ma nawet wiersza naglowka.');
  return {
    naglowki: naglowki.map((n) => n.trim()),
    wiersze,
    kodowanie,
    wierszyWPliku: wiersze.length,
  };
}
