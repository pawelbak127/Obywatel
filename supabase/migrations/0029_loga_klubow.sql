-- =====================================================================
-- Obywatel 2.0 — migracja 0029: kubelek `loga` + kolumny w `clubs`
--
-- PO CO. Pawel poprosil o odroznianie partii logiem. Pierwsza odpowiedz
-- brzmiala „nie da sie uczciwie, bo `clubs.logo_url` jest puste dla
-- wszystkich trzynastu klubow, wiec logo trzeba by wziac skadinad — czyli
-- hostowac cudze znaki towarowe bez podstawy".
--
-- TA ODPOWIEDZ BYLA BLEDNA. Specyfikacja OpenAPI Sejm API (57 sciezek,
-- pobrana 13.09.2026) wymienia `/sejm/term{term}/clubs/{id}/logo`.
-- Sprawdzone na wszystkich dwunastu klubach kadencji X: jedenascie zwraca
-- prawdziwy `image/jpeg` o wielkosci 1,9–7,3 kB.
--
-- Logo ma wiec DOKLADNIE TAKIE SAMO zrodlo jak zdjecie posla: rejestr
-- Kancelarii Sejmu. Znika zarowno problem podstawy prawnej, jak i problem
-- „skad to wziac" — a przy obrazku moze stanac <SourceLink> jak przy
-- kazdej innej informacji.
--
-- ---------------------------------------------------------------------
-- DLACZEGO OSOBNY KUBELEK, A NIE `portrety`.
--
-- `portrety` przyjalby je rozmiarem (limit 512 kB, te same typy MIME).
-- Ale nazwa kubelka jest jedyna etykieta, jaka zobaczy ktos, kto za rok
-- otworzy panel Storage i zapyta „co to za pliki". Kubelek nazwany
-- „portrety", w ktorym leza znaki towarowe partii, klamalby o wlasnej
-- zawartosci — a to jest projekt, w ktorym nazwy maja znaczyc to, co mowia.
--
-- ---------------------------------------------------------------------
-- `niez.` NIE MA LOGA I TO NIE JEST AWARIA.
--
-- Endpoint zwraca dla niego `200` z ZEROWA dlugoscia. Niezrzeszeni nie sa
-- partia i nie maja znaku — brak pliku jest tu poprawnym stanem. Importer
-- MUSI to odroznic od bledu pobierania, inaczej co noc bedzie zglaszal
-- awarie, ktorej nie ma.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('loga', 'loga', true, 262144, array['image/jpeg', 'image/png'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

alter table clubs add column if not exists logo_stored_url text;
alter table clubs add column if not exists logo_stored_at  timestamptz;
alter table clubs add column if not exists logo_sha256     text;

comment on column clubs.logo_stored_url is
  'Adres naszej kopii loga w kubelku `loga`. NULL = klub nie ma znaku (np. niez.) albo jeszcze nie kopiowalismy.';
comment on column clubs.logo_sha256 is
  'sha256 bajtow loga, 64 znaki hex. Sluzy do odswiezania — patrz wzorzec z mps.photo_sha256 (0027).';

-- Ten sam ksztalt, co przy zdjeciach (0027), i z tego samego powodu:
-- kolumna bez ograniczenia przyjmie smiec, a wtedy porownanie sumy wychodzi
-- zawsze na „zmienilo sie" i skrypt nadpisuje Storage co noc po cichu.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clubs_logo_sha256_hex' and conrelid = 'clubs'::regclass
  ) then
    alter table clubs add constraint clubs_logo_sha256_hex
      check (logo_sha256 is null or logo_sha256 ~ '^[0-9a-f]{64}$');
  end if;
end $$;

-- =====================================================================
-- BLOKI KONTROLNE (CLAUDE.md §7.3)
-- =====================================================================

-- 1. KUBELEK ISTNIEJE I JEST PUBLICZNY. Gdyby nie byl, strona nie odczyta
--    ani jednego loga, a blad zobaczymy dopiero w przegladarce.
do $$
declare publiczny boolean;
begin
  select public into publiczny from storage.buckets where id = 'loga';
  if publiczny is null then
    raise exception 'Kubelek "loga" nie powstal.';
  end if;
  if not publiczny then
    raise exception 'Kubelek "loga" nie jest publiczny — strona nie odczyta znakow klubow.';
  end if;
end $$;

-- 2. OGRANICZENIE NAPRAWDE ODRZUCA. Sprawdzamy ZACHOWANIEM, nie obecnoscia
--    w katalogu: wpis moze istniec jako `not valid` i nie pilnowac niczego.
do $$
declare id_probny text;
begin
  select id into id_probny from clubs order by id limit 1;
  if id_probny is null then
    raise exception 'Tabela clubs jest pusta — uruchom import przed ta migracja.';
  end if;

  begin
    update clubs set logo_sha256 = 'nie-jest-suma' where id = id_probny;
    raise exception
      'Ograniczenie clubs_logo_sha256_hex NIE dziala — kolumna przyjela smiec. '
      'Bez niego kazde porownanie sumy wychodzi na "zmienilo sie".';
  exception
    when check_violation then null; -- tego oczekujemy
  end;

  update clubs set logo_sha256 = null where id = id_probny and logo_sha256 = 'nie-jest-suma';
end $$;

-- =====================================================================
-- WYNIK. `raise notice` jest niewidoczne w edytorze SQL Supabase (§6).
-- Oczekiwane TERAZ: 13 klubow, 0 z kopia. Kopie pojawiaja sie po
-- `npm run ingest:loga`.
-- =====================================================================
select
  count(*)                                          as klubow,
  count(logo_stored_url)                            as z_kopia,
  count(*) filter (where logo_sha256 is not null)   as zwazonych
from clubs;
