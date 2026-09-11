/**
 * WYJAŚNIENIE POJĘCIA — dymek „?" bez JavaScriptu.
 *
 * POWÓD ISTNIENIA. Na liście posłów stały zdania w rodzaju „lista posortowana
 * po dolnej granicy przedziału ufności". Zdanie jest prawdziwe i ważne, ale
 * czytelnik, który przyszedł sprawdzić swojego posła, odbija się od niego
 * i wychodzi. Żargon nie znika — schodzi o jedno kliknięcie niżej. Nagłówek
 * mówi po ludzku, dymek tłumaczy dokładnie i uczciwie temu, kto chce wiedzieć.
 *
 * DLACZEGO `<details>`, A NIE `title=""` ANI BIBLIOTEKA.
 *   - `title` nie istnieje na dotyku. Połowa czytelników nie zobaczy go nigdy.
 *   - Dymek na `:hover` jest tym samym problemem w ładniejszej oprawie.
 *   - Biblioteka to komponent kliencki i kilkanaście kilobajtów JS na stronę,
 *     która poza tym nie potrzebuje ani jednej linijki skryptu.
 *
 * `<details>` działa na klawiaturze, na dotyku, przy wyłączonym JS i jest
 * czytany przez czytniki ekranu jako grupa rozwijana. Nic nie trzeba dodawać.
 *
 * UWAGA NA MIEJSCE UŻYCIA. `<details>` to element blokowy w rozumieniu HTML,
 * więc NIE WOLNO go wstawiać do `<p>` — przeglądarka zamknie akapit przed nim,
 * a React zobaczy inne drzewo po stronie serwera i po stronie klienta
 * (błąd hydracji). Wstawiamy go do `<div>`, `<span>`, `<dt>`, `<h2>` — nigdy
 * do akapitu.
 */
export function Wyjasnienie({ tytul, children }: { tytul: string; children: React.ReactNode }) {
  return (
    <details className="group relative inline-block align-middle">
      <summary
        className="ml-1 inline-flex h-4 w-4 cursor-help list-none items-center justify-center rounded-full border border-[color:var(--color-rule)] text-[9px] font-semibold leading-none text-[color:var(--color-ink-faint)] transition-colors marker:content-[''] hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-accent)] group-open:border-[color:var(--color-accent)] group-open:text-[color:var(--color-accent)]"
        aria-label={`Wyjaśnienie: ${tytul}`}
      >
        ?
      </summary>

      {/*
        Panel jest pozycjonowany absolutnie, żeby otwarcie dymka nie przesuwało
        wiersza tabeli. `max-w` w jednostkach viewportu, bo na telefonie
        stała szerokość w pikselach wychodzi poza ekran.
      */}
      <div className="absolute left-0 top-6 z-20 w-[min(22rem,80vw)] rounded border border-[color:var(--color-rule)] bg-[color:var(--color-surface)] p-3 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-[color:var(--color-ink-soft)] shadow-lg">
        <strong className="block text-[color:var(--color-ink)]">{tytul}</strong>
        <span className="mt-1 block">{children}</span>
      </div>
    </details>
  );
}
