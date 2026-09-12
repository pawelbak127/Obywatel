import type { Metadata } from 'next';
import Link from 'next/link';
import { publicEnv } from '@/lib/env';
import './globals.css';

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
 * Szerokosc max-w-6xl, nie max-w-3xl: layout nie wie, na ktorej stronie stoi,
 * a najszersza tresc w serwisie (/poslowie) ma max-w-6xl. Waskiego naglowka
 * nad szeroka trescia nie da sie odroznic od bledu renderowania; szerokiego
 * naglowka nad waska trescia (np. profil posla) - da sie, to zwykly uklad
 * wiekszosci serwisow. Odrzucona alternatywa: osobna szerokosc per strona -
 * wymagalaby przekazywania propsa przez kazdy layout, ktorego dzis nie ma.
 */
function Naglowek() {
  return (
    <header className="border-b border-[color:var(--color-rule)]">
      <nav className="mx-auto flex max-w-6xl items-baseline gap-5 px-6 py-3">
        <Link href="/" className="font-semibold tracking-tight hover:text-[color:var(--color-accent)]">
          Obywatel<span className="text-[color:var(--color-accent)]">&nbsp;2.0</span>
        </Link>
        <Link
          href="/poslowie"
          className="font-mono text-xs text-[color:var(--color-ink-soft)] hover:text-[color:var(--color-accent)]"
        >
          posłowie
        </Link>
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
        .
      </div>
    </footer>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl">
      <body className="flex min-h-screen flex-col antialiased">
        <Naglowek />
        <div className="flex-1">{children}</div>
        <Stopka />
      </body>
    </html>
  );
}
