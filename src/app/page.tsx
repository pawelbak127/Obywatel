import Link from 'next/link';

import { createClient } from '@/lib/supabase/server';
import { hasPublicConfig } from '@/lib/env';

/**
 * Strona glowna.
 *
 * POWOD PRZEPISANIA. Do tej pory pod adresem `/` stala strona diagnostyczna
 * z naglowkiem "Sprint 0 · szkielet" i zdaniem "puste tabele na tym etapie sa
 * poprawnym wynikiem — dane wjezdzaja w Sprincie 1". W bazie bylo wtedy
 * 2,1 mln glosow imiennych i 1 662 procesy legislacyjne.
 *
 * Strona glowna klamala o stanie wlasnego projektu, i to w miejscu, w ktorym
 * przypadkowy czytelnik wyrabia sobie pierwsze zdanie o tym, czy mozna nam
 * ufac. Diagnostyka jest potrzebna i zostaje — ale pod adresem `/status`,
 * gdzie jest dla nas, a nie dla niego.
 */

export const dynamic = 'force-dynamic';

type Liczby = { poslowie: number | null; glosowania: number | null; glosy: number | null; procesy: number | null };

async function policz(): Promise<Liczby> {
  const puste: Liczby = { poslowie: null, glosowania: null, glosy: null, procesy: null };
  if (!hasPublicConfig) return puste;

  try {
    const supabase = await createClient();
    const jeden = async (tabela: string) => {
      // `estimated`, nie `exact`: COUNT(*) na 2,1 mln wierszy przekracza
      // statement_timeout roli anon. Na stronie glownej i tak zaokraglamy.
      const { count, error } = await supabase.from(tabela).select('*', { count: 'estimated', head: true });
      return error ? null : count;
    };
    const [poslowie, glosowania, glosy, procesy] = await Promise.all([
      jeden('mps'),
      jeden('votings'),
      jeden('votes'),
      jeden('legislative_processes'),
    ]);
    return { poslowie, glosowania, glosy, procesy };
  } catch {
    return puste;
  }
}

