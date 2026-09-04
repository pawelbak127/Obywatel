import { createClient } from '@/lib/supabase/server';
import { hasPublicConfig, urlConfigError } from '@/lib/env';

// Strona statusu ma pokazywac stan bazy TERAZ, nie z czasu builda.
export const dynamic = 'force-dynamic';

type Row = { label: string; table: string; count: number | null; note: string };

const TABLES: Array<{ label: string; table: string; note: string }> = [
  { label: 'Posłowie', table: 'mps', note: 'oczekiwane 499 po Sprincie 1' },
  { label: 'Kluby', table: 'clubs', note: 'oczekiwane 12' },
  { label: 'Głosowania', table: 'votings', note: 'oczekiwane ~4 150 po Sprincie 2' },
  { label: 'Głosy imienne', table: 'votes', note: 'oczekiwane ~1,9 mln' },
  { label: 'Procesy legislacyjne', table: 'legislative_processes', note: 'Sprint 4' },
  { label: 'Obietnice', table: 'promises', note: 'Sprint 4' },
  { label: 'Treści AI', table: 'ai_contents', note: 'Sprint 5' },
  { label: 'Źródła', table: 'sources', note: 'jeden wpis na każdy pobrany zasób' },
];

async function readCounts(): Promise<{ rows: Row[]; error: string | null }> {
  if (!hasPublicConfig) {
    return { rows: [], error: 'Brak konfiguracji Supabase — uzupełnij .env.local' };
  }
  // Adres ze ścieżką /rest/v1 daje 404 na każdym zapytaniu. Mówimy o tym wprost,
  // zamiast pokazywać tabelę samych zer, która wygląda jak pusta baza.
  const urlError = urlConfigError();
  if (urlError) return { rows: [], error: urlError };

  try {
    const supabase = await createClient();
    const rows = await Promise.all(
      TABLES.map(async (t) => {
        // `estimated` zamiast `exact`. COUNT(*) na tabeli `votes` to pełny skan
        // 2,1 mln wierszy — przekracza statement_timeout roli `anon` i wraca błędem.
        // PostgREST przy `estimated` czyta oszacowanie z planera dla dużych tabel,
        // a dla małych i tak liczy dokładnie. Strona statusu nie potrzebuje
        // dokładności co do wiersza; potrzebuje odpowiedzi.
        const { count, error } = await supabase
          .from(t.table)
          .select('*', { count: 'estimated', head: true });
        // count === null przy braku błędu oznacza HEAD, które nie doszło do bazy.
        return { ...t, count: error || count === null ? null : count };
      }),
    );
    return { rows, error: null };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : 'Nieznany błąd połączenia' };
  }
}

export default async function StatusPage() {
  const { rows, error } = await readCounts();

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <p className="font-mono text-xs uppercase tracking-[0.16em] text-[color:var(--color-accent)]">
        Sprint 0 · szkielet
      </p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight">Obywatel 2.0</h1>
      <p className="mt-4 max-w-prose text-[color:var(--color-ink-soft)]">
        Ta strona istnieje po to, żeby jednym spojrzeniem potwierdzić, że deploy działa, a aplikacja
        widzi bazę. Puste tabele na tym etapie są poprawnym wynikiem — dane wjeżdżają w Sprincie 1.
      </p>

      <nav className="mt-6 flex gap-2 font-mono text-xs">
        <a
          href="/poslowie"
          className="rounded border border-[color:var(--color-accent)] px-3 py-1.5 text-[color:var(--color-accent)]"
        >
          obecność posłów →
        </a>
      </nav>

      {error ? (
        <div className="mt-10 rounded border border-[color:var(--color-accent)] bg-white/60 p-5 dark:bg-black/20">
          <p className="font-mono text-xs uppercase tracking-widest text-[color:var(--color-accent)]">
            Brak połączenia
          </p>
          <p className="mt-2 text-sm">{error}</p>
        </div>
      ) : (
        <div className="mt-10 overflow-x-auto rounded border border-[color:var(--color-rule)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[color:var(--color-rule)] bg-black/[0.03] dark:bg-white/[0.04]">
                <th className="px-4 py-3 text-left font-mono text-[11px] font-medium uppercase tracking-widest text-[color:var(--color-ink-soft)]">
                  Tabela
                </th>
                <th className="px-4 py-3 text-right font-mono text-[11px] font-medium uppercase tracking-widest text-[color:var(--color-ink-soft)]">
                  Wierszy
                </th>
                <th className="px-4 py-3 text-left font-mono text-[11px] font-medium uppercase tracking-widest text-[color:var(--color-ink-soft)]">
                  Docelowo
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.table} className="border-b border-[color:var(--color-rule)] last:border-0">
                  <td className="px-4 py-2.5">
                    {r.label} <span className="font-mono text-xs opacity-50">{r.table}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                    {r.count === null ? (
                      <span className="text-[color:var(--color-accent)]">błąd</span>
                    ) : (
                      r.count.toLocaleString('pl-PL')
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-[color:var(--color-ink-soft)]">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-8 font-mono text-xs leading-relaxed text-[color:var(--color-ink-soft)]">
        Odczyt kluczem anon przez RLS. Jeśli liczby się wyświetliły, polityka „publiczny odczyt”
        działa; jeśli <code>npm run smoke</code> przechodzi, zapis jest zamknięty.
        <br />
        Liczby dużych tabel są szacowane przez planer — dokładny <code>COUNT(*)</code> na 2 mln
        wierszy przekracza limit czasu zapytania i nie jest tu do niczego potrzebny.
      </p>
    </main>
  );
}
