import { inicjaly } from '@/lib/format';

/**
 * PORTRET POSŁA.
 *
 * Dlaczego zwykły `<img>`, a nie `next/image`.
 * Optymalizator Next.js przepuszcza każdy obraz przez funkcję serwerową
 * i liczy to jako transformację. Przy 499 posłach i liście renderowanej
 * przy każdym wejściu zjadłoby to darmowy limit w kilka dni — a projekt stoi
 * na założeniu, że koszt miesięczny ma być bliski zeru. Zdjęcia z Sejm API są
 * małe i statyczne, więc optymalizacja nic tu nie zmienia poza rachunkiem.
 *
 * Dlaczego nie ma `onError`.
 * Obsługa błędu ładowania wymagałaby komponentu klienckiego przy każdym
 * wierszu listy. Zamiast tego pytamy o istnienie pliku RAZ, przy imporcie
 * (HEAD, migracja 0018), a widok wypuszcza adres tylko wtedy, gdy plik jest.
 * Do komponentu nie ma więc jak trafić martwy adres — jeśli trafi, znaczy to,
 * że coś jest nie tak z importem, a nie z tym plikiem.
 *
 * Zastępczy portret to inicjały na neutralnym tle. Świadomie BEZ koloru
 * zależnego od klubu czy od nazwiska: barwa przy twarzy człowieka zawsze
 * coś sugeruje, a my nie mamy nic do zasugerowania.
 */

type Rozmiar = 'sm' | 'md' | 'lg';

const WYMIARY: Record<Rozmiar, { px: number; klasa: string; tekst: string }> = {
  sm: { px: 36, klasa: 'h-9 w-9', tekst: 'text-[11px]' },
  md: { px: 56, klasa: 'h-14 w-14', tekst: 'text-sm' },
  lg: { px: 88, klasa: 'h-22 w-22', tekst: 'text-xl' },
};

export function Portret({
  src,
  nazwa,
  rozmiar = 'sm',
}: {
  src: string | null;
  nazwa: string;
  rozmiar?: Rozmiar;
}) {
  const { px, klasa, tekst } = WYMIARY[rozmiar];
  const wspolne = `${klasa} shrink-0 rounded-full border border-[color:var(--color-rule)] object-cover`;

  if (!src) {
    return (
      <div
        className={`${wspolne} flex items-center justify-center bg-[color:var(--color-surface)] font-mono ${tekst} text-[color:var(--color-ink-faint)]`}
        /*
          `aria-hidden`, bo nazwisko stoi tuż obok jako tekst. Czytnik ekranu,
          który przeczytałby jeszcze inicjały, powiedziałby to samo dwa razy.
        */
        aria-hidden="true"
      >
        {inicjaly(nazwa)}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- świadomie, patrz komentarz u góry pliku
    <img
      src={src}
      alt=""
      aria-hidden="true"
      width={px}
      height={px}
      loading="lazy"
      decoding="async"
      // Serwer Kancelarii Sejmu nie musi wiedzieć, z której podstrony
      // przyszło żądanie o zdjęcie.
      referrerPolicy="no-referrer"
      className={`${wspolne} bg-[color:var(--color-surface)]`}
    />
  );
}
