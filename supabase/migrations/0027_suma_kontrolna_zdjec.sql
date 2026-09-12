-- =====================================================================
-- Obywatel 2.0 — migracja 0027: `mps.photo_sha256`
--
-- PO CO. Migracja 0023 skopiowala 499 zdjec do wlasnego Storage i zapisala
-- `photo_stored_at` z komentarzem „sluzy do odswiezania". Zaden mechanizm
-- odswiezania nigdy nie powstal (pozycja R2-5 z recenzji) — komentarz
-- opisywal zamiar, nie kod.
--
-- Odswiezania nie da sie zrobic tanio bez tej kolumny. Zmierzone 11.09.2026
-- na `api.sejm.gov.pl/.../MP/{id}/photo`: odpowiedz nie ma ANI `ETag`, ANI
-- `Last-Modified`, ANI `Cache-Control`. Nie ma wiec czego porownac bez
-- pobrania calego pliku — a skoro i tak go pobieramy, to suma kontrolna
-- jest jedynym sposobem, zeby NIE zapisywac go z powrotem do Storage,
-- gdy nic sie nie zmienilo.
--
-- Przy okazji kolumna odpowiada na pytanie, ktorego dotad nie umielismy
-- zadac: czy plik u nas to na pewno ten sam plik, co u zrodla.
--
-- ---------------------------------------------------------------------
-- DLACZEGO OGRANICZENIE NA KSZTALT, A NIE SAMO `text`.
--
-- Kolumna bez ograniczenia przyjmie wszystko: pusty ciag, komunikat bledu,
-- skrot obciety w polowie. Zadna z tych wartosci nie rowna sie prawdziwej
-- sumie, wiec porownanie „czy sie zmienilo" wychodzi ZAWSZE na „tak" —
-- i skrypt zaczyna po cichu nadpisywac Storage co noc, nie zglaszajac bledu.
-- Awaria, ktora wyglada jak poprawne dzialanie, jest tu grozniejsza niz
-- awaria glosna.
-- =====================================================================

alter table mps add column if not exists photo_sha256 text;

comment on column mps.photo_sha256 is
  'sha256 bajtow zdjecia w naszym Storage, 64 znaki hex. NULL = kopia sprzed 0027, jeszcze niezwazona.';

-- Osobno od `add column`, bo `add column if not exists` nie powtorzy sie
-- przy ponownym uruchomieniu, a ograniczenie mogloby wtedy nie powstac.
--
-- BEZ `drop constraint if exists`. Tamten wariant jest krotszy, ale wpada
-- pod bezpiecznik `scripts/sql.mjs` razem z `alter table … drop column`
-- i wymagalby flagi `--pozwol-na-destrukcje` — czyli wylaczenia ochrony
-- przed prawdziwa utrata danych po to, zeby dolozyc ograniczenie. Sprawdzenie
-- katalogu jest dluzsze o piec linii i niczego nie usuwa.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'mps_photo_sha256_hex' and conrelid = 'mps'::regclass
  ) then
    alter table mps add constraint mps_photo_sha256_hex
      check (photo_sha256 is null or photo_sha256 ~ '^[0-9a-f]{64}$');
  end if;
end $$;

-- =====================================================================
-- BLOKI KONTROLNE (CLAUDE.md §7.3)
-- =====================================================================

-- 1. OGRANICZENIE NAPRAWDE ISTNIEJE I NAPRAWDE ODRZUCA.
--    Sprawdzamy je ZACHOWANIEM, nie obecnoscia w katalogu systemowym:
--    wpis do katalogu moze istniec jako `not valid` i nie pilnowac niczego.
--    Proba idzie w podtransakcji i jest wycofywana — zaden wiersz nie
--    zostaje zmieniony.
do $$
declare id_probny int;
begin
  select id into id_probny from mps order by id limit 1;
  if id_probny is null then
    raise exception 'Tabela mps jest pusta — uruchom import przed ta migracja.';
  end if;

  begin
    update mps set photo_sha256 = 'nie-jest-suma' where id = id_probny;
    -- Jesli doszlismy tutaj, ograniczenie przepuscilo smiec.
    raise exception
      'Ograniczenie mps_photo_sha256_hex NIE dziala — kolumna przyjela wartosc '
      '"nie-jest-suma". Bez niego kazde porownanie sumy wychodzi na "zmienilo sie" '
      'i skrypt nadpisuje Storage co noc, nie zglaszajac bledu.';
  exception
    when check_violation then
      null; -- tego oczekujemy
  end;

  -- Wycofanie proby. `update` powyzej albo sie nie udal (check_violation),
  -- albo rzucil wyjatek konczacy migracje — ale gdyby Postgres kiedys
  -- zmienil kolejnosc, ta linia przywraca stan jawnie.
  update mps set photo_sha256 = null where id = id_probny and photo_sha256 = 'nie-jest-suma';
end $$;

-- 2. KONTRAKT Z `ingest/lib/preflight.ts`. Skrypt sprawdza kolumny przez
--    `select ... limit 0`, wiec literowka w nazwie ujawnilaby sie dopiero
--    przy nocnym uruchomieniu. Tutaj ujawnia sie od razu.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'mps' and column_name = 'photo_sha256' and data_type = 'text'
  ) then
    raise exception 'Kolumna mps.photo_sha256 nie powstala albo ma inny typ niz text.';
  end if;
end $$;

-- =====================================================================
-- WYNIK. `raise notice` jest niewidoczne w edytorze SQL Supabase (§6).
--
-- Oczekiwane TERAZ: `z_kopia` = 499, `zwazonych` = 0. Sumy pojawiaja sie
-- dopiero przy kolejnych uruchomieniach `ingest:zdjecia`, po 17 na dobe —
-- czyli komplet po okolo trzydziestu dniach.
-- =====================================================================
select
  count(*) filter (where photo_stored_url is not null) as z_kopia,
  count(*) filter (where photo_sha256 is not null)     as zwazonych,
  min(photo_stored_at)::date                           as najstarsza_kopia,
  max(photo_stored_at)::date                           as najswiezsza_kopia
from mps;
