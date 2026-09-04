-- =====================================================================
-- Obywatel 2.0 — migracja 0010: nieobecnosc bez kontekstu jest zarzutem
--
-- CO POKAZALY PIERWSZE PRAWDZIWE DANE. Ranking "najnizsza obecnosc", policzony
-- juz uczciwie (przedzialy ufnosci, pelne mianowniki), zwraca w czolowce:
--
--     11,6%  posel z pelna kadencja
--     14,6%  posel z pelna kadencja
--     50,3%  poslanka z pelna kadencja
--     50,5%  Prezes Rady Ministrow
--
-- I to jest problem, ktorego nie rozwiaze zadna statystyka. Wszystkie te liczby
-- sa poprawne. Ale powody nieobecnosci sa krancowo rozne — od sprawowania urzedu,
-- przez chorobe i urlop rodzicielski, po zwykle nieprzychodzenie do pracy —
-- a Sejm API NIE PODAJE POWODU. Zwraca tylko fakt.
--
-- Ranking "najgorsza frekwencja" bez kontekstu stawia szefa rzadu obok posla,
-- ktory po prostu nie przychodzi, i sugeruje, ze to to samo zjawisko. Kazda
-- strona sceny uzna to za atak na siebie, i obie beda mialy racje.
--
-- Nie mozemy wymyslic powodow, ktorych zrodlo nie podaje. Mozemy natomiast dac
-- czytelnikowi to, co z danych WYNIKA — a mianowicie KSZTALT nieobecnosci w czasie.
--
--   Nieobecnosc ciagla, blokiem od konkretnego miesiaca  -> przyczyna strukturalna
--                                                           (urzad, wyjazd, choroba)
--   Nieobecnosc rozproszona po calej kadencji            -> wzorzec zachowania
--
-- To rozroznienie jest w naszych danych i nie wymaga zgadywania. Dwie liczby
-- "50%" wygladajace identycznie w tabeli wygladaja zupelnie inaczej na osi czasu.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Nieobecnosc w rozbiciu na miesiace
--    ~499 poslow x ~24 miesiace = ~12 tys. wierszy. Grosze wobec 2,1 mln glosow.
-- ---------------------------------------------------------------------
create table if not exists mp_absence_monthly (
  mp_id      smallint not null references mps(id) on delete cascade,
  month      date     not null,          -- pierwszy dzien miesiaca
  votings    int      not null,
  present    int      not null,
  absent     int      not null,
  absent_pct numeric(4,1),
  primary key (mp_id, month)
);

alter table mp_absence_monthly enable row level security;
create policy "public read absence" on mp_absence_monthly for select using (true);
grant select on mp_absence_monthly to anon, authenticated;

comment on table mp_absence_monthly is
  'Ksztalt nieobecnosci w czasie. Bez tego "50% obecnosci" prezesa rady ministrow i "50%" posla, ktory nie przychodzi, wygladaja identycznie.';

create or replace function public.refresh_absence_monthly()
returns table (updated int)
language plpgsql
set search_path = ''
set statement_timeout = '10min'
as $$
declare n int;
begin
  delete from public.mp_absence_monthly;

  insert into public.mp_absence_monthly (mp_id, month, votings, present, absent, absent_pct)
  select
    v.mp_id,
    date_trunc('month', vt.voted_at)::date            as month,
    count(*)::int                                     as votings,
    count(*) filter (where v.value <> 'ABSENT')::int  as present,
    count(*) filter (where v.value =  'ABSENT')::int  as absent,
    round(100.0 * count(*) filter (where v.value = 'ABSENT') / nullif(count(*),0), 1)
  from public.votes v
  join public.votings vt on vt.id = v.voting_id
  group by v.mp_id, date_trunc('month', vt.voted_at)::date;

  get diagnostics n = row_count;
  return query select n;
end $$;

revoke all on function public.refresh_absence_monthly() from public, anon, authenticated;
grant execute on function public.refresh_absence_monthly() to service_role;

