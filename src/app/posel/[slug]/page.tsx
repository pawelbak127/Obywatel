import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';

import {
  pobierzPosla,
  pobierzSlugi,
  pobierzNieobecnosciMiesieczne,
  pobierzGlosyPosla,
  pobierzProcesyDlaGlosowan,
  BrakObiektuWBazie,
  type MpKontekst,
  adresAktu,
  type ProcesGlosowania,
  LOS_OPIS,
  opisWeta,
} from '@/lib/queries';
import { BrakMigracji } from '@/components/BrakMigracji';
import { polskieDaty } from '@/lib/format';
import { SourceLink } from '@/components/SourceLink';
import { Portret } from '@/components/Portret';
import { StatystykiPosla, ZgodnoscZKlubem } from '@/components/StatBar';
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

  // Procesy dobieramy PO glosowaniach, bo potrzebujemy ich identyfikatorow.
  // Brak widoku (niewykonana migracja 0016) daje pusta mape, nie wyjatek —
  // profil ma dzialac takze bez tej kolumny.
  const procesy = await pobierzProcesyDlaGlosowan(glosy.map(({ votings: v }) => v.id));

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

      {/*
        Portret stoi OBOK nazwiska, nie nad nagłówkiem. Zdjęcie na całą
        szerokość zepchnęłoby pierwsze liczby poniżej pierwszego ekranu,
        a to one są powodem, dla którego ktoś tu wchodzi.
        `items-start`, bo przy nazwisku łamiącym się na dwie linie portret
        ma zostać przy górnej krawędzi, a nie odjechać na środek.
      */}
      <header className="mt-6 flex items-start gap-4 border-b-2 border-[color:var(--color-ink)] pb-5">
        <Portret src={mp.photo_url} nazwa={mp.full_name} rozmiar="lg" />

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-[color:var(--color-accent)]">
            {mp.klub && <span>{mp.klub}</span>}
            {!mp.active && <span className="text-[color:var(--color-ink-soft)]">mandat wygasł</span>}
            <span className="text-[color:var(--color-ink-soft)] normal-case tracking-normal">
              {mp.zakres_mandatu}
            </span>
          </div>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight">{mp.full_name}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-[color:var(--color-ink-soft)]">
            {/*
              Okręg jest LINKIEM do listy przefiltrowanej tym okręgiem. To jest
              najczęstsze kolejne pytanie czytelnika: „a kto jeszcze startował
              u mnie". Jedno kliknięcie zamiast powrotu i szukania od nowa.
            */}
            {mp.district_num !== null && mp.district_name && (
              <Link
                href={`/poslowie?okreg=${mp.district_num}`}
                className="hover:text-[color:var(--color-accent)] hover:underline"
              >
                okręg {mp.district_num} · {mp.district_name}
              </Link>
            )}
            {okres && <span>głosował w okresie {okres}</span>}
            <SourceLink href={SEJM_MP(mp.id)} label={`Profil posła w Sejm API (id ${mp.id})`} />
          </p>
        </div>
      </header>

      {/*
        Oficjalny powód zakończenia mandatu — z rejestru Sejmu, nie z naszej oceny.
        Stoi PRZED liczbami, bo bez niego „54% obecności" przy stu głosowaniach
        na cztery i pół tysiąca czyta się jak zarzut, a jest opisem sytuacji,
        w której poseł mandatu po prostu już nie sprawował.
      */}
      {mp.powod_zakonczenia && (
        <p className="mt-6 rounded border-l-2 border-[color:var(--color-rule)] bg-black/[0.02] py-2.5 pl-3 text-sm leading-relaxed dark:bg-white/[0.03]">
          {mp.powod_zakonczenia}{' '}
          <span className="text-[color:var(--color-ink-soft)]">
            Wszystkie liczby niżej dotyczą wyłącznie okresu sprawowania mandatu.
            {!mp.w_rankingu && ' Ten profil nie występuje w zestawieniach porównawczych.'}
          </span>
        </p>
      )}

      {/*
        Funkcja panstwowa stoi PRZED liczbami, nie pod osia czasu.
        Blad interpretacyjny rodzi sie przy liczbie 50,5% — wiec kontekst
        musi byc tam, gdzie ta liczba, a nie kilka ekranow nizej.
      */}
      {mp.funkcje_panstwowe && (
        <p className="mt-6 rounded border-l-2 border-[color:var(--color-accent)] bg-black/[0.02] py-2.5 pl-3 text-sm leading-relaxed dark:bg-white/[0.03]">
          <strong className="font-semibold">Funkcja państwowa w tym okresie:</strong>{' '}
          {polskieDaty(mp.funkcje_panstwowe)}
          <span className="block text-xs text-[color:var(--color-ink-soft)]">
            Wpis udokumentowany aktem powołania. Podajemy go, żeby liczby niżej dało się
            czytać w kontekście — nie po to, żeby je usprawiedliwiać.
          </span>
        </p>
      )}

      <div className="mt-8">
        <StatystykiPosla mp={mp} />
      </div>

      <div className="mt-10">
        {/*
          `funkcje` celowo nie jest tu przekazywane — ta sama informacja stoi juz
          wyzej, przy liczbach. Powtorzenie jej pod wykresem nic nie dodawalo.
        */}
        <AbsenceTimeline miesiace={miesiace} ksztalt={mp.ksztalt_nieobecnosci} funkcje={null} />
      </div>

      <ZgodnoscZKlubem mp={mp} />

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
                    {/*
                      Posiedzenie i numer glosowania. Sejm potrafi przeprowadzic
                      kilka glosowan o identycznym tytule tego samego dnia —
                      bez tych dwoch liczb wiersze wygladaja jak duplikat bledu.
                    */}
                    <span className="block text-[10px] text-[color:var(--color-ink-faint,#7d8899)]">
                      {v.sitting}/{v.voting_number}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {v.title}
                    {/*
                      Plakietka z numerem druku tylko wtedy, gdy tytul go NIE zawiera.
                      "Glosowanie proceduralne dotyczace druku nr 2848  druk 2848"
                      to ta sama informacja dwa razy w jednej linii.
                    */}
                    {v.print_numbers?.filter((n) => !v.title.includes(n)).length ? (
                      <span className="ml-2 whitespace-nowrap font-mono text-[11px] text-[color:var(--color-ink-soft)]">
                        druk {v.print_numbers.filter((n) => !v.title.includes(n)).join(', ')}
                      </span>
                    ) : null}
                    <CzegoDotyczylo procesy={procesy.get(v.id) ?? []} />
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

