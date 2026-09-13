import Link from 'next/link';

import { createClient } from '@/lib/supabase/server';
import { hasPublicConfig } from '@/lib/env';
import {
  pobierzOkregi,
  pobierzOstatnieProcesy,
  adresAktu,
  LOS_OPIS,
  type Okreg,
  type ProcesOstatni,
} from '@/lib/queries';
import { polskieDaty } from '@/lib/format';
import { SourceLink } from '@/components/SourceLink';

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

/**
 * Okregi do wyboru na wejsciu. Blad NIE wywraca strony glownej — lista
 * okregow jest udogodnieniem, a nie trescia. Gdy zabraknie widoku, zostaje
 * samo przejscie do pelnego zestawienia.
 */
async function okregi(): Promise<Okreg[]> {
  if (!hasPublicConfig) return [];
  try {
    return await pobierzOkregi();
  } catch {
    return [];
  }
}

/**
 * Przebieg procesu w rejestrze Sejmu. Nie eksportujemy tego — `page.tsx`
 * dopuszcza tylko ustalony zestaw eksportow (CLAUDE.md §8).
 *
 * POTRZEBNE, BO `adresAktu()` NIE WYSTARCZA NA TEJ SEKCJI. Adres aktu
 * istnieje dopiero po publikacji, a najswiezsze procesy z definicji jeszcze
 * opublikowane nie sa — zmierzone 12.09.2026: zadna z pieciu pozycji nie
 * miala ani `isap_url`, ani `eli_address`. Sekcja stalaby wiec na stronie,
 * ktora obiecuje odnosnik przy kazdej informacji, bez ani jednego zrodla.
 *
 * Przebieg procesu istnieje od chwili zlozenia druku i jest tym samym
 * rejestrem, z ktorego bierzemy los. Gdy akt juz jest, ma pierwszenstwo —
 * prowadzi do tekstu, a nie do opisu drogi.
 */
const SEJM_PROCES = (druk: string) => `https://api.sejm.gov.pl/sejm/term10/processes/${druk}`;

/**
 * Ostatnio zamkniete procesy. Blad NIE wywraca strony glownej — tak samo
 * jak przy liczbach i okregach, sekcja po prostu znika.
 */