-- ---------------------------------------------------------------------
-- 2. Funkcje panstwowe — jedyna droga do kontekstu, jakiego API nie da
--
-- Tabela CELOWO wymaga zrodla, tak jak kazdy inny fakt w tym systemie.
-- Wpis "minister od marca 2024" bez linku do powolania jest tak samo
-- niedopuszczalny jak kwota z oswiadczenia majatkowego bez skanu.
--
-- Wypelniana recznie przez moderacje. Kilkadziesiat wpisow na kadencje.
-- ---------------------------------------------------------------------
create table if not exists mp_roles (
  id         uuid primary key default gen_random_uuid(),
  mp_id      smallint not null references mps(id) on delete cascade,
  role_name  text     not null,          -- 'Prezes Rady Ministrow', 'Minister Sprawiedliwosci'
  role_kind  text     not null,          -- 'rzad' | 'prezydium_sejmu' | 'ue' | 'inne'
  date_from  date     not null,
  date_to    date,
  source_id  uuid     not null references sources(id),
  created_at timestamptz not null default now(),
  constraint role_dates check (date_to is null or date_to >= date_from)
);

create index on mp_roles (mp_id, date_from);
alter table mp_roles enable row level security;
create policy "public read roles" on mp_roles for select using (true);
grant select on mp_roles to anon, authenticated;

comment on table mp_roles is
  'Funkcje panstwowe wyjasniajace strukturalna nieobecnosc. Uzupelniana recznie, ZAWSZE ze zrodlem. Nie sluzy do usprawiedliwiania — sluzy do opisania.';

-- ---------------------------------------------------------------------
-- 3. Widok: liczba razem z jej kontekstem
--
-- `nieobecnosc_ciagla` mierzy, jak bardzo nieobecnosci sa skupione w czasie:
-- ile miesiecy posel opuscil niemal w calosci (>= 80% nieobecnosci).
-- Duzo takich miesiecy przy niskiej obecnosci = przerwa, a nie wzorzec.
-- ---------------------------------------------------------------------
create or replace view mp_obecnosc_kontekst as
select
  r.id, r.full_name, r.slug, r.klub, r.active,
  r.votes_total, r.attendance_pct, r.attendance_lo, r.attendance_hi,
  r.niepewnosc_pkt, r.zakres_mandatu,
  r.first_voted_at, r.last_voted_at,
  a.miesiecy_lacznie,
  a.miesiecy_prawie_bez_obecnosci,
  case
    when r.attendance_pct >= 90 then 'brak istotnych nieobecnosci'
    when a.miesiecy_prawie_bez_obecnosci >= 0.5 * a.miesiecy_lacznie then 'nieobecnosc ciagla — sprawdz funkcje panstwowa lub przerwe w mandacie'
    when a.miesiecy_prawie_bez_obecnosci > 0 then 'nieobecnosc czesciowo skupiona w czasie'
    else 'nieobecnosc rozproszona'
  end as ksztalt_nieobecnosci,
  (select string_agg(ro.role_name || ' (od ' || ro.date_from || coalesce(' do ' || ro.date_to, '') || ')', '; ')
     from mp_roles ro where ro.mp_id = r.id) as funkcje_panstwowe
from mp_stats_ranking r
left join lateral (
  select
    count(*)::int                                  as miesiecy_lacznie,
    count(*) filter (where m.absent_pct >= 80)::int as miesiecy_prawie_bez_obecnosci
  from mp_absence_monthly m
  where m.mp_id = r.id
) a on true;

alter view mp_obecnosc_kontekst set (security_invoker = on);
grant select on mp_obecnosc_kontekst to anon, authenticated;

comment on view mp_obecnosc_kontekst is
  'Obecnosc razem z ksztaltem nieobecnosci w czasie i ewentualna funkcja panstwowa. To jest zestaw kolumn, ktory profil posla ma pokazac — sama liczba jest zarzutem, liczba z kontekstem jest informacja.';
