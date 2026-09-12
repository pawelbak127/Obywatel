import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/types/db';

/**
 * Zapis zgloszenia bledu. PIERWSZA sciezka w calym serwisie, ktora pisze
 * do bazy z zadania czytelnika — reszta stron tylko czyta.
 *
 * DLACZEGO ZWYKLY `POST` DO TRASY API, A NIE SERVER ACTION.
 * Server Action tez dziala bez JavaScriptu, ale robi to przez ukryte pole
 * z identyfikatorem akcji, ktory zmienia sie przy kazdym buildzie, i przez
 * sciezke, ktorej nie da sie odczytac z kodu HTML strony. Tutaj adres
 * docelowy jest w atrybucie `action` i znaczy dokladnie to, co widac.
 * Przy formularzu, ktory jest dla czytelnika jedyna droga odwolawcza od
 * naszych liczb, przejrzystosc wazy wiecej niz wygoda.
 *
 * KLUCZ ANON, NIE SERVICE ROLE. `createClient()` uzywa klucza anon i pelnego
 * RLS. Prawdziwa bramka jest w polityce „anon zglasza blad" z migracji 0003:
 * wymusza `status = 'new'`, `is_subject = false`, dlugosc wiadomosci 10-4000
 * i zamkniety slownik typow. Walidacja nizej NIE JEST zabezpieczeniem —
 * jest po to, zeby czytelnik dostal zdanie po polsku zamiast bledu z bazy.
 *
 * SPAM. Pole-pulapka lapie naiwne boty i tyle. Klucz anon jest z zalozenia
 * publiczny, wiec kazdy moze wstawiac wiersze prosto do PostgREST-a
 * z pominieciem tego formularza — jakiekolwiek liczenie prob TUTAJ byloby
 * teatrem. Realne ograniczanie tempa musi stanac na brzegu sieci (hosting)
 * albo w bazie; do czasu premiery zostaje moderacja recznie.
 */

/** Dokladnie te wartosci dopuszcza polityka RLS z 0003. Zmiana tu wymaga migracji. */
const TYPY = ['mp', 'voting', 'promise', 'ai_content', 'process', 'subsidy'] as const;
type Typ = (typeof TYPY)[number];

/** Ten sam wzorzec, co w polityce RLS — zeby odrzucic wczesniej i uprzejmiej. */
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function wroc(base: URL, params: Record<string, string>) {
  const u = new URL('/zglos', base);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  // 303, nie 302: przegladarka ma zamienic POST na GET, zeby odswiezenie
  // strony po wyslaniu nie zapisalo zgloszenia drugi raz.
  return NextResponse.redirect(u, 303);
}

export async function POST(request: Request) {
  const base = new URL(request.url);
  const f = await request.formData();

  const tekst = (k: string) => {
    const v = f.get(k);
    return typeof v === 'string' ? v.trim() : '';
  };

  // Pole-pulapka. Czlowiek go nie widzi i nie wypelni; bot wypelnia wszystko.
  // Udajemy sukces zamiast pokazywac blad — bot nie dostaje informacji zwrotnej,
  // ktora pozwolilaby mu sie dostroic.
  if (tekst('strona-www')) return wroc(base, { ok: '1' });

  const typ = tekst('typ');
  const czego = tekst('czego') || 'nieokreslony';
  const wiadomosc = tekst('wiadomosc');
  const email = tekst('email');

  if (!TYPY.includes(typ as Typ)) return wroc(base, { blad: 'typ' });
  if (wiadomosc.length < 10) return wroc(base, { blad: 'krotka', typ });
  if (wiadomosc.length > 4000) return wroc(base, { blad: 'dluga', typ });
  if (email && !EMAIL.test(email)) return wroc(base, { blad: 'email', typ });

  // Wiersz opisany TYPEM Z BAZY, wiec literowka w nazwie kolumny nadal wywala
  // kontrole typow. `status` i `is_subject` zostawiamy domyslne — polityka RLS
  // i tak odrzuci wiersz, ktory probuje ustawic je inaczej, a brak tych pol
  // pokazuje, ze formularz nawet nie ma takiej ambicji.
  const wiersz: Database['public']['Tables']['error_reports']['Insert'] = {
    entity_type: typ,
    entity_id: czego.slice(0, 64),
    message: wiadomosc,
    reporter_email: email || null,
  };

  const supabase = await createClient();
  // `as never` DOTYCZY WYLACZNIE KLIENTA, NIE DANYCH. src/types/db.ts jest
  // generowany w nowszym formacie (klucz `__InternalSupabase`), ktorego
  // @supabase/ssr 0.5.2 nie rozpoznaje — zawezal wiec typ wstawianego wiersza
  // do `never` i odrzucal KAZDY obiekt. Sprawdzone osobno: sam typ `Insert`
  // z pliku rozwiazuje sie poprawnie, wiec blad jest po stronie wersji
  // klienta. Rzutowanie stoi tu, a nie na `wiersz` wyzej, zeby zawartosc
  // nadal byla kontrolowana. Odrzucona alternatywa: podniesienie wersji
  // @supabase/* — to zmiana zaleznosci dotykajaca wszystkich zapytan
  // serwisu, a nie jednego formularza.
  const { error } = await supabase.from('error_reports').insert(wiersz as never);

  if (error) {
    // Tresci bledu z bazy NIE pokazujemy czytelnikowi — moze zawierac nazwy
    // kolumn i tresc polityki. Do logu serwera trafia calosc, do czytelnika kod.
    console.error('[zglos] zapis nieudany:', error.message);
    return wroc(base, { blad: 'zapis', typ });
  }

  return wroc(base, { ok: '1' });
}

/**
 * Wejscie GET-em na adres zapisu to zwykle pomylka albo bot. Odsylamy
 * na formularz zamiast pokazywac 405 z pustym cialem.
 */
export async function GET(request: Request) {
  return NextResponse.redirect(new URL('/zglos', new URL(request.url)), 303);
}
