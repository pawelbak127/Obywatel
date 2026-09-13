import 'server-only';

/*
  KLIENT BEZ CIASTECZEK — pelne uzasadnienie w `supabase/public.ts`.

  W skrocie: `server.ts` wola `cookies()`, a `cookies()` w renderze
  statycznym rzuca `DYNAMIC_SERVER_USAGE`. Przez to wszystkie trasy
  z parametrem (`/posel/[slug]`, `/okreg/[nr]`, `/klub/[skrot]`) zwracaly
  na produkcji 500. Strony publiczne nie maja logowania, wiec ciasteczka
  byly tu z szablonu, nie z potrzeby.

  Zapis zgloszenia bledu (`/api/zglos`) NADAL idzie przez `server.ts`.
*/
import { createPublicClient } from '@/lib/supabase/public';

/**
 * Warstwa dostepu do danych dla stron publicznych.
 *
 * Wszystko czyta kluczem anon przez RLS — strona nie ma i nie potrzebuje
 * uprawnien wiekszych niz przypadkowy uzytkownik. Jesli cos tu przestanie
 * dzialac po zmianie polityk, to znaczy, ze polityki sa za ciasne, a nie
 * ze strona potrzebuje service_role.
 *
 * Typy sa recznie opisane, bo `src/types/db.ts` to na razie atrapa.
 * Po `npm run db:types` mozna je zastapic wygenerowanymi.
 */

/**
 * Brak obiektu w bazie to NIE jest awaria aplikacji — to brakujaca migracja.
 * Zamiast stosu wywolan pokazujemy, co uruchomic.
 *
 * PGRST205 = "Could not find the table ... in the schema cache". Dwie przyczyny:
 * migracja nie zostala wykonana albo PostgREST ma stary cache.
 */
export class BrakObiektuWBazie extends Error {
  constructor(
    readonly obiekt: string,
    readonly migracja: string,
    readonly szczegol?: string,
  ) {
    super(
      `Schemat bazy jest starszy niz kod ("${obiekt}"). Uruchom supabase/migrations/${migracja}, ` +
        "a jesli juz to zrobiles — przeladuj cache: notify pgrst, 'reload schema';" +
        (szczegol ? ` [${szczegol}]` : ''),
    );
    this.name = 'BrakObiektuWBazie';
  }
}

const MIGRACJE: Record<string, string> = {
  // 0023 przedefiniowala ten widok (coalesce na adres zdjecia). Wskazanie
  // 0018 cofneloby te zmiane po cichu, wygladajac na skuteczna naprawe.
  mp_obecnosc_kontekst: '0023_zdjecia_u_siebie.sql',
  okregi_wyborcze: '0018_zdjecia_okregi_niezgodnosc.sql',
  glosowanie_z_procesem: '0025_niezmienniki_losu.sql',
  proces_los: '0025_niezmienniki_losu.sql',
  procesy_ostatnie: '0026_procesy_ostatnie.sql',
  mp_absence_monthly: '0010_kontekst_nieobecnosci.sql',
  mp_stats_ranking: '0009_przedzialy_ufnosci.sql',
  mp_stats: '0002_rls_hardening.sql',
};

function sprawdzBlad(obiekt: string, error: { code?: string; message: string } | null): void {
  if (!error) return;
  // Brak obiektu ALBO brak kolumny w obiekcie to ten sam problem z punktu widzenia
  // uzytkownika: schemat bazy jest starszy niz kod. Widok mp_obecnosc_kontekst
  // w migracji 0010 nie przekazywal siedmiu kolumn, o ktore pyta ta warstwa —
  // komunikat "column ... does not exist" wygladal jak blad aplikacji, a byl
  // brakiem migracji 0011.
  const brakSchematu =
    error.code === 'PGRST205' ||
    error.code === '42703' ||
    /schema cache/i.test(error.message) ||
    /does not exist/i.test(error.message);

  if (brakSchematu) {
    throw new BrakObiektuWBazie(obiekt, MIGRACJE[obiekt] ?? 'najnowsza migracja', error.message);
  }
  throw new Error(`${obiekt}: ${error.message}`);
}

export type ZakresMandatu = 'pelna kadencja' | 'ponad polowa kadencji' | 'czesc kadencji' | 'krotki mandat';

export type KsztaltNieobecnosci =
  | 'brak istotnych nieobecnosci'
  | 'nieobecnosc ciagla — sprawdz funkcje panstwowa lub przerwe w mandacie'
  | 'nieobecnosc czesciowo skupiona w czasie'
  | 'nieobecnosc rozproszona';

