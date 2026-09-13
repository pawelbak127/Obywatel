import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';

import { pobierzKlub, pobierzSkrotyKlubow, BrakObiektuWBazie, type PoselNaLiscie } from '@/lib/queries';
import { BrakMigracji } from '@/components/BrakMigracji';
import { Portret } from '@/components/Portret';
import { SourceLink } from '@/components/SourceLink';
import { odmien, skrotKlubu } from '@/lib/format';

export const revalidate = 86400;

const SEJM_KLUBY = 'https://api.sejm.gov.pl/sejm/term10/clubs';

/**
 * STRONA KLUBU.
 *
 * POWSTALA Z UWAGI PAWLA (13.09.2026): „wchodzimy w klub i jestesmy
 * przekierowani do obecnosci w tym klubie — wedlug mnie powinnismy byc
 * przekierowani do konkretnego klubu i miec tam informacje o tym klubie".
 *
 * Mial racje. Odnosnik z nazwy klubu prowadzil do listy poslow z tym klubem,
 * czyli do kolejnego widoku tych samych ludzi. Tymczasem rejestr Sejmu ma
 * o klubach wlasne dane — pelna nazwe, liczebnosc, kontakt — i nie bylo ich
 * gdzie pokazac.
 *
 * CZEGO TA STRONA CELOWO NIE MA: srednich klubowych („srednia obecnosc
 * klubu", „spojnosc klubu"). Takie liczby dalyby sie policzyc, ale kazda
 * z nich jest NOWA LICZBA O LUDZIACH i wymaga wlasnego mianownika, wlasnego
 * przedzialu ufnosci i wlasnego zdania o tym, czego NIE znaczy — tak jak
 * obecnosc i zgodnosc z klubem na `/poslowie`. Wrzucone tu w biegu byloby
 * dokladnie tym, przed czym bronia sie pozostale strony. Zamiast tego
 * odsylamy do dwoch zestawien, ktore juz maja ten aparat.
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
    const skroty = await pobierzSkrotyKlubow();
    return skroty.map((skrot) => ({ skrot }));
  } catch (e) {
    console.error(`::error::generateStaticParams w [skrot] nie zwrocilo ani jednej sciezki: ${(e as Error).message}`);
    return [];
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ skrot: string }>;
}): Promise<Metadata> {
  const { skrot } = await params;
  const nazwa = decodeURIComponent(skrot);
  return {
    title: `Klub ${nazwa}`,
    description: `Posłowie klubu ${nazwa} w Sejmie X kadencji — pełny skład z rejestru Kancelarii Sejmu.`,
  };
}

export default async function StronaKlubu({ params }: { params: Promise<{ skrot: string }> }) {
  const { skrot } = await params;

  let wynik: Awaited<ReturnType<typeof pobierzKlub>>;
  try {
    wynik = await pobierzKlub(decodeURIComponent(skrot));
  } catch (e) {
    if (e instanceof BrakObiektuWBazie) return <BrakMigracji error={e} />;
    throw e;
  }
  if (!wynik) notFound();

  const { klub, obecni, byli } = wynik;
  const adresListy = `/poslowie?klub=${encodeURIComponent(klub.id)}`;

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[color:var(--color-accent)]">
        Sejm X kadencji
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">{skrotKlubu(klub.id)}</h1>

      {/*
        PELNA NAZWA JEST TRESCIA, NIE PODPISEM. „KO" to nasz skrot roboczy;
        „Klub Parlamentarny Koalicja Obywatelska - Platforma Obywatelska,
        Nowoczesna, Inicjatywa Polska, Zieloni" to nazwa, pod ktora ten klub
        wystepuje w rejestrze. Czytelnik ma prawo wiedziec, co kryje skrot,
        ktorego uzywamy w kazdym wierszu listy.
      */}
      {/*
        PELNA NAZWA TYLKO WTEDY, GDY REJESTR JA MA.

        Przy klubach spoza slownika (D5) `name` jest rowne `id` — rejestr nie
        zna ich pelnej nazwy, bo juz ich nie prowadzi. Wypisanie tego samego
        ciagu dwa razy pod soba wygladalo jak usterka. Zamiast tego mowimy
        wprost, co sie stalo.
      */}
      {klub.name !== klub.id ? (
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-[color:var(--color-ink-soft)]">
          {klub.name}
        </p>
      ) : (
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-[color:var(--color-ink-soft)]">
          Rejestr Sejmu nie prowadzi już tego koła — nie podaje ani jego pełnej nazwy, ani
          liczebności. Kod zachowujemy, bo posłowie byli z nim związani.
        </p>
      )}

      <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-6 border-t border-[color:var(--color-rule)] pt-6 sm:grid-cols-4">
        <div>
          <dt className="text-3xl font-semibold tabular-nums">{obecni.length}</dt>
          <dd className="mt-1 text-[13px] text-[color:var(--color-ink-soft)]">
            {odmien(obecni.length, ['poseł', 'posłowie', 'posłów'])}
          </dd>
        </div>
        {byli.length > 0 && (
          <div>
            <dt className="text-3xl font-semibold tabular-nums">{byli.length}</dt>
            <dd className="mt-1 text-[13px] text-[color:var(--color-ink-soft)]">
              {odmien(byli.length, ['mandat wygasł', 'mandaty wygasły', 'mandatów wygasło'])}
            </dd>
          </div>
        )}
      </dl>

      {/*
        LICZBA Z REJESTRU OBOK NASZEJ, gdy sie roznia.

        `clubs.members_count` liczy czlonkow aktywnych. Nasza liczba powinna
        byc ta sama i 13.09.2026 byla — dla kazdego z trzynastu klubow co do
        jednego. Gdyby kiedys przestala, czytelnik ma to zobaczyc od nas,
        a nie odkryc samodzielnie.
      */}
      {klub.members_count !== null && klub.members_count !== obecni.length && (
        <p className="mt-4 max-w-prose rounded border-l-2 border-[color:var(--color-accent)] bg-black/[0.02] py-2.5 pl-3 text-sm leading-relaxed dark:bg-white/[0.03]">
          <strong>Nasza liczba nie zgadza się z rejestrem.</strong> Rejestr Kancelarii Sejmu podaje{' '}
          {klub.members_count}, my liczymy {obecni.length}. Różnica bierze się z momentu pobrania
          danych — pokazujemy ją zamiast wybierać jedną z dwóch liczb.
        </p>
      )}

      <nav className="mt-8 flex flex-wrap gap-2 font-mono text-xs">
        <Link
          href={`${adresListy}&widok=obecnosc`}
          className="rounded border border-[color:var(--color-rule)] px-3 py-1.5 text-[color:var(--color-ink-soft)] hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-accent)]"
        >
          obecność w tym klubie →
        </Link>
        <Link
          href={`${adresListy}&widok=klub`}
          className="rounded border border-[color:var(--color-rule)] px-3 py-1.5 text-[color:var(--color-ink-soft)] hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-accent)]"
        >
          zgodność z klubem →
        </Link>
      </nav>

      <Sklad tytul="Posłowie klubu" ludzie={obecni} />

      {/*
        BYLI CZLONKOWIE SA OSOBNO I SA PODPISANI. Ukrycie ich lamaloby
        „nikogo nie ukrywamy"; wrzucenie do jednej listy dawaloby liczbe
        niezgodna z rejestrem i sugerowaloby, ze ci ludzie nadal zasiadaja.
      */}
      {byli.length > 0 && (
        <Sklad
          tytul="Mandat wygasł w trakcie kadencji"
          ludzie={byli}
          opis="Ci posłowie należeli do klubu, ale ich mandat wygasł. Rejestr nie liczy ich do składu."
        />
      )}

      {(klub.email || klub.fax || klub.phone) && (
        <section className="mt-12 border-t border-[color:var(--color-rule)] pt-6">
          <h2 className="text-lg font-semibold">Kontakt z rejestru</h2>
          <dl className="mt-3 max-w-prose divide-y divide-[color:var(--color-rule)] border-y border-[color:var(--color-rule)]">
            {klub.email && <Kontakt etykieta="E-mail" wartosc={klub.email} />}
            {klub.phone && <Kontakt etykieta="Telefon" wartosc={klub.phone} />}
            {klub.fax && <Kontakt etykieta="Faks" wartosc={klub.fax} />}
          </dl>
          <p className="mt-2 text-xs text-[color:var(--color-ink-soft)]">
            Dane kontaktowe pochodzą z rejestru klubów Kancelarii Sejmu — nie zbieraliśmy ich sami.{' '}
            <SourceLink href={SEJM_KLUBY} label="Rejestr klubów poselskich w Sejm API" />
          </p>
        </section>
      )}

      <p className="mt-10 max-w-prose border-t border-[color:var(--color-rule)] pt-5 text-xs text-[color:var(--color-ink-soft)]">
        Skład klubu pochodzi z rejestru posłów Kancelarii Sejmu i jest odświeżany co noc.{' '}
        <Link href="/status" className="underline decoration-dotted underline-offset-2">
          Kiedy ostatnio pobieraliśmy dane
        </Link>
        .{' '}
        <Link
          href={`/zglos?typ=mp&co=${encodeURIComponent(`klub ${klub.id}`)}`}
          className="underline decoration-dotted underline-offset-2"
        >
          Zgłoś błąd w tym składzie
        </Link>
        .
      </p>
    </main>
  );
}

