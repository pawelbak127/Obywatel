-- =====================================================================
-- Obywatel 2.0 — migracja 0008: refresh_mp_stats bez zlaczenia bocznego
--
-- OBJAW. Po backfillu 2 099 638 glosow:
--     BLAD: refresh_mp_stats: canceling statement due to statement timeout
-- Ta sama funkcja wywolana recznie w SQL Editorze przechodzi — bo tam limit
-- czasu jest inny. Przez PostgREST (czyli z crona) padala.
--
-- PRZYCZYNA. Zapytanie liczylo wiekszosc klubu ZLACZENIEM BOCZNYM, czyli raz
-- dla KAZDEGO z 2,1 mln wierszy. Tymczasem "wiekszosc klubu w danym glosowaniu"
-- to wartosc dla PARY (glosowanie, klub) — takich par jest okolo 4 569 x 13,
-- czyli ~59 tysiecy, a nie 2,1 miliona. Liczylismy to samo ~35 razy za duzo.
--
-- POPRAWKA. Wiekszosci licza sie raz, grupowaniem, i sa doklejane zwyklym
-- zlaczeniem. Zmierzone na 2 101 740 wierszach (PostgreSQL 16, dane o rozkladzie
-- zblizonym do realnego):
--
--     zlaczenie boczne (0007):  10 157 ms
--     grupowanie (0008):        patrz komentarz na koncu pliku
--
-- Dodatkowo funkcja dostaje wlasny statement_timeout. Nawet szybkie zapytanie
-- na obciazonej instancji potrafi przekroczyc domyslny limit, a nocny cron nie
-- ma powodu miescic sie w limicie przewidzianym dla zapytan uzytkownika.
--
-- UWAGA na coalesce(club_seq, -1): posel bez klubu ma NULL, a NULL = NULL nigdy
-- nie jest prawda. Bez tego zabiegu trzeba by uzyc "is not distinct from",
-- co blokuje zlaczenie haszowe i cofa cala optymalizacje.
-- =====================================================================

alter table mp_stats add column if not exists first_voted_at timestamptz;
alter table mp_stats add column if not exists last_voted_at  timestamptz;

comment on column mp_stats.first_voted_at is
  'Pierwsze glosowanie, w ktorym posel wystapil. Poslowie obejmujacy mandat w trakcie kadencji maja krotszy okres — bez tego procenty sa nieporownywalne.';