export type MpKontekst = {
  id: number;
  full_name: string;
  slug: string;
  klub: string | null;
  active: boolean;

  /**
   * Adres zdjęcia — albo `null`.
   *
   * Widok wypuszcza adres WYŁĄCZNIE dla posłów, u których importer sprawdził
   * HEAD-em, że plik istnieje (migracja 0018). `null` znaczy „nie mamy
   * zdjęcia", nie „coś się popsuło" — interfejs rysuje wtedy inicjały.
   */
  photo_url: string | null;
  district_num: number | null;
  district_name: string | null;
  voivodeship: string | null;

  votes_total: number;
  attendance_pct: number | null;
  attendance_lo: number | null;
  attendance_hi: number | null;
  voted_pct: number | null;
  present_count: number | null;
  absent_count: number | null;
  loyalty_pct: number | null;
  loyalty_lo: number | null;
  loyalty_hi: number | null;
  loyalty_votings: number | null;

  /**
   * Odsetek głosowań, w których poseł zagłosował INACZEJ niż większość swojego
   * klubu — czyli `100 - loyalty_pct`, liczone w widoku z tej samej kolumny.
   *
   * NIE nazywa się „bunt" świadomie. Sejm nie publikuje, czy w danym głosowaniu
   * obowiązywała dyscyplina klubowa; zmierzyć da się wyłącznie rozbieżność
   * z większością klubu. Głosowanie zwolnione z dyscypliny, brak stanowiska
   * klubu i pomyłka przy przycisku wyglądają w danych tak samo. Nazwa mówi
   * dokładnie tyle, ile wiemy — interpretację zostawiamy czytelnikowi.
   *
   * `null`, gdy klub miał mniej niż 3 głosujących (poseł nie może być własną
   * większością — próg z migracji 0004).
   */
  niezgodnosc_z_klubem_pct: number | null;
  niezgodnosc_lo: number | null;
  niezgodnosc_hi: number | null;

  niepewnosc_pkt: number | null;
  zakres_mandatu: ZakresMandatu;
  first_voted_at: string | null;
  last_voted_at: string | null;
  miesiecy_lacznie: number | null;
  miesiecy_prawie_bez_obecnosci: number | null;
  ksztalt_nieobecnosci: KsztaltNieobecnosci;
  funkcje_panstwowe: string | null;

  /** Kategoria z rejestru Sejmu: 'Zgon', 'Zrzeczenie', … Null, gdy mandat trwa. */
  inactive_cause: string | null;
  /** Zdanie rejestru, np. „Wybrany na posła do Parlamentu Europejskiego". */
  waiver_desc: string | null;
  /** Gotowe zdanie dla interfejsu, złożone w widoku. Null = mandat trwa. */
  powod_zakonczenia: string | null;
  /**
   * Czy wiersz wchodzi do zestawień porównawczych.
   *
   * `false` wyłącznie wtedy, gdy mandat wygasł z powodu śmierci. Profil posła
   * zostaje dostępny z pełnymi liczbami — nie zestawiamy tylko zmarłych
   * w rankingu rozliczającym z obecności (decyzja D17).
   */
  w_rankingu: boolean;
};

export type MiesiacNieobecnosci = {
  month: string;
  votings: number;
  present: number;
  absent: number;
  absent_pct: number | null;
};

const KOLUMNY_KONTEKST =
  'id, full_name, slug, klub, active, photo_url, district_num, district_name, voivodeship, ' +
  'votes_total, attendance_pct, attendance_lo, attendance_hi, ' +
  'voted_pct, present_count, absent_count, loyalty_pct, loyalty_lo, loyalty_hi, loyalty_votings, ' +
  'niezgodnosc_z_klubem_pct, niezgodnosc_lo, niezgodnosc_hi, ' +
  'niepewnosc_pkt, zakres_mandatu, first_voted_at, last_voted_at, ' +
  'miesiecy_lacznie, miesiecy_prawie_bez_obecnosci, ksztalt_nieobecnosci, funkcje_panstwowe, ' +
  'inactive_cause, waiver_desc, powod_zakonczenia, w_rankingu';

export async function pobierzPosla(slug: string): Promise<MpKontekst | null> {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from('mp_obecnosc_kontekst')
    .select(KOLUMNY_KONTEKST)
    .eq('slug', slug)
    .maybeSingle();
  sprawdzBlad('mp_obecnosc_kontekst', error);
  return (data as MpKontekst | null) ?? null;
}

/**
 * Ranking. Sortowanie po DOLNEJ granicy przedzialu, nie po surowym procencie —
 * inaczej lista czolowa jest lista krotkich mandatow, a nie zachowan.
 *
 * `w_rankingu` odsiewa poslow, ktorych mandat wygasl z powodu smierci.
 * Filtr jest TUTAJ, w jednej funkcji, a nie w komponencie — zeby nowa strona
 * z zestawieniem nie mogla go pominac przez przeoczenie. Profil posla czyta
 * przez `pobierzPosla`, ktore tego filtra nie ma i miec nie powinno.
 */
export type Metryka = 'obecnosc' | 'niezgodnosc';