function Kontakt({ etykieta, wartosc }: { etykieta: string; wartosc: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 py-2">
      <dt className="text-sm text-[color:var(--color-ink-soft)]">{etykieta}</dt>
      <dd className="text-right font-mono text-[13px]">{wartosc}</dd>
    </div>
  );
}

function Sklad({
  tytul,
  ludzie,
  opis,
}: {
  tytul: string;
  ludzie: PoselNaLiscie[];
  opis?: string;
}) {
  if (!ludzie.length) return null;
  return (
    <section className="mt-12">
      <h2 className="text-lg font-semibold">{tytul}</h2>
      {opis && (
        <p className="mt-1 max-w-prose text-xs leading-relaxed text-[color:var(--color-ink-soft)]">{opis}</p>
      )}
      <ul className="mt-4 grid gap-x-8 border-y border-[color:var(--color-rule)] sm:grid-cols-2 lg:grid-cols-3">
        {ludzie.map((mp) => (
          <li key={mp.id} className="flex items-center gap-3 border-b border-[color:var(--color-rule)] py-2.5 last:border-b-0 sm:[&:nth-last-child(-n+1)]:border-b-0">
            <Portret src={mp.photo_url} nazwa={mp.full_name} rozmiar="sm" />
            <div className="min-w-0">
              <Link
                href={`/posel/${mp.slug}`}
                className="text-sm font-medium hover:text-[color:var(--color-accent)] hover:underline"
              >
                {mp.full_name}
              </Link>
              {mp.district_name && (
                <p className="font-mono text-[11px] text-[color:var(--color-ink-soft)]">
                  okręg {mp.district_num}, {mp.district_name}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