create or replace function public.refresh_mp_stats()
returns table (updated int)
language plpgsql
set search_path = ''
set statement_timeout = '10min'
as $$
declare n int;
begin
  with maj as (
    -- Raz na pare (glosowanie, klub) zamiast raz na wiersz.
    select
      v.voting_id,
      coalesce(v.club_seq, -1)                as club_key,
      mode() within group (order by v.value)  as club_majority,
      count(*)                                as club_size
    from public.votes v
    where v.value in ('YES','NO','ABSTAIN')
    group by v.voting_id, coalesce(v.club_seq, -1)
  ),
  per_vote as (
    select
      v.mp_id,
      v.value,
      vt.kind,
      vt.voted_at,
      m.club_majority,
      coalesce(m.club_size, 0) as club_size,
      (v.value in ('YES','NO','ABSTAIN')) as ma_stanowisko,
      (
        v.value in ('YES','NO','ABSTAIN')
        and coalesce(m.club_size, 0) >= 3
        and vt.kind is distinct from 'ON_LIST'
      ) as liczy_sie
    from public.votes v
    join public.votings vt on vt.id = v.voting_id
    left join maj m
      on m.voting_id = v.voting_id
     and m.club_key  = coalesce(v.club_seq, -1)
  ),
  stats as (
    select
      pv.mp_id,
      count(*)::int                                      as votes_total,
      count(*) filter (where pv.value <> 'ABSENT')::int   as votes_cast,
      round(100.0 * count(*) filter (where pv.value <> 'ABSENT')
            / nullif(count(*),0), 1)                      as attendance_pct,
      round(100.0 * count(*) filter (where pv.ma_stanowisko)
            / nullif(count(*),0), 1)                      as voted_pct,
      count(*) filter (where pv.value = 'PRESENT')::int   as present_count,
      count(*) filter (where pv.value = 'ABSENT')::int    as absent_count,
      min(pv.voted_at)                                    as first_voted_at,
      max(pv.voted_at)                                    as last_voted_at,
      count(*) filter (where pv.liczy_sie)::int           as loyalty_votings,
      count(*) filter (where pv.ma_stanowisko and pv.club_size < 3)::int         as loyalty_skipped,
      count(*) filter (where pv.value <> 'ABSENT' and pv.kind = 'ON_LIST')::int  as loyalty_skipped_onlist,
      count(*) filter (where pv.value <> 'ABSENT' and not pv.ma_stanowisko)::int as loyalty_skipped_nostance,
      round(100.0 * count(*) filter (where pv.liczy_sie and pv.value = pv.club_majority)
            / nullif(count(*) filter (where pv.liczy_sie), 0), 1) as loyalty_pct
    from per_vote pv
    group by pv.mp_id
  )
  insert into public.mp_stats
    (mp_id, votes_total, votes_cast, attendance_pct, voted_pct,
     present_count, absent_count, first_voted_at, last_voted_at, loyalty_pct,
     loyalty_votings, loyalty_skipped, loyalty_skipped_onlist, loyalty_skipped_nostance, computed_at)
  select s.mp_id, s.votes_total, s.votes_cast, s.attendance_pct, s.voted_pct,
         s.present_count, s.absent_count, s.first_voted_at, s.last_voted_at, s.loyalty_pct,
         s.loyalty_votings, s.loyalty_skipped, s.loyalty_skipped_onlist, s.loyalty_skipped_nostance, now()
  from stats s
  join public.mps m on m.id = s.mp_id
  on conflict (mp_id) do update set
    votes_total              = excluded.votes_total,
    votes_cast               = excluded.votes_cast,
    attendance_pct           = excluded.attendance_pct,
    voted_pct                = excluded.voted_pct,
    present_count            = excluded.present_count,
    absent_count             = excluded.absent_count,
    first_voted_at           = excluded.first_voted_at,
    last_voted_at            = excluded.last_voted_at,
    loyalty_pct              = excluded.loyalty_pct,
    loyalty_votings          = excluded.loyalty_votings,
    loyalty_skipped          = excluded.loyalty_skipped,
    loyalty_skipped_onlist   = excluded.loyalty_skipped_onlist,
    loyalty_skipped_nostance = excluded.loyalty_skipped_nostance,
    computed_at              = excluded.computed_at;

  get diagnostics n = row_count;
  return query select n;
end $$;

revoke all on function public.refresh_mp_stats() from public, anon, authenticated;
grant execute on function public.refresh_mp_stats() to service_role;

-- ---------------------------------------------------------------------
-- Widok: dlaczego nie wolno ustawiac poslow w rankingu po samym procencie
--
-- Realne dane z pierwszego backfillu: Grzegorz Lorek ma 4 569 glosowan,
-- a Artur Soboń 100. Obaj maja kolumne "obecnosc" wyrazona w procentach,
-- ale te procenty licza sie z zupelnie roznych mianownikow — bo mandat
-- obejmuje sie i traci w trakcie kadencji.
--
-- Ranking "najgorszej frekwencji" zbudowany na samym procencie wysunalby
-- na czolo poslow, ktorzy byli w Sejmie przez dwa tygodnie. Frontend musi
-- pokazywac "X z Y glosowan", a nie tylko procent.
-- ---------------------------------------------------------------------
create or replace view mp_stats_porownywalne as
select
  s.*,
  (select max(votes_total) from mp_stats)                              as max_glosowan,
  round(100.0 * s.votes_total / nullif((select max(votes_total) from mp_stats),0), 1) as pokrycie_kadencji,
  -- Do rankingow bierzemy wylacznie poslow obecnych przez wiekszosc kadencji.
  (s.votes_total >= 0.5 * (select max(votes_total) from mp_stats))     as w_rankingu
from mp_stats s;

alter view mp_stats_porownywalne set (security_invoker = on);
grant select on mp_stats_porownywalne to anon, authenticated;

comment on view mp_stats_porownywalne is
  'mp_stats + informacja, jaka czesc kadencji obejmuja dane posla. Ranking po procencie bez tego filtra jest mylacy.';
