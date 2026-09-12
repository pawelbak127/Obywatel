import Link from 'next/link';
import type { Metadata } from 'next';

import {
  pobierzRanking,
  pobierzOkregi,
  BrakObiektuWBazie,
  type MpKontekst,
  type Metryka,
  type Okreg,
} from '@/lib/queries';
import { BrakMigracji } from '@/components/BrakMigracji';
import { Portret } from '@/components/Portret';
import { Wyjasnienie } from '@/components/Wyjasnienie';
import { polskieDaty, procent, skalaDo } from '@/lib/format';

export const revalidate = 86400;

export const metadata: Metadata = {
  title: 'Posłowie',
  description:
    'Kto najczęściej opuszcza głosowania i kto najczęściej głosuje inaczej niż jego klub. ' +
    'Sejm X kadencji — z liczbą głosowań, marginesem błędu i kontekstem. Dane z Sejm API.',
};

/* =====================================================================
   RANKING Z KONTEKSTEM — decyzja redakcyjna projektu.

   Każdy wiersz obowiązkowo niesie cztery rzeczy obok procentu:
     1. mianownik — „X z Y głosowań", bo mandaty trwają różnie długo,
     2. margines błędu — bo 54% ze 100 prób to nie to samo co 54% z 4 569,
     3. kształt nieobecności — bo przerwa i wzorzec wyglądają tak samo,
     4. funkcję państwową, jeśli jest udokumentowana.

   Sortowanie po DOLNEJ granicy przedziału, nie po surowym procencie.
   Nikogo nie ukrywamy i nikogo nie pokazujemy bez kontekstu.

   ZMIANA W TEJ WERSJI: żargon zszedł o jedno kliknięcie niżej.
   Nagłówek pyta „Kto najczęściej opuszcza głosowania?", a „dolna granica
   przedziału ufności" siedzi w dymku dla tych, którzy chcą wiedzieć.
   Liczby są te same — zmieniło się tylko to, kto rozumie pierwsze zdanie.
   ===================================================================== */

type Widok = {
  /** Etykieta zakładki. */
  zakladka: string;
  /** Nagłówek H1 — pytanie, nie termin. */
  naglowek: string;
  wprowadzenie: string;
  /** Podpisy przełącznika kierunku, w kolejności [„najgorsi", „najlepsi"]. */
  kierunki: readonly [string, string];
};

const WIDOKI: Record<Metryka, Widok> = {
  obecnosc: {
    zakladka: 'obecność',
    naglowek: 'Kto najczęściej opuszcza głosowania?',
    wprowadzenie:
      'Obecność to udział głosowań, w których poseł oddał głos. Sejm nie podaje, ' +
      'dlaczego posła nie było — więc my też nie podajemy.',
    kierunki: ['najczęściej nieobecni', 'najczęściej obecni'],
  },
  niezgodnosc: {
    zakladka: 'zgodność z klubem',
    naglowek: 'Kto najczęściej głosuje inaczej niż jego klub?',
    wprowadzenie:
      'Odsetek głosowań, w których poseł zagłosował inaczej niż większość jego klubu. ' +
      'Sejm nie publikuje, czy obowiązywała dyscyplina — pokazujemy sam fakt rozbieżności.',
    kierunki: ['najczęściej inaczej', 'najrzadziej inaczej'],
  },
};

const LIMIT = 60;

