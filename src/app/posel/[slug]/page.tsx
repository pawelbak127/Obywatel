import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';

import {
  pobierzPosla,
  pobierzSlugi,
  pobierzNieobecnosciMiesieczne,
  pobierzGlosyPosla,
  BrakObiektuWBazie,
  type MpKontekst,
} from '@/lib/queries';
import { BrakMigracji } from '@/components/BrakMigracji';
import { SourceLink } from '@/components/SourceLink';
import { StatystykiPosla } from '@/components/StatBar';
import { AbsenceTimeline } from '@/components/AbsenceTimeline';

export const revalidate = 86400; // dane zmieniaja sie raz na dobe, po nocnym cronie

/**
 * 499 stron generowanych statycznie. Jesli baza jest niedostepna w czasie builda
 * (np. na swiezym klonie bez sekretow), zwracamy pusta liste — strony wygeneruja
 * sie na zadanie zamiast wywracac deploy.
 */
export async function generateStaticParams() {
  try {
    return (await pobierzSlugi()).map((slug) => ({ slug }));
  } catch {
    return [];
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const mp = await pobierzPosla(slug).catch(() => null);
  if (!mp) return { title: 'Nie znaleziono posła' };
  return {
    title: mp.full_name,
    description:
      `${mp.full_name}${mp.klub ? ` (${mp.klub})` : ''} — obecność ` +
      `${mp.attendance_pct?.toFixed(1).replace('.', ',') ?? '—'}% z ${mp.votes_total} głosowań. ` +
      'Dane z Sejm API, każda liczba z linkiem do źródła.',
  };
}

const SEJM_MP = (id: number) => `https://api.sejm.gov.pl/sejm/term10/MP/${id}`;

export default async function ProfilPosla({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let mp: MpKontekst | null;
  let miesiace: Awaited<ReturnType<typeof pobierzNieobecnosciMiesieczne>>;
  let glosy: Awaited<ReturnType<typeof pobierzGlosyPosla>>;
  try {
    mp = await pobierzPosla(slug);
    if (!mp) notFound();
    [miesiace, glosy] = await Promise.all([
      pobierzNieobecnosciMiesieczne(mp.id),
      pobierzGlosyPosla(mp.id, 25),
    ]);
  } catch (e) {
    if (e instanceof BrakObiektuWBazie) return <BrakMigracji error={e} />;
    throw e;
  }

  const okres =
    mp.first_voted_at && mp.last_voted_at
      ? `${new Date(mp.first_voted_at).toLocaleDateString('pl-PL')} – ${new Date(mp.last_voted_at).toLocaleDateString('pl-PL')}`
      : null;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link
        href="/poslowie"
        className="font-mono text-xs text-[color:var(--color-ink-soft)] hover:text-[color:var(--color-accent)]"
      >
        ← wszyscy posłowie
      </Link>

      <header className="mt-6 border-b-2 border-[color:var(--color-ink)] pb-5">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-[color:var(--color-accent)]">
          {mp.klub && <span>{mp.klub}</span>}
          {!mp.active && <span className="text-[color:var(--color-ink-soft)]">mandat wygasł</span>}
          <span className="text-[color:var(--color-ink-soft)] normal-case tracking-normal">
            {mp.zakres_mandatu}
          </span>
        </div>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight">{mp.full_name}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-[color:var(--color-ink-soft)]">
          {okres && <span>głosował w okresie {okres}</span>}
          <SourceLink href={SEJM_MP(mp.id)} label={`Profil posła w Sejm API (id ${mp.id})`} />
        </p>
      </header>

      <div className="mt-8">
        <StatystykiPosla mp={mp} />
      </div>

      <div className="mt-10">
        <AbsenceTimeline
          miesiace={miesiace}
          ksztalt={mp.ksztalt_nieobecnosci}
          funkcje={mp.funkcje_panstwowe}
        />
      </div>

      <section className="mt-12">
        <h2 className="mb-3 text-sm font-semibold">Ostatnie głosowania</h2>
        <div className="overflow-x-auto rounded border border-[color:var(--color-rule)]">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-[color:var(--color-rule)] bg-black/[0.03] dark:bg-white/[0.04]">
                <th className="px-3 py-2 text-left font-mono text-[10.5px] uppercase tracking-widest text-[color:var(--color-ink-soft)]">
                  Data
                </th>
                <th className="px-3 py-2 text-left font-mono text-[10.5px] uppercase tracking-widest text-[color:var(--color-ink-soft)]">
                  Głosowanie
                </th>
                <th className="px-3 py-2 text-left font-mono text-[10.5px] uppercase tracking-widest text-[color:var(--color-ink-soft)]">
                  Głos
                </th>
                <th className="px-3 py-2 text-left font-mono text-[10.5px] uppercase tracking-widest text-[color:var(--color-ink-soft)]">
                  Protokół
                </th>
              </tr>
            </thead>
            <tbody>
              {glosy.map(({ value, votings: v }) => (
                <tr key={v.id} className="border-b border-[color:var(--color-rule)] last:border-0 align-top">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs tabular-nums text-[color:var(--color-ink-soft)]">
                    {new Date(v.voted_at).toLocaleDateString('pl-PL')}
                  </td>
                  <td className="px-3 py-2">
                    {v.title}
                    {v.print_numbers?.length ? (
                      <span className="ml-2 font-mono text-[11px] text-[color:var(--color-ink-soft)]">
                        druk {v.print_numbers.join(', ')}
                      </span>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <GlosBadge value={value} />
                  </td>
                  <td className="px-3 py-2">
                    {v.pdf_url && (
                      <SourceLink
                        href={v.pdf_url}
                        label={`Oficjalny protokół głosowania ${v.sitting}/${v.voting_number}`}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-[color:var(--color-ink-soft)]">
          Każdy wiersz prowadzi do oficjalnego protokołu na serwerze Kancelarii Sejmu.
          Nie prosimy, żeby nam wierzyć.
        </p>
      </section>
    </main>
  );
}

const OPIS_GLOSU: Record<string, { tekst: string; klasa: string }> = {
  YES: { tekst: 'za', klasa: 'text-[color:var(--color-ok,#1c6b48)]' },
  NO: { tekst: 'przeciw', klasa: 'text-[color:var(--color-accent)]' },
  ABSTAIN: { tekst: 'wstrzymał się', klasa: 'text-[color:var(--color-warn,#8a5300)]' },
  ABSENT: { tekst: 'nieobecny', klasa: 'text-[color:var(--color-ink-soft)]' },
  PRESENT: { tekst: 'obecny, nie głosował', klasa: 'text-[color:var(--color-ink-soft)]' },
};

function GlosBadge({ value }: { value: string }) {
  const o = OPIS_GLOSU[value] ?? { tekst: value, klasa: 'text-[color:var(--color-ink-soft)]' };
  return <span className={`font-mono text-xs ${o.klasa}`}>{o.tekst}</span>;
}