/** Liczby na stronie glownej sa ZAOKRAGLONE i tak sie je opisuje. */
function okolo(n: number | null): string {
  if (n === null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',')} mln`;
  if (n >= 10_000) return `${Math.round(n / 1000)} tys.`;
  return n.toLocaleString('pl-PL');
}

export default async function StronaGlowna() {
  const l = await policz();

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
        Co robią posłowie, których wybraliśmy
      </h1>

      <p className="mt-5 max-w-prose text-lg leading-relaxed text-[color:var(--color-ink-soft)]">
        Głosowania w Sejmie, droga każdej ustawy i pieniądze publiczne — złożone
        z oficjalnych rejestrów państwowych. Przy każdej liczbie stoi odnośnik do dokumentu,
        z którego pochodzi.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/poslowie"
          className="rounded border border-[color:var(--color-accent)] px-4 py-2 font-mono text-sm text-[color:var(--color-accent)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-white"
        >
          obecność posłów →
        </Link>
      </div>

      {/* ---------------------------------------------------------------
          Liczby jako dowod, ze to nie jest makieta. Zaokraglone i opisane
          jako zaokraglone — dokladny COUNT(*) na tabeli glosow przekracza
          limit czasu, a strona glowna go nie potrzebuje.
      --------------------------------------------------------------- */}
      <dl className="mt-12 grid grid-cols-2 gap-x-6 gap-y-6 border-t border-[color:var(--color-rule)] pt-8 sm:grid-cols-4">
        {[
          { l: 'posłów', v: okolo(l.poslowie) },
          { l: 'głosowań', v: okolo(l.glosowania) },
          { l: 'głosów imiennych', v: okolo(l.glosy) },
          { l: 'procesów legislacyjnych', v: okolo(l.procesy) },
        ].map((x) => (
          <div key={x.l}>
            {/* Bez font-mono: font o stalej szerokosci ma sens w kolumnie
                cyfr, gdzie liczy sie wyrownanie — tu stoja cztery pojedyncze
                liczby naglowkowe i monospace nadawal im tylko ton konsoli.
                tabular-nums zostaje, bo wyrownuje szerokosci cyfr. */}
            <dt className="text-3xl font-semibold tabular-nums">{x.v}</dt>
            <dd className="mt-1 text-[13px] text-[color:var(--color-ink-soft)]">{x.l}</dd>
          </div>
        ))}
      </dl>

      {/*
        TO ZDANIE BYLO W PIERWSZEJ WERSJI NIEPRAWDZIWE i warto pamietac, jak.

        Brzmialo: „Dokladne wartosci sa na stronie stanu bazy". Sprawdzone:
        `/status` liczy TAK SAMO, przez `count: 'estimated'` — pokazuje te same
        szacunki, tylko bez zaokraglenia do „mln" i „tys.". Zdanie odsylalo
        wiec po dokladnosc tam, gdzie jej nie ma.

        Nowa wersja mowi czytelnikowi rzecz, ktora mu sie nalezy i ktorej
        nigdzie dotad nie mowilismy: te liczby sa SZACUNKAMI. Powod jest
        techniczny i uczciwy — dokladny COUNT(*) na 2,1 mln wierszy przekracza
        statement_timeout roli anon (CLAUDE.md §6).
      */}
      <p className="mt-3 text-xs text-[color:var(--color-ink-soft)]">
        Liczby pobierane na żywo z bazy. Są to szacunki — dokładne policzenie
        dwóch milionów wierszy przekracza limit czasu zapytania. Wartości bez
        zaokrąglenia pokazuje{' '}
        <Link href="/status" className="underline decoration-dotted underline-offset-2">
          strona stanu bazy
        </Link>
        .
      </p>

      {/* ---------------------------------------------------------------
          Zasady. Nie "o nas", tylko konkretne zobowiazania, ktore czytelnik
          moze sprawdzic na dowolnej podstronie w piec sekund.
      --------------------------------------------------------------- */}
      <section className="mt-14 space-y-6 border-t border-[color:var(--color-rule)] pt-8">
        <h2 className="text-sm font-semibold">Na czym to stoi</h2>

        <div className="space-y-5 text-sm leading-relaxed text-[color:var(--color-ink-soft)]">
          <p>
            <strong className="text-[color:var(--color-ink)]">Każda liczba ma źródło.</strong>{' '}
            Nie prosimy, żeby nam wierzyć. Przy każdym głosowaniu jest odnośnik do protokołu
            na serwerze Kancelarii Sejmu, przy każdej uchwalonej ustawie — do jej tekstu
            w rejestrze. Gdy źródła nie mamy, nie ma też odnośnika i mówimy o tym wprost.
          </p>
          <p>
            <strong className="text-[color:var(--color-ink)]">Nie zgadujemy powodów.</strong>{' '}
            Sejm nie podaje, dlaczego posła nie było na głosowaniu. Sprawowanie urzędu,
            choroba i nieprzychodzenie do pracy wyglądają w danych identycznie — więc
            pokazujemy to, co z danych wynika, i nazywamy po imieniu to, czego nie wiemy.
          </p>
          <p>
            <strong className="text-[color:var(--color-ink)]">Liczba bez mianownika kłamie.</strong>{' '}
            Sześćdziesiąt procent ze stu głosowań i sześćdziesiąt procent z czterech tysięcy
            to nie jest ta sama informacja. Przy każdym odsetku stoi, z ilu głosowań go
            policzono i jak bardzo jest pewny.
          </p>
        </div>
      </section>

      <p className="mt-12 border-t border-[color:var(--color-rule)] pt-6 text-xs text-[color:var(--color-ink-soft)]">
        Projekt w budowie. Dane o głosowaniach i procesach legislacyjnych są kompletne
        dla obecnej kadencji; obietnice i dotacje dopiero powstają.{' '}
        <Link href="/status" className="underline decoration-dotted underline-offset-2">
          Stan bazy
        </Link>{' '}
        pokazuje dokładnie, co już jest.
      </p>
    </main>
  );
}
