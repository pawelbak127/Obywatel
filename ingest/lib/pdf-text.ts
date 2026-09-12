/**
 * Wyciąganie tekstu z PDF-ów publikowanych przez Sejm i RCL.
 *
 * ---------------------------------------------------------------------
 * PO CO TO ISTNIEJE I DLACZEGO NIE WYSTARCZY PROSTA WERSJA.
 *
 * Pierwsza wersja tego kodu brała po prostu wszystkie ciągi w nawiasach
 * ze strumieni i sklejała je w tekst. Na postanowieniu Prezydenta
 * o powołaniu Rady Ministrów (MP/2023/1383) dało to:
 *
 *     „Pana Krzysztofa Gawkowskiego"        <- przeszlo
 *     „Pana -Kamysza"                       <- mialo byc „Wladyslawa Kosiniaka-Kamysza"
 *     „Ministra Klimatu i"                  <- uciete „i Srodowiska"
 *     „Przewod-"                            <- „Przewodniczacego"
 *
 * Czyli **zniknęły dokładnie polskie znaki** — a razem z nimi połowa nazwisk.
 * Tekst wyglądał na kompletny i nie było w nim śladu, że czegoś brakuje.
 * Dla projektu, który przypisuje ludziom funkcje państwowe, to jest najgorszy
 * możliwy rodzaj błędu: cicha dziura w miejscu, gdzie stoi czyjeś nazwisko.
 *
 * Przyczyna: te PDF-y używają fontów złożonych (`Type0` / `CIDFontType2`),
 * w których bajty w strumieniu NIE SĄ znakami. Są identyfikatorami glifów,
 * a tłumaczenie na Unicode leży w osobnym strumieniu `ToUnicode`.
 *
 * ---------------------------------------------------------------------
 * ZASADA TEGO MODUŁU: nieznany kod jest RAPORTOWANY, nie pomijany.
 *
 * `pdfDoTekstu` zwraca razem z tekstem liczbę kodów, których nie umiała
 * przetłumaczyć, i wstawia w ich miejsce znak zastępczy. Wywołujący ma wtedy
 * czym zmierzyć, czy wynikowi można ufać — zamiast dostać ładny tekst
 * z niewidocznymi dziurami.
 *
 * To ten sam wzorzec co „nieznana wartość słownikowa jest raportowana, nie
 * przerywa importu" (CLAUDE.md §7.2).
 */

import zlib from 'node:zlib';

/** Znak wstawiany w miejsce kodu, którego nie umiemy przetłumaczyć. */
export const ZNAK_NIEZNANY = '�';

export type WynikPdf = {
  tekst: string;
  /** Ile kodów nie dało się przetłumaczyć. Zero znaczy „tekst kompletny". */
  nieznanychKodow: number;
  /** Ile fontów miało mapę ToUnicode, a ile trzeba było czytać bajt po bajcie. */
  fontowZMapa: number;
  fontowBezMapy: number;
};

type Obiekt = { nr: number; dict: string; stream: Buffer | null };

/**
 * Rozbicie pliku na obiekty `N 0 obj … endobj`.
 *
 * Celowo NIE czytamy tablicy xref. Te pliki bywają z niepoprawnymi offsetami
 * po ponownym zapisie, a skanowanie po sygnaturach działa niezależnie od tego,
 * czy xref jest spójny. Kosztuje jeden przebieg po buforze.
 */
function obiekty(buf: Buffer): Map<number, Obiekt> {
  const mapa = new Map<number, Obiekt>();
  const tekst = buf.toString('latin1');
  const re = /(\d+)\s+\d+\s+obj\b/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(tekst)) !== null) {
    const nr = Number(m[1]);
    const start = m.index + m[0].length;
    const koniec = tekst.indexOf('endobj', start);
    if (koniec === -1) continue;

    const ciało = tekst.slice(start, koniec);
    const sPos = ciało.indexOf('stream');
    let dict = ciało;
    let stream: Buffer | null = null;

    if (sPos !== -1) {
      dict = ciało.slice(0, sPos);
      // Po slowie `stream` idzie CRLF albo LF — oba trzeba pominac co do bajtu.
      let od = start + sPos + 6;
      if (buf[od] === 0x0d) od++;
      if (buf[od] === 0x0a) od++;
      const doPos = tekst.indexOf('endstream', od);
      if (doPos !== -1) stream = buf.subarray(od, doPos);
    }

    mapa.set(nr, { nr, dict, stream });
  }
  return mapa;
}

