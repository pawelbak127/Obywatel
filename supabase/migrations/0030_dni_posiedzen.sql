-- =====================================================================
-- Obywatel 2.0 — migracja 0030: `mp_sitting_days` + widok `mp_dni_obecnosci`
--
-- PO CO. Serwis powtarza na kazdej podstronie zdanie: „Sejm nie podaje,
-- dlaczego posla nie bylo". Zdanie jest prawdziwe i zostaje — rejestr nadal
-- nie podaje POWODU.
--
-- Podaje natomiast cos, czego do 13.09.2026 nie pokazywalismy nigdzie:
-- czy nieobecnosc byla USPRAWIEDLIWIONA. Endpoint
-- `/sejm/term10/MP/{id}/votings/stats` zwraca dla kazdego dnia posiedzenia
-- pole `absenceExcuse`.
--
-- To jest wazne, bo dzis jedyny kontekst przy wysokiej nieobecnosci
-- (`ksztalt_nieobecnosci`) jest NASZA WLASNA pochodna. `absence_excuse`
-- jest faktem z rejestru, z odnosnikiem.
--
-- ---------------------------------------------------------------------
-- CO TA FLAGA ZNACZY — ustalone pomiarem, nie z dokumentacji.
--
-- Sprawdzone na czterech poslach, w tym dwoch z pelnym zapisem 159 dni:
-- `absenceExcuse = true` NIE WYSTAPILO ANI RAZU przy `numMissed = 0`.
--
--   Ziobro      159 dni: 7 z pelna obecnoscia, 55 uspr., 97 nieuspr.
--   Romanowski  159 dni: 26 z pelna obecnoscia, 15 uspr., 118 nieuspr.
--   Adamczyk    159 dni: 109 z pelna obecnoscia, 13 uspr., 37 nieuspr.
--   Sobon         7 dni: 5 z pelna obecnoscia, 1 uspr., 1 nieuspr.
--
-- Flaga opisuje wiec SAMA NIEOBECNOSC, a nie dzien w ogole. Dlatego wolno
-- napisac „nieobecnosc usprawiedliwiona", a nie tylko „dzien oznaczony".
--
-- ---------------------------------------------------------------------
-- KLUCZ JEST TROJELEMENTOWY I TO NIE JEST OSTROZNOSC NA WYROST.
--
-- Zmierzone: 159 wierszy, ale tylko 158 UNIKALNYCH DAT — jeden dzien
-- wystepuje dwa razy, z roznymi numerami posiedzenia. Klucz `(mp_id, date)`
-- gubilby ten wiersz po cichu przy kazdym imporcie.
--
-- ---------------------------------------------------------------------
-- PULAPKA PRZY UZYCIU TYCH DANYCH — przeczytaj, zanim cokolwiek policzysz.
--
-- Nasza obecnosc liczy sie PER GLOSOWANIE (z tabeli `votes`), a ta flaga
-- jest PER DZIEN POSIEDZENIA. Jeden dzien zawiera i glosy oddane, i
-- opuszczone — Ziobro ma 152 dni z jakimkolwiek brakiem przy 4 045
-- opuszczonych glosowaniach.
--
-- NIE WOLNO wiec napisac „X% nieobecnosci usprawiedliwionych", bo mianownik
-- byl by z innego zbioru niz licznik. Jedyna uczciwa forma to liczba DNI:
-- „w 55 z 152 dni, w ktorych posel opuscil glosowania, nieobecnosc byla
-- usprawiedliwiona".
-- =====================================================================

create table if not exists mp_sitting_days (
  mp_id          integer     not null references mps(id) on delete cascade,
  date           date        not null,
  sitting        integer     not null,
  num_votings    integer     not null,
  num_voted      integer     not null,
  num_missed     integer     not null,
  absence_excuse boolean     not null,
  updated_at     timestamptz not null default now(),
  primary key (mp_id, date, sitting)
);

comment on table mp_sitting_days is
  'Dzien posiedzenia w ujeciu jednego posla, z rejestru Sejmu (/MP/{id}/votings/stats). Klucz trojelementowy — jedna data potrafi miec dwa posiedzenia.';
comment on column mp_sitting_days.absence_excuse is
  'Czy nieobecnosc tego dnia byla usprawiedliwiona. NIE mowi, z jakiego powodu.';

create index if not exists mp_sitting_days_mp_idx on mp_sitting_days (mp_id);