export async function pobierzRanking(
  opts: {
    kierunek?: 'najgorsi' | 'najlepsi';
    limit?: number;
    szukaj?: string;
    okreg?: number | null;
    /**
     * DOKLADNY skrot klubu, nie fraza. To osobny parametr od `szukaj`
     * z konkretnego powodu: `szukaj` idzie przez `ilike.%fraza%` po nazwisku
     * ORAZ po klubie, wiec „KO" wyciagaloby Kowalskiego, Sikorskiego
     * i Kosiniaka-Kamysza. Odnosnik z nazwy klubu musi dawac klub, a nie
     * przypadkowa zbieznosc liter w nazwiskach.
     */
    klub?: string | null;
    metryka?: Metryka;
  } = {},
) {
  const { kierunek = 'najgorsi', limit = 100, szukaj, okreg = null, klub = null, metryka = 'obecnosc' } = opts;
  const supabase = createPublicClient();

  // Sortowanie ZAWSZE po dolnej granicy przedziału. Dla niezgodności z klubem
  // to jest ten sam argument co dla obecności: poseł, który zagłosował inaczej
  // niż klub raz na dziesięć razy, nie może wyprzedzić posła, który zrobił to
  // czterysta razy na cztery tysiące, tylko dlatego że miał krótszy mandat.
  const kolumna = metryka === 'niezgodnosc' ? 'niezgodnosc_lo' : 'attendance_lo';

  let zapytanie = supabase
    .from('mp_obecnosc_kontekst')
    .select(KOLUMNY_KONTEKST)
    .not(kolumna, 'is', null)
    .eq('w_rankingu', true);

  // Szukanie po nazwisku albo skrocie klubu. Fraze CZYSCIMY: przecinki
  // i nawiasy sa skladnia filtra PostgREST-a, wiec wpisane w pole tekstowe
  // rozsypalyby zapytanie. Zostawiamy litery, cyfry, spacje i myslnik.
  const fraza = (szukaj ?? '').trim().replace(/[^\p{L}\p{N}\s-]/gu, '').slice(0, 60);
  if (fraza) {
    zapytanie = zapytanie.or(`full_name.ilike.%${fraza}%,klub.ilike.%${fraza}%`);
  }

  // Okręg przychodzi jako liczba — nie ma tu nic do czyszczenia, bo wszystko,
  // co nie jest liczbą całkowitą z zakresu okręgów, odpada już przy parsowaniu.
  if (Number.isInteger(okreg) && okreg !== null && okreg > 0) {
    zapytanie = zapytanie.eq('district_num', okreg);
  }

  // `eq`, nie `ilike`: skrót klubu przychodzi z naszego własnego odnośnika,
  // więc ma pasować dokładnie albo nie pasować wcale. Wartość i tak trafia
  // do PostgREST-a jako parametr, nie jako sklejony tekst zapytania.
  if (klub) {
    zapytanie = zapytanie.eq('klub', klub.trim().slice(0, 60));
  }

  // Przy niezgodności „najgorsi" znaczy NAJWYŻSZA rozbieżność z klubem, więc
  // kierunek sortowania jest odwrotny niż przy obecności. Bez tego przełącznik
  // pokazywałby dokładnie odwrotność tego, co obiecuje etykieta.
  const rosnaco = metryka === 'niezgodnosc' ? kierunek === 'najlepsi' : kierunek === 'najgorsi';

  const { data, error } = await zapytanie.order(kolumna, { ascending: rosnaco }).limit(limit);
  sprawdzBlad('mp_obecnosc_kontekst', error);
  return (data ?? []) as MpKontekst[];
}

/** Waski zestaw kolumn dla zwyklej listy — bez liczb, wiec bez ich kosztu. */
const KOLUMNY_LISTY =
  'id, full_name, slug, klub, active, photo_url, district_num, district_name, ' +
  'zakres_mandatu, powod_zakonczenia, w_rankingu';

export type PoselNaLiscie = {
  id: number;
  full_name: string;
  slug: string;
  klub: string | null;
  active: boolean;
  photo_url: string | null;
  district_num: number | null;
  district_name: string | null;
  zakres_mandatu: string;
  powod_zakonczenia: string | null;
  w_rankingu: boolean;
};

/**
 * ZWYKLA LISTA POSLOW — bez rankingu, bez procentow, bez oceny.
 *
 * Powstala 13.09.2026 na uwage Pawla: wejscie w swoj okreg pokazywalo od razu
 * „Kto najczesciej opuszcza glosowania?". Czytelnik pytal „kto mnie
 * reprezentuje", a dostawal odpowiedz na pytanie, ktorego nie zadal — i to
 * w formie zestawienia od najgorszego.
 *
 * DWIE ROZNICE WOBEC `pobierzRanking`, obie zamierzone.
 *
 * 1. BRAK FILTRA `w_rankingu`. Ranking slusznie pomija posla z dwutygodniowym
 *    mandatem, bo procent z pieciu glosowan nie znaczy nic. Ale na liscie
 *    „kto reprezentuje moj okreg" ten posel ma stac, bo reprezentowal.
 *    Zmierzone: troje poslow, wszyscy z zakonczonym mandatem. Pominiecie ich
 *    tutaj lamaloby zasade „nikogo nie ukrywamy" (HANDOFF §1.2).
 *
 * 2. BRAK `limit`. Lista ma byc kompletna: caly okreg albo caly Sejm.
 *    Gorna granica 500 jest bezpiecznikiem na wypadek, gdyby import kiedys
 *    zdublowal wiersze — nie jest stronicowaniem.
 */
