import type { Metadata } from 'next';
import Link from 'next/link';

import {
  pobierzKomisje,
  BrakObiektuWBazie,
  BrakPolaczeniaZBaza,
  type KomisjaNaSpisie,
  type TypKomisji,
} from '@/lib/queries';
import { BrakMigracji } from '@/components/BrakMigracji';
import { BrakPolaczenia } from '@/components/BrakPolaczenia';
import { SourceLink } from '@/components/SourceLink';
import { odmien } from '@/lib/format';

export const revalidate = 86400;

const SEJM_KOMISJE = 'https://api.sejm.gov.pl/sejm/term10/committees';

export const metadata: Metadata = {
  title: 'Komisje sejmowe',
  description:
    'Komisje stałe, nadzwyczajne i śledcze Sejmu X kadencji wraz ze składem — z rejestru Kancelarii Sejmu.',
};

/**
 * SPIS KOMISJI.
 *
 * Komisja jest odpowiedzia na pytanie „czym ten posel sie zajmuje", ktore
 * czytelnik zadaje wczesniej niz „jak glosowal". Skoro stoi na profilu,
 * musi byc tez miejsce, z ktorego widac wszystkie — inaczej komisje sa
 * osiagalne wylacznie przez nazwisko, czyli trzeba znac czlonka, zeby
 * dotrzec do komisji.
 *
 * GRUPUJEMY PO TYPIE, nie mieszamy w jedna liste. Komisja stala, komisja
 * nadzwyczajna i komisja SLEDCZA to trzy rozne rzeczy o roznym ciezarze,
 * a wspolna lista alfabetyczna zrownywalaby je wizualnie.
 */
const TYPY: Array<{ typ: TypKomisji; naglowek: string; opis: string }> = [
  {
    typ: 'STANDING',
    naglowek: 'Komisje stałe',
    opis: 'Powoływane na całą kadencję, każda ma stały zakres spraw zapisany w regulaminie Sejmu.',
  },
  {
    typ: 'EXTRAORDINARY',
    naglowek: 'Komisje nadzwyczajne',
    opis: 'Powoływane do konkretnej sprawy — najczęściej do rozpatrzenia jednego projektu ustawy.',
  },
  {
    typ: 'INVESTIGATIVE',
    naglowek: 'Komisje śledcze',
    opis: 'Powoływane do zbadania określonej sprawy. Działają na podstawie odrębnej ustawy.',
  },
];

export default async function Komisje() {
  let komisje: KomisjaNaSpisie[];
  try {
    komisje = await pobierzKomisje();
  } catch (e) {
    if (e instanceof BrakObiektuWBazie) return <BrakMigracji error={e} />;
    if (e instanceof BrakPolaczeniaZBaza) return <BrakPolaczenia co="komisji sejmowych" />;
    throw e;
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-[color:var(--color-accent)]">
        Sejm X kadencji
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Komisje sejmowe</h1>
      <p className="mt-4 max-w-prose text-sm leading-relaxed text-[color:var(--color-ink-soft)]">
        {`${komisje.length} ${odmien(komisje.length, ['komisja', 'komisje', 'komisji'])} w trzech rodzajach. ` +
          `Przy każdej stoi liczba posłów w składzie — poseł zasiada zwykle w kilku.`}
      </p>

      <div className="mt-10 space-y-10">
        {TYPY.map(({ typ, naglowek, opis }) => {
          const grupa = komisje.filter((k) => k.type === typ);
          if (!grupa.length) return null;

          return (
            <section key={typ}>
              <h2 className="text-lg font-semibold">
                {naglowek}{' '}
                <span className="text-sm font-normal text-[color:var(--color-ink-soft)]">
                  ({grupa.length})
                </span>
              </h2>
              <p className="mt-1 max-w-prose text-xs leading-relaxed text-[color:var(--color-ink-soft)]">
                {opis}
              </p>

              <ul className="mt-3 divide-y divide-[color:var(--color-rule)] border-y border-[color:var(--color-rule)]">
                {grupa.map((k) => (
                  <li key={k.code} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
                    <Link
                      href={`/komisja/${encodeURIComponent(k.code)}`}
                      className="min-w-0 flex-1 text-sm hover:text-[color:var(--color-accent)] hover:underline"
                    >
                      {k.name}
                    </Link>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-[color:var(--color-ink-soft)]">
                      {k.czlonkow} {odmien(k.czlonkow, ['poseł', 'posłowie', 'posłów'])}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <p className="mt-10 max-w-prose border-t border-[color:var(--color-rule)] pt-5 text-xs text-[color:var(--color-ink-soft)]">
        Skład komisji pochodzi z rejestru Kancelarii Sejmu i jest odświeżany co noc.{' '}
        <SourceLink href={SEJM_KOMISJE} label="Rejestr komisji sejmowych w Sejm API" />
      </p>
    </main>
  );
}