-- Suma sie zgadza w 100% probki (318 wierszy, 0 odchylen). Jesli rejestr
-- kiedys przysle wiersz, w ktorym sie nie zgadza, import ma stanac, a nie
-- policzyc z niego cokolwiek.
-- Bez `drop constraint if exists` — wpada pod bezpiecznik `scripts/sql.mjs`
-- razem z `drop column` i wymagalby wylaczenia ochrony po to, zeby dolozyc
-- ochrone. Sprawdzenie katalogu jest dluzsze o piec linii i niczego nie usuwa.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'mp_sitting_days_suma' and conrelid = 'mp_sitting_days'::regclass
  ) then
    alter table mp_sitting_days add constraint mp_sitting_days_suma
      check (num_voted + num_missed = num_votings);
  end if;
end $$;

alter table mp_sitting_days enable row level security;

drop policy if exists "public read mp_sitting_days" on mp_sitting_days;
create policy "public read mp_sitting_days" on mp_sitting_days for select using (true);
grant select on mp_sitting_days to anon, authenticated;

-- =====================================================================
-- WIDOK — liczby wyprowadzamy tutaj, nie przechowujemy (CLAUDE.md §6).
-- =====================================================================

drop view if exists mp_dni_obecnosci;

create view mp_dni_obecnosci
with (security_invoker = on) as
select
  mp_id,
  count(*)                                                          as dni_posiedzen,
  count(*) filter (where num_missed > 0)                            as dni_z_nieobecnoscia,
  count(*) filter (where num_missed > 0 and absence_excuse)          as dni_usprawiedliwione,
  count(*) filter (where num_missed > 0 and not absence_excuse)      as dni_nieusprawiedliwione,
  max(date)                                                          as ostatni_dzien
from mp_sitting_days
group by mp_id;

comment on view mp_dni_obecnosci is
  'Dni posiedzen w ujeciu posla. UWAGA: liczy DNI, nie glosowania — nie mieszac z attendance_pct, ktore liczy glosowania.';

grant select on mp_dni_obecnosci to anon, authenticated;

-- =====================================================================
-- BLOKI KONTROLNE (CLAUDE.md §7.3)
-- =====================================================================

-- 1. KONTRAKT Z `queries.ts`. Literowka w nazwie kolumny ujawnilaby sie
--    dopiero przy wejsciu na profil.
do $$
declare brakujace text;
begin
  select string_agg(k, ', ') into brakujace
  from unnest(array[
    'mp_id', 'dni_posiedzen', 'dni_z_nieobecnoscia',
    'dni_usprawiedliwione', 'dni_nieusprawiedliwione', 'ostatni_dzien'
  ]) as k
  where not exists (
    select 1 from information_schema.columns
    where table_name = 'mp_dni_obecnosci' and column_name = k
  );

  if brakujace is not null then
    raise exception 'Widok mp_dni_obecnosci nie ma kolumn: %', brakujace;
  end if;
end $$;

-- 2. OGRANICZENIE SUMY NAPRAWDE ODRZUCA — sprawdzane ZACHOWANIEM,
--    w podtransakcji, bez zostawiania wiersza.
do $$
declare id_probny int;
begin
  select id into id_probny from mps order by id limit 1;
  if id_probny is null then
    raise exception 'Tabela mps jest pusta — uruchom import przed ta migracja.';
  end if;

  begin
    insert into mp_sitting_days (mp_id, date, sitting, num_votings, num_voted, num_missed, absence_excuse)
    values (id_probny, date '1900-01-01', 0, 10, 3, 3, false);
    raise exception
      'Ograniczenie mp_sitting_days_suma NIE dziala — przeszedl wiersz, w ktorym '
      'oddane + opuszczone nie rowna sie wszystkim. Kazda liczba z tej tabeli '
      'bylaby wtedy niesprawdzalna.';
  exception
    when check_violation then null; -- tego oczekujemy
  end;

  delete from mp_sitting_days where mp_id = id_probny and date = date '1900-01-01' and sitting = 0;
end $$;

-- 3. ANON NAPRAWDE CZYTA. Bez tego sekcja na profilu bylaby po prostu pusta,
--    tak jak sekcja swiezosci na /status przez cala dobe (migracja 0028).
do $$
begin
  if not has_table_privilege('anon', 'mp_dni_obecnosci', 'SELECT') then
    raise exception 'anon nie ma prawa SELECT na mp_dni_obecnosci — sekcja na profilu bedzie pusta.';
  end if;
end $$;

-- =====================================================================
-- WYNIK. Oczekiwane TERAZ: same zera — tabela zapelnia sie po
-- `npm run ingest:dni`.
-- =====================================================================
select
  (select count(*) from mp_sitting_days)                  as wierszy,
  (select count(distinct mp_id) from mp_sitting_days)     as poslow,
  (select count(*) from mp_dni_obecnosci)                 as w_widoku;
