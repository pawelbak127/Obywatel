import type { Metadata } from 'next';
import Link from 'next/link';
import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import { publicEnv } from '@/lib/env';
import './globals.css';

/*
  FONT, KTORY SERWIS DEKLAROWAL I KTOREGO NIKT NIGDY NIE ZOBACZYL.

  `globals.css` od poczatku ustawialo `--font-sans: "IBM Plex Sans", …`,
  ale nic tego kroju nie wczytywalo: zero `@font-face` w skompilowanym CSS,
  zero `next/font`, zero `<link>` do jakiegokolwiek serwisu z fontami
  (zmierzone 13.09.2026). IBM Plex nie jest fontem systemowym na Windows,
  macOS, iOS ani Androidzie, wiec kazdy czytelnik widzial pierwszy krok
  rezerwowy — `system-ui`, czyli Segoe UI, i Consolas dla monospace.

  Cala tozsamosc typograficzna projektu niosl wiec domyslny font systemu,
  ktorego nikt nie wybral. To byla pojedyncza najwieksza przyczyna wrazenia,
  ze serwis wyglada staro.

  DLACZEGO `next/font/google`, A NIE `<link>` DO GOOGLE FONTS:
    - plik pobiera sie NA BUILDZIE i jest serwowany z naszej domeny, wiec
      przegladarka czytelnika nie wysyla ani jednego zadania do Google —
      znika zarowno opoznienie, jak i pytanie o dane osobowe;
    - Next sam dokleja `preload` i `font-display: swap`;
    - zero JavaScriptu po stronie klienta (§2);
    - `next` jest juz zaleznoscia, wiec nie dokladamy ani jednej nowej.

  `latin-ext` JEST OBOWIAZKOWY. Podzbior `latin` nie zawiera ą, ć, ę, ł, ń,
  ó, ś, ź, ż — bez niego polskie znaki spadalyby na font zastepczy i kazde
  nazwisko lamaloby sie wizualnie w polowie.

  Grubosci ograniczone do tych, ktorych kod naprawde uzywa (400/500/600 dla
  tekstu, 400/500 dla monospace) — kazda dodatkowa to osobny plik do pobrania.
*/
const plexSans = IBM_Plex_Sans({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600'],
  display: 'swap',
  variable: '--font-plex-sans',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-plex-mono',
});

export const metadata: Metadata = {
  metadataBase: new URL(publicEnv.siteUrl),
  title: {
    default: 'Obywatel 2.0',
    template: '%s · Obywatel 2.0',
  },
  description:
    'Niezależna platforma obywatelska. Głosowania, obietnice i pieniądze publiczne — zawsze z linkiem do oficjalnego źródła.',
  robots: { index: false, follow: false }, // zdjac przed premiera (Sprint 5)
};

/**
 * NAWIGACJA GLOBALNA.
 *
 * Do tej pory kazda strona byla wyspa: z profilu posla wracalo sie tylko
 * linkiem "wszyscy poslowie", a ze strony glownej nie dalo sie nigdzie wrocic.
 * Czytelnik, ktory trafi z wyszukiwarki wprost na profil, nie mial jak
 * dowiedziec sie, czym w ogole jest ten serwis.
 *
 * Jeden pasek u gory, ten sam wszedzie, bez menu rozwijanych i bez JavaScriptu.
 *
 * SZEROKOSC max-w-6xl — TAKA SAMA JAK KAZDA STRONA. To sie zmienilo
 * 12.09.2026 i warto wiedziec dlaczego, bo poprzednia wersja tego komentarza
 * bronila stanu odwrotnego.
 *
 * Bylo tak: naglowek i /poslowie mialy max-w-6xl, a strona glowna, profil,
 * /status i /zglos — max-w-3xl. Komentarz twierdzil, ze szeroki naglowek nad
 * waska trescia „da sie odroznic od bledu renderowania, to zwykly uklad
 * wiekszosci serwisow".
 *
 * Nie dalo sie. Przy oknie 1900 px naglowek zaczynal sie 374 px od lewej,
 * a tresc strony glownej 566 px — 192 px rozjazdu. Taka roznica nie czyta sie
 * jako zamierzony waski lam (ten robi sie widoczny dopiero, gdy jest duzo
 * wiekszy i tresc stoi na srodku), tylko jako dwie krawedzie, ktore mialy sie
 * pokryc i nie pokryly.
 *
 * ZASADA, KTORA Z TEGO ZOSTAJE: szerokosc KONTENERA jest stala dla calego
 * serwisu, a komfort czytania to wlasnosc BLOKU TEKSTU (`max-w-prose`),
 * nie calej strony. Dzieki temu akapit ma swoje 65 znakow w wierszu, a tabela
 * szescdziesieciu wierszy dostaje miejsce, ktorego potrzebuje — i nic nie
 * musi wiedziec, na ktorej stronie stoi.
 */
