# Obywatel 2.0

Niezależna platforma obywatelska: głosowania w Sejmie, obietnice polityków i pieniądze
publiczne — zawsze z linkiem do oficjalnego źródła, a każde streszczenie AI z widoczną metką.

## Dokumentacja

| Dokument | Co zawiera |
|---|---|
| [`docs/zrodla-danych.md`](docs/zrodla-danych.md) | Stan rozpoznania każdego źródła — zmierzone liczby, endpointy, pułapki |
| [`docs/decyzje.md`](docs/decyzje.md) | Dziennik decyzji z uzasadnieniami, razem z tymi wycofanymi |
| [`docs/sudop.md`](docs/sudop.md) | SUDOP — śledztwo zaparkowane, pełny stan wiedzy i kroki powrotu |
| [`docs/wniosek-uokik-sudop.md`](docs/wniosek-uokik-sudop.md) | Gotowy szkic wniosku do UOKiK |

Reszta tego pliku to instrukcja uruchomienia i opis kolejnych sprintów.

## Jak wgrywać kolejne paczki

**Nie kasuj folderu.** W `C:\Projects\obywatel` są rzeczy, których w paczce nigdy nie ma:
`.env.local` (klucze), `node_modules` i historia gita. Skasowanie folderu oznacza
ustawianie wszystkiego od nowa.

Zrób to raz, teraz — zanim przyjdzie następna paczka:

```bash
cd C:\Projects\obywatel
git init
git add -A
git commit -m "Sprint 0 i 1"
```

Przy każdej kolejnej paczce:

```bash
# 1. rozpakuj Z NADPISANIEM do C:\Projects\obywatel
# 2. zobacz DOKŁADNIE, co się zmieniło:
git status
git diff

# 3. jeśli zmienił się package.json:
npm install

# 4. zatwierdź:
git add -A && git commit -m "Sprint 2"
```

`git diff` po rozpakowaniu to najlepsze narzędzie kontroli, jakie masz —
zobaczysz każdą linię, którą zmieniłem, zamiast wierzyć mi na słowo.
`.env.local` jest w `.gitignore` i nigdy nie ma go w paczce, więc przeżyje każde nadpisanie.

Jedyny przypadek, którego nadpisywanie nie obsłuży, to plik, który **usunąłem** —
wtedy napiszę o tym wprost.

---

## Uruchomienie od zera

### 1. Zależności

```bash
npm install
```

Wymagany Node 20.9+ (rozwijane na 22). `npm install` powtarzaj po każdej paczce,
która zmienia `package.json` — `node_modules` nigdy nie jest w archiwum.

### 2. Projekt Supabase — krok po kroku