export async function pobierzPoslow(
  opts: { szukaj?: string; okreg?: number | null; klub?: string | null } = {},
): Promise<PoselNaLiscie[]> {
  const { szukaj, okreg = null, klub = null } = opts;
  const supabase = createPublicClient();

  let zapytanie = supabase.from('mp_obecnosc_kontekst').select(KOLUMNY_LISTY);

  // Ta sama sanityzacja co w `pobierzRanking` — przecinki i nawiasy sa
  // skladnia filtra PostgREST-a, wiec wpisane w pole tekstowe rozsypalyby
  // zapytanie.
  const fraza = (szukaj ?? '').trim().replace(/[^\p{L}\p{N}\s-]/gu, '').slice(0, 60);
  if (fraza) zapytanie = zapytanie.or(`full_name.ilike.%${fraza}%,klub.ilike.%${fraza}%`);
  if (Number.isInteger(okreg) && okreg !== null && okreg > 0) {
    zapytanie = zapytanie.eq('district_num', okreg);
  }
  if (klub) zapytanie = zapytanie.eq('klub', klub.trim().slice(0, 60));

  const { data, error } = await zapytanie.limit(500);
  sprawdzBlad('mp_obecnosc_kontekst', error);

  /*
    SORTOWANIE PO NAZWISKU ROBIMY TUTAJ, NIE W SQL-u, i to jest wyjatek
    wymagajacy uzasadnienia — w tym projekcie liczby i kolejnosc zwykle
    wyprowadza widok.

    Widok nie ma kolumny `last_name` (jest w tabeli `mps`, nie w widoku),
    a `order by full_name` sortowaloby po IMIENIU. Dolozenie kolumny znaczy
    przepisanie calego widoku `mp_obecnosc_kontekst` — najwazniejszego
    w serwisie — po to, zeby zmienic kolejnosc wyswietlania.

    Wolno tak zrobic WYLACZNIE dlatego, ze pobieramy KOMPLET pasujacych
    wierszy, a nie pierwsza strone. Gdyby bylo tu prawdziwe stronicowanie,
    sortowanie po stronie aplikacji ukladaloby tylko biezaca strone i lista
    bylaby bledna — to jest ta pulapka, przed ktora broni tamta zasada.
  */
  const nazwisko = (pelne: string) => pelne.trim().split(/\s+/).at(-1) ?? pelne;
  return ((data ?? []) as PoselNaLiscie[]).sort((a, b) =>
    nazwisko(a.full_name).localeCompare(nazwisko(b.full_name), 'pl'),
  );
}

/**
 * Okreg wraz z jego poslami — dla strony `/okreg/[nr]`.
 *
 * TEN SAM ROZDZIAL CO PRZY KLUBACH i z tego samego powodu. Widok
 * `okregi_wyborcze` liczy WSZYSTKICH przypisanych do okregu; zmierzone
 * 13.09.2026: Warszawa 23, z czego 20 aktywnych. Okreg wybiera ustalona
 * liczbe poslow — troje to osoby, ktore te mandaty zajmowaly wczesniej.
 * „23 poslow z mojego okregu" byloby nieprawda o dniu dzisiejszym,
 * a pominiecie tych trojga — nieprawda o kadencji.
 *
 * PODZIAL NA KLUBY to zwykle zliczenie, nie wskaznik: nie potrzebuje
 * mianownika ani przedzialu ufnosci, bo nie jest odsetkiem niczego.
 * Dlatego wolno go tu podac, w odroznieniu od „sredniej obecnosci okregu".
 */
export async function pobierzOkreg(nr: number): Promise<{
  okreg: Okreg;
  obecni: PoselNaLiscie[];
  byli: PoselNaLiscie[];
  kluby: Array<{ klub: string; ilu: number }>;
} | null> {
  const supabase = createPublicClient();

  const { data: o, error } = await supabase
    .from('okregi_wyborcze')
    .select('district_num, district_name, voivodeship, poslow')
    .eq('district_num', nr)
    .maybeSingle();
  sprawdzBlad('okregi_wyborcze', error);
  if (!o) return null;

  const wszyscy = await pobierzPoslow({ okreg: nr });
  const obecni = wszyscy.filter((m) => m.active);

  // Kluby liczymy TYLKO z obecnych — podzial mandatow opisuje dzien dzisiejszy.
  const licznik = new Map<string, number>();
  for (const m of obecni) {
    const k = m.klub ?? 'bez klubu';
    licznik.set(k, (licznik.get(k) ?? 0) + 1);
  }

  return {
    okreg: o as Okreg,
    obecni,
    byli: wszyscy.filter((m) => !m.active),
    kluby: [...licznik.entries()]
      .map(([klub, ilu]) => ({ klub, ilu }))
      .sort((a, b) => b.ilu - a.ilu || a.klub.localeCompare(b.klub, 'pl')),
  };
}

export type Klub = {
  id: string;
  name: string;
  members_count: number | null;
  email: string | null;
  fax: string | null;
  phone: string | null;
};

/**
 * Klub wraz z jego posłami — dla strony `/klub/[skrot]`.
 *
 * DLACZEGO OSOBNA STRONA, A NIE FILTR. Do 13.09.2026 odnosnik z nazwy klubu
 * prowadzil do listy przefiltrowanej tym klubem. Pawel zwrocil uwage, ze
 * czytelnik klikajacy „PiS" pyta o KLUB, a dostawal kolejny widok poslow.
 * Rejestr Sejmu ma o klubach wlasne dane — pelna nazwe, liczebnosc, kontakt —
 * i nie bylo gdzie ich pokazac.
 *
 * ROZDZIAL NA OBECNYCH I BYLYCH nie jest kosmetyka. `clubs.members_count`
 * pochodzi z rejestru i liczy czlonkow AKTYWNYCH; nasza tabela wiaze z klubem
 * takze poslow z wygaslym mandatem. Zmierzone 13.09.2026: KO ma 156 w rejestrze
 * i 174 wierszy u nas, z czego 156 aktywnych — zgadza sie co do jednego dla
 * KAZDEGO klubu. Pokazanie jednej listy pod liczba z rejestru wygladaloby jak
 * blad; ukrycie bylych lamaloby „nikogo nie ukrywamy".
 */
