import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';

import { pobierzOkregi, BrakObiektuWBazie } from '@/lib/queries';
import { BrakMigracji } from '@/components/BrakMigracji';
import { odmien } from '@/lib/format';

export const revalidate = 86400;

export const metadata: Metadata = {
  title: 'Okręgi wyborcze',
  description: 'Czterdzieści jeden okręgów wyborczych do Sejmu — posłowie wybrani w każdym z nich.',
};

/**
 * SPIS OKREGOW — i zarazem przekierowanie z formularza na stronie glownej.
 *
 * DLACZEGO PRZEKIEROWANIE, A NIE ADRES WPROST. Formularz `GET` bez
 * JavaScriptu potrafi zlozyc wylacznie `/okreg?nr=19` — nie umie wstawic
 * wartosci w SCIEZKE. Mielismy wiec dwie mozliwosci: zostawic czytelnika
 * na adresie z parametrem albo przepisac go na `/okreg/19`.
 *
 * Wybieramy drugie, bo to adres, ktory czytelnik wysle dalej i ktory ma
 * sens sam z siebie. Przekierowanie jest po stronie serwera i kosztuje
 * jedno dodatkowe zadanie — raz, przy wejsciu.
 *
 * Bez parametru strona jest po prostu spisem wszystkich czterdziestu jeden.
 */
export default async function Okregi({
  searchParams,
}: {
  searchParams: Promise<{ nr?: string }>;
}) {
  const sp = await searchParams;

  const numer = Number.parseInt(sp.nr ?? '', 10);
  if (Number.isInteger(numer) && numer > 0) redirect(`/okreg/${numer}`);

  let okregi: Awaited<ReturnType<typeof pobierzOkregi>>;
  try {
    okregi = await pobierzOkregi();
  } catch (e) {
    if (e instanceof BrakObiektuWBazie) return <BrakMigracji error={e} />;
    throw e;
  }

  // Grupujemy po wojewodztwie, bo tak ludzie szukaja swojego okregu —
  // od miejsca, w ktorym mieszkaja, a nie od numeru, ktorego nie pamietaja.
  const wedlugWojewodztw = new Map<string, typeof okregi>();
  for (const o of okregi) {
    const w = o.voivodeship ?? 'bez województwa';
    const lista = wedlugWojewodztw.get(w);
    if (lista) lista.push(o);
    else wedlugWojewodztw.set(w, [o]);
  }
  const grupy = [...wedlugWojewodztw.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pl'));

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <p className="font-mono text-xs uppercase tracking-[0.16em] text-[color:var(--color-accent)]">
        Sejm X kadencji
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Okręgi wyborcze</h1>
      <p className="mt-4 max-w-prose text-sm leading-relaxed text-[color:var(--color-ink-soft)]">
        {okregi.length} {odmien(okregi.length, ['okręg', 'okręgi', 'okręgów'])}, pogrupowanych
        województwami. Nazwa okręgu to jego miasto siedziby komisji — okręg obejmuje zwykle znacznie
        większy obszar, którego granic tu nie rysujemy, bo prowadzi je PKW.
      </p>

      <div className="mt-10 space-y-8">
        {grupy.map(([wojewodztwo, lista]) => (
          <section key={wojewodztwo}>
            {/*
              Naglowek wojewodztwa mial 11 px, czyli MNIEJ niz akapit nad nim
              (14 px) — sekcja byla wizualnie drobniejsza od wlasnego opisu.
              Wersaliki i odstep miedzy literami zostaja, bo to one odrozniaja
              nazwe wojewodztwa od nazwy okregu; rosnie sam rozmiar i kontrast.
            */}
            <h2 className="font-mono text-sm uppercase tracking-[0.16em] text-[color:var(--color-ink-soft)]">
              {wojewodztwo}
            </h2>
            <ul className="mt-2 grid gap-x-8 border-y border-[color:var(--color-rule)] sm:grid-cols-2 lg:grid-cols-3">
              {lista.map((o) => (
                <li
                  key={o.district_num}
                  className="flex items-baseline justify-between gap-3 border-b border-[color:var(--color-rule)] py-2 last:border-b-0"
                >
                  <Link
                    href={`/okreg/${o.district_num}`}
                    className="text-sm hover:text-[color:var(--color-accent)] hover:underline"
                  >
                    <span className="font-mono text-xs text-[color:var(--color-ink-faint)]">
                      {o.district_num}
                    </span>{' '}
                    {o.district_name}
                  </Link>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-[color:var(--color-ink-soft)]">
                    {o.poslow} {odmien(o.poslow, ['poseł', 'posłowie', 'posłów'])}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
