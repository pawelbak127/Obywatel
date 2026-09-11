import type { MpKontekst } from '@/lib/queries';

/**
 * Liczba razem z jej niepewnoscia — nigdy sam procent.
 *
 * Pasek pokazuje trzy rzeczy naraz:
 *   - wartosc (znacznik),
 *   - przedzial ufnosci 95% (jasniejszy obszar),
 *   - mianownik ("z ilu glosowan") pod spodem.
 *
 * Przy 100 glosowaniach przedzial ma 19 punktow szerokosci i widac to golym
 * okiem. Przy 4 569 glosowaniach jest waski. Czytelnik nie musi rozumiec
 * statystyki, zeby zobaczyc, ktora liczba jest pewna.
 *
 * `null` NIE jest zerem. Brak danych rysujemy jako brak danych — lojalnosc
 * posla w klubie jednoosobowym albo glosujacego wylacznie PRESENT nie wynosi 0%,
 * tylko nie da sie jej policzyc.
 */
export function StatBar({
  label,
  value,
  lo,
  hi,
  denominator,
  denominatorLabel,
  explainNull,
}: {
  label: string;
  value: number | null;
  lo: number | null;
  hi: number | null;
  denominator: number | null;
  denominatorLabel: string;
  explainNull?: string;
}) {
  if (value === null) {
    return (
      <div className="py-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-medium">{label}</span>
          <span className="font-mono text-sm text-[color:var(--color-ink-soft)]">brak danych</span>
        </div>
        {explainNull && (
          <p className="mt-1 text-xs leading-snug text-[color:var(--color-ink-soft)]">{explainNull}</p>
        )}
      </div>
    );
  }

  const dol = lo ?? value;
  const gora = hi ?? value;
  const szerokosc = Math.max(0.4, gora - dol); // minimum, zeby przedzial byl widoczny

  return (
    <div className="py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <span className="font-mono text-sm tabular-nums">
          {value.toFixed(1).replace('.', ',')}%
          {lo !== null && hi !== null && (
            <span className="ml-2 text-xs text-[color:var(--color-ink-soft)]">
              {dol.toFixed(1).replace('.', ',')}–{gora.toFixed(1).replace('.', ',')}%
            </span>
          )}
        </span>
      </div>

      {/*
        SKALA. Bez niej znacznik stoi "gdzies" i nie znaczy nic: przy 99,7%
        doklejal sie do prawej krawedzi i wygladal jak blad renderowania,
        a przy 50,5% jak w polowie pustego paska. Kreska w 50% i dwie liczby
        na koncach wystarcza, zeby pasek dalo sie przeczytac bez zgadywania.
      */}
      <div
        className="relative mt-2 h-2 w-full overflow-hidden rounded-sm bg-black/[0.07] dark:bg-white/[0.09]"
        role="img"
        aria-label={`${label}: ${value.toFixed(1)} procent w skali od 0 do 100, przedział ufności od ${dol.toFixed(1)} do ${gora.toFixed(1)} procent`}
      >
        <span className="absolute inset-y-0 left-1/2 w-px bg-black/[0.16] dark:bg-white/[0.18]" aria-hidden />
        <div
          className="absolute inset-y-0 bg-[color:var(--color-accent)]/25"
          style={{ left: `${dol}%`, width: `${szerokosc}%` }}
        />
        <div
          className="absolute inset-y-0 w-[2px] bg-[color:var(--color-accent)]"
          style={{ left: `calc(${value}% - 1px)` }}
        />
      </div>

      <div
        aria-hidden
        className="mt-1 flex items-baseline justify-between font-mono text-[10px] tabular-nums text-[color:var(--color-ink-faint,#7d8899)]"
      >
        <span>0%</span>
        <span>50%</span>
        <span>100%</span>
      </div>

      <p className="mt-1 font-mono text-[11px] text-[color:var(--color-ink-soft)] tabular-nums">
        {denominator !== null ? `${denominator.toLocaleString('pl-PL')} ${denominatorLabel}` : denominatorLabel}
      </p>
    </div>
  );
}

/**
 * Blok statystyk posla. Obecnosc i udzial stoja obok siebie CELOWO —
 * przy 2,5% glosow typu PRESENT te liczby sie rozjezdzaja, a pokazanie
 * tylko jednej pod etykieta "frekwencja" byloby wyborem narracji.
 */
export function StatystykiPosla({ mp }: { mp: MpKontekst }) {
  const roznica =
    mp.attendance_pct !== null && mp.voted_pct !== null
      ? Math.round((mp.attendance_pct - mp.voted_pct) * 10) / 10
      : null;

  return (
    <section className="divide-y divide-[color:var(--color-rule)]">
      <StatBar
        label="Obecność"
        value={mp.attendance_pct}
        lo={mp.attendance_lo}
        hi={mp.attendance_hi}
        denominator={mp.votes_total}
        denominatorLabel="głosowań w okresie mandatu"
      />
      <StatBar
        label="Udział w głosowaniach"
        value={mp.voted_pct}
        lo={null}
        hi={null}
        denominator={mp.present_count}
        denominatorLabel="razy obecny bez oddania głosu"
      />
      {roznica !== null && roznica >= 1 && (
        <p className="pt-3 text-xs leading-relaxed text-[color:var(--color-ink-soft)]">
          Różnica {roznica.toFixed(1).replace('.', ',')} punktu między obecnością a udziałem oznacza
          głosowania, w których poseł był na sali, ale nie oddał głosu. Sejm nie podaje powodu.
        </p>
      )}
    </section>
  );
}

/**
 * ZGODNOSC Z KLUBEM STOI OSOBNO — i to jest decyzja, nie estetyka.
 *
 * Postawiona w jednym rzedzie z obecnoscia i udzialem czytala sie jako trzecia
 * ocena tego samego rodzaju: im wyzej, tym lepiej. A wysoka zgodnosc da sie
 * czytac dwojako. My tego nie rozstrzygamy — a uklad graficzny rozstrzygal
 * za nas. Kreska i odstep to zdejmuja.
 *
 * BEZ AKAPITU WYJASNIAJACEGO (decyzja Pawla). Pierwsza wersja miala trzy zdania
 * o tym, ze to liczba opisowa, a nie ocena. Kazdy wie, co znaczy "zgodnosc
 * z klubem"; tlumaczenie tego brzmialo protekcjonalnie i rozwadnialo strone.
 * Interpretacje i tak zostawiamy czytelnikowi — samo oddzielenie to wystarcza.
 *
 * Zostaje jedna informacja rzeczowa, przy mianowniku: dlaczego wliczonych
 * glosowan jest mniej niz wszystkich. Bez niej 2 296 przy 4 569 wyglada na blad.
 */
export function ZgodnoscZKlubem({ mp }: { mp: MpKontekst }) {
  return (
    <section className="mt-8 border-t border-[color:var(--color-rule)] pt-6">
      <StatBar
        label="Zgodność z klubem"
        value={mp.loyalty_pct}
        lo={mp.loyalty_lo}
        hi={mp.loyalty_hi}
        denominator={mp.loyalty_votings}
        denominatorLabel="głosowań, w których poseł zajął stanowisko"
        explainNull="Nie da się policzyć: klub liczył mniej niż trzech głosujących albo poseł nie zajmował stanowiska. To nie to samo co 0%."
      />
    </section>
  );
}
