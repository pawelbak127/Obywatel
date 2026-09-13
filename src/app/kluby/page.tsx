import type { Metadata } from 'next';
import Link from 'next/link';

import { pobierzKluby, BrakObiektuWBazie } from '@/lib/queries';
import { BrakMigracji } from '@/components/BrakMigracji';
import { SourceLink } from '@/components/SourceLink';
import { odmien } from '@/lib/format';

export const revalidate = 86400;

const SEJM_KLUBY = 'https://api.sejm.gov.pl/sejm/term10/clubs';

export const metadata: Metadata = {
  title: 'Kluby i koła poselskie',
  description: 'Kluby parlamentarne i koła poselskie Sejmu X kadencji wraz z liczebnością z rejestru.',
};

/**
 * SPIS KLUBOW.
 *
 * Powstal razem ze strona `/klub/[skrot]`: skoro klub jest juz miejscem,
 * do ktorego mozna wejsc, musi byc tez miejsce, z ktorego widac wszystkie.
 * Bez tego kluby byly osiagalne wylacznie przez nazwisko posla — czyli
 * czytelnik musial znac kogos z klubu, zeby dotrzec do klubu.
 *
 * Kolejnosc po liczebnosci, nie alfabetycznie. Alfabet stawia kolo
 * czteroosobowe przed klubem stupiecdziesiecioosobowym i nie niesie zadnej
 * informacji; liczebnosc mowi od razu, kto ma w Sejmie ile glosow.
 */
export default async function Kluby() {
  let kluby: Awaited<ReturnType<typeof pobierzKluby>>;
  try {
    kluby = await pobierzKluby();
  } catch (e) {
    if (e instanceof BrakObiektuWBazie) return <BrakMigracji error={e} />;
    throw e;
  }

  const najwiekszy = Math.max(1, ...kluby.map((k) => k.members_count ?? 0));

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[color:var(--color-accent)]">
        Sejm X kadencji
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Kluby i koła poselskie</h1>
      <p className="mt-4 max-w-prose text-sm leading-relaxed text-[color:var(--color-ink-soft)]">
        {kluby.length} {odmien(kluby.length, ['klub', 'kluby', 'klubów'])} i kół, uszeregowanych
        według liczby posłów. Liczebność pochodzi z rejestru Kancelarii Sejmu i dotyczy posłów
        sprawujących mandat.
      </p>

      <ul className="mt-10 divide-y divide-[color:var(--color-rule)] border-y border-[color:var(--color-rule)]">
        {kluby.map((k) => (
          <li key={k.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3">
            <Link
              href={`/klub/${encodeURIComponent(k.id)}`}
              className="w-36 shrink-0 font-medium hover:text-[color:var(--color-accent)] hover:underline"
            >
              {k.id}
            </Link>

            <span className="min-w-0 flex-1 text-sm text-[color:var(--color-ink-soft)]">{k.name}</span>

            <span className="flex shrink-0 items-center gap-3">
              {/*
                Pasek dlugosci proporcjonalnej do najwiekszego klubu. Sama
                liczba stoi obok — pasek sluzy wylacznie porownaniu wzrokiem.
              */}
              <span className="hidden h-2 w-24 overflow-hidden rounded-sm bg-black/[0.07] sm:block dark:bg-white/[0.09]">
                <span
                  className="block h-full bg-[color:var(--color-ink-soft)]"
                  style={{ width: `${((k.members_count ?? 0) / najwiekszy) * 100}%` }}
                />
              </span>
              <span className="w-24 text-right font-mono text-xs tabular-nums">
                {k.members_count ?? '—'}{' '}
                {k.members_count !== null && odmien(k.members_count, ['poseł', 'posłowie', 'posłów'])}
              </span>
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-6 max-w-prose text-xs text-[color:var(--color-ink-soft)]">
        Dane pochodzą z rejestru klubów Kancelarii Sejmu i są odświeżane co noc.{' '}
        <SourceLink href={SEJM_KLUBY} label="Rejestr klubów poselskich w Sejm API" />
      </p>
    </main>
  );
}
