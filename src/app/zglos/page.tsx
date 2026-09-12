import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Zgłoś błąd',
  description: 'Formularz zgłaszania błędów w danych prezentowanych w serwisie.',
};

/**
 * FORMULARZ ZGLASZANIA BLEDU.
 *
 * To jest jedyna droga odwolawcza czytelnika — a zwlaszcza posla albo firmy,
 * ktorych dotycza nasze liczby. Serwis, ktory przy kazdej liczbie stawia
 * odnosnik do rejestru i twierdzi, ze mozna go sprawdzic, musi tez miec
 * miejsce, w ktorym ktos powie „sprawdzilem i sie nie zgadza".
 *
 * ZERO JAVASCRIPTU. Zwykly `<form method="post">` na trase /api/zglos.
 * Dlugosci pilnuja atrybuty `required`, `minLength`, `maxLength` — przegladarka
 * egzekwuje je natywnie, bez ani jednej linijki skryptu, a serwer i tak
 * sprawdza wszystko powtornie.
 *
 * DLACZEGO STAN POKAZUJEMY PRZEZ PARAMETR W ADRESIE. Po zapisie trasa
 * przekierowuje tu z `?ok=1` albo `?blad=...`. Bez JS nie ma innego sposobu
 * pokazania wyniku, a przy okazji wychodzi z tego adres, ktory dziala po
 * odswiezeniu i da sie cofnac przyciskiem „wstecz".
 */

const TYPY: ReadonlyArray<{ wartosc: string; etykieta: string }> = [
  { wartosc: 'mp', etykieta: 'Poseł — dane osobowe, klub, okręg, zdjęcie' },
  { wartosc: 'voting', etykieta: 'Głosowanie — wynik, data, przypisany głos' },
  { wartosc: 'process', etykieta: 'Proces legislacyjny — etapy, los ustawy' },
  { wartosc: 'subsidy', etykieta: 'Dotacja lub pomoc publiczna' },
  { wartosc: 'promise', etykieta: 'Obietnica wyborcza' },
  { wartosc: 'ai_content', etykieta: 'Podsumowanie przygotowane przez model językowy' },
];

const BLEDY: Record<string, string> = {
  typ: 'Nie wybrano, czego dotyczy zgłoszenie.',
  krotka:
    'Opis jest za krótki — potrzebujemy przynajmniej dziesięciu znaków, żeby dało się go sprawdzić.',
  dluga: 'Opis jest dłuższy niż cztery tysiące znaków. Skróć go albo napisz, gdzie znajdziemy resztę.',
  email: 'Adres e-mail wygląda na niepoprawny. Możesz go też zostawić pusty.',
  zapis: 'Zgłoszenie nie zostało zapisane z powodu błędu po naszej stronie. Spróbuj ponownie za chwilę.',
};

const POLE =
  'mt-1.5 w-full max-w-lg rounded border border-[color:var(--color-rule)] ' +
  'bg-[color:var(--color-surface)] px-2 py-1.5 text-sm';

