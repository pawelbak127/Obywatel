import { createClient } from '@/lib/supabase/server';
import { hasPublicConfig, urlConfigError } from '@/lib/env';

// Strona statusu ma pokazywac stan bazy TERAZ, nie z czasu builda.
export const dynamic = 'force-dynamic';

type Row = { label: string; table: string; count: number | null; note: string };

const TABLES: Array<{ label: string; table: string; note: string }> = [
  { label: 'Posłowie', table: 'mps', note: 'komplet kadencji X' },
  { label: 'Kluby', table: 'clubs', note: 'kluby i koła poselskie' },
  { label: 'Głosowania', table: 'votings', note: 'głosowania imienne z protokołów' },
  { label: 'Głosy imienne', table: 'votes', note: 'po jednym na posła i głosowanie' },
  { label: 'Procesy legislacyjne', table: 'legislative_processes', note: 'ścieżka każdego druku' },
  { label: 'Etapy procesów', table: 'process_stages', note: 'kolejne kroki każdego druku' },
  { label: 'Obietnice wyborcze', table: 'promises', note: 'moduł jeszcze nieuruchomiony' },
  { label: 'Podsumowania AI', table: 'ai_contents', note: 'moduł jeszcze nieuruchomiony' },
  { label: 'Źródła', table: 'sources', note: 'jeden wpis na każdy pobrany zasób' },
];

/**
 * Swiezosc danych — od 12.09.2026 GLOWNY fakt tej strony.
 *
 * Liczby wierszy mowia, ILE mamy. Czytelnika bardziej obchodzi, Z KIEDY —
 * bo „obecnosc 51%" policzona z danych sprzed tygodnia to co innego niz ta
 * sama liczba policzona wczoraj. Serwis, ktorego cala teza brzmi „kazda
 * informacja ma pokrycie", jest winien czytelnikowi date pomiaru tak samo
 * jak zrodlo.
 *
 * To jest tez nasz wlasny czujnik: gdyby ta sekcja istniala wczesniej,
 * zauwazylibysmy od razu, ze nocny import przestal chodzic.
 */
type Swiezosc = { job: string; etykieta: string; last_run: string | null; last_error: string | null };

const JOBY: Record<string, string> = {
  mps: 'Posłowie, kluby i zdjęcia',
  votings: 'Głosowania i głosy imienne',
  processes: 'Procesy legislacyjne',
};

async function readFreshness(): Promise<Swiezosc[]> {
  if (!hasPublicConfig || urlConfigError()) return [];
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from('sync_state').select('job, last_run, last_error');
    if (error) return [];
    return (data ?? [])
      .filter((r: { job: string }) => r.job in JOBY)
      .map((r: { job: string; last_run: string | null; last_error: string | null }) => ({
        ...r,
        etykieta: JOBY[r.job] ?? r.job,
      }))
      .sort((a: Swiezosc, b: Swiezosc) => a.etykieta.localeCompare(b.etykieta, 'pl'));
  } catch {
    return [];
  }
}

/** „3 dni temu" czyta sie lepiej niz znacznik czasu z sekundami. */
function ileTemu(iso: string | null): string {
  if (!iso) return 'nigdy';
  const dni = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (dni <= 0) return 'dzisiaj';
  if (dni === 1) return 'wczoraj';
  return `${dni} dni temu`;
}

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
  const [{ rows, error }, swiezosc] = await Promise.all([readCounts(), readFreshness()]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <p className="font-mono text-xs uppercase tracking-[0.16em] text-[color:var(--color-accent)]">
        dane
      </p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight">Skąd pochodzą dane</h1>
      <p className="mt-4 max-w-prose text-[color:var(--color-ink-soft)]">
        Wszystko, co pokazuje ten serwis, pochodzi z oficjalnych rejestrów państwowych i jest
        pobierane automatycznie. Ta strona mówi, <strong className="text-[color:var(--color-ink)]">kiedy</strong>{' '}
        pobraliśmy je ostatnio i ile tego mamy. Tabela pusta nie znaczy „awaria" — znaczy, że
        danego modułu jeszcze nie uruchomiliśmy.
      </p>

      {/*
        SWIEZOSC PRZED LICZBAMI, i to nie jest kwestia kolejnosci na ekranie.

        Liczba wierszy mowi, ile mamy. Data ostatniego pobrania mowi, czy to,
        co czytelnik wlasnie oglada, jest aktualne — a przy danych o obecnosci
        poslow ta druga informacja wazy wiecej. Do 12.09.2026 strona podawala
        wylacznie pierwsza z nich.
      */}
      {swiezosc.length > 0 && (
        <section className="mt-10">
          <h2 className="text-sm font-semibold">Kiedy ostatnio pobieraliśmy</h2>
          <dl className="mt-3 divide-y divide-[color:var(--color-rule)] border-y border-[color:var(--color-rule)]">
            {swiezosc.map((z) => (
              <div key={z.job} className="flex flex-wrap items-baseline justify-between gap-x-4 py-3">
                <dt className="text-sm">{z.etykieta}</dt>
                <dd className="text-right">
                  <span className="text-sm font-medium tabular-nums">{ileTemu(z.last_run)}</span>
                  {z.last_run && (
                    <span className="ml-2 font-mono text-[11px] text-[color:var(--color-ink-faint)]">
                      {new Date(z.last_run).toLocaleDateString('pl-PL')}
                    </span>
                  )}
                  {/*
                    Blad ostatniego importu pokazujemy CZYTELNIKOWI, nie tylko sobie.
                    Serwis, ktory prosi o zaufanie do liczb, nie moze przemilczec,
                    ze ostatnia proba ich odswiezenia sie nie powiodla.
                  */}
                  {z.last_error && (
                    <span className="block text-[11px] leading-snug text-[color:var(--color-accent)]">
                      ostatni import zgłosił błąd
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

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