/** Rozpakowanie strumienia, jeśli jest skompresowany. */
function rozpakuj(o: Obiekt): Buffer | null {
  if (!o.stream) return null;
  if (!/FlateDecode/.test(o.dict)) return o.stream;
  try {
    return zlib.inflateSync(o.stream);
  } catch {
    try {
      return zlib.inflateRawSync(o.stream);
    } catch {
      return null;
    }
  }
}

const ref = (dict: string, klucz: string): number | null => {
  const m = new RegExp(`/${klucz}\\s+(\\d+)\\s+\\d+\\s+R`).exec(dict);
  return m ? Number(m[1]) : null;
};

/**
 * Parsowanie CMap-y `ToUnicode`.
 *
 * Format jest prosty i dobrze określony w specyfikacji PDF:
 *
 *     beginbfchar  <0041> <0041>  endbfchar          pojedyncze kody
 *     beginbfrange <0041> <005A> <0041> endbfrange   zakres ciagly
 *     beginbfrange <0041> <0043> [<0041> <0042> <0043>] endbfrange
 *
 * Wartości bywają wielobajtowe (np. ligatura „fi" jako dwa znaki UTF-16),
 * dlatego tłumaczymy na całe łańcuchy, a nie na pojedyncze znaki.
 */
function parsujToUnicode(cmap: string): Map<number, string> {
  const mapa = new Map<number, string>();
  const utf16 = (hex: string): string => {
    let s = '';
    for (let i = 0; i + 3 < hex.length + 1; i += 4) s += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
    return s;
  };

  for (const blok of cmap.match(/beginbfchar([\s\S]*?)endbfchar/g) ?? []) {
    const re = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(blok)) !== null) mapa.set(parseInt(m[1] ?? '0', 16), utf16(m[2] ?? ''));
  }

  for (const blok of cmap.match(/beginbfrange([\s\S]*?)endbfrange/g) ?? []) {
    // Wariant z tablica: <od> <do> [<a> <b> <c>]
    const reTab = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([\s\S]*?)\]/g;
    let m: RegExpExecArray | null;
    while ((m = reTab.exec(blok)) !== null) {
      const od = parseInt(m[1] ?? '0', 16);
      const lista = (m[3] ?? '').match(/<([0-9A-Fa-f]+)>/g) ?? [];
      lista.forEach((h, i) => mapa.set(od + i, utf16(h.slice(1, -1))));
    }
    // Wariant ciagly: <od> <do> <pierwszy>
    const reCiag = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    while ((m = reCiag.exec(blok)) !== null) {
      const od = parseInt(m[1] ?? '0', 16);
      const doK = parseInt(m[2] ?? '0', 16);
      const baza = parseInt(m[3] ?? '0', 16);
      // Zakres bywa deklarowany szeroko; 65 536 to gorna granica rozsadku.
      for (let k = od; k <= doK && k - od < 65_536; k++) {
        if (!mapa.has(k)) mapa.set(k, String.fromCharCode(baza + (k - od)));
      }
    }
  }
  return mapa;
}

/** Nazwy glifów z `/Differences`, ograniczone do tego, co realnie występuje. */
const GLIFY: Record<string, string> = {
  aogonek: 'ą', Aogonek: 'Ą', cacute: 'ć', Cacute: 'Ć', eogonek: 'ę', Eogonek: 'Ę',
  lslash: 'ł', Lslash: 'Ł', nacute: 'ń', Nacute: 'Ń', oacute: 'ó', Oacute: 'Ó',
  sacute: 'ś', Sacute: 'Ś', zacute: 'ź', Zacute: 'Ź', zdotaccent: 'ż', Zdotaccent: 'Ż',
  quotesingle: "'", quotedblleft: '„', quotedblright: '”', endash: '–', emdash: '—',
  space: ' ', hyphen: '-', period: '.', comma: ',', colon: ':', semicolon: ';',
};

