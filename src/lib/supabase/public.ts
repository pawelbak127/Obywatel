import { createServerClient } from '@supabase/ssr';
import { publicEnv } from '@/lib/env';
import type { Database } from '@/types/db';

/**
 * KLIENT DO PUBLICZNYCH ODCZYTOW — BEZ CIASTECZEK.
 *
 * ---------------------------------------------------------------------
 * PO CO POWSTAL: PRODUKCJA ZWRACALA 500 NA WSZYSTKICH TRASACH Z PARAMETREM.
 *
 * `/posel/[slug]`, `/okreg/[nr]` i `/klub/[skrot]` wywalaly sie na Vercelu
 * z `DYNAMIC_SERVER_USAGE`. Mechanizm, odtworzony 13.09.2026:
 *
 *   1. Kazda z tych tras ma `generateStaticParams`, wiec Next probuje je
 *      renderowac STATYCZNIE.
 *   2. Kazdy odczyt danych szedl przez `src/lib/supabase/server.ts`, ktory
 *      wola `cookies()` z `next/headers`.
 *   3. `cookies()` w renderze statycznym RZUCA — to jest cala przyczyna.
 *   4. `generateStaticParams` mialo `try/catch` zwracajacy pusta liste.
 *      Wyjatek z punktu 3 wpadal wlasnie tam i ZNIKAL. Build pokazywal
 *      „Generating static pages (8/8)" zamiast pieciuset kilkudziesieciu —
 *      i nikt tego nie zauwazyl, bo build konczyl sie sukcesem.
 *   5. Na produkcji Next probowal wygenerowac strone na zadanie, znowu
 *      trafial na `cookies()` i zwracal 500.
 *
 * Warto zapamietac punkt 4: `try/catch`, ktory mial chronic build przed
 * brakiem bazy, ukryl prawdziwa usterke na tyle skutecznie, ze przeszla
 * przez lokalny build, typecheck i deploy.
 *
 * ---------------------------------------------------------------------
 * DLACZEGO BEZ CIASTECZEK, A NIE `force-dynamic`.
 *
 * `export const dynamic = 'force-dynamic'` tez by to naprawilo — jedna linijka
 * na plik. Odrzucone, bo kazde wejscie na profil bilo by wtedy do bazy:
 * 499 profili razy czytelnicy razy roboty wyszukiwarek, przy koszcie
 * miesiecznym, ktory ma byc bliski zeru. Naprawiamy przyczyne, nie objaw.
 *
 * Strony publiczne NIE MAJA LOGOWANIA. Czytaja kluczem `anon` przez RLS,
 * nie maja sesji i nie maja czego trzymac w ciasteczku. `cookies()` bylo
 * tam z szablonu, nie z potrzeby.
 *
 * Po tej zmianie strony renderuja sie na zadanie i sa buforowane zgodnie
 * z `revalidate` — czyli raz na dobe, tak jak nocny import.
 *
 * ---------------------------------------------------------------------
 * CZEGO TEN KLIENT NIE ROBI.
 *
 * Nie ma sesji i nie ma jak jej zdobyc, wiec `auth.uid()` jest w nim zawsze
 * `null`. Gdyby kiedys powstal modul wymagajacy zalogowanego czytelnika
 * (`promise_votes` ma polityke `auth.uid() = user_id`), MUSI uzyc
 * `server.ts`, a nie tego pliku. Trasa zapisu `/api/zglos` zostaje na
 * `server.ts` z tego samego powodu.
 */
/*
  TEN SAM PAKIET CO `server.ts` (`@supabase/ssr`), TYLKO BEZ `cookies()`.

  Pierwsza wersja tego pliku uzywala `createClient` z `@supabase/supabase-js`
  i NIE KOMPILOWALA SIE: ten pakiet typuje `select()` inaczej i zawezal wynik
  do `GenericStringError[]`, wywracajac kazde rzutowanie `as MpKontekst[]`
  w queries.ts. Sprawdzone w obu wariantach, z parametrem `<Database>`
  i bez — przyczyna jest w pakiecie, nie w typie.

  Zostajemy wiec przy `createServerClient`, a jedyna roznica wobec
  `server.ts` to adapter ciasteczek: tutaj pusty. Dzieki temu typowanie
  wszystkich zapytan jest IDENTYCZNE jak przed zmiana — przy naprawie
  produkcji nie chcemy przy okazji ruszac kontraktu kazdego zapytania.

  Pusty adapter jest bezpieczny, bo nie ma czego czytac ani zapisywac:
  strony publiczne nie maja logowania i nie tworza sesji.
*/
export function createPublicClient() {
  return createServerClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookies: {
      // Nie czytamy ciasteczek i nie zapisujemy ich. To jest cala zmiana,
      // ktora naprawia 500 na produkcji.
      getAll: () => [],
      setAll: () => {},
    },
    global: { headers: { 'X-Client-Info': 'obywatel-public' } },
  });
}
