import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';

import {
  pobierzKomisje1,
  pobierzKodyKomisji,
  BrakObiektuWBazie,
  BrakPolaczeniaZBaza,
  type TypKomisji,
} from '@/lib/queries';
import { BrakMigracji } from '@/components/BrakMigracji';
import { BrakPolaczenia } from '@/components/BrakPolaczenia';
import { Portret } from '@/components/Portret';
import { SourceLink } from '@/components/SourceLink';
import { odmien, polskieDaty, skrotKlubu } from '@/lib/format';

export const revalidate = 86400;

const SEJM_KOMISJE = 'https://api.sejm.gov.pl/sejm/term10/committees';

/** Slownik zamkniety, pilnowany ograniczeniem w bazie (migracja 0033). */
const TYP: Record<TypKomisji, string> = {
  STANDING: 'komisja stała',
  EXTRAORDINARY: 'komisja nadzwyczajna',
  INVESTIGATIVE: 'komisja śledcza',
};

/**
 * STRONA JEDNEJ KOMISJI.
 *
 * CO TU JEST NAJWAZNIEJSZE: `scope`, czyli oficjalny opis zakresu dzialania
 * z rejestru. To najlepsza istniejaca odpowiedz na „czym ta komisja sie
 * zajmuje" — napisana nie przez nas, tylko przez Sejm. Dlatego stoi wysoko
 * i w pelnym brzmieniu, a nie jako skrocony podpis.
 *
 * CZEGO TU NIE MA: PODKOMISJI. Rejestr podaje ich kody (106 pozycji), ale
 * zaden z nich nie wystepuje jako komisja na liscie glownej — sprawdzone.
 * „ASW01N" bez nazwy nie jest informacja, tylko zagadka. Podajemy sama
 * LICZBE, zeby czytelnik wiedzial, ze istnieja, i nic ponadto.
 */
export async function generateStaticParams() {
  try {
    return (await pobierzKodyKomisji()).map((kod) => ({ kod }));
  } catch (e) {
    console.error(`::error::generateStaticParams w [kod] nie zwrocilo ani jednej sciezki: ${(e as Error).message}`);
    return [];
  }
}

export async function generateMetadata({ params }: { params: Promise<{ kod: string }> }): Promise<Metadata> {
  const { kod } = await params;
  const wynik = await pobierzKomisje1(decodeURIComponent(kod)).catch(() => null);
  if (!wynik) return { title: 'Komisja sejmowa' };
  return {
    title: wynik.komisja.name,
    description: `Skład ${wynik.komisja.name_genitive ?? wynik.komisja.name} w Sejmie X kadencji — z rejestru Kancelarii Sejmu.`,
  };
}

export default async function StronaKomisji({ params }: { params: Promise<{ kod: string }> }) {
  const { kod } = await params;

  let wynik: Awaited<ReturnType<typeof pobierzKomisje1>>;
  try {
    wynik = await pobierzKomisje1(decodeURIComponent(kod));
  } catch (e) {
    if (e instanceof BrakObiektuWBazie) return <BrakMigracji error={e} />;
    if (e instanceof BrakPolaczeniaZBaza) return <BrakPolaczenia co="składu komisji" />;
    throw e;
  }
  if (!wynik) notFound();

  const { komisja, sklad } = wynik;
  const funkcyjni = sklad.filter((c) => c.function);

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-[color:var(--color-accent)]">
        {TYP[komisja.type]}
      </p>
      <h1 className="mt-2 max-w-prose text-3xl font-semibold leading-tight tracking-tight">
        {komisja.name}
      </h1>

      <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-6 border-t border-[color:var(--color-rule)] pt-6 sm:grid-cols-4">
        <div>
          <dt className="text-3xl font-semibold tabular-nums">{sklad.length}</dt>
          <dd className="mt-1 text-[13px] text-[color:var(--color-ink-soft)]">
            {odmien(sklad.length, ['poseł', 'posłowie', 'posłów'])}
          </dd>
        </div>
        {funkcyjni.length > 0 && (
          <div>
            <dt className="text-3xl font-semibold tabular-nums">{funkcyjni.length}</dt>
            <dd className="mt-1 text-[13px] text-[color:var(--color-ink-soft)]">
              {odmien(funkcyjni.length, ['z funkcją', 'z funkcją', 'z funkcją'])}
            </dd>
          </div>
        )}
        {komisja.appointment_date && (
          <div>
            <dt className="text-3xl font-semibold tabular-nums">
              {polskieDaty(komisja.appointment_date).slice(6)}
            </dt>
            <dd className="mt-1 text-[13px] text-[color:var(--color-ink-soft)]">rok powołania</dd>
          </div>
        )}
      </dl>

      {komisja.scope && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold">Zakres działania</h2>
          {/*
            OPIS W PELNYM BRZMIENIU, NIE SKROCONY. To jedyne miejsce w serwisie,
            gdzie instytucja sama mowi, czym sie zajmuje — skracanie go byloby
            zastapieniem jej slow naszymi. `whitespace-pre-line`, bo rejestr
            lamie ten tekst wlasnymi akapitami.
          */}
          <p className="mt-3 max-w-prose whitespace-pre-line text-sm leading-relaxed text-[color:var(--color-ink-soft)]">
            {komisja.scope}
          </p>
        </section>
      )}

      <section className="mt-12">
        <h2 className="text-lg font-semibold">Skład</h2>
        <p className="mt-1 max-w-prose text-xs leading-relaxed text-[color:var(--color-ink-soft)]">
          {'Funkcje podajemy dokładnie tak, jak zapisał je rejestr — łącznie z formą żeńską tam, ' +
            'gdzie rejestr jej użył. Brak funkcji przy nazwisku znaczy „zwykły członek".'}
        </p>

        <ul className="mt-4 grid gap-x-8 border-y border-[color:var(--color-rule)] sm:grid-cols-2 lg:grid-cols-3">
          {sklad.map((c) => (
            <li
              key={c.mp_id}
              className="flex items-center gap-3 border-b border-[color:var(--color-rule)] py-2.5 last:border-b-0"
            >
              <Portret src={c.photo_url} nazwa={c.full_name} rozmiar="sm" />
              <div className="min-w-0">
                <Link
                  href={`/posel/${c.slug}`}
                  className="text-sm font-medium hover:text-[color:var(--color-accent)] hover:underline"
                >
                  {c.full_name}
                </Link>
                <p className="text-xs text-[color:var(--color-ink-soft)]">
                  {c.klub && (
                    <Link
                      href={`/klub/${encodeURIComponent(c.klub)}`}
                      className="hover:text-[color:var(--color-accent)] hover:underline"
                    >
                      {skrotKlubu(c.klub)}
                    </Link>
                  )}
                  {c.function && (
                    <span className="block font-medium text-[color:var(--color-ink)]">{c.function}</span>
                  )}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-10 max-w-prose border-t border-[color:var(--color-rule)] pt-5 text-xs leading-relaxed text-[color:var(--color-ink-soft)]">
        Skład pochodzi z rejestru Kancelarii Sejmu i jest odświeżany co noc.{' '}
        <SourceLink href={SEJM_KOMISJE} label="Rejestr komisji sejmowych w Sejm API" />
        {komisja.sub_committees.length > 0 && (
          <span className="mt-2 block">
            {`Komisja ma ${komisja.sub_committees.length} ${odmien(komisja.sub_committees.length, ['podkomisję', 'podkomisje', 'podkomisji'])}. ` +
              'Rejestr podaje wyłącznie ich kody, bez nazw i składu — dlatego ich tu nie wypisujemy.'}
          </span>
        )}
      </p>
    </main>
  );
}
