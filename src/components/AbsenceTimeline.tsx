import type { MiesiacNieobecnosci, KsztaltNieobecnosci } from '@/lib/queries';
import { polskieDaty } from '@/lib/format';

/**
 * Os czasu nieobecnosci — najwazniejszy element profilu.
 *
 * POWOD ISTNIENIA. Pierwszy ranking na zywych danych postawil obok siebie
 * Prezesa Rady Ministrow z obecnoscia 50,5% i posla z obecnoscia 50,3%.
 * Obie liczby prawdziwe, przyczyny krancowo rozne, a Sejm API nie podaje powodu.
 *
 * Tego nie rozwiaze zadna statystyka, ale rozwiazuje to obrazek: nieobecnosc
 * ciagla wyglada jak blok od konkretnego miesiaca, a rozproszona jak rowny szum
 * przez cala kadencje. Czytelnik widzi roznice bez czytania ani jednego zdania.
 *
 * Rysowane inline w SVG — bez biblioteki, bez JavaScriptu po stronie klienta.
 * Dziala na wylaczonym JS i wchodzi do statycznego HTML-a.
 */

const KOLORY: Record<string, { tlo: string; opis: string }> = {
  'brak istotnych nieobecnosci': { tlo: 'var(--color-ok, #1c6b48)', opis: 'Obecność powyżej 90%.' },
  'nieobecnosc ciagla — sprawdz funkcje panstwowa lub przerwe w mandacie': {
    tlo: 'var(--color-warn, #8a5300)',
    opis:
      'Nieobecności skupione w czasie — wyglądają na przerwę w wykonywaniu mandatu, ' +
      'a nie na wzorzec zachowania. Typowe przy objęciu urzędu, chorobie lub dłuższym wyjeździe. ' +
      'Sejm nie podaje powodu; jeśli znamy udokumentowaną funkcję państwową, jest wypisana wyżej.',
  },
  'nieobecnosc czesciowo skupiona w czasie': {
    tlo: 'var(--color-warn, #8a5300)',
    opis: 'Część nieobecności układa się w bloki, część jest rozproszona.',
  },
  'nieobecnosc rozproszona': {
    tlo: 'var(--color-accent, #a6172b)',
    opis: 'Nieobecności rozłożone równomiernie przez całą kadencję — nie widać jednej przerwy.',
  },
};

export function AbsenceTimeline({
  miesiace,
  ksztalt,
  funkcje,
}: {
  miesiace: MiesiacNieobecnosci[];
  ksztalt: KsztaltNieobecnosci;
  funkcje: string | null;
}) {
  if (!miesiace.length) {
    return (
      <p className="text-sm text-[color:var(--color-ink-soft)]">
        Brak głosowań w okresie sprawowania mandatu.
      </p>
    );
  }

  const W = 720;
  const H = 96;
  const szer = W / miesiace.length;
  const opis = KOLORY[ksztalt] ?? KOLORY['nieobecnosc rozproszona']!;

  const etykieta = (m: string) => {
    const d = new Date(m);
    return `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getFullYear()).slice(2)}`;
  };

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Nieobecności w czasie</h2>
        <span className="font-mono text-[11px] text-[color:var(--color-ink-soft)]">
          {miesiace.length} miesięcy · słupek = udział nieobecności w miesiącu
        </span>
      </div>

      <div className="overflow-x-auto rounded border border-[color:var(--color-rule)] bg-[color:var(--color-surface,#fff)]/40 p-3">
        <svg
          viewBox={`0 0 ${W} ${H + 18}`}
          className="h-auto w-full min-w-[520px]"
          role="img"
          aria-label={`Rozkład nieobecności w ${miesiace.length} miesiącach. ${opis.opis}`}
        >
          {/* linia 100% i 50% — bez nich slupki nie maja skali */}
          {[0, 0.5, 1].map((f) => (
            <line
              key={f}
              x1={0}
              x2={W}
              y1={H - f * H}
              y2={H - f * H}
              stroke="var(--color-rule, #dce2ea)"
              strokeWidth={1}
              strokeDasharray={f === 0 ? undefined : '3 3'}
            />
          ))}

          {miesiace.map((m, i) => {
            const pct = m.absent_pct ?? 0;
            const h = Math.max(pct > 0 ? 1.5 : 0, (pct / 100) * H);
            return (
              <g key={m.month}>
                {/*
                  Tekst skladamy w JS i wstawiamy jako JEDNO wyrazenie.
                  Rozbity na kilka wyrazen i zlaman linii dawal inny podzial
                  wezlow tekstowych na serwerze niz w przegladarce — React
                  zglaszal "Hydration failed" dokladnie na tym <title>.
                */}
                <title>{`${etykieta(m.month)}: nieobecny w ${m.absent} z ${m.votings} głosowań (${pct
                  .toFixed(1)
                  .replace('.', ',')}%)`}</title>
                <rect
                  x={i * szer + szer * 0.15}
                  y={H - h}
                  width={Math.max(1, szer * 0.7)}
                  height={h}
                  fill={opis.tlo}
                  opacity={pct >= 80 ? 1 : 0.65}
                />
              </g>
            );
          })}

          {/* etykiety co kilka miesiecy, zeby sie nie zlewaly */}
          {miesiace.map((m, i) =>
            i % Math.ceil(miesiace.length / 8) === 0 ? (
              <text
                key={`t-${m.month}`}
                x={i * szer + szer / 2}
                y={H + 13}
                textAnchor="middle"
                fontSize="9"
                fontFamily="var(--font-mono, monospace)"
                fill="var(--color-ink-soft, #4b5566)"
              >
                {etykieta(m.month)}
              </text>
            ) : null,
          )}
        </svg>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-[color:var(--color-ink-soft)]">{opis.opis}</p>

      {funkcje && (
        <p className="mt-2 rounded border-l-2 border-[color:var(--color-accent)] bg-black/[0.02] py-2 pl-3 text-xs leading-relaxed dark:bg-white/[0.03]">
          <strong className="font-semibold">Funkcje państwowe w tym okresie:</strong>{' '}
          {polskieDaty(funkcje)}
        </p>
      )}
    </section>
  );
}