export default async function Poslowie({
  searchParams,
}: {
  searchParams: Promise<{ kierunek?: string; q?: string; okreg?: string; widok?: string }>;
}) {
  const sp = await searchParams;
  const najlepsi = sp.kierunek === 'najlepsi';
  const metryka: Metryka = sp.widok === 'klub' ? 'niezgodnosc' : 'obecnosc';
  const fraza = (sp.q ?? '').trim().slice(0, 60);

  // Okręg z adresu jest danymi od użytkownika. Parsujemy go na liczbę i wszystko,
  // co nie jest liczbą całkowitą, po prostu przepada — nie ma tu czego czyścić,
  // bo do zapytania nie trafia tekst.
  const okregRaw = Number.parseInt(sp.okreg ?? '', 10);
  const okreg = Number.isInteger(okregRaw) && okregRaw > 0 ? okregRaw : null;

  let lista: MpKontekst[];
  let okregi: Okreg[];
  try {
    [lista, okregi] = await Promise.all([
      pobierzRanking({ kierunek: najlepsi ? 'najlepsi' : 'najgorsi', limit: LIMIT, szukaj: fraza, okreg, metryka }),
      pobierzOkregi(),
    ]);
  } catch (e) {
    if (e instanceof BrakObiektuWBazie) return <BrakMigracji error={e} />;
    throw e;
  }

  const w = WIDOKI[metryka];
  const filtrowane = Boolean(fraza) || okreg !== null;

  // Skala paska. Dla obecności zakres jest naturalnie pełny (0–100%), dla
  // niezgodności mieści się w praktyce poniżej 35% — pasek 0–100 dałby 60
  // niemal identycznych kresek. Górna granica jest podpisana pod listą.
  const skala =
    metryka === 'niezgodnosc' ? skalaDo(lista.map((m) => m.niezgodnosc_hi), 10) : 100;

  /** Adres z zachowaniem wszystkich pozostałych filtrów. */
  const adres = (
    zmiana: Partial<{ kierunek: string | null; widok: string | null; okreg: string | null; q: string | null }>,
  ) => {
    const p = new URLSearchParams();
    const kier = 'kierunek' in zmiana ? zmiana.kierunek : najlepsi ? 'najlepsi' : null;
    const wid = 'widok' in zmiana ? zmiana.widok : metryka === 'niezgodnosc' ? 'klub' : null;
    const okr = 'okreg' in zmiana ? zmiana.okreg : okreg !== null ? String(okreg) : null;
    const q = 'q' in zmiana ? zmiana.q : fraza;
    if (kier) p.set('kierunek', kier);
    if (wid) p.set('widok', wid);
    if (okr) p.set('okreg', okr);
    if (q) p.set('q', q);
    const s = p.toString();
    return s ? `/poslowie?${s}` : '/poslowie';
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[color:var(--color-accent)]">
        Sejm X kadencji
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">{w.naglowek}</h1>
      <p className="mt-4 max-w-prose text-sm leading-relaxed text-[color:var(--color-ink-soft)]">
        {w.wprowadzenie}
      </p>

      {/* ---------------------------------------------------------------
          Przełącznik metryki. Dwie różne odpowiedzialności posła — bycie
          na sali i głosowanie po swojemu — mają osobne listy, a nie dwie
          kolumny w jednej tabeli. Czytelnik za każdym razem wie, na co patrzy.
      --------------------------------------------------------------- */}
      <nav className="mt-7 flex gap-4 border-b border-[color:var(--color-rule)] text-sm" aria-label="Rodzaj zestawienia">
        {(Object.keys(WIDOKI) as Metryka[]).map((klucz) => {
          const aktywna = klucz === metryka;
          return (
            <Link
              key={klucz}
              href={adres({ widok: klucz === 'niezgodnosc' ? 'klub' : null, kierunek: null })}
              aria-current={aktywna ? 'page' : undefined}
              className={`-mb-px border-b-2 px-0.5 pb-2 ${
                aktywna
                  ? 'border-[color:var(--color-accent)] font-medium text-[color:var(--color-ink)]'
                  : 'border-transparent text-[color:var(--color-ink-soft)] hover:text-[color:var(--color-accent)]'
              }`}
            >
              {WIDOKI[klucz].zakladka}
            </Link>
          );
        })}
      </nav>

      {/* ---------------------------------------------------------------
          FILTRY. Zwykły formularz GET — bez JavaScriptu. Działa z wyłączonymi
          skryptami, adres z wynikiem da się wysłać komuś, a „wstecz" robi to,
          czego czytelnik oczekuje.

          Okręg jest tu priorytetem: „mój poseł" to w praktyce „poseł z mojego
          okręgu", a nie nazwisko, które trzeba znać z góry.
      --------------------------------------------------------------- */}
      <form method="get" action="/poslowie" className="mt-5 flex flex-wrap items-end gap-2">
        {najlepsi && <input type="hidden" name="kierunek" value="najlepsi" />}
        {metryka === 'niezgodnosc' && <input type="hidden" name="widok" value="klub" />}

        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[color:var(--color-ink-faint)]">
            okręg wyborczy
          </span>
          <select
            name="okreg"
            defaultValue={okreg === null ? '' : String(okreg)}
            className="w-60 rounded border border-[color:var(--color-rule)] bg-[color:var(--color-surface)] px-2 py-1.5 text-xs outline-none focus:border-[color:var(--color-accent)]"
          >
            <option value="">wszystkie okręgi</option>
            {okregi.map((o) => (
              <option key={o.district_num} value={o.district_num}>
                {o.district_num}. {o.district_name} ({o.poslow})
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[color:var(--color-ink-faint)]">
            nazwisko albo klub
          </span>
          <input
            type="search"
            name="q"
            defaultValue={fraza}
            placeholder="np. Kowalski"
            className="w-48 rounded border border-[color:var(--color-rule)] bg-[color:var(--color-surface)] px-2 py-1.5 text-xs outline-none placeholder:text-[color:var(--color-ink-faint)] focus:border-[color:var(--color-accent)]"
          />
        </label>

        <button
          type="submit"
          className="rounded border border-[color:var(--color-rule)] px-3 py-1.5 font-mono text-xs text-[color:var(--color-ink-soft)] hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-accent)]"
        >
          pokaż
        </button>
        {filtrowane && (
          <Link
            href={adres({ okreg: null, q: null })}
            className="pb-1.5 font-mono text-xs text-[color:var(--color-ink-soft)] underline decoration-dotted underline-offset-2 hover:text-[color:var(--color-accent)]"
          >
            wyczyść
          </Link>
        )}
      </form>

      <nav className="mt-4 flex flex-wrap items-center gap-2 font-mono text-xs">
        <Link
          href={adres({ kierunek: null })}
          className={`rounded border px-3 py-1.5 ${!najlepsi ? 'border-[color:var(--color-accent)] text-[color:var(--color-accent)]' : 'border-[color:var(--color-rule)] text-[color:var(--color-ink-soft)]'}`}
        >
          {w.kierunki[0]}
        </Link>
        <Link
          href={adres({ kierunek: 'najlepsi' })}
          className={`rounded border px-3 py-1.5 ${najlepsi ? 'border-[color:var(--color-accent)] text-[color:var(--color-accent)]' : 'border-[color:var(--color-rule)] text-[color:var(--color-ink-soft)]'}`}
        >
          {w.kierunki[1]}
        </Link>

        <span className="ml-auto inline-flex items-center text-[color:var(--color-ink-faint)]">
          sortowanie
          <Wyjasnienie tytul="Dlaczego nie sortujemy po samym procencie">
            Sortujemy po dolnej granicy 95% przedziału ufności (metoda Wilsona) — tej samej,
            którą sklepy układają oceny produktów. Poseł z dwutygodniowym mandatem i wynikiem
            54% ze 100 głosowań wiedziałby o sobie znacznie mniej niż poseł z 54% z 4 569 —
            a w rankingu po surowym procencie stanęliby obok siebie. Dzięki przedziałowi krótki
            mandat nie wygrywa zestawienia przypadkiem i nie znika z niego, gdy wynik jest
            naprawdę słaby.
          </Wyjasnienie>
        </span>
      </nav>

      {/* Ostrzeżenie merytoryczne — zostaje, ale krótsze i tylko tam, gdzie dotyczy. */}
      {metryka === 'obecnosc' && (
        <div className="mt-5 max-w-prose rounded border-l-2 border-[color:var(--color-accent)] bg-black/[0.02] py-2.5 pl-3 text-sm leading-relaxed dark:bg-white/[0.03]">
          <strong>Sejm nie podaje powodu nieobecności.</strong> Sprawowanie urzędu, choroba,
          urlop rodzicielski i nieprzychodzenie do pracy wyglądają w danych identycznie.
          Kolumna „kształt" mówi tylko tyle, czy nieobecności skupiają się w czasie.
        </div>
      )}
      {metryka === 'niezgodnosc' && (
        <div className="mt-5 max-w-prose rounded border-l-2 border-[color:var(--color-accent)] bg-black/[0.02] py-2.5 pl-3 text-sm leading-relaxed dark:bg-white/[0.03]">
          <strong>To nie jest miara buntu.</strong> Sejm nie publikuje, czy w danym głosowaniu
          obowiązywała dyscyplina klubowa. Głosowanie z niej zwolnione, brak stanowiska klubu
          i pomyłka przy przycisku wyglądają w danych tak samo — pokazujemy rozbieżność,
          nie jej powód.
        </div>
      )}

      {filtrowane && (
        <p className="mt-5 text-sm text-[color:var(--color-ink-soft)]">
          {lista.length === 0 ? (
            <>Nic nie pasuje do tych filtrów. Szukamy po nazwisku i skrócie klubu — spróbuj samego nazwiska.</>
          ) : (
            <>
              <strong className="text-[color:var(--color-ink)]">{lista.length}</strong>
              {lista.length === 1 ? ' wynik' : lista.length < 5 ? ' wyniki' : ' wyników'}
              {okreg !== null && ` z okręgu nr ${okreg}`}
              {fraza && ` dla „${fraza}"`}. To wycinek listy, więc numery pozycji nie mają tu
              sensu — nie pokazujemy ich.
            </>
          )}
        </p>
      )}

      {lista.length > 0 && (
        <ol className="mt-6 divide-y divide-[color:var(--color-rule)] border-y border-[color:var(--color-rule)]">
          {lista.map((mp, i) => (
            /*
              Numer pozycji tylko na pełnej liście. Przy filtrowaniu „1" obok
              nazwiska czytałoby się jako „pierwsze miejsce w rankingu", a jest
              to pierwszy wiersz wycinka — czyli dokładnie ta liczba bez
              mianownika, którą sami piętnujemy na stronie głównej.
            */
            <Wiersz
              key={mp.id}
              mp={mp}
              pozycja={filtrowane ? null : i + 1}
              metryka={metryka}
              skala={skala}
            />
          ))}
        </ol>
      )}

      <p className="mt-4 font-mono text-[11px] text-[color:var(--color-ink-faint)]">
        {metryka === 'niezgodnosc'
          ? `Pasek w skali 0–${skala}%. Zakres dopasowany do danych — najwyższa niezgodność w Sejmie tej kadencji nie sięga jednej trzeciej.`
          : 'Pasek w skali 0–100%. Jaśniejsze pole to margines błędu, kreska to zmierzony wynik.'}
      </p>

      {lista.length >= LIMIT && !filtrowane && (
        <p className="mt-3 text-xs text-[color:var(--color-ink-soft)]">
          Pokazujemy {LIMIT} skrajnych wyników z 499 posłów. Żeby znaleźć konkretną osobę,
          użyj okręgu albo nazwiska — nie ukrywamy nikogo, po prostu nie zmieścimy wszystkich naraz.
        </p>
      )}

      <p className="mt-6 text-xs text-[color:var(--color-ink-soft)]">
        Dane pochodzą z Sejm API. Każdy profil zawiera link do oficjalnego protokołu każdego
        głosowania. Jeśli widzisz błąd, zgłoś go — poprawimy i opiszemy poprawkę.
      </p>
    </main>
  );
}

function Wiersz({
  mp,
  pozycja,
  metryka,
  skala,
}: {
  mp: MpKontekst;
  pozycja: number | null;
  metryka: Metryka;
  skala: number;
}) {
  const obecnosc = metryka === 'obecnosc';
  const pct = obecnosc ? mp.attendance_pct : mp.niezgodnosc_z_klubem_pct;
  const dol = (obecnosc ? mp.attendance_lo : mp.niezgodnosc_lo) ?? pct ?? 0;
  const gora = (obecnosc ? mp.attendance_hi : mp.niezgodnosc_hi) ?? pct ?? 0;
  const podstawa = obecnosc ? mp.votes_total : (mp.loyalty_votings ?? 0);
  const ciagla = mp.ksztalt_nieobecnosci.startsWith('nieobecnosc ciagla');

  // Procent szerokości paska w SKALI WIDOKU, nie w skali 0–100. Bez tego
  // przy niezgodności wszystkie paski byłyby kreskami przy lewej krawędzi.
  const naSkali = (v: number) => Math.min(100, Math.max(0, (v / skala) * 100));

  return (
    <li className="grid grid-cols-[1.75rem_1fr] gap-x-3 py-4 sm:grid-cols-[1.75rem_1fr_11rem]">
      <span className="pt-2.5 font-mono text-xs tabular-nums text-[color:var(--color-ink-faint)]">
        {pozycja ?? ''}
      </span>

      <div className="flex min-w-0 gap-3">
        <Portret src={mp.photo_url} nazwa={mp.full_name} rozmiar="sm" />

        {/*
          `flex-1` DOPEŁNIA poszerzenie kontenera do max-w-6xl i bez niego
          tamta zmiana pogarszałaby stronę zamiast poprawiać.

          Portret ma sztywne 36 px, a ten blok bez klasy rozciągającej brałby
          szerokość z treści (`flex: 0 1 auto`). Cała dodana szerokość lądowała
          więc w pustym pasie między nazwiskiem a kolumną paska, zamiast trafić
          tam, gdzie są dane. Teraz idzie do zdania kontekstu, które przy
          wąskiej kolumnie łamało się na trzy linie.

          `min-w-0` zostaje — bez niego `truncate` w środku przestaje działać,
          bo element flex nie kurczy się poniżej swojej treści.
        */}
        <div className="min-w-0 flex-1">
          <Link
            href={`/posel/${mp.slug}`}
            className="font-medium hover:text-[color:var(--color-accent)] hover:underline"
          >
            {mp.full_name}
          </Link>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-[color:var(--color-ink-soft)]">
            {mp.klub && <span>{mp.klub}</span>}
            {mp.district_name && (
              <>
                <span aria-hidden="true">·</span>
                <span>okręg {mp.district_num}, {mp.district_name}</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">
              {obecnosc
                ? `${(mp.votes_total - (mp.absent_count ?? 0)).toLocaleString('pl-PL')} z ${mp.votes_total.toLocaleString('pl-PL')} głosowań`
                : `z ${podstawa.toLocaleString('pl-PL')} głosowań klubowych`}
            </span>
            {mp.zakres_mandatu !== 'pelna kadencja' && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-[color:var(--color-warn)]">{mp.zakres_mandatu}</span>
              </>
            )}
          </div>

          {/*
            Kolejność jest tu istotna. Jeśli rejestr podaje powód zakończenia
            mandatu, pokazujemy JEGO — a nie nasz domysł o kształcie nieobecności.
            Poseł, który zrzekł się mandatu po wyborze do Parlamentu Europejskiego,
            nie „opuszczał głosowań": on ich po prostu nie miał.
          */}
          {mp.powod_zakonczenia ? (
            <p className="mt-1 text-[11px] leading-snug text-[color:var(--color-ink-soft)]">
              {mp.powod_zakonczenia} Procent liczony jest wyłącznie z głosowań przypadających
              na czas sprawowania mandatu.
            </p>
          ) : (
            <>
              {/*
                Funkcja państwowa pokazuje się ZAWSZE, gdy jest udokumentowana.
                Wcześniej była schowana pod warunkiem „nieobecność ciągła" — przez
                co Prezes Rady Ministrów, którego nieobecności są częściowo
                rozproszone, nie dostawał w rankingu żadnego kontekstu, mimo że
                wpis w mp_roles istniał. Ranking łamał wtedy własną zasadę (D11).
              */}
              {mp.funkcje_panstwowe && (
                <p className="mt-1 text-[11px] leading-snug">
                  <span className="text-[color:var(--color-ink-soft)]">W tym okresie: </span>
                  <span className="font-medium">{polskieDaty(mp.funkcje_panstwowe)}</span>
                </p>
              )}
              {obecnosc && ciagla && (
                <p className="mt-1 text-[11px] leading-snug text-[color:var(--color-ink-soft)]">
                  Nieobecności skupione w czasie — wygląda na przerwę w wykonywaniu mandatu,
                  nie na wzorzec.{mp.funkcje_panstwowe ? '' : ' Powód nieznany z danych.'}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <div className="col-span-2 mt-2 sm:col-span-1 sm:mt-0">
        <div className="flex items-baseline justify-between gap-2 sm:justify-end">
          <span className="font-mono text-sm tabular-nums">{procent(pct)}%</span>
          <span className="font-mono text-[10.5px] tabular-nums text-[color:var(--color-ink-soft)]">
            ±{procent((gora - dol) / 2 || 0)} pkt
          </span>
        </div>
        {/*
          WYSOKOSC h-2.5, nie h-1.5. Przy szescdziesieciu wierszach jeden nad
          drugim roznica miedzy 11,5% a 14,5% byla praktycznie niewidoczna,
          a pasek jest tu glownym nosnikiem informacji — liczba obok podaje
          wartosc, ale to pasek pozwala POROWNAC posla z poslem.
        */}
        <div
          className="relative mt-1.5 h-2.5 w-full overflow-hidden rounded-sm bg-black/[0.07] dark:bg-white/[0.09]"
          role="img"
          aria-label={`${procent(pct)} procent, margines błędu od ${procent(dol)} do ${procent(gora)}`}
        >
          {/* Krycie /45, nie /25 — pole przedzialu ufnosci ma byc odrozniane
              od tla toru golym okiem, a nie tylko istniec w kodzie. */}
          <div
            className="absolute inset-y-0 bg-[color:var(--color-accent)]/45"
            style={{ left: `${naSkali(dol)}%`, width: `${Math.max(0.4, naSkali(gora) - naSkali(dol))}%` }}
          />
          {/* Kreska 3px zamiast 2px, bo po wzmocnieniu pola cienka ginela.
              `- 1.5px` to polowa nowej szerokosci — bez tego srodek kreski
              przestalby stac dokladnie na wartosci. */}
          <div
            className="absolute inset-y-0 w-[3px] bg-[color:var(--color-accent)]"
            style={{ left: `calc(${naSkali(pct ?? 0)}% - 1.5px)` }}
          />
        </div>
      </div>
    </li>
  );
}
