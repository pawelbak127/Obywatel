/**
 * BAZA JEST NIEOSIAGALNA — komunikat dla czytelnika, nie stos wywolan.
 *
 * Ten sam powod, dla ktorego istnieje `BrakMigracji`: czerwony ekran Next.js
 * nie mowi czytelnikowi nic, a kazdy blad, ktory widzi, powinien mowic
 * CZYJA to wina. Tu wina jest nasza i tak to nazywamy.
 *
 * DLACZEGO NIE UDAJEMY, ZE DANYCH NIE MA. Pusta lista klubow czytalaby sie
 * jako „w Sejmie nie ma klubow". Serwis, ktory przy kazdej liczbie stawia
 * odnosnik i pisze, czego NIE wie, nie moze zamieniac wlasnej awarii
 * w fakt o Sejmie.
 *
 * UZYWANY TAKZE PRZY BUDOWANIU BEZ BAZY. CI buduje ze swiadomie zastepczymi
 * kluczami — wtedy ta strona powstaje jako artefakt, ktory nigdy nie zostanie
 * wdrozony, i chodzi wylacznie o to, zeby build nie padl.
 */
export function BrakPolaczenia({ co }: { co: string }) {
  return (
    <main className="mx-auto max-w-6xl px-6 py-16">
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-[color:var(--color-accent)]">
        Awaria po naszej stronie
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        Nie udało się połączyć z bazą danych
      </h1>

      <p className="mt-4 max-w-prose text-sm leading-relaxed text-[color:var(--color-ink-soft)]">
        Nie pokazujemy {co}, bo w tej chwili nie mamy do nich dostępu.{' '}
        <strong className="text-[color:var(--color-ink)]">
          To nie znaczy, że tych danych nie ma
        </strong>{' '}
        — znaczy, że nie umiemy ich teraz odczytać. Spróbuj za chwilę.
      </p>

      <p className="mt-4 max-w-prose text-sm leading-relaxed text-[color:var(--color-ink-soft)]">
        Jeśli to się powtarza, daj nam znać przez{' '}
        <a href="/zglos" className="underline decoration-dotted underline-offset-2">
          formularz zgłaszania błędów
        </a>
        . Stan importów pokazuje{' '}
        <a href="/status" className="underline decoration-dotted underline-offset-2">
          strona o pochodzeniu danych
        </a>
        .
      </p>
    </main>
  );
}
