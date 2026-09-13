import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';

import { pobierzOkreg, pobierzOkregi, BrakObiektuWBazie, BrakPolaczeniaZBaza, type PoselNaLiscie } from '@/lib/queries';
import { BrakMigracji } from '@/components/BrakMigracji';
import { BrakPolaczenia } from '@/components/BrakPolaczenia';
import { Portret } from '@/components/Portret';
import { SourceLink } from '@/components/SourceLink';
import { odmien } from '@/lib/format';

export const revalidate = 86400;

const SEJM_POSLOWIE = 'https://api.sejm.gov.pl/sejm/term10/MP';

/**
 * STRONA OKREGU WYBORCZEGO.
 *
 * Odpowiada na pytanie, ktore serwis zadaje na stronie glownej: „Kto
 * reprezentuje Twoj okreg?". Do 13.09.2026 wybor okregu prowadzil do listy
 * poslow z filtrem — a sam okreg nie mial gdzie nic o sobie powiedziec.
 *
 * CZEGO TU JESZCZE NIE MA, I DLACZEGO.
 *
 *   MAPA GRANIC. Wymaga podzialu terytorialnego okregow — ktore powiaty
 *   i gminy do ktorego naleza — a tego nie ma ani w Sejm API, ani w naszej
 *   bazie. Zrodlem jest PKW i GUS. Narysowanie mapy „mniej wiecej" byloby
 *   pierwsza rzecza w serwisie bez pokrycia w dokumencie.
 *
 *   FREKWENCJA I WYNIKI WYBOROW. Mamy `number_of_votes` — liczbe glosow
 *   oddanych na KAZDEGO WYBRANEGO posla. To nie jest ani frekwencja, ani
 *   wynik wyborow w okregu: brakuje w tym wszystkich, ktorzy startowali
 *   i nie weszli. Suma takich liczb wygladalaby jak „ile glosow oddano
 *   w okregu" i bylaby mylaca o rzad wielkosci.
 *
 * PODZIAL MANDATOW MIEDZY KLUBY jest natomiast zwyklym zliczeniem — nie
 * odsetkiem, wiec nie potrzebuje mianownika ani przedzialu ufnosci.
 */

  /*
    PUSTA LISTA TO AWARIA, NIE CISZA — i to jest lekcja z 13.09.2026.

    Ten `catch` mial chronic build przed niedostepna baza. Zrobil natomiast
    coś gorszego: polknal `DYNAMIC_SERVER_USAGE` rzucane przez `cookies()`
    i zwracal pusta liste. Build konczyl sie SUKCESEM, pokazujac
    „Generating static pages (8/8)" zamiast 553, a produkcja zwracala 500
    na kazdej trasie z parametrem. Bledu nie bylo widac nigdzie — ani
    w logu builda, ani w typecheck.

    Dlatego teraz komunikat idzie na `stderr` z prefiksem `::error::`,
    ktory GitHub Actions zaznacza na czerwono. Nadal NIE przerywamy builda
    — brak bazy przy budowaniu jest dopuszczalny i strony wyrenderuja sie
    na zadanie — ale cisza przestaje byc opcja.
  */
export async function generateStaticParams() {
  try {
    const okregi = await pobierzOkregi();
    return okregi.map((o) => ({ nr: String(o.district_num) }));
  } catch (e) {
    console.error(`::error::generateStaticParams w [nr] nie zwrocilo ani jednej sciezki: ${(e as Error).message}`);
    return [];
  }
}

export async function generateMetadata({ params }: { params: Promise<{ nr: string }> }): Promise<Metadata> {
  const { nr } = await params;
  return {
    title: `Okręg nr ${nr}`,
    description: `Posłowie wybrani w okręgu wyborczym nr ${nr} — pełny skład z rejestru Kancelarii Sejmu.`,
  };
}

