import Link from 'next/link';
import type { Metadata } from 'next';

import { pobierzRanking, BrakObiektuWBazie, type MpKontekst } from '@/lib/queries';
import { BrakMigracji } from '@/components/BrakMigracji';

export const revalidate = 86400;

export const metadata: Metadata = {
  title: 'Obecność posłów',
  description:
    'Obecność posłów na głosowaniach Sejmu X kadencji — z liczbą głosowań, przedziałem ufności ' +
    'i kształtem nieobecności w czasie. Dane z Sejm API.',
};

/**
 * RANKING Z KONTEKSTEM — decyzja redakcyjna projektu.
 *
 * Każdy wiersz obowiązkowo niesie cztery rzeczy obok procentu:
 *   1. mianownik — "X z Y głosowań", bo mandaty trwają różnie długo,
 *   2. przedział ufności — bo 54% ze 100 prób to nie to samo co 54% z 4 569,
 *   3. kształt nieobecności — bo przerwa i wzorzec wyglądają tak samo w tabeli,
 *   4. funkcję państwową, jeśli jest udokumentowana.
 *
 * Sortowanie po DOLNEJ granicy przedziału, nie po surowym procencie.
 * Nikogo nie ukrywamy i nikogo nie pokazujemy bez kontekstu.
 */
export default async function Poslowie({
  searchParams,
}: {
  searchParams: Promise<{ kierunek?: string }>;
}) {
  const { kierunek } = await searchParams;
  const najlepsi = kierunek === 'najlepsi';

  let lista: MpKontekst[];
  try {
    lista = await pobierzRanking({ kierunek: najlepsi ? 'najlepsi' : 'najgorsi', limit: 60 });
  } catch (e) {
    if (e instanceof BrakObiektuWBazie) return <BrakMigracji error={e} />;
    throw e;
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[color:var(--color-accent)]">
        Sejm X kadencji
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Obecność na głosowaniach</h1>

      <p className="mt-4 max-w-prose text-sm leading-relaxed text-[color:var(--color-ink-soft)]">
        Lista posortowana po <strong>dolnej granicy przedziału ufności</strong>, nie po surowym
        procencie. Poseł, który przez dwa tygodnie mandatu opuścił połowę głosowań, nie wyprzedza
        posła, który przez całą kadencję opuścił połowę z czterech tysięcy — bo o tym pierwszym
        wiemy znacznie mniej.
      </p>
      <p className="mt-3 max-w-prose rounded border-l-2 border-[color:var(--color-accent)] bg-black/[0.02] py-2 pl-3 text-sm leading-relaxed dark:bg-white/[0.03]">
        <strong>Sejm nie podaje powodu nieobecności.</strong> Sprawowanie urzędu, choroba, urlop
        rodzicielski i nieprzychodzenie do pracy wyglądają w danych identycznie. Kolumna
        „kształt” mówi tylko tyle, czy nieobecności skupiają się w czasie — to jedyne rozróżnienie,
        które wynika z danych, a nie z naszego domysłu.
      </p>

      <nav className="mt-6 flex gap-2 font-mono text-xs">
        <Link
          href="/poslowie"
          className={`rounded border px-3 py-1.5 ${!najlepsi ? 'border-[color:var(--color-accent)] text-[color:var(--color-accent)]' : 'border-[color:var(--color-rule)] text-[color:var(--color-ink-soft)]'}`}
        >
          najniższa obecność
        </Link>
        <Link
          href="/poslowie?kierunek=najlepsi"
          className={`rounded border px-3 py-1.5 ${najlepsi ? 'border-[color:var(--color-accent)] text-[color:var(--color-accent)]' : 'border-[color:var(--color-rule)] text-[color:var(--color-ink-soft)]'}`}
        >
          najwyższa obecność
        </Link>
      </nav>

      <ol className="mt-6 divide-y divide-[color:var(--color-rule)] border-y border-[color:var(--color-rule)]">
        {lista.map((mp, i) => (
          <Wiersz key={mp.id} mp={mp} pozycja={i + 1} />
        ))}
      </ol>

      <p className="mt-6 text-xs text-[color:var(--color-ink-soft)]">
        Dane pochodzą z Sejm API. Każdy profil zawiera link do oficjalnego protokołu każdego
        głosowania. Jeśli widzisz błąd, zgłoś go — poprawimy i opiszemy poprawkę.
      </p>
    </main>
  );
}

function Wiersz({ mp, pozycja }: { mp: MpKontekst; pozycja: number }) {
  const pct = mp.attendance_pct;
  const dol = mp.attendance_lo ?? pct ?? 0;
  const gora = mp.attendance_hi ?? pct ?? 0;
  const ciagla = mp.ksztalt_nieobecnosci.startsWith('nieobecnosc ciagla');

  return (
    <li className="grid grid-cols-[2rem_1fr] gap-x-3 py-4 sm:grid-cols-[2rem_1fr_11rem]">
      <span className="pt-0.5 font-mono text-xs tabular-nums text-[color:var(--color-ink-faint,#7d8899)]">
        {pozycja}
      </span>

      <div className="min-w-0">
        <Link
          href={`/posel/${mp.slug}`}
          className="font-medium hover:text-[color:var(--color-accent)] hover:underline"
        >
          {mp.full_name}
        </Link>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-[color:var(--color-ink-soft)]">
          {mp.klub && <span>{mp.klub}</span>}
          <span>·</span>
          <span className="tabular-nums">
            {(mp.votes_total - (mp.absent_count ?? 0)).toLocaleString('pl-PL')} z{' '}
            {mp.votes_total.toLocaleString('pl-PL')} głosowań
          </span>
          {mp.zakres_mandatu !== 'pelna kadencja' && (
            <>
              <span>·</span>
              <span className="text-[color:var(--color-warn,#8a5300)]">{mp.zakres_mandatu}</span>
            </>
          )}
        </div>

        {ciagla && (
          <p className="mt-1 text-[11px] leading-snug text-[color:var(--color-ink-soft)]">
            Nieobecności skupione w czasie — wygląda na przerwę w wykonywaniu mandatu, nie na wzorzec.
            {mp.funkcje_panstwowe ? ` Funkcja: ${mp.funkcje_panstwowe}.` : ' Powód nieznany z danych.'}
          </p>
        )}
      </div>

      <div className="col-span-2 mt-2 sm:col-span-1 sm:mt-0">
        <div className="flex items-baseline justify-between gap-2 sm:justify-end">
          <span className="font-mono text-sm tabular-nums">
            {pct?.toFixed(1).replace('.', ',') ?? '—'}%
          </span>
          <span className="font-mono text-[10.5px] text-[color:var(--color-ink-soft)] tabular-nums">
            ±{(((gora - dol) / 2) || 0).toFixed(1).replace('.', ',')} pkt
          </span>
        </div>
        <div className="relative mt-1.5 h-1.5 w-full overflow-hidden rounded-sm bg-black/[0.07] dark:bg-white/[0.09]">
          <div
            className="absolute inset-y-0 bg-[color:var(--color-accent)]/25"
            style={{ left: `${dol}%`, width: `${Math.max(0.4, gora - dol)}%` }}
          />
          <div
            className="absolute inset-y-0 w-[2px] bg-[color:var(--color-accent)]"
            style={{ left: `calc(${pct ?? 0}% - 1px)` }}
          />
        </div>
      </div>
    </li>
  );
}