export default async function Zglos({
  searchParams,
}: {
  searchParams: Promise<{ typ?: string; id?: string; co?: string; ok?: string; blad?: string }>;
}) {
  const sp = await searchParams;

  const wybranyTyp = TYPY.some((t) => t.wartosc === sp.typ) ? sp.typ : undefined;
  const czego = (sp.id ?? '').slice(0, 64);
  const opisCzego = (sp.co ?? '').slice(0, 120);
  const blad = sp.blad ? BLEDY[sp.blad] : undefined;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Zgłoś błąd w danych</h1>

      {sp.ok === '1' ? (
        /*
          Potwierdzenie ZASTEPUJE formularz, a nie stoi nad nim. Formularz
          zostawiony pod spodem zacheca do wyslania tego samego drugi raz.
        */
        <div className="mt-6 rounded border-l-2 border-[color:var(--color-rule)] bg-black/[0.02] py-3 pl-3 text-sm leading-relaxed dark:bg-white/[0.03]">
          <strong className="font-semibold">Zgłoszenie zapisane. Dziękujemy.</strong>
          <span className="mt-1 block text-[color:var(--color-ink-soft)]">
            Czyta je człowiek. Nie publikujemy zgłoszeń ani nie odpowiadamy automatycznie —
            jeśli zostawiłeś adres e-mail, odezwiemy się tylko wtedy, gdy będzie to potrzebne
            do wyjaśnienia sprawy.
          </span>
          <span className="mt-3 block">
            <Link href="/poslowie" className="underline decoration-dotted underline-offset-2">
              Wróć do zestawienia posłów
            </Link>
          </span>
        </div>
      ) : (
        <>
          <p className="mt-4 max-w-prose text-sm leading-relaxed text-[color:var(--color-ink-soft)]">
            Wszystkie liczby w serwisie pochodzą z oficjalnych rejestrów i przy każdej stoi
            odnośnik do dokumentu źródłowego. Jeśli któraś się nie zgadza, chcemy o tym wiedzieć.
          </p>

          {/*
            To zastrzezenie musi pasc PRZED formularzem, nie po nim. Bez niego
            czesc zgloszen bedzie dotyczyla rzeczy, ktorych nie mozemy zmienic,
            a czytelnik dowie sie o tym dopiero z odpowiedzi albo wcale.
          */}
          <p className="mt-3 max-w-prose text-sm leading-relaxed text-[color:var(--color-ink-soft)]">
            Jedno zastrzeżenie: jeżeli błąd jest już w rejestrze państwowym, my go u siebie
            nie poprawimy — pokazujemy to, co rejestr zawiera, i nie wolno nam tego cicho
            korygować. W takim wypadku zgłoszenie i tak jest cenne: opiszemy rozbieżność albo
            zwrócimy się do instytucji, która rejestr prowadzi.
          </p>

          {blad && (
            <p
              role="alert"
              className="mt-6 max-w-prose rounded border-l-2 border-[color:var(--color-accent)] bg-black/[0.02] py-2.5 pl-3 text-sm leading-relaxed dark:bg-white/[0.03]"
            >
              {blad}
              <span className="mt-1 block text-[color:var(--color-ink-soft)]">
                Wpisana treść nie została wysłana. Przycisk „wstecz" w przeglądarce powinien ją
                przywrócić.
              </span>
            </p>
          )}

          <form method="post" action="/api/zglos" className="mt-8 space-y-6">
            {/*
              POLE-PULAPKA. Czlowiek go nie widzi i nie zatrzyma sie na nim
              tabulatorem; bot wypelnia wszystko, co znajdzie. Odsuniecie za
              krawedz zamiast `hidden`, bo pole ukryte przez `display:none`
              jest dla bota czytelnym sygnalem, ze to pulapka.
            */}
            <div className="absolute left-[-9999px]" aria-hidden="true">
              <label htmlFor="strona-www">Nie wypełniaj tego pola</label>
              <input id="strona-www" name="strona-www" type="text" tabIndex={-1} autoComplete="off" />
            </div>

            <div>
              <label htmlFor="typ" className="block text-sm font-medium">
                Czego dotyczy zgłoszenie
              </label>
              <select id="typ" name="typ" required defaultValue={wybranyTyp ?? ''} className={POLE}>
                <option value="" disabled>
                  — wybierz —
                </option>
                {TYPY.map((t) => (
                  <option key={t.wartosc} value={t.wartosc}>
                    {t.etykieta}
                  </option>
                ))}
              </select>
            </div>

            {/*
              DWA WARIANTY TEGO POLA, i to nie jest ozdoba.

              Z profilu przychodzi identyfikator wpisu (`?id=1`) — liczba, ktora
              dla nas jest kluczem, a dla czytelnika niczym. Wyswietlona
              w edytowalnym polu wygladala jak pomylka i kusila, zeby ja
              skasowac; skasowana — zgloszenie traci powiazanie z wpisem.
              Dlatego identyfikator jedzie ukrytym polem, a czytelnik widzi
              nazwe, ktora rozpoznaje.

              Gdy ktos wchodzi na /zglos wprost, identyfikatora nie ma i pole
              jest zwyklym tekstem — wtedy to czytelnik mowi nam, czego szukac.
            */}
            {czego ? (
              <div>
                <span className="block text-sm font-medium">Zgłoszenie dotyczy</span>
                <p className="mt-1.5 text-sm text-[color:var(--color-ink-soft)]">
                  {opisCzego || czego}{' '}
                  <Link href="/zglos" className="underline decoration-dotted underline-offset-2">
                    zmień
                  </Link>
                </p>
                <input type="hidden" name="czego" value={czego} />
              </div>
            ) : (
              <div>
                <label htmlFor="czego" className="block text-sm font-medium">
                  Którego wpisu{' '}
                  <span className="font-normal text-[color:var(--color-ink-soft)]">
                    — nazwisko, numer druku albo adres strony
                  </span>
                </label>
                <input
                  id="czego"
                  name="czego"
                  type="text"
                  maxLength={64}
                  placeholder="np. Jan Kowalski albo /posel/jan-kowalski"
                  className={POLE}
                />
              </div>
            )}

            <div>
              <label htmlFor="wiadomosc" className="block text-sm font-medium">
                Na czym polega błąd
              </label>
              <p className="mt-1 max-w-prose text-xs leading-relaxed text-[color:var(--color-ink-soft)]">
                Najbardziej pomaga zdanie w rodzaju „u was jest X, a w rejestrze jest Y" — razem
                z odnośnikiem do dokumentu, jeśli go masz.
              </p>
              <textarea
                id="wiadomosc"
                name="wiadomosc"
                required
                minLength={10}
                maxLength={4000}
                rows={7}
                className="mt-1.5 w-full rounded border border-[color:var(--color-rule)] bg-[color:var(--color-surface)] px-2 py-1.5 text-sm leading-relaxed"
              />
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium">
                Twój e-mail{' '}
                <span className="font-normal text-[color:var(--color-ink-soft)]">
                  — nieobowiązkowo
                </span>
              </label>
              <p className="mt-1 max-w-prose text-xs leading-relaxed text-[color:var(--color-ink-soft)]">
                Potrzebny tylko wtedy, gdy trzeba będzie dopytać. Nie zapisujemy Cię na żadną listę
                i nie przekazujemy adresu dalej.
              </p>
              <input id="email" name="email" type="email" maxLength={200} className={POLE} />
            </div>

            <button
              type="submit"
              className="rounded border border-[color:var(--color-accent)] px-4 py-2 font-mono text-sm text-[color:var(--color-accent)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-white"
            >
              wyślij zgłoszenie →
            </button>
          </form>
        </>
      )}
    </main>
  );
}