function parsujDifferences(enc: string): Map<number, string> {
  const mapa = new Map<number, string>();
  const m = /\/Differences\s*\[([\s\S]*?)\]/.exec(enc);
  if (!m) return mapa;
  let kod = 0;
  for (const tok of (m[1] ?? '').match(/\d+|\/[A-Za-z0-9.]+/g) ?? []) {
    if (tok.startsWith('/')) {
      const nazwa = tok.slice(1);
      const znak = GLIFY[nazwa] ?? (/^uni([0-9A-Fa-f]{4})$/.test(nazwa)
        ? String.fromCharCode(parseInt(nazwa.slice(3), 16))
        : null);
      if (znak) mapa.set(kod, znak);
      kod++;
    } else {
      kod = Number(tok);
    }
  }
  return mapa;
}

type Font = { mapa: Map<number, string>; dwubajtowy: boolean; maMape: boolean };

/** Fonty z zasobów dokumentu, po nazwie zasobu (`/F1`, `/TT2`…). */
function fonty(objs: Map<number, Obiekt>): Map<string, Font> {
  const wynik = new Map<string, Font>();

  for (const o of objs.values()) {
    // Slownik /Font wewnatrz /Resources: << /F1 12 0 R /F2 15 0 R >>
    const blok = /\/Font\s*<<([\s\S]*?)>>/.exec(o.dict);
    if (!blok) continue;

    const re = /\/([A-Za-z0-9.+-]+)\s+(\d+)\s+\d+\s+R/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(blok[1] ?? '')) !== null) {
      const nazwa = m[1];
      const fo = m[2] ? objs.get(Number(m[2])) : undefined;
      if (!nazwa || !fo) continue;

      const dwubajtowy = /\/Subtype\s*\/Type0/.test(fo.dict);
      const nrCmap = ref(fo.dict, 'ToUnicode');
      let mapa = new Map<number, string>();
      let maMape = false;

      if (nrCmap !== null) {
        const co = objs.get(nrCmap);
        const rozp = co ? rozpakuj(co) : null;
        if (rozp) {
          mapa = parsujToUnicode(rozp.toString('latin1'));
          maMape = mapa.size > 0;
        }
      }
      if (!maMape) {
        const nrEnc = ref(fo.dict, 'Encoding');
        const enc = nrEnc !== null ? objs.get(nrEnc)?.dict : fo.dict;
        if (enc) mapa = parsujDifferences(enc);
      }

      /*
        NAZWA ZASOBU (`/F1`, `/TT2`) JEST LOKALNA DLA STRONY, NIE DLA PLIKU.

        Ten sam `/F1` na stronie 1 i na stronie 2 to zwykle DWA ROZNE fonty,
        kazdy z wlasnym podzbiorem glifow. Pierwsza wersja brala pierwszy
        napotkany i ignorowala reszte — skutkiem byla jedna litera („y")
        znikajaca z calego dokumentu, bo jej kod siedzial w mapie fontu,
        ktory zostal odrzucony jako „juz mamy taka nazwe".

        Scalamy wiec mapy o tej samej nazwie, UZUPELNIAJAC luki i nie
        nadpisujac tego, co juz jest. To nie jest rozwiazanie doskonale —
        prawidlowe wymagaloby wiazania strumienia tresci z /Resources jego
        wlasnej strony — ale jest bezpieczne w jedna strone: moze dolozyc
        brakujacy glif, nie moze podmienic poprawnie odczytanego.

        Gdyby dwa fonty uzywaly tego samego kodu dla ROZNYCH znakow, wygra
        pierwszy — czyli dokladnie to, co bylo przedtem. Licznik nieznanych
        kodow i tak pokaze, gdy cos sie nie spina.
      */
      const juz = wynik.get(nazwa);
      if (juz) {
        for (const [k, v] of mapa) if (!juz.mapa.has(k)) juz.mapa.set(k, v);
        if (maMape) juz.maMape = true;
        continue;
      }
      wynik.set(nazwa, { mapa, dwubajtowy, maMape });
    }
  }
  return wynik;
}