export async function pobierzKlub(
  id: string,
): Promise<{ klub: Klub; obecni: PoselNaLiscie[]; byli: PoselNaLiscie[] } | null> {
  const supabase = createPublicClient();

  const { data: k, error: bladKlubu } = await supabase
    .from('clubs')
    .select('id, name, members_count, email, fax, phone')
    .eq('id', id)
    .maybeSingle();
  sprawdzBlad('clubs', bladKlubu);
  if (!k) return null;

  const wszyscy = await pobierzPoslow({ klub: id });
  return {
    klub: k as Klub,
    obecni: wszyscy.filter((m) => m.active),
    byli: wszyscy.filter((m) => !m.active),
  };
}

/**
 * Spis klubow z liczebnoscia — dla `/kluby`.
 *
 * `members_count` bierzemy Z REJESTRU, nie liczymy sami. Zmierzone
 * 13.09.2026: pokrywa sie co do jednego z liczba naszych aktywnych poslow
 * dla kazdego z trzynastu klubow, wiec wlasne liczenie nie dodaloby nic
 * poza kolejnym miejscem, w ktorym te dwie liczby moglyby sie rozjechac.
 */
export async function pobierzKluby(): Promise<Klub[]> {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from('clubs')
    .select('id, name, members_count, email, fax, phone')
    .order('members_count', { ascending: false, nullsFirst: false });
  sprawdzBlad('clubs', error);
  return (data ?? []) as Klub[];
}

/** Skroty wszystkich klubow — do `generateStaticParams` i do listy klubow. */
export async function pobierzSkrotyKlubow(): Promise<string[]> {
  const supabase = createPublicClient();
  const { data, error } = await supabase.from('clubs').select('id').order('id');
  sprawdzBlad('clubs', error);
  return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
}

export type DaneOsobowe = {
  birth_date: string | null;
  birth_location: string | null;
  education_level: string | null;
  profession: string | null;
  number_of_votes: number | null;
  oath_date: string | null;
};

/**
 * DANE Z REJESTRU O SAMYM CZLOWIEKU — data i miejsce urodzenia, wyksztalcenie,
 * zawod, liczba glosow w wyborach, data slubowania.
 *
 * Sa w tabeli `mps` OD PIERWSZEJ MIGRACJI i do 13.09.2026 nie byly pokazywane
 * nigdzie. Import je zapisywal, interfejs o nich nie wiedzial. Zmierzone:
 * 499/499 wypelnionych dla wszystkich pol poza zawodem (493/499).
 *
 * DLACZEGO OSOBNE ZAPYTANIE, A NIE KOLUMNY W WIDOKU. `mp_obecnosc_kontekst`
 * liczy obecnosc, przedzialy ufnosci i ksztalt nieobecnosci dla 499 poslow
 * naraz — jest przeliczany przy kazdym wejsciu na liste. Dane osobowe czyta
 * wylacznie profil, po jednym wierszu. Dolozenie ich do widoku obciazyloby
 * kazde zapytanie listy o kolumny, ktorych lista nigdy nie uzyje, i wymagaloby
 * przepisania najwazniejszego widoku w serwisie.
 *
 * Czytamy z `mps`, nie z widoku, wiec obowiazuje polityka „public read mps".
 */
export async function pobierzDaneOsobowe(mpId: number): Promise<DaneOsobowe | null> {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from('mps')
    .select('birth_date, birth_location, education_level, profession, number_of_votes, oath_date')
    .eq('id', mpId)
    .maybeSingle();
  sprawdzBlad('mps', error);
  return (data as DaneOsobowe | null) ?? null;
}

export type Okreg = {
  district_num: number;
  district_name: string;
  voivodeship: string | null;
  poslow: number;
};

/**
 * Lista okręgów do filtra.
 *
 * Bierze się z widoku, czyli z danych — nie z tablicy wpisanej w kod. Gdyby
 * ktoś kiedyś dopisał okręg ręcznie, lista i tak rozjechałaby się z bazą
 * dokładnie w chwili, w której przestaliby ją poprawiać.
 */
export async function pobierzOkregi(): Promise<Okreg[]> {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from('okregi_wyborcze')
    .select('district_num, district_name, voivodeship, poslow')
    .order('district_num', { ascending: true });
  sprawdzBlad('okregi_wyborcze', error);
  return (data ?? []) as Okreg[];
}

export async function pobierzNieobecnosciMiesieczne(mpId: number): Promise<MiesiacNieobecnosci[]> {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from('mp_absence_monthly')
    .select('month, votings, present, absent, absent_pct')
    .eq('mp_id', mpId)
    .order('month', { ascending: true });
  sprawdzBlad('mp_absence_monthly', error);
  return (data ?? []) as MiesiacNieobecnosci[];
}

/** Wszystkie slugi — do generateStaticParams. */
export async function pobierzSlugi(): Promise<string[]> {
  const supabase = createPublicClient();
  const { data, error } = await supabase.from('mps').select('slug');
  if (error) throw new Error(`pobierzSlugi: ${error.message}`);
  return (data ?? []).map((r: { slug: string }) => r.slug);
}

export type Glosowanie = {
  id: number;
  sitting: number;
  voting_number: number;
  voted_at: string;
  title: string;
  topic: string | null;
  kind: string | null;
  pdf_url: string | null;
  print_numbers: string[] | null;
};