1. **Nowy projekt** na [supabase.com](https://supabase.com).
   Region: **Central EU (Frankfurt)** — najbliżej Polski i w EOG.
   Hasło do bazy zapisz w menedżerze haseł; nie da się go później odczytać.

2. **SQL Editor → New query.** Wykonaj migracje **po kolei**, każdą w całości:

| Plik | Co robi | Sygnał, że przeszła |
|---|---|---|
| `0001_init.sql` | schemat podstawowy | bez błędów |
| `0002_rls_hardening.sql` | RLS na wszystkich tabelach | `NOTICE: RLS wlaczone…` |
| `0003_advisor_fixes.sql` | cztery ostrzeżenia Security Advisora | `NOTICE: Advisor…` |
| `0004_clubs_and_loyalty.sql` | kluby spoza słownika, próg lojalności | bez błędów |
| `0005_list_votes.sql` | głosowania listowe | bez błędów |
| `0006_vote_value_present.sql` | wartość `PRESENT` — **uruchom w dwóch krokach** | bez błędów |
| `0007_frekwencja_vs_udzial.sql` | obecność i udział jako dwie liczby | bez błędów |
| `0008_refresh_wydajnosc.sql` | `refresh_mp_stats` 10,2 s → 2,3 s | bez błędów |
| `0009_przedzialy_ufnosci.sql` | rankingi na przedziałach Wilsona | bez błędów |
| `0010_kontekst_nieobecnosci.sql` | kształt nieobecności, funkcje państwowe | bez błędów |
| `0011_widok_pelny_kontrakt.sql` | komplet kolumn dla profilu | `NOTICE: Kontrakt widoku… 24 kolumn` |

**`0006` wymaga dwóch uruchomień.** PostgreSQL nie pozwala użyć świeżo dodanej
wartości enuma w tej samej transakcji, w której powstała. Najpierw sama pierwsza linia
(`alter type vote_value add value…`), potem reszta pliku.

Migracje **sprawdzają własne założenia** — `0002` weryfikuje RLS na wszystkich tabelach,
`0011` sprawdza, czy widok wystawia komplet kolumn wymaganych przez `src/lib/queries.ts`.
Jeśli coś nie gra, rzucają wyjątkiem zamiast przejść po cichu.

3. Po wszystkim przelicz metryki:

```sql
select refresh_mp_stats();
select refresh_absence_monthly();
```

4. **Table Editor** → przejrzyj listę. Przy żadnej tabeli nie może być plakietki
   **„Unrestricted"**. Jeśli jest, migracja 0002 nie została wykonana w całości.

5. **Advisors → Security Advisor** → *Rerun linter*. Powinno być czysto.

6. **Project Settings → API** → skopiuj `Project URL`, klucz `anon` i klucz `service_role`.

Cały łańcuch `0001 → 0011` jest sprawdzony na czystej bazie PostgreSQL 16.

### Gdy coś nie działa

```bash
node --env-file=.env.local scripts/diagnose.mjs
```

Omija `supabase-js` i strzela surowym `fetch`-em, pokazując dokładny URL, metodę,
status i ciało odpowiedzi. Jak czytać wynik:

| Objaw | Znaczenie |
|---|---|
| `42501`, `23502`, `23514` | baza świadomie odmówiła — **tak ma być** |
| `PGRST125` (404) | ścieżka nie istnieje; żądanie nie doszło do bazy |
| `PGRST205` | tabela poza cache schematu → `notify pgrst, 'reload schema';` |
| `401` / `403` | zły klucz albo zła rola |

**Kody `PGRST***` nigdy nie są dowodem, że RLS działa** — to warstwa transportu, nie baza.

### RLS — co jest włączone i dlaczego

**Tak, RLS ma być włączone — na każdej tabeli w `public`, bez wyjątku.** Migracje robią
to za Ciebie; w panelu nie musisz klikać nic.

Zasada jest jedna: **`anon` czyta, nikt poza `service_role` nie pisze faktów.**
Klucz `anon` jest publiczny z założenia — trafia do przeglądarki i tak ma być.
Bezpieczeństwo daje RLS, nie tajność tego klucza. Klucz `service_role` ma atrybut
`BYPASSRLS` i dlatego działa import — i dlatego nie wolno mu nigdy trafić do kodu
klienckiego.

| Tabela | `anon` | Uwaga |
|---|---|---|
| `mps`, `clubs`, `votings`, `votes`, `sources`, `mp_stats`, `legislative_processes`, `process_stages` | odczyt | jawne z założenia — to jest produkt |
| `promises`, `ai_contents`, `asset_declarations` | odczyt tylko `published` | moderacja przed publikacją |
| `promise_votes` | zapis własnego głosu | `with check (auth.uid() = user_id)` |
| `error_reports` | zapis | formularz „Zgłoś błąd" |
| `sync_state` | **brak dostępu** | RLS włączone, zero polityk |

Trzy rzeczy, które audyt migracji 0001 wykazał i które naprawia 0002:

**Pięć tabel miało RLS wyłączone** (`clubs`, `sources`, `legislative_processes`,
`process_stages`, `sync_state`). Same GRANT-y je chroniły, co działa dokładnie do
momentu, aż ktoś doda jednego GRANT-a za dużo.

**Widok `public_ai_contents` działał jako SECURITY DEFINER** — domyślne zachowanie
w PostgreSQL. Czytał `ai_contents` z uprawnieniami właściciela, więc polityka
„pokazuj tylko `published`" **nigdy nie była sprawdzana**. Cały sens tego widoku —
„frontend fizycznie nie jest w stanie pokazać treści AI bez metki" — opierał się na
założeniu, które nie było prawdziwe. `security_invoker = on` to naprawia.

**`mp_stats` był widokiem zmaterializowanym**, a RLS na matviews nie działa w ogóle —
można im tylko odebrać GRANT. Zamieniony na zwykłą tabelę odświeżaną funkcją
`refresh_mp_stats()`, do której `execute` ma wyłącznie `service_role`.
Zmierzone: 3,8 s na 230 tys. wierszy testowych, więc przy docelowych 1,9 mln licz
~30–60 s w nocnym cronie.

Migracja `0003` domyka cztery ostrzeżenia Security Advisora: `search_path` w obu
funkcjach, `pg_trgm` przeniesione z `public` do `extensions`, oraz polityka
`error_reports`, która przestała być „always true".

### Wyszukiwarka posłów a polskie znaki

Przy okazji przenoszenia `pg_trgm` wyszło coś ważniejszego niż samo ostrzeżenie.
Trigramy liczą podobieństwo na surowych znakach, więc:

```
'Pawel Sliz'  vs  full_name 'Paweł Śliż'  →  similarity 0.222   (próg 0.3 — brak trafienia)
'pawel-sliz'  vs  slug      'pawel-sliz'  →  similarity 1.000
```

Użytkownik wpisuje w wyszukiwarkę „Pawel Sliz" bez diakrytyków i **nie znalazłby posła**.
Kolumna `slug` jest już pozbawiona znaków diakrytycznych, więc to ona dostaje drugi indeks
trigramowy (`mps_slug_trgm`). Frontend w Sprincie 3 slugifikuje zapytanie przed wysłaniem —
tą samą funkcją co import (`ingest/lib/slug.ts`).

### `npm audit` — dwa ostrzeżenia, świadomie zostawione

`postcss` wciągnięty przez Next.js ma podatności, których łańcuch wymaga
`sourceMappingURL` kontrolowanego przez atakującego w pliku CSS. My przetwarzamy
wyłącznie własny arkusz Tailwinda w czasie builda — nie ma wektora.
`npm audit fix --force` podbiłby Next.js do 16 (zmiana łamiąca) dla zerowego zysku
bezpieczeństwa. Wracamy do tego, gdy 15.x dostanie poprawkę albo przy planowej migracji.

### 3. Zmienne środowiskowe

```bash
cp .env.example .env.local
```

Wartości znajdziesz w Supabase → **Project Settings → API**.
`SUPABASE_SERVICE_ROLE_KEY` omija RLS — nie commituj go i nie wklejaj do kodu klienckiego.

### 4. Test wyjścia Sprintu 0

```bash
node --env-file=.env.local scripts/smoke-test.mjs
```

Test sprawdza na **żywej bazie**, że:

| Blok | Co weryfikuje |
|---|---|
| A | klucz `anon` czyta wszystkie tabele publiczne |
| B | klucz `anon` **nie zapisze** posła, głosowania ani treści AI — ale może zgłosić błąd |
| B2 | `anon` nie widzi `sync_state` i nie wywoła `refresh_mp_stats()`; `service_role` widzi |
| C | wstawienie posła bez `source_id` jest odrzucane przez bazę |
| D | treść AI bez modelu, bez disclaimera, bez źródła albo z `ai_generated=false` jest odrzucana |
| E | nieopublikowana treść AI nie przecieka przez widok publiczny |
| F | dane testowe są sprzątane |

Wszystkie asercje przeszły lokalnie na PostgreSQL 16 przed wysyłką. Jeśli u Ciebie coś pada,
to znaczy, że migracja nie została w całości wykonana albo RLS nie jest włączone.

### 5. Aplikacja

```bash
npm run dev
```

Strona główna to tablica statusu: liczy wiersze w każdej tabeli kluczem `anon`.
Same zera na tym etapie są **poprawnym wynikiem** — potwierdzają, że deploy widzi bazę
i że polityka „publiczny odczyt" działa.

### 6. Deploy

Import repozytorium na Vercelu, te same trzy zmienne w **Environment Variables**.
Build musi przejść bez `SUPABASE_SERVICE_ROLE_KEY` — jeśli nie przechodzi, ktoś zaimportował
`lib/supabase/admin.ts` do komponentu klienckiego i klucz właśnie wyciekał do bundla.

---

## Struktura

```
src/lib/supabase/
  browser.ts   klucz anon, komponenty klienckie, pełne RLS
  server.ts    klucz anon, Server Components, sesja w ciasteczkach
  admin.ts     service_role — OMIJA RLS, wyłącznie skrypty importu
               ('server-only' wywala build przy próbie użycia po stronie klienta)

supabase/migrations/0001_init.sql   cały schemat, wersja 0.2
scripts/smoke-test.mjs              test wyjścia Sprintu 0
scripts/probes/                     sondy rekonesansowe (nie są częścią aplikacji)
.github/workflows/ingest.yml        cron importu — na GitHubie, nie na Vercelu
```

## Dlaczego cron mieszka w GitHub Actions

Pełny backfill głosowań to ~4 200 zapytań i ~3 minuty (zmierzone na żywym API).
Limit czasu funkcji na darmowym planie Vercela liczy się w sekundach.
Actions dają długie zadania, historię przebiegów i retry — a dla repozytorium publicznego
standardowe runnery są bezpłatne.

Efekt uboczny, który jest nam na rękę: codzienne zapytanie utrzymuje darmową bazę w stanie aktywnym.

## Rozmiar bazy — dlaczego typy są takie wąskie

Zmierzone na PostgreSQL 16, 230 000 wierszy testowych w `votes`:

```
66,8 B na wiersz (dane + indeks PK)  →  ~121 MB dla docelowych 1,9 mln wierszy
```

Stąd `voting_id int`, `mp_id smallint`, `club_seq smallint` zamiast `bigint`/`int`/`text`,
brak indeksu `(mp_id, value)` i snapshoty surowych odpowiedzi poza Postgresem.
Nie zmieniaj tych typów bez ponownego policzenia budżetu.

---

## Sprint 1 — import posłów i klubów

```
ingest/
  lib/http.ts             throttling (8 równolegle), retry z Retry-After
  lib/sejm-client.ts      typowane endpointy; kształty z pomiaru, nie z dokumentacji
  lib/source-recorder.ts  JEDYNE miejsce tworzące wiersze w `sources`
  lib/slug.ts             adresy /posel/[slug] — stabilne i deterministyczne
  lib/db.ts               klient service_role dla skryptów
  mappers/mp.ts           czyste funkcje SejmMP → MpRow, plus bezpiecznik sanity
  mappers/mp.test.ts      15 testów, bez sieci i bez bazy
  jobs/sync-mps.ts        orkiestracja
```

### Uruchomienie

```bash
npm test                                              # 15 testów, ~0,3 s
npx tsx --env-file=.env.local ingest/jobs/sync-mps.ts
npx tsx --env-file=.env.local ingest/jobs/sync-mps.ts --force   # pomija skrót po hashu
```

### Test wyjścia Sprintu 1

1. Po pierwszym przebiegu: **499 posłów, 12 klubów**, każdy z `source_id`.
2. Drugi przebieg pod rząd loguje `bez zmian (ten sam hash) — pomijam zapis`
   i nie dotyka ani jednego wiersza. To jest dowód idempotencji.
3. `select count(*) from mps where source_id is null` → **0**.
4. Strona statusu pokazuje niezerowe liczby.

### Trzy decyzje warte uzasadnienia

**Hash liczymy z surowych bajtów odpowiedzi, nie z `JSON.stringify(parsed)`.**
Kolejność kluczy po sparsowaniu potrafi się zmienić bez zmiany danych — hashowanie
obiektu przepisywałoby całą bazę co noc bez powodu. Sejm API nie zwraca `ETag`
ani `Last-Modified` (zmierzone), więc ten hash to jedyny mechanizm delty, jaki mamy.

**Slug raz zapisany jest nienaruszalny.** Adresy `/posel/...` krążą po X i są kluczem
cache dla grafik OG. Import czyta istniejące slugi z bazy i nigdy ich nie przelicza.
Imiennicy dostają sufiks z numerem okręgu, nie losową liczbę.
Osobna pułapka: **`ł` nie normalizuje się przez NFD** — Unicode traktuje je jako
odrębną literę, nie `l` z diakrytykiem. Stąd jawna mapa znaków i test, który to pilnuje.

**Import przerywa się, gdy API zwróci mniej niż 400 posłów.** Import, który po cichu
wstawi 3 rekordy zamiast 460, jest gorszy od takiego, który się wywali — bo strona
nadal wygląda na działającą.

### Kluby spoza słownika i próg lojalności

Pierwszy import na żywych danych zalogował:

```
UWAGA: 1 poslow bez dopasowanego klubu: Polska2050-TD
```

Sejm API zwraca w `/clubs` **dwanaście** klubów, a w polu `MP.club` występuje
**trzynaście** różnych wartości. Niespójność jest po stronie źródła.

Nie przypisujemy tego posła do podobnie brzmiącego „Polska2050" — to byłoby
wymyślenie danych, których źródło nie podaje. Zamiast tego `ensureClubs()` tworzy klub
z kodu, który naprawdę przyszedł, z flagą `from_dictionary = false` i notatką.
Widok `clubs_poza_slownikiem` pokazuje takie przypadki — warto tam zaglądać po imporcie.

Z tego wynikła rzecz poważniejsza. Skoro istnieją kluby jednoosobowe, to lojalność
partyjna liczona wprost dałaby takiemu posłowi **100%** — bo większością własnego klubu
jest on sam. Liczba „100% lojalności" przy nazwisku posła, wyliczona z klubu liczącego
jedną osobę, to materiał na sprostowanie. Migracja `0004` dokłada próg:

| Wielkość klubu w danym głosowaniu | `loyalty_pct` |
|---|---|
| ≥ 3 głosujących | liczona normalnie |
| < 3 głosujących | **NULL**, a głosowanie ląduje w `loyalty_skipped` |

Zmierzone na danych syntetycznych: poseł głosujący z 10-osobowym klubem dostaje 100%,
głosujący przeciw — 0%, a poseł w klubie jednoosobowym dostaje `NULL` i
`loyalty_skipped = 100`. Frontend musi pokazać „brak danych", nigdy „100%".

---

## Sprint 2 — głosowania imienne

```
ingest/mappers/voting.ts        SejmVoting → votings / votes / list_votes
ingest/mappers/voting.test.ts   16 testów, bez sieci
ingest/jobs/backfill-votings.ts jednorazowy import całej kadencji, z kursorem
ingest/jobs/sync-votings.ts     nocny import przyrostowy przez ?dateFrom=
```

### Uruchomienie

```bash
# 1. migracja 0005_list_votes.sql w SQL Editorze
# 2. jedno posiedzenie na próbę — sprawdź, czy liczby się zgadzają
npx tsx --env-file=.env.local ingest/jobs/backfill-votings.ts --only 63

# 3. pełny backfill (kilkanaście minut, można przerwać i wznowić)
npx tsx --env-file=.env.local ingest/jobs/backfill-votings.ts

# 4. przyrostowy — to samo, co będzie chodzić co noc
npx tsx --env-file=.env.local ingest/jobs/sync-votings.ts
```

### Test wyjścia Sprintu 2

```sql
select count(*) from votings;            -- ~4 150
select count(*) from votes;              -- ~1 900 000
select count(*) from votings_niezgodne;  -- MUSI być 0
select pg_size_pretty(pg_total_relation_size('votes'));  -- ~120 MB
select * from mp_stats order by attendance_pct limit 5;
```

`votings_niezgodne` to widok porównujący nasze sumy głosów imiennych z licznikami
zbiorczymi, które Sejm API podaje **niezależnie**. Każdy wiersz to głosowanie,
w którym coś się rozjeżdża. Sprawdzony w obie strony na danych syntetycznych:
wykrywa rozjazd i znika, gdy dane są spójne.

### Trzy pułapki, które ten sprint rozbraja

**Głosowania listowe zaniżyłyby frekwencję.** Przy `kind = ON_LIST` (wybory do
organów) pole `vote` bywa puste, a decyzje siedzą w `listVotes`. Zapisanie tego jako
`ABSENT` obniżyłoby frekwencję posła, który normalnie głosował — czyli postawiło przy
jego nazwisku zarzut, którego dane nie potwierdzają. Traktujemy obecność `listVotes`
jako uczestnictwo, a szczegóły lądują w osobnej tabeli `list_votes`
(osobnej, bo kolumna `jsonb` kosztowałaby miejsce przy każdym z 1,9 mln wierszy).

**Lojalność przy głosowaniu listowym nie ma sensu.** Nie ma tam „za" i „przeciw",
więc nie ma czegoś takiego jak większość klubu. `refresh_mp_stats()` wyklucza `ON_LIST`
z lojalności, ale wlicza do frekwencji, a `loyalty_skipped_onlist` mówi, ile głosowań
pominięto. Zmierzone: przy 90 zwykłych i 10 listowych głosowaniach
`loyalty_votings = 90`, `loyalty_skipped_onlist = 10`.

**Klub bierzemy z głosu, nie z profilu posła.** Poseł zmienia klub w trakcie kadencji;
lojalność historyczna musi porównywać go z klubem, w którym był **w momencie
głosowania**. Sejm API podaje to w każdym rekordzie głosu.

### Czwarta pułapka, znaleziona dopiero na żywych danych

Pierwsza próba backfillu posiedzenia 63 przerwała się na:

```
invalid input value for enum vote_value: "PRESENT"
```

Enum zbudowałem ze schematu OpenAPI Sejm API. `PRESENT` tam nie było — pojawiło się
w danych. Wniosek szerszy niż jedna brakująca wartość: **dziedzinę tego pola kontroluje
źródło, nie my.**

Sama brakująca wartość to drobiazg. Groźne było to, co by się stało, gdyby przeszła
niezauważona. Logika lojalności brzmiała „wszystko poza `ABSENT`", więc `PRESENT` —
obecność bez zajęcia stanowiska — byłaby porównywana z większością klubu i wychodziła
jako **nielojalność**. Poseł dostałby zarzut za głos, którego nie oddał.

Migracja `0006` zamienia warunek z listy zakazanych na **listę dozwolonych**: do lojalności
wchodzą wyłącznie `YES`, `NO`, `ABSTAIN`. Każda przyszła, nieznana dziś wartość
automatycznie zostaje poza lojalnością, zamiast wpadać do niej po cichu.
To samo dotyczy liczenia większości klubu.

Zmierzone: poseł głosujący zawsze `PRESENT` ma **frekwencję 100%** i
**`loyalty_pct = NULL`** z `loyalty_skipped_nostance = 100`. Przed poprawką pokazałby 0%.

Do tego importer sprawdza dziedzinę **przed** zapisem całego posiedzenia i przerywa
z gotowym poleceniem SQL, zamiast wywracać się na porcji nr 2000, gdy część danych
jest już w bazie. Widok `wartosci_glosow` pokazuje, co realnie siedzi w tabeli:

```sql
select * from wartosci_glosow;
```

### Frekwencja to nie to samo co udział (migracja 0007)

Pierwszy udany backfill posiedzenia 63 dał rozkład, który obalił moje założenie:

| wartość | wystąpień | udział |
|---|---:|---:|
| `YES` | 14 807 | |
| `NO` | 12 359 | |
| `ABSTAIN` | 4 515 | |
| `ABSENT` | 1 496 | |
| **`PRESENT`** | **863** | **2,5%** |

A jednocześnie `list_votes = 0` — na tym posiedzeniu **nie było ani jednego głosowania
listowego**. Czyli `PRESENT` nie ma nic wspólnego z `ON_LIST`. Znaczy po prostu:
poseł był na sali i nie oddał głosu.

To zmienia sens słowa „frekwencja". Mamy dwie różne i obie uczciwe miary:

| | definicja | kolumna |
|---|---|---|
| **Obecność** | wszystko poza `ABSENT` — był na sali | `attendance_pct` |
| **Udział** | tylko `YES`/`NO`/`ABSTAIN` — nacisnął przycisk | `voted_pct` |

Przy 2,5% głosów typu `PRESENT` te liczby rozjeżdżają się na tyle, że poseł może mieć
100% obecności i wyraźnie niższy udział. Pokazanie jednej z nich pod etykietą
„frekwencja" i przemilczenie drugiej byłoby wyborem narracji, a nie prezentacją danych.
Liczymy więc obie, a `mp_stats.present_count` podaje różnicę wprost.

Zmierzone na danych syntetycznych: poseł zawsze `PRESENT` → obecność 100%, udział 0%.
Widok `obecnosc_vs_udzial` sortuje posłów po tej różnicy — to jednocześnie kontrola
poprawności i materiał na tekst dla dziennikarza.

### Wznawianie backfillu

Zapis 1,9 mln wierszy przez PostgREST to kilka tysięcy żądań HTTP — coś padnie.
Po każdym ukończonym posiedzeniu numer trafia do `sync_state`, więc ponowne
uruchomienie podejmuje pracę od następnego. Bez duplikatów, bez zaczynania od zera.

```bash
npx tsx --env-file=.env.local ingest/jobs/backfill-votings.ts --from 1   # od początku
npx tsx --env-file=.env.local ingest/jobs/backfill-votings.ts --only 63  # jedno posiedzenie
```

### Wydajność `refresh_mp_stats` (migracja 0008)

Pierwszy pełny backfill zapisał 2 099 638 głosów bez jednej niezgodności, a potem
przewrócił się na ostatnim kroku:

```
BLAD: refresh_mp_stats: canceling statement due to statement timeout
```

Ta sama funkcja uruchomiona ręcznie w SQL Editorze przechodziła — bo tam obowiązuje
inny limit czasu. Przez PostgREST, czyli z crona, padała.

Przyczyną było złączenie boczne liczące większość klubu **raz dla każdego z 2,1 mln
wierszy**. Tymczasem „większość klubu w danym głosowaniu" to wartość dla pary
(głosowanie, klub) — takich par jest około 59 tysięcy. Liczyliśmy to samo 35 razy
za dużo. Zmierzone na 2 101 740 wierszach:

| wersja | czas |
|---|---:|
| złączenie boczne (0007) | 10 157 ms |
| grupowanie (0008) | **2 275 ms** |

Do tego funkcja dostała własny `statement_timeout = '10min'`, a backfill nie traktuje
już nieudanego przeliczenia statystyk jako porażki całego importu — dane głosowań są
wtedy zapisane i spójne, brakuje wyłącznie metryk.

### Dlaczego nie wolno robić rankingu po samym procencie

Realne dane z pierwszego backfillu:

| poseł | `votes_total` | obecność |
|---|---:|---:|
| Grzegorz Lorek | 4 569 | 99,1% |
| Bogumiła Olbryś | 2 244 | 98,7% |
| Krzysztof Brejza | 147 | 93,9% |
| Artur Soboń | 100 | 54,0% |

**Mianowniki są różne.** Mandat obejmuje się i traci w trakcie kadencji, a Sejm API
zwraca głosy tylko za okres sprawowania mandatu. Ranking „najgorszej frekwencji"
zbudowany na samym procencie wysunąłby na czoło posłów, którzy byli w Sejmie
przez dwa tygodnie — i byłby to zarzut wynikający z arytmetyki, nie z zachowania.

`mp_stats` ma teraz `first_voted_at` i `last_voted_at`. Profil posła musi pokazywać
**„X z Y głosowań"**, a nie tylko procent.

### Rankingi na przedziałach ufności (migracja 0009)

Flaga `w_rankingu` z progiem 50%, którą wprowadziłem w `0008`, okazała się zła
na żywych danych. Z dwóch powodów.

**Próg jest urwiskiem w przypadkowym miejscu.** Czterech posłów ma 2 244 głosowania —
49,1% kadencji — i frekwencję 88–99%. Wypadali z rankingu o jeden punkt procentowy,
tak samo jak posłowie z 447 głosowaniami (9,8%). Próg traktował pół kadencji
i dwa tygodnie identycznie.

**Wykluczenie też jest decyzją.** Poseł z frekwencją 54% przy 100 głosowaniach ma
prawo znaleźć się w zestawieniu. Ukrywanie go „bo ma mało głosowań" to nie neutralność,
tylko wybór na jego korzyść.

Prawdziwy problem nie polega na tym, że mało głosowań jest „nieważne" — tylko na tym,
że procent ze 100 prób i procent z 4 569 prób to liczby o zupełnie różnej pewności.
Jeden zły tydzień przy 100 głosowaniach zbija frekwencję o 20 punktów; przy 4 569
o 0,4 punktu. Ranking po surowym procencie jest więc rankingiem długości mandatu.

Używamy **przedziału ufności Wilsona (95%)** — tego samego narzędzia, którym sortuje się
oceny w sklepach, żeby produkt z jedną piątką nie bił produktu z tysiącem czwórek.
Zmierzone na realnych przypadkach z bazy (SQL zgodny z niezależnym wyliczeniem w Pythonie
co do dziesiątej części punktu):

| głosowań | surowy % | przedział | szerokość |
|---:|---:|---|---:|
| 100 | 54,0% | 44,3 – 63,4% | 19,1 pkt |
| 147 | 93,9% | 88,8 – 96,7% | 7,9 pkt |
| 447 | 100,0% | 99,1 – 100,0% | 0,9 pkt |
| 2 244 | 98,7% | 98,2 – 99,1% | 0,9 pkt |
| 4 569 | 99,1% | 98,8 – 99,3% | 0,5 pkt |
| 4 569 | 54,0% | 52,5 – 55,4% | 2,9 pkt |

Sortujemy po `attendance_lo`, a pokazujemy `attendance_pct` **razem** z przedziałem
i liczbą głosowań. Poseł z krótkim mandatem nie wygrywa rankingu „najlepszych"
przypadkiem (100% ze 100 prób daje dolną granicę 96,3%, a 100% z 4 569 prób — 99,9%),
ale też nie znika z zestawienia, gdy naprawdę ma słaby wynik.

Widok `mp_stats_porownywalne` zastąpiony przez `mp_stats_ranking`: bez filtrowania,
z etykietą `zakres_mandatu` (pełna kadencja / ponad połowa / część / krótki mandat)
i `niepewnosc_pkt` do pokazania jako „± X pkt".

Koszt: 21 ms na 920 wywołań funkcji. Czas `refresh_mp_stats` bez zmian — 2,3 s.

### Nieobecność bez kontekstu jest zarzutem (migracja 0010)

Pierwszy uczciwie policzony ranking „najniższa obecność" zwrócił w czołówce posłów
z **pełną kadencją** i obecnością 11,6%, 14,6%, 50,3% oraz 50,5% — a wśród nich
urzędującego Prezesa Rady Ministrów.

Każda z tych liczb jest poprawna. Ale powody nieobecności są krańcowo różne —
od sprawowania urzędu, przez chorobę i urlop rodzicielski, po zwykłe nieprzychodzenie
do pracy — a **Sejm API nie podaje powodu.** Zwraca wyłącznie fakt.

Ranking bez kontekstu stawia szefa rządu obok posła, który po prostu nie przychodzi,
i sugeruje, że to to samo zjawisko. Każda strona sceny uzna to za atak na siebie
i obie będą miały rację.

Nie wolno nam wymyślać powodów, których źródło nie podaje. Możemy natomiast pokazać
to, co z danych **wynika** — kształt nieobecności w czasie:

| kształt | interpretacja |
|---|---|
| ciągła, blokiem od konkretnego miesiąca | przyczyna strukturalna: urząd, wyjazd, choroba |
| rozproszona po całej kadencji | wzorzec zachowania |

Zmierzone na dwóch przypadkach o **identycznej** obecności 50,0%:

| poseł | miesięcy | miesięcy prawie bez obecności | klasyfikacja |
|---|---:|---:|---|
| nieobecny blokiem | 8 | 4 | *nieobecność ciągła* |
| nieobecny co drugie głosowanie | 8 | 0 | *nieobecność rozproszona* |

Tabela `mp_absence_monthly` (~12 tys. wierszy, przeliczana w 1,2 s) trzyma rozkład
miesięczny. Tabela `mp_roles` — uzupełniana ręcznie i **zawsze ze źródłem**, tak samo
jak każdy inny fakt w tym systemie — opisuje funkcje państwowe. Widok
`mp_obecnosc_kontekst` łączy jedno z drugim i to jest zestaw kolumn, który ma trafić
na profil posła.

Nie po to, żeby usprawiedliwiać. Po to, żeby opisać.

---

## Sprint 3 — publiczna strona posła

```
src/lib/queries.ts                warstwa dostępu, klucz anon przez RLS
src/components/SourceLink.tsx     komponent zerowy — href jest WYMAGANY
src/components/StatBar.tsx        liczba razem z przedziałem ufności
src/components/AbsenceTimeline.tsx  kształt nieobecności, inline SVG bez JS
src/app/posel/[slug]/page.tsx     499 stron statycznych, ISR 24 h
src/app/poslowie/page.tsx         ranking z kontekstem
```

```bash
npm run dev     # http://localhost:3000/poslowie
```

### Decyzja redakcyjna: ranking z kontekstem

Pierwszy uczciwie policzony ranking postawił obok siebie Prezesa Rady Ministrów
i posłów z niską obecnością z zupełnie innych powodów. Wybrana odpowiedź: **publikujemy
pełną listę, ale każdy wiersz obowiązkowo niesie cztery rzeczy obok procentu.**

1. **Mianownik** — „X z Y głosowań”. Mandaty trwają różnie długo.
2. **Przedział ufności** — jako pasek, nie jako liczba do czytania. Przy 100 głosowaniach
   ma 19 punktów szerokości i widać to gołym okiem.
3. **Kształt nieobecności** — jedyne rozróżnienie, które *wynika z danych*,
   a nie z naszego domysłu.
4. **Funkcja państwowa**, jeśli jest udokumentowana w `mp_roles` ze źródłem.

Nikogo nie ukrywamy i nikogo nie pokazujemy bez kontekstu.

### Trzy decyzje w kodzie

**`SourceLink` ma `href` jako prop wymagany, bez wartości domyślnej.** Nie da się napisać
`<SourceLink />` „na razie bez linku, potem się doda” — kompilacja padnie. Baza wymusza
`source_id NOT NULL` po swojej stronie, ale nie widzi, co renderuje przeglądarka.
Tu pilnuje tego TypeScript.

**`null` nie jest zerem.** Lojalność posła w klubie jednoosobowym albo głosującego wyłącznie
`PRESENT` nie wynosi 0% — nie da się jej policzyć. `StatBar` renderuje wtedy „brak danych”
wraz z wyjaśnieniem dlaczego, zamiast rysować pusty pasek, który wygląda jak zero.

**Oś czasu jest inline SVG bez JavaScriptu.** Wchodzi do statycznego HTML-a, działa przy
wyłączonym JS i renderuje się w obrazku OG (Sprint 5) tym samym kodem.

## Następny krok — Sprint 4

Oś czasu obietnic (`legislative_processes` + `process_stages` są już w bazie),
panel moderatora i crowd-checking z auth magic-link.