function Naglowek() {
  return (
    <header className="border-b border-[color:var(--color-rule)]">
      {/*
        ODSTEP JEST NA ODNOSNIKACH, NIE NA <nav>. Wczesniej `py-3` siedzialo
        na kontenerze, wiec sam odnosnik mial wysokosc litery — okolo 16 px.
        Minimum WCAG 2.2 (SC 2.5.8) to 24 px, zalecenie producentow telefonow
        44 px. Na kontenerze zostaje `py-1`, reszta przechodzi na `<a>`.
      */}
      <nav className="mx-auto flex max-w-6xl flex-wrap items-baseline gap-x-1 gap-y-1 px-5 py-1">
        <Link href="/" className="px-1 py-2.5 font-semibold tracking-tight hover:text-[color:var(--color-accent)]">
          Obywatel<span className="text-[color:var(--color-accent)]">&nbsp;2.0</span>
        </Link>
        {/*
          TRZY ODNOSNIKI, NIE JEDEN. Do 13.09.2026 nawigacja miala wylacznie
          „poslowie" — serwis miał wtedy cztery trasy, wiec bylo to obronne.
          Dzis ma osiem i dwie z nich (okregi, kluby) byly osiagalne WYLACZNIE
          przez nazwisko posla: zeby dojsc do klubu, trzeba bylo znac kogos
          z klubu.

          Nie dokladamy tu `/status` ani `/zglos` — te nalezą do stopki
          (uzasadnienie nizej) i doklejone tutaj konkurowalyby o miejsce
          z trescia serwisu.
        */}
        {[
          ['/poslowie', 'posłowie'],
          ['/okreg', 'okręgi'],
          ['/kluby', 'kluby'],
          ['/komisje', 'komisje'],
        ].map(([adres, podpis]) => (
          <Link
            key={adres}
            href={adres!}
            className="rounded px-2 py-2.5 text-xs text-[color:var(--color-ink-soft)] hover:text-[color:var(--color-accent)]"
          >
            {podpis}
          </Link>
        ))}
      </nav>
    </header>
  );
}

function Stopka() {
  return (
    <footer className="mt-16 border-t border-[color:var(--color-rule)]">
      {/* max-w-6xl jak w Naglowku - uzasadnienie w komentarzu nad Naglowkiem */}
      <div className="mx-auto max-w-6xl px-6 py-6 text-xs leading-relaxed text-[color:var(--color-ink-soft)]">
        Dane pochodzą z API Kancelarii Sejmu i innych oficjalnych rejestrów państwowych.
        Serwis nie jest powiązany z żadną instytucją publiczną ani partią.{' '}
        {/*
          LINK PRZENIESIONY Z NAWIGACJI DO STOPKI (12.09.2026).

          W glownej nawigacji stal na rowni z „poslowie", czyli narzedzie
          diagnostyczne konkurowalo o miejsce z trescia serwisu. Odnosnik
          o pochodzeniu danych nalezy do stopki — tam sie go szuka i tam
          sasiaduje ze zdaniem o zrodlach, ktore mowi to samo jednym zdaniem.

          NIE ukrywamy go. Dla serwisu, ktorego produktem jest wiarygodnosc,
          publiczna strona o stanie i swiezosci danych jest atutem — to
          odpowiednik <SourceLink> na poziomie calego serwisu. Zmienia sie
          miejsce i jezyk, nie dostepnosc.
        */}
        <Link
          href="/status"
          className="underline decoration-dotted underline-offset-2 hover:text-[color:var(--color-accent)]"
        >
          Skąd pochodzą dane i kiedy je pobraliśmy
        </Link>
        .{' '}
        {/*
          Odnosnik do formularza stoi w stopce KAZDEJ strony, nie tylko profilu.
          Blad, ktory czytelnik zauwaza, i strona, na ktorej go zauwaza, to nie
          zawsze to samo miejsce — a droga odwolawcza, ktorej trzeba szukac,
          jest droga odwolawcza tylko z nazwy.
        */}
        <Link
          href="/zglos"
          className="underline decoration-dotted underline-offset-2 hover:text-[color:var(--color-accent)]"
        >
          Zgłoś błąd w danych
        </Link>
        .
      </div>
    </footer>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body className="flex min-h-screen flex-col antialiased">
        <Naglowek />
        <div className="flex-1">{children}</div>
        <Stopka />
      </body>
    </html>
  );
}