export type ProcesGlosowania = {
  voting_id: number;
  print_number: string;
  process_title: string;
  title_final: string | null;
  document_type: string | null;
  passed: boolean | null;
  closure_date: string | null;
  isap_url: string | null;
  eli_address: string | null;
  /**
   * Co się stało z procesem PO uchwaleniu przez Sejm (migracja 0019).
   * `null`, gdy Sejm go nie uchwalił albo proces trwa.
   */
  los_procesu: LosProcesu | null;
  /** Czy w etapach jest wniosek Prezydenta (weto). Fakt z rejestru, nie wniosek. */
  ma_weto: boolean;
  /** Czy Sejm rozpatrywał wniosek Prezydenta. NIE mówi, jak zagłosował. */
  ma_rozpatrzenie_wniosku: boolean;
  /** 'etap procesu' = z rejestru. 'numer druku z tytulu' = z naszego parsowania. */
  pewnosc_powiazania: string;
};

/**
 * Los procesu legislacyjnego po głosowaniu w Sejmie.
 *
 * `passed` z Sejm API znaczy WYŁĄCZNIE „Sejm uchwalił" — nie „stało się prawem".
 * Dalej jest Senat, podpis Prezydenta, weto i wniosek do Trybunału. Renderowanie
 * `passed` jako jednego słowa „uchwalono" sprawiało, że przy ustawie o KRS
 * czy o Trybunale Konstytucyjnym czytelnik widział „uchwalono" i miał pełne
 * prawo wywnioskować, że ta ustawa obowiązuje. Nie obowiązuje.
 */
export type LosProcesu =
  | 'opublikowany'
  | 'podpisany'
  | 'weto'
  | 'trybunal'
  | 'oczekuje'
  | 'u_prezydenta'
  | 'bez_etapu_prezydenckiego'
  /**
   * Sejm uchwalił, Prezydent zawetował, Sejm nie odrzucił weta.
   *
   * To jedyny los, który NIE zależy od flagi `passed` — bo flaga jest tu
   * niekonsekwentna. Z piętnastu procesów w tej samej sytuacji faktycznej
   * sześć ma `passed = false`, a dziewięć `true` (migracja 0024).
   */
  | 'weto_utrzymane'
  /**
   * Wycofany w migracji 0021 — widok nie ma go już jak wyprodukować.
   * Zostaje w typie i w LOS_OPIS wyłącznie na czas, w którym baza mogłaby
   * być jeszcze na 0020. Gdy 0021 jest wszędzie wykonana, można usunąć.
   */
  | 'brak_potwierdzenia';

/**
 * Zdanie dla interfejsu + informacja, czy jest to stan przejściowy.
 *
 * Teksty są opisowe, nie oceniające: „Prezydent zawetował" jest faktem
 * z rejestru, „ustawa zablokowana" byłoby już naszą interpretacją.
 */