/**
 * Czego dotyczylo glosowanie — proces legislacyjny pod tytulem z protokolu.
 *
 * DWA ZRODLA POWIAZANIA I DWA ROZNE ZDANIA.
 *
 * `etap procesu` znaczy, ze rejestr Sejmu WPROST wskazuje to glosowanie
 * w etapie procesu. To jest wiedza z rejestru i tak ja opisujemy.
 *
 * `numer druku z tytulu` znaczy, ze numer druku wyluskalismy z tytulu
 * glosowania wlasnym wyrazeniem regularnym. Trafnosc zmierzona na 93%,
 * ale to nadal jest nasze parsowanie, nie deklaracja Sejmu — i czytelnik
 * ma prawo wiedziec, ktore z dwojga oglada.
 *
 * Roznica jest maleńka wizualnie i zasadnicza merytorycznie. Zrownanie ich
 * jednym zdaniem "dotyczy ustawy X" byloby przedstawieniem naszego domyslu
 * jako faktu z rejestru.
 */
function CzegoDotyczylo({ procesy }: { procesy: ProcesGlosowania[] }) {
  if (!procesy.length) return null;

  return (
    <ul className="mt-1.5 space-y-1">
      {procesy.map((p) => {
        const zRejestru = p.pewnosc_powiazania === 'etap procesu';


        /*
          „uchwalono" zastepowalo tu CZTERY rozne rzeczy: ustawe opublikowana
          w Dzienniku Ustaw, ustawe zawetowana przez Prezydenta, ustawe
          skierowana do Trybunalu Konstytucyjnego i ustawe swiezo uchwalona,
          ktora czeka na publikacje. `passed` z Sejm API znaczy tylko tyle,
          ze SEJM uchwalil — a droga ustawy na tym sie nie konczy.

          Przy druku 219 (KRS) i 254 (Trybunal Konstytucyjny) czytelnik widzial
          „uchwalono" i mial pelne prawo wywnioskowac, ze te ustawy obowiazuja.
          Nie obowiazuja. Etapy weta siedzialy w naszej bazie od migracji 0016 —
          zaimportowalismy fakt i sami go zaslonilismy.

          Los pochodzi z widoku (migracja 0019) i jest wyprowadzony wylacznie
          z etapow rejestru. Gdy widok go nie zna — bo migracja nie poszla —
          wracamy do starego, uczciwie ogolnego zdania.
        */
        /*
          LOS MA PIERWSZENSTWO NAD FLAGA `passed` — od migracji 0024.

          Wczesniej stalo tu `p.passed ? … : 'nie uchwalono'`, wiec flaga
          rozstrzygala pierwsza. Przy pietnastu procesach, w ktorych Sejm nie
          odrzucil weta, dawalo to DWA PRZECIWNE komunikaty przy tym samym
          fakcie: szesc drukow z `passed = false` czytalo sie jako
          „nie uchwalono" (czyli „Sejm byl przeciw", choc byl za), a dziewiec
          z `passed = true` jako „Prezydent zawetowal", bez slowa o tym, ze
          sprawa jest zamknieta.

          Los pochodzi ze slow rejestru i jest konsekwentny, flaga nie jest.
          Gdy widok losu nie zna — bo migracja nie poszla — wracamy do flagi.
        */
        const los = p.los_procesu ? LOS_OPIS[p.los_procesu] : null;
        const etykieta = los?.etykieta ?? (p.passed ? 'uchwalono przez Sejm' : 'nie uchwalono');

        /*
          D1: zdanie o skutku prawnym ma prowadzic do aktu. Gdy adresu nie ma,
          etykieta zostaje zwyklym tekstem — nie udajemy zrodla.

          LINKUJEMY WYLACZNIE ETYKIETE POCHODZACA Z LOSU (od migracji 0025).
          Powod jest konkretny: druk 921 to „Poselski wniosek o wyrazenie wotum
          nieufnosci", ktorego Sejm NIE przyjal — `passed = false`, wiec los
          jest pusty i etykieta brzmi „nie uchwalono". Ale proces MA adres
          w Monitorze Polskim (MP/2025/55), bo opublikowano dokument o tej
          sprawie. Bez tego warunku napis „nie uchwalono" stawal sie LINKIEM
          DO AKTU — czyli zdaniem „tego nie uchwalono" prowadzacym do czegos,
          co wyglada na obowiazujace prawo.

          Adres przy procesie nieuchwalonym nie jest dowodem uchwalenia.
          Gdy etykieta pochodzi z gołej flagi `passed`, zostaje zwyklym tekstem.
        */
        const adres = los ? adresAktu(p) : null;

        return (
          <li key={p.print_number} className="text-[11px] leading-snug">
            <span className="text-[color:var(--color-ink-soft)]">
              {p.document_type ?? 'proces'} nr {p.print_number}:{' '}
            </span>
            <span>{p.title_final ?? p.process_title}</span>
            {p.closure_date && (
              <>
                {' · '}
                {adres ? (
                  <a
                    href={adres}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium underline decoration-dotted underline-offset-2 hover:text-[color:var(--color-accent)]"
                  >
                    {etykieta}
                  </a>
                ) : (
                  <span
                    className={`font-medium ${
                      p.los_procesu === 'weto' ||
                      p.los_procesu === 'trybunal' ||
                      p.los_procesu === 'weto_utrzymane'
                        ? 'text-[color:var(--color-warn)]'
                        : ''
                    }`}
                  >
                    {etykieta}
                  </span>
                )}
                {/*
                  Jedno zdanie wyjasnienia stoi TU, a nie w slowniczku na dole
                  strony. „Prezydent zawetowal" bez zdania o wiekszosci 3/5
                  jest prawda, ktora czytelnik i tak musi gdzies sprawdzic.
                */}
                {los?.wyjasnienie && (
                  <span className="block text-[color:var(--color-ink-soft)]">
                    {los.wyjasnienie}
                  </span>
                )}
                {/*
                  Fakty o wecie stoja OBOK SIEBIE, nie sklejone we wniosek.
                  Rejestr mowi dwie rzeczy osobno: ze Prezydent zlozyl wniosek
                  i ze Sejm ten wniosek rozpatrywal. Nie mowi, jak Sejm zaglosowal.
                  Napisanie "Sejm weta nie odrzucil" byloby wnioskowaniem
                  z nieobecnosci danych — dokladnie tym, czego ten serwis nie robi.
                */}
                {/*
                  Przy `weto_utrzymane` NIE wolamy opisWeta(): etykieta mowi juz,
                  ze weto sie utrzymalo, a dopisek „rejestr odnotowuje wniosek
                  Prezydenta oraz rozpatrywanie tego wniosku" brzmialby przy niej
                  jak wahanie. Ta funkcja zostaje dla wet, przy ktorych rejestr
                  naprawde milczy o wyniku — po migracji 0024 jest ich 48.
                */}
                {p.los_procesu !== 'weto_utrzymane' && opisWeta(p) && (
                  <span className="block text-[color:var(--color-ink-soft)]">{opisWeta(p)}</span>
                )}
              </>
            )}
            <span
              className="ml-1 font-mono text-[10px] text-[color:var(--color-ink-faint,#7d8899)]"
              title={
                zRejestru
                  ? 'Powiązanie pochodzi z rejestru Sejmu — etap procesu wskazuje to głosowanie.'
                  : 'Powiązanie wynika z numeru druku wyłuskanego z tytułu głosowania przez nas, nie z rejestru.'
              }
            >
              {zRejestru ? '[z rejestru]' : '[z tytułu]'}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
