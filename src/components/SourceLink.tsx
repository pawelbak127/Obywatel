/**
 * KOMPONENT ZEROWY. Powstaje pierwszy, bo wszystko inne go uzywa.
 *
 * Wymog z dokumentacji projektu brzmi: "Każda informacja musi posiadać link
 * do oficjalnego państwowego rejestru". Baza wymusza to po swojej stronie
 * (`source_id NOT NULL`), ale baza nie widzi, co renderuje przegladarka.
 *
 * Tutaj wymusza to TypeScript: `href` jest wymagany i nie ma wartosci domyslnej.
 * Nie da sie wstawic <SourceLink /> "na razie bez linku, potem sie doda".
 * Kompilacja padnie.
 *
 * Zasada redakcyjna: liczba bez tego komponentu obok nie ma prawa trafic
 * na strone. Jesli gdzies jej nie ma, to jest blad do naprawienia, a nie
 * niedopracowany szczegol.
 */

type Props = {
  /** Adres OFICJALNEGO rejestru. Nie nasz, nie posrednika. */
  href: string;
  /** Co dokladnie jest pod tym linkiem — czytane przez czytniki ekranu. */
  label: string;
  /** Kiedy pobralismy dane. UOKiK wymaga tego przy republikacji danych SUDOP. */
  retrievedAt?: string | null;
  className?: string;
};

export function SourceLink({ href, label, retrievedAt, className = '' }: Props) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={
        retrievedAt
          ? `${label} — dane pobrane ${new Date(retrievedAt).toLocaleDateString('pl-PL')}`
          : label
      }
      className={
        'inline-flex items-center gap-1 align-middle font-mono text-[11px] text-[color:var(--color-ink-soft)] ' +
        'underline decoration-dotted underline-offset-2 transition-colors ' +
        'hover:text-[color:var(--color-accent)] focus-visible:outline focus-visible:outline-2 ' +
        'focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)] ' +
        className
      }
    >
      <span aria-hidden="true">↗</span>
      <span className="sr-only">Źródło: </span>
      źródło
    </a>
  );
}

/**
 * Wersja dla treści wygenerowanej przez model językowy.
 *
 * Drugi wymóg prawny projektu: każde podsumowanie AI musi mieć widoczną metkę.
 * Widok `public_ai_contents` gwarantuje, że dane bez metki nie wyjdą z bazy;
 * ten komponent gwarantuje, że metka nie zniknie w warstwie widoku.
 *
 * Adnotacja jest CZĘŚCIĄ komponentu, nie osobnym elementem obok — nie da się
 * jej pominąć przez zapomnienie, a na zrzucie ekranu z telefonu widać ją
 * razem z treścią.
 */
export function AiSummary({
  body,
  model,
  disclaimer,
  sourceHref,
  sourceLabel,
}: {
  body: string;
  model: string;
  disclaimer: string;
  sourceHref: string;
  sourceLabel: string;
}) {
  return (
    <figure className="my-4 rounded border border-[color:var(--color-rule)] bg-black/[0.02] p-4 dark:bg-white/[0.03]">
      <figcaption className="mb-2 flex flex-wrap items-center gap-2 font-mono text-[10.5px] uppercase tracking-widest text-[color:var(--color-accent)]">
        <span className="rounded-sm border border-current px-1.5 py-0.5">Wygenerowane przez SI</span>
        <span className="text-[color:var(--color-ink-soft)] normal-case tracking-normal">{model}</span>
        <SourceLink href={sourceHref} label={sourceLabel} />
      </figcaption>
      <div className="text-sm leading-relaxed">{body}</div>
      <p className="mt-3 border-t border-[color:var(--color-rule)] pt-2 text-xs text-[color:var(--color-ink-soft)]">
        {disclaimer}
      </p>
    </figure>
  );
}