export const LOS_OPIS: Record<LosProcesu, { etykieta: string; wyjasnienie: string | null }> = {
  opublikowany: {
    etykieta: 'uchwalono i opublikowano',
    wyjasnienie: null, // przy tym losie stoi link do aktu — on jest wyjaśnieniem
  },
  podpisany: {
    etykieta: 'uchwalono — Prezydent podpisał',
    wyjasnienie: 'Akt nie pojawił się jeszcze w rejestrze; publikacja następuje po podpisie.',
  },
  weto: {
    etykieta: 'uchwalono — Prezydent zawetował',
    wyjasnienie: 'Nie mamy w rejestrze ani podpisu Prezydenta, ani publikacji aktu.',
  },

  /**
   * Jedyna etykieta w tym słowniku przepisana ze SŁÓW rejestru, a nie złożona
   * przez nas z kodów etapu.
   *
   * `process_stages.decision` = „nie uchwalona ponownie" przy etapie
   * `PresidentMotionConsideration`. Importujemy to pole od migracji 0016
   * i do 0024 nie używaliśmy go nigdzie — a to ono, a nie kod etapu, mówi,
   * czym skończyło się ponowne głosowanie.
   *
   * UWAGA NA POKUSĘ, W KTÓRĄ WPADŁA PIERWSZA WERSJA TEGO ZDANIA. Siedem z tych
   * procesów ma dodatkowo etap końcowy o nazwie „nie uchwalona ponownie po
   * wecie Prezydenta" — brzmi to lepiej i chciało się to zacytować. Ale
   * pozostałych osiem (druki 410, 643, 865, 935, 1109, 1110, 1131, 1600) ma
   * etap końcowy nazwany po prostu „Uchwalono", bo są to druki rozpatrywane
   * ŁĄCZNIE i rejestr zamyka je en bloc. Cytowanie tamtej frazy przy nich
   * byłoby przypisaniem rejestrowi słów, których dla nich nie ma —
   * dokładnie tym, przed czym ostrzega D20.
   *
   * Zmierzone: fraza o wecie występuje 7 razy na 629 etapów `End` w całej
   * bazie. `decision = 'nie uchwalona ponownie'` — 15 na 15.
   *
   * Do 0024 te piętnaście procesów czytało się na dwa przeciwne sposoby,
   * zależnie od niekonsekwentnej flagi `passed`: sześć jako „nie uchwalono"
   * (czyli „Sejm był przeciw", choć był za), dziewięć jako „Prezydent
   * zawetował" (bez słowa, że sprawa jest zamknięta).
   */
  weto_utrzymane: {
    etykieta: 'uchwalona przez Sejm — weto Prezydenta utrzymane',
    wyjasnienie:
      'Sejm uchwalił ustawę, Prezydent ją zawetował, a w ponownym głosowaniu Sejm nie uchwalił ' +
      'jej ponownie. Rejestr zapisuje decyzję tego etapu słowami „nie uchwalona ponownie".',
  },
  trybunal: {
    etykieta: 'uchwalono — skierowano do Trybunału Konstytucyjnego',
    wyjasnienie: 'Prezydent nie podpisał i skierował ustawę do zbadania zgodności z Konstytucją.',
  },
  oczekuje: {
    etykieta: 'uchwalono — oczekuje na publikację',
    wyjasnienie: 'Sejm uchwalił niedawno; rejestr nie odnotował jeszcze żadnego etapu prezydenckiego.',
  },

  /**
   * Ustawa jest u Prezydenta i rejestr milczy o tym, co dalej.
   *
   * Wyjaśnienie wymienia trzy rzeczy, których NIE MA, zamiast sugerować
   * którąkolwiek z nich. Przy druku 219 (ustawa o KRS) rejestr kończy się
   * na „przekazano do podpisu" z 15.07.2024 — i tyle wiemy. Napisanie
   * „Prezydent zwleka" albo „zawetował" byłoby naszym wnioskiem z ciszy
   * rejestru, a nie faktem z rejestru.
   */
  u_prezydenta: {
    etykieta: 'uchwalono — przekazano Prezydentowi',
    wyjasnienie:
      'Rejestr odnotowuje przekazanie ustawy do podpisu i nie odnotowuje, co było dalej: ' +
      'ani podpisu, ani weta, ani skierowania do Trybunału.',
  },

  /**
   * Sejm uchwalił, a rejestr nie ma ani przekazania Prezydentowi, ani adresu aktu.
   *
   * PIERWSZA WERSJA TEGO ZDANIA BYŁA ZA MOCNA. Brzmiała: „Przy wnioskach,
   * informacjach i zawiadomieniach to jest normalny koniec drogi" — czyli
   * uspokajała czytelnika, powołując się na typ dokumentu. Dwa problemy,
   * oba wyszły w recenzji:
   *
   * 1. To jest nasza wiedza o procedurze, a nie fakt z rejestru — i była
   *    pokazywana KAŻDEMU wierszowi kubełka, także tym, których nie opisuje.
   *    Z 184 procesów szesnaście to uchwały, listy kandydatów i sprawozdania,
   *    czyli nie „wnioski, informacje i zawiadomienia".
   * 2. Przy uchwałach było wprost nietrafione. Zmierzone: wszystkie 149
   *    opublikowanych uchwał Sejmu MA u nas adres w Monitorze Polskim.
   *    Publikacja jest więc normalną drogą uchwały, a nie jej brakiem —
   *    czyli przy tych jedenastu bez adresu mamy najpewniej lukę w imporcie.
   *    To jest dokładnie przypadek „nie wiemy", który migracja 0021 uznała
   *    za wymarły.
   *
   * Nowa wersja nie powołuje się na typ dokumentu i nie uspokaja. Mówi, czego
   * w rejestrze nie ma, i nazywa niewiedzę po imieniu — tak jak przy kształcie
   * nieobecności i przy wecie.
   */
  bez_etapu_prezydenckiego: {
    etykieta: 'uchwalono przez Sejm',
    wyjasnienie:
      'Rejestr nie odnotowuje ani przekazania Prezydentowi, ani adresu aktu w publikatorze. ' +
      'Nie wiemy, czy proces nie przewidywał dalszych etapów, czy po prostu nie mamy ich w danych.',
  },

  /** Wycofany w 0021 — zostaje na czas, w którym baza może być jeszcze na 0020. */
  brak_potwierdzenia: {
    etykieta: 'uchwalono przez Sejm',
    wyjasnienie: 'Nie mamy potwierdzenia publikacji w rejestrze i nie wiemy, na czym proces stanął.',
  },
};

/**
 * Zdanie o wecie, budowane z FAKTÓW, nie z wniosku.
 *
 * Rejestr mówi dwie rzeczy osobno: że Prezydent złożył wniosek (weto) i że
 * Sejm ten wniosek rozpatrywał. Podajemy obie i zostawiamy czytelnikowi
 * złożenie ich w całość — tak samo jak przy kształcie nieobecności.
 *
 * ---------------------------------------------------------------------
 * POPRAWKA Z 11.09.2026 — I JEST TO LEKCJA WARTA ZAPAMIĘTANIA.
 *
 * Stał tu wcześniej taki komentarz:
 *
 *   „Kuszące byłoby napisać »Sejm weta nie odrzucił«, skoro nie ma podpisu —
 *    ale to jest wnioskowanie z nieobecności danych, a nie fakt z rejestru."
 *
 * Zdanie było słuszne i chroniło nas przed realnym błędem. Ale wyciągnęliśmy
 * z niego wniosek o jeden krok za daleko: **uznaliśmy sprawę za niepoznawalną,
 * zamiast poszukać, czy rejestr jej nie rozstrzyga gdzie indziej.**
 *
 * Rozstrzyga. Pole `process_stages.decision` niesie zdanie „nie uchwalona
 * ponownie", a `stage_name` etapu końcowego — „nie uchwalona ponownie po
 * wecie Prezydenta". Oba importujemy od migracji 0016 i nie czytaliśmy ich
 * nigdzie. Dotyczy to piętnastu procesów (migracja 0024, los `weto_utrzymane`).
 *
 * Zasada „nie wnioskujemy z nieobecności danych" zostaje w mocy. Dochodzi
 * do niej druga, lustrzana: **zanim ogłosisz niewiedzę, sprawdź, czy rejestr
 * nie powiedział tego w polu, którego nie czytasz.** Kody grupują; słowa
 * mówią, co się stało.
 *
 * Ta funkcja zostaje dla wet, przy których rejestr naprawdę milczy o wyniku —
 * po 0024 jest ich 48. Przy `weto_utrzymane` interfejs jej NIE woła, bo
 * etykieta mówi już wszystko, a powtórzenie brzmiałoby jak wahanie.
 */