/** Zamiana ciągu z operatora tekstowego na znaki, wg mapy aktywnego fontu. */
function dekodujCiag(surowy: string, font: Font | undefined, licznik: { nieznane: number }): string {
  const bajty: number[] = [];
  for (let i = 0; i < surowy.length; i++) {
    const z = surowy[i]!;
    if (z === '\\') {
      const nast = surowy[i + 1] ?? '';
      const okt = /^[0-7]{1,3}/.exec(surowy.slice(i + 1));
      if (okt) {
        bajty.push(parseInt(okt[0], 8));
        i += okt[0].length;
      } else {
        const ucieczki: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12 };
        bajty.push(ucieczki[nast] ?? nast.charCodeAt(0));
        i++;
      }
    } else {
      bajty.push(z.charCodeAt(0) & 0xff);
    }
  }

  if (!font) return bajty.map((b) => String.fromCharCode(b)).join('');

  let out = '';
  const krok = font.dwubajtowy ? 2 : 1;
  for (let i = 0; i < bajty.length; i += krok) {
    const kod = krok === 2 ? ((bajty[i]! << 8) | (bajty[i + 1] ?? 0)) : bajty[i]!;
    const znak = font.mapa.get(kod);
    if (znak !== undefined) {
      out += znak;
    } else if (!font.dwubajtowy && kod >= 32 && kod < 127) {
      // Font prosty bez wpisu w Differences: kody ASCII znacza same siebie.
      out += String.fromCharCode(kod);
    } else {
      licznik.nieznane++;
      out += ZNAK_NIEZNANY;
    }
  }
  return out;
}

/**
 * Tekst z PDF-a.
 *
 * Przechodzimy strumienie treści operator po operatorze, pilnując aktywnego
 * fontu (`/F1 12 Tf`), bo to on rozstrzyga, jak czytać bajty w `(…)` i `<…>`.
 * Bez tego wszystkie fonty czytałoby się jednym kodowaniem — i właśnie stąd
 * brały się zniknięte polskie znaki w pierwszej wersji.
 */
export function pdfDoTekstu(buf: Buffer): WynikPdf {
  const objs = obiekty(buf);
  const fnt = fonty(objs);
  const licznik = { nieznane: 0 };
  const kawalki: string[] = [];

  for (const o of objs.values()) {
    const rozp = rozpakuj(o);
    if (!rozp) continue;
    const tresc = rozp.toString('latin1');
    // Strumien tresci poznajemy po operatorze BT — inaczej trafilibysmy
    // na fonty, obrazy i metadane.
    if (!/\bBT\b/.test(tresc)) continue;

    let aktywny: Font | undefined;
    /*
      CIAG SZESNASTKOWY LAPIEMY BEZ WZGLEDU NA TO, CO PO NIM STOI.

      Pierwsza wersja wymagala `<hex> Tj` — i to byl blad, ktory kosztowal
      drugie podejscie. Fonty zlozone (Type0) emituja tekst niemal wylacznie
      w tablicach `[<00A5> -10 <00B3>] TJ`, gdzie po ciagu idzie liczba
      kerningu, a nie operator. Przez ten jeden warunek CALY tekst pisany
      polskim fontem byl pomijany — i, co gorsza, licznik nieznanych kodow
      pokazywal ZERO, bo te bajty nigdy nie trafialy do dekodera.

      Czyli druga cicha dziura w tym samym miejscu: tekst wygladal na
      kompletny, a miernik jakosci twierdzil, ze jest dobrze.
    */
    const re = /\/([A-Za-z0-9.+-]+)\s+[\d.]+\s+Tf|\(((?:\\.|[^\\()])*)\)|<([0-9A-Fa-f][0-9A-Fa-f\s]*)>|\bET\b|\bT\*\b/g;
    let m: RegExpExecArray | null;
    let strona = '';

    while ((m = re.exec(tresc)) !== null) {
      if (m[1] !== undefined) {
        aktywny = fnt.get(m[1]);
      } else if (m[2] !== undefined) {
        strona += dekodujCiag(m[2], aktywny, licznik);
      } else if (m[3] !== undefined) {
        const hex = m[3].replace(/\s+/g, '');
        const bajty: string[] = [];
        for (let i = 0; i < hex.length; i += 2) bajty.push(String.fromCharCode(parseInt(hex.slice(i, i + 2), 16)));
        strona += dekodujCiag(bajty.join(''), aktywny, licznik);
      } else if (m[0] === 'T*') {
        strona += '\n';
      }
    }
    if (strona.trim()) kawalki.push(strona);
  }

  const tekst = kawalki
    .join('\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  let zMapa = 0;
  let bezMapy = 0;
  for (const f of fnt.values()) (f.maMape ? zMapa++ : bezMapy++);

  return { tekst, nieznanychKodow: licznik.nieznane, fontowZMapa: zMapa, fontowBezMapy: bezMapy };
}
