import { BrakObiektuWBazie } from '@/lib/queries';

/**
 * Brakujaca migracja to stan konfiguracji, nie awaria aplikacji.
 *
 * Pierwsze uruchomienie Sprintu 3 pokazalo czerwony ekran Next.js ze stosem
 * wywolan, bo w bazie nie bylo jeszcze widoku z migracji 0010. Stos wywolan
 * nie mowi, co zrobic. Ten panel mowi.
 */
export function BrakMigracji({ error }: { error: unknown }) {
  const brak = error instanceof BrakObiektuWBazie ? error : null;

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[color:var(--color-warn)]">
        Konfiguracja bazy
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        Schemat bazy jest starszy niż kod
      </h1>

      <p className="mt-4 text-sm leading-relaxed text-[color:var(--color-ink-soft)]">
        To nie jest błąd aplikacji. Brakuje obiektu albo kolumny
        {brak ? <code className="mx-1 font-mono">{brak.obiekt}</code> : ' '}
        w bazie. Są dwie możliwe przyczyny.
      </p>

      <ol className="mt-5 space-y-4 text-sm">
        <li>
          <strong>Migracja nie została uruchomiona.</strong> W SQL Editorze wykonaj całą zawartość:
          <pre className="mt-2 overflow-x-auto rounded border border-[color:var(--color-rule)] bg-black/[0.03] p-3 font-mono text-xs dark:bg-white/[0.04]">
            supabase/migrations/{brak?.migracja ?? '0010_kontekst_nieobecnosci.sql'}
          </pre>
        </li>
        <li>
          <strong>Migracja przeszła, ale PostgREST ma stary cache schematu.</strong>
          <pre className="mt-2 overflow-x-auto rounded border border-[color:var(--color-rule)] bg-black/[0.03] p-3 font-mono text-xs dark:bg-white/[0.04]">
            notify pgrst, &apos;reload schema&apos;;
          </pre>
          <span className="text-[color:var(--color-ink-soft)]">
            Albo w panelu: Settings → API → Reload schema cache.
          </span>
        </li>
      </ol>

      <p className="mt-6 font-mono text-[11px] text-[color:var(--color-ink-soft)]">
        Sprawdź najpierw punkt 2 — jeśli obiekt widać w Table Editorze, to on.
      </p>

      {brak?.szczegol && (
        <p className="mt-3 overflow-x-auto rounded border border-[color:var(--color-rule)] bg-black/[0.03] p-2 font-mono text-[11px] text-[color:var(--color-ink-soft)] dark:bg-white/[0.04]">
          {brak.szczegol}
        </p>
      )}
    </main>
  );
}