export function opisWeta(p: { ma_weto: boolean; ma_rozpatrzenie_wniosku: boolean }): string | null {
  if (!p.ma_weto) return null;
  return p.ma_rozpatrzenie_wniosku
    ? 'Rejestr odnotowuje wniosek Prezydenta (weto) oraz rozpatrywanie tego wniosku przez Sejm.'
    : 'Rejestr odnotowuje wniosek Prezydenta (weto).';
}

export type ProcesOstatni = {
  print_number: string;
  tytul: string;
  closure_date: string;
  los: LosProcesu;
  isap_url: string | null;
  eli_address: string | null;
};

/**
 * Ostatnio zamkniete procesy legislacyjne — material dla strony glownej.
 *
 * NIE „rozstrzygniete". Widok `procesy_ostatnie` (0026) zwraca wszystko, co
 * ma ustalony los i date zamkniecia, lacznie z wetem i oczekiwaniem na
 * publikacje. O tym, co sie naprawde stalo, mowi etykieta losu przy kazdym
 * wierszu, a nie naglowek sekcji — ten sam powod, dla ktorego `passed`
 * nigdy nie jest renderowane jednym slowem „uchwalono".
 */
export async function pobierzOstatnieProcesy(limit = 5): Promise<ProcesOstatni[]> {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from('procesy_ostatnie')
    .select('print_number, tytul, closure_date, los, isap_url, eli_address')
    .order('closure_date', { ascending: false })
    .limit(limit);
  sprawdzBlad('procesy_ostatnie', error);
  return (data ?? []) as ProcesOstatni[];
}

/**
 * Adres aktu w oficjalnym rejestrze.
 *
 * ISAP jest pierwszy, bo API podaje go wprost. ELI budujemy z adresu
 * (`MP/2023/1261` -> `https://eli.gov.pl/eli/MP/2023/1261/ogl`) — ten sam
 * wzor, ktory zwraca Sejm w `links[rel=eli]`.
 *
 * Gdy nie ma zadnego z dwoch, zwracamy null i interfejs NIE pisze wtedy
 * "uchwalono" jako linku. Zdanie o skutku prawnym bez odnosnika do aktu
 * lamie decyzje D1 — lepiej pokazac je jako zwykly tekst niz udawac zrodlo.
 */
export function adresAktu(p: { isap_url: string | null; eli_address: string | null }): string | null {
  if (p.isap_url) return p.isap_url;
  if (p.eli_address) return `https://eli.gov.pl/eli/${p.eli_address}/ogl`;
  return null;
}

/**
 * Procesy legislacyjne dla podanych glosowan.
 *
 * Widok `glosowanie_z_procesem` laczy na dwa sposoby i sam mowi, ktorym:
 * przez etap procesu (rejestr wprost wskazuje glosowanie) albo przez numer
 * druku wyluskany z tytulu. Interfejs MUSI te dwa przypadki rozroznic —
 * "wiemy z rejestru" i "wynika z tytulu" to nie jest to samo zdanie.
 *
 * Jedno glosowanie moze dotyczyc kilku drukow rozpatrywanych lacznie, dlatego
 * zwracamy mape na TABLICE, nie na pojedynczy proces.
 */
export async function pobierzProcesyDlaGlosowan(votingIds: number[]): Promise<Map<number, ProcesGlosowania[]>> {
  const mapa = new Map<number, ProcesGlosowania[]>();
  if (!votingIds.length) return mapa;

  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from('glosowanie_z_procesem')
    .select(
      'voting_id, print_number, process_title, title_final, document_type, passed, closure_date, ' +
        'isap_url, eli_address, los_procesu, ma_weto, ma_rozpatrzenie_wniosku, pewnosc_powiazania',
    )
    .in('voting_id', votingIds);

  // Brak widoku to brakujaca migracja, nie awaria strony — profil ma sie
  // wyswietlic bez tej kolumny, a nie wywrocic.
  if (error) {
    if (error.code === 'PGRST205' || error.code === '42P01' || /does not exist|schema cache/i.test(error.message)) {
      return mapa;
    }
    throw new Error(`glosowanie_z_procesem: ${error.message}`);
  }

  for (const r of (data ?? []) as ProcesGlosowania[]) {
    const lista = mapa.get(r.voting_id);
    if (lista) lista.push(r);
    else mapa.set(r.voting_id, [r]);
  }
  return mapa;
}

/** Ostatnie glosowania posla wraz z jego glosem. */
export async function pobierzGlosyPosla(mpId: number, limit = 30) {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from('votes')
    .select('value, votings!inner(id, sitting, voting_number, voted_at, title, topic, kind, pdf_url, print_numbers)')
    .eq('mp_id', mpId)
    .order('voted_at', { ascending: false, referencedTable: 'votings' })
    .limit(limit);
  if (error) throw new Error(`pobierzGlosyPosla(${mpId}): ${error.message}`);
  return (data ?? []) as Array<{ value: string; votings: Glosowanie }>;
}