async function ostatnie(): Promise<ProcesOstatni[]> {
  if (!hasPublicConfig) return [];
  try {
    return await pobierzOstatnieProcesy(5);
  } catch {
    return [];
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
  const [l, lista, procesy] = await Promise.all([policz(), okregi(), ostatnie()]);

  return (
    <main className="mx-auto max-w-6xl px-6 py-16">
      {/*
        NAGLOWEK JEST PYTANIEM CZYTELNIKA, NIE OPISEM SERWISU.

        Bylo: „Co robia poslowie, ktorych wybralismy" — zdanie prawdziwe,
        ale opisujace nas, nie jego. Czytelnik nie przychodzi z pytaniem
        „co robia poslowie"; przychodzi z pytaniem o KONKRETNEGO posla,
        najczesciej swojego. Naglowek nazywa teraz to pytanie i prowadzi
        wprost do pola wyboru okregu, ktore stoi zaraz pod nim.

        Zakres serwisu (ustawy, pieniadze publiczne) niesie akapit nizej —
        naglowek ma otwierac droge, a nie wyliczac dzialy.

        SWIADOMIE NIE KOPIUJEMY cudzego sformulowania. Sejmograf pyta „Czy
        Twoj posel chodzi na glosowania?" i jest to lepsze zdanie niz nasze
        poprzednie — ale zawezone do obecnosci, a my pytamy tez o to, JAK
        glosuje. Podpatrzony zostal chwyt (pytanie zamiast opisu), nie tekst.
      */}
      <h1 className="max-w-prose text-4xl font-semibold tracking-tight sm:text-5xl">
        Kto reprezentuje Twój okręg i jak głosuje?
      </h1>

      <p className="mt-5 max-w-prose text-lg leading-relaxed text-[color:var(--color-ink-soft)]">
        Głosowania w Sejmie, droga każdej ustawy i pieniądze publiczne — złożone
        z oficjalnych rejestrów państwowych. Przy każdej liczbie stoi odnośnik do dokumentu,
        z którego pochodzi.
      </p>

      {/* ---------------------------------------------------------------
          WEJSCIE W DANE PRZEZ OKREG, NIE PRZEZ RANKING.

          Do 12.09.2026 stal tu jeden przycisk i nic wiecej — strona glowna
          nie pokazywala ani jednego nazwiska, glosowania czy ustawy, tylko
          cztery zaokraglone liczby i trzy akapity o zasadach. Czytelnik
          musial uwierzyc na slowo, zanim cokolwiek zobaczyl.

          Rozwazana i ODRZUCONA alternatywa: wiersz rankingu („najczesciej
          nieobecni") wprost na stronie glownej. Dawalby konkret natychmiast,
          ale serwis, ktory w trzech akapitach obiecuje „nie zgadujemy
          powodow", otwieralby sie lista wstydu — a przedzial ufnosci (D10)
          chroni przed niesprawiedliwoscia statystyczna, nie przed rama
          interpretacyjna, ktora czytelnik zabiera ze soba dalej.

          Okreg odpowiada na inne pytanie: nie „kto jest najgorszy", tylko
          „kto reprezentuje mnie". Prowadzi do tych samych danych, filtr
          juz istnieje, a formularz to zwykly GET — bez JavaScriptu.
      --------------------------------------------------------------- */}
      {lista.length > 0 ? (
        <form method="get" action="/okreg" className="mt-8 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-wider text-[color:var(--color-ink-faint)]">
              twój okręg wyborczy
            </span>
            <select
              name="nr"
              defaultValue=""
              className="w-72 max-w-full rounded border border-[color:var(--color-rule)] bg-[color:var(--color-surface)] px-2 py-1.5 text-sm"
            >
              {/*
                Pusta wartosc nie znaczy „pokaz wszystkich poslow", tylko
                „nie wiem, ktory to okreg" — i prowadzi na spis okregow
                pogrupowany wojewodztwami. Tak wlasnie szuka czytelnik,
                ktory swojego numeru nie zna, a to jest wiekszosc.
              */}
              <option value="">nie wiem — pokaż spis okręgów</option>
              {lista.map((o) => (
                <option key={o.district_num} value={o.district_num}>
                  {o.district_num} · {o.district_name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="rounded border border-[color:var(--color-accent)] px-4 py-2 font-mono text-sm text-[color:var(--color-accent)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-white"
          >
            pokaż →
          </button>

          <Link
            href="/poslowie"
            className="pb-2 font-mono text-xs text-[color:var(--color-ink-soft)] underline decoration-dotted underline-offset-2 hover:text-[color:var(--color-accent)]"
          >
            albo wszyscy posłowie
          </Link>
        </form>
      ) : (
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/poslowie"
            className="rounded border border-[color:var(--color-accent)] px-4 py-2 font-mono text-sm text-[color:var(--color-accent)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-white"
          >
            obecność posłów →
          </Link>
        </div>
      )}

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
      <p className="mt-3 max-w-prose text-xs text-[color:var(--color-ink-soft)]">
        Liczby pobierane na żywo z bazy. Są to szacunki — dokładne policzenie
        dwóch milionów wierszy przekracza limit czasu zapytania. Wartości bez
        zaokrąglenia pokazuje{' '}
        <Link href="/status" className="underline decoration-dotted underline-offset-2">
          strona stanu bazy
        </Link>
        .
      </p>

      {/* ---------------------------------------------------------------
          CO OSTATNIO PRZESZLO PRZEZ SEJM.

          Pierwsza tresc na stronie glownej, ktora jest danymi, a nie
          deklaracja — piec prawdziwych ustaw z data, losem i odnosnikiem
          do rejestru. Czytelnik widzi, ze serwis zyje, zanim zdecyduje,
          czy nam wierzy.

          NAGLOWEK MOWI „przeszlo przez Sejm", NIE „rozstrzygnieto".
          Na tej liscie staja obok siebie ustawa opublikowana w Dzienniku
          i ustawa zawetowana — druga nie jest rozstrzygnieta i nazwanie jej
          tak byloby dokladnie tym bledem, przed ktorym broni typ LosProcesu.
          Prawde o kazdym wierszu mowi jego wlasna etykieta.

          Odnosnik stoi tylko tam, gdzie rejestr ma akt. Brak odnosnika jest
          informacja — D1 zabrania udawac zrodlo, ktorego nie ma.
      --------------------------------------------------------------- */}
      {procesy.length > 0 && (
        <section className="mt-14 border-t border-[color:var(--color-rule)] pt-8">
          <h2 className="text-lg font-semibold">Co ostatnio przeszło przez Sejm</h2>

          <ul className="mt-5 divide-y divide-[color:var(--color-rule)] border-y border-[color:var(--color-rule)]">
            {procesy.map((p) => {
              const akt = adresAktu(p);
              return (
                <li key={p.print_number} className="py-3">
                  <p className="max-w-prose text-sm leading-snug">{p.tytul}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-[color:var(--color-ink-soft)]">
                    <span className="tabular-nums">{polskieDaty(p.closure_date)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{LOS_OPIS[p.los].etykieta}</span>
                    <span aria-hidden="true">·</span>
                    <span>druk {p.print_number}</span>
                    <SourceLink
                      href={akt ?? SEJM_PROCES(p.print_number)}
                      label={
                        akt
                          ? `Tekst aktu w oficjalnym rejestrze (druk ${p.print_number})`
                          : `Przebieg procesu legislacyjnego w rejestrze Sejmu (druk ${p.print_number})`
                      }
                    />
                  </p>
                </li>
              );
            })}
          </ul>

          <p className="mt-3 max-w-prose text-xs text-[color:var(--color-ink-soft)]">
            Pięć procesów o najświeższej dacie zamknięcia w rejestrze Sejmu. „Uchwalono" nie
            znaczy „obowiązuje" — dlatego przy każdym stoi, co się z nim stało dalej.
          </p>
        </section>
      )}

      {/* ---------------------------------------------------------------
          Zasady. Nie "o nas", tylko konkretne zobowiazania, ktore czytelnik
          moze sprawdzic na dowolnej podstronie w piec sekund.
      --------------------------------------------------------------- */}
      <section className="mt-14 space-y-6 border-t border-[color:var(--color-rule)] pt-8">
        <h2 className="text-lg font-semibold">Na czym to stoi</h2>

        <div className="max-w-prose space-y-5 text-sm leading-relaxed text-[color:var(--color-ink-soft)]">
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

      <p className="mt-12 border-t border-[color:var(--color-rule)] pt-6 text-xs max-w-prose text-[color:var(--color-ink-soft)]">
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
