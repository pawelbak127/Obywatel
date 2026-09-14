-- =====================================================================
-- Obywatel 2.0 — migracja 0033: komisje sejmowe i czlonkostwo poslow
--
-- PO CO. Profil posla mowi, jak glosowal i o co pytal rzad. Nie mowi
-- natomiast, CZYM SIE ZAJMUJE — a to pierwsze pytanie, jakie zadaje
-- czytelnik o „swoim" posle. Komisja jest na to odpowiedzia z rejestru,
-- bez ani jednego domyslu z naszej strony.
--
-- Zmierzone 13.09.2026:
--   40 komisji: 31 stalych, 6 nadzwyczajnych, 3 SLEDCZE
--   1 076 czlonkostw, 409 poslow
--   funkcje: 37 przewodniczacych, 3 przewodniczace, 169 zastepcow,
--            2 zastepcow przewodniczacej, 5 zastepczyn, 860 bez funkcji
--
-- ---------------------------------------------------------------------
-- FUNKCJE ZAPISUJEMY SLOWAMI REJESTRU, NIE NORMALIZUJEMY.
--
-- Rejestr rozroznia „przewodniczacy" i „przewodniczaca", „zastepca
-- przewodniczacej" i „zastepczyni przewodniczacej". Kuszace bylo sprowadzic
-- to do dwoch kodow — i byloby to zlamaniem D20: kody grupuja, slowa mowia,
-- a przy sporze wygrywaja slowa rejestru. Sprowadzenie „przewodniczacej" do
-- „przewodniczacy" zmienialoby to, co rejestr napisal o konkretnej osobie.
--
-- `function` = NULL znaczy zwykly czlonek. To 860 z 1 076 wpisow i jest to
-- poprawny stan, nie brak danych.
--
-- ---------------------------------------------------------------------
-- PODKOMISJE ZAPISUJEMY JAKO KODY I NIC WIECEJ.
--
-- Kazda komisja podaje liste kodow swoich podkomisji — lacznie 106 pozycji.
-- Zmierzone: ZADEN z tych kodow nie wystepuje jako komisja na liscie
-- glownej, czyli API nie daje o nich zadnych danych poza samym kodem.
--
-- Trzymamy je wiec jako `text[]` bez klucza obcego i BEZ pokazywania
-- czytelnikowi. Kod bez nazwy („ASW01N") nie jest informacja, tylko
-- zagadka — a serwis, ktory obiecuje odnosnik przy kazdej informacji,
-- nie moze publikowac czegos, czego sam nie umie rozwinac.
-- =====================================================================

create table if not exists committees (
  code              text        primary key,
  term              integer     not null default 10,
  name              text        not null,
  name_genitive     text,
  type              text        not null check (type in ('STANDING', 'EXTRAORDINARY', 'INVESTIGATIVE')),
  scope             text,
  phone             text,
  appointment_date  date,
  composition_date  date,
  sub_committees    text[]      not null default '{}',
  updated_at        timestamptz not null default now()
);

comment on table committees is
  'Komisje sejmowe z rejestru. `sub_committees` to same kody — API nie daje o podkomisjach nic wiecej, wiec nie pokazujemy ich czytelnikowi.';
comment on column committees.type is
  'STANDING = stala, EXTRAORDINARY = nadzwyczajna, INVESTIGATIVE = sledcza. Slownik zamkniety, pilnowany ograniczeniem.';

create table if not exists committee_members (
  code      text        not null references committees(code) on delete cascade,
  mp_id     integer     not null references mps(id) on delete cascade,
  function  text,
  join_date date,
  primary key (code, mp_id)
);

comment on column committee_members.function is
  'Funkcja SLOWAMI REJESTRU (D20) — takze w formie zenskiej. NULL = zwykly czlonek, to 860 z 1 076 wpisow.';

create index if not exists committee_members_mp_idx on committee_members (mp_id);

alter table committees        enable row level security;
alter table committee_members enable row level security;

drop policy if exists "public read committees" on committees;
create policy "public read committees" on committees for select using (true);

drop policy if exists "public read committee_members" on committee_members;
create policy "public read committee_members" on committee_members for select using (true);

grant select on committees, committee_members to anon, authenticated;

-- =====================================================================
-- WIDOK — komisje w ujeciu posla (CLAUDE.md §6: liczby wyprowadzamy).
-- =====================================================================

drop view if exists mp_komisje;

create view mp_komisje
with (security_invoker = on) as
select
  m.mp_id,
  m.code,
  c.name,
  c.type,
  m.function,
  m.join_date
from committee_members m
join committees c on c.code = m.code;

comment on view mp_komisje is
  'Czlonkostwa posla w komisjach, z nazwa i typem komisji. Jeden wiersz na czlonkostwo — posel bywa w kilku.';

grant select on mp_komisje to anon, authenticated;

-- =====================================================================
-- BLOKI KONTROLNE (CLAUDE.md §7.3)
-- =====================================================================

-- 1. KONTRAKT Z `queries.ts`.
do $$
declare brakujace text;
begin
  select string_agg(k, ', ') into brakujace
  from unnest(array['mp_id', 'code', 'name', 'type', 'function', 'join_date']) as k
  where not exists (
    select 1 from information_schema.columns
    where table_name = 'mp_komisje' and column_name = k
  );
  if brakujace is not null then
    raise exception 'Widok mp_komisje nie ma kolumn: %', brakujace;
  end if;
end $$;

-- 2. SLOWNIK TYPU NAPRAWDE ODRZUCA — sprawdzane ZACHOWANIEM. Interfejs
--    tlumaczy te trzy wartosci na polskie nazwy; czwarta wypadlaby z tego
--    tlumaczenia i pokazalaby czytelnikowi surowy kod.
do $$
begin
  begin
    insert into committees (code, name, type) values ('_PROBA', 'proba', 'COKOLWIEK');
    raise exception 'Ograniczenie na `type` NIE dziala — przeszedl typ spoza slownika.';
  exception
    when check_violation then null; -- tego oczekujemy
  end;
  delete from committees where code = '_PROBA';
end $$;

-- 3. KLUCZ OBCY DO `mps` NAPRAWDE PILNUJE.
do $$
begin
  insert into committees (code, name, type) values ('_PROBA', 'proba klucza obcego', 'STANDING');
  begin
    insert into committee_members (code, mp_id) values ('_PROBA', -999);
    raise exception 'Klucz obcy do mps NIE dziala — przeszedl czlonek, ktorego nie ma w bazie.';
  exception
    when foreign_key_violation then null; -- tego oczekujemy
  end;
  delete from committees where code = '_PROBA';
end $$;

-- 4. ANON CZYTA.
do $$
begin
  if not has_table_privilege('anon', 'mp_komisje', 'SELECT') then
    raise exception 'anon nie ma prawa SELECT na mp_komisje — sekcja na profilu bedzie pusta.';
  end if;
  if not has_table_privilege('anon', 'committees', 'SELECT') then
    raise exception 'anon nie ma prawa SELECT na committees.';
  end if;
end $$;

-- =====================================================================
-- WYNIK. Oczekiwane TERAZ: zera. Po `npm run ingest:komisje`: 40 komisji
-- i 1 076 czlonkostw (zmierzone 13.09.2026).
-- =====================================================================
select
  (select count(*) from committees)                                  as komisji,
  (select count(*) from committees where type = 'INVESTIGATIVE')     as sledczych,
  (select count(*) from committee_members)                           as czlonkostw,
  (select count(distinct mp_id) from committee_members)              as poslow;