export default async function StronaOkregu({ params }: { params: Promise<{ nr: string }> }) {
  const { nr } = await params;

  // Wszystko, co nie jest dodatnia liczba calkowita, odpada juz tutaj —
  // do zapytania nie trafia tekst.
  const numer = Number.parseInt(nr, 10);
  if (!Number.isInteger(numer) || numer <= 0) notFound();

  let wynik: Awaited<ReturnType<typeof pobierzOkreg>>;
  try {
    wynik = await pobierzOkreg(numer);
  } catch (e) {
    if (e instanceof BrakObiektuWBazie) return <BrakMigracji error={e} />;
    // Baza nieosiagalna to co innego niz brakujaca migracja — patrz
    // `BrakPolaczeniaZBaza` w queries.ts. Bez tego build bez dostepu
    // do bazy pada, a na produkcji czytelnik dostaje czerwony ekran.
    if (e instanceof BrakPolaczeniaZBaza) return <BrakPolaczenia co="posłów z tego okręgu" />;
    throw e;
  }
  if (!wynik) notFound();

  const { okreg, obecni, byli, kluby } = wynik;
  const adresListy = `/poslowie?okreg=${okreg.district_num}`;

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-[color:var(--color-accent)]">
        Sejm X kadencji
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">
        Okręg nr {okreg.district_num} — {okreg.district_name}
      </h1>
      {okreg.voivodeship && (
        <p className="mt-2 text-xs text-[color:var(--color-ink-soft)]">
          województwo {okreg.voivodeship}
        </p>
      )}

      <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-6 border-t border-[color:var(--color-rule)] pt-6 sm:grid-cols-4">
        <div>
          <dt className="text-3xl font-semibold tabular-nums">{obecni.length}</dt>
          <dd className="mt-1 text-sm text-[color:var(--color-ink-soft)]">
            {odmien(obecni.length, ['poseł', 'posłowie', 'posłów'])} obecnie
          </dd>
        </div>
        {byli.length > 0 && (
          <div>
            <dt className="text-3xl font-semibold tabular-nums">{byli.length}</dt>
            <dd className="mt-1 text-sm text-[color:var(--color-ink-soft)]">
              {odmien(byli.length, ['mandat wygasł', 'mandaty wygasły', 'mandatów wygasło'])}
            </dd>
          </div>
        )}
        <div>
          <dt className="text-3xl font-semibold tabular-nums">{kluby.length}</dt>
          <dd className="mt-1 text-sm text-[color:var(--color-ink-soft)]">
            {odmien(kluby.length, ['klub', 'kluby', 'klubów'])} z mandatem
          </dd>
        </div>
      </dl>

      {/*
        PODZIAL MANDATOW — pasek proporcji, nie wykres kolowy.

        Pasek pozwala porownac dwa okregi obok siebie, bo kazdy zaczyna sie
        w tym samym miejscu. Kolo wymaga liczenia katow i przy jednym mandacie
        daje wycinek nie do zobaczenia. Kazdy segment ma podpis z liczba —
        kolor sam w sobie nie niesie tu zadnej informacji i nikt nie musi go
        odczytywac.
      */}
      {kluby.length > 0 && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold">Podział mandatów</h2>
          <ul className="mt-3 max-w-prose divide-y divide-[color:var(--color-rule)] border-y border-[color:var(--color-rule)]">
            {kluby.map(({ klub, ilu }) => (
              <li key={klub} className="flex items-center gap-3 py-2">
                <span className="w-32 shrink-0 truncate text-xs">
                  {klub === 'bez klubu' ? (
                    <span className="text-[color:var(--color-ink-soft)]">bez klubu</span>
                  ) : (
                    <Link
                      href={`/klub/${encodeURIComponent(klub)}`}
                      className="hover:text-[color:var(--color-accent)] hover:underline"
                    >
                      {klub}
                    </Link>
                  )}
                </span>
                <span className="h-2.5 flex-1 overflow-hidden rounded-sm bg-black/[0.07] dark:bg-white/[0.09]">
                  <span
                    className="block h-full bg-[color:var(--color-ink-soft)]"
                    style={{ width: `${(ilu / obecni.length) * 100}%` }}
                  />
                </span>
                <span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums">
                  {ilu} {odmien(ilu, ['mandat', 'mandaty', 'mandatów'])}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <nav className="mt-8 flex flex-wrap gap-2 text-xs">
        <Link
          href={`${adresListy}&widok=obecnosc`}
          className="rounded border border-[color:var(--color-rule)] px-3 py-1.5 text-[color:var(--color-ink-soft)] hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-accent)]"
        >
          obecność w tym okręgu →
        </Link>
        <Link
          href={`${adresListy}&widok=klub`}
          className="rounded border border-[color:var(--color-rule)] px-3 py-1.5 text-[color:var(--color-ink-soft)] hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-accent)]"
        >
          zgodność z klubem →
        </Link>
      </nav>

      <Sklad tytul="Posłowie z tego okręgu" ludzie={obecni} />

      {byli.length > 0 && (
        <Sklad
          tytul="Mandat wygasł w trakcie kadencji"
          ludzie={byli}
          opis="Ci posłowie zostali wybrani w tym okręgu, ale ich mandat wygasł przed końcem kadencji."
        />
      )}

      <p className="mt-10 max-w-prose border-t border-[color:var(--color-rule)] pt-5 text-xs leading-relaxed text-[color:var(--color-ink-soft)]">
        Skład pochodzi z rejestru posłów Kancelarii Sejmu i jest odświeżany co noc.{' '}
        <SourceLink href={SEJM_POSLOWIE} label="Rejestr posłów X kadencji w Sejm API" />
        <span className="mt-2 block">
          Nie pokazujemy granic okręgu ani wyników wyborów — podział terytorialny okręgów prowadzi
          PKW, a my nie mamy go w danych. Wolimy tego nie rysować z pamięci.
        </span>
      </p>
    </main>
  );
}

function Sklad({ tytul, ludzie, opis }: { tytul: string; ludzie: PoselNaLiscie[]; opis?: string }) {
  if (!ludzie.length) return null;
  return (
    <section className="mt-12">
      <h2 className="text-lg font-semibold">{tytul}</h2>
      {opis && (
        <p className="mt-1 max-w-prose text-xs leading-relaxed text-[color:var(--color-ink-soft)]">{opis}</p>
      )}
      <ul className="mt-4 grid gap-x-8 border-y border-[color:var(--color-rule)] sm:grid-cols-2 lg:grid-cols-3">
        {ludzie.map((mp) => (
          <li
            key={mp.id}
            className="flex items-center gap-3 border-b border-[color:var(--color-rule)] py-2.5 last:border-b-0"
          >
            <Portret src={mp.photo_url} nazwa={mp.full_name} rozmiar="sm" />
            <div className="min-w-0">
              <Link
                href={`/posel/${mp.slug}`}
                className="text-sm font-medium hover:text-[color:var(--color-accent)] hover:underline"
              >
                {mp.full_name}
              </Link>
              {mp.klub && (
                <p className="text-xs text-[color:var(--color-ink-soft)]">{mp.klub}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
