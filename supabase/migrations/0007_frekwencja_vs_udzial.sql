-- =====================================================================
-- Obywatel 2.0 — migracja 0007: frekwencja to nie to samo co udzial
--
-- ZNALEZISKO Z ZYWYCH DANYCH. Posiedzenie 63, 74 glosowania, 34 040 glosow:
--
--     YES      14 807
--     NO       12 359
--     ABSTAIN   4 515
--     ABSENT    1 496
--     PRESENT     863     <-- 2,5% wszystkich glosow
--
-- A jednoczesnie `list_votes = 0` — na tym posiedzeniu NIE BYLO ani jednego
-- glosowania listowego. Czyli moje zalozenie, ze PRESENT wystepuje tylko przy
-- ON_LIST, bylo bledne. PRESENT znaczy po prostu: posel byl obecny na sali
-- i nie oddal glosu.
--
-- To zmienia sens slowa "frekwencja". Mamy dwie rozne, obie uczciwe miary:
--
--   OBECNOSC  = wszystko poza ABSENT            (byl na sali)
--   UDZIAL    = tylko YES / NO / ABSTAIN        (nacisnal przycisk)
--
-- Przy 2,5% glosow typu PRESENT te liczby rozjezdzaja sie na tyle, ze posel
-- moze miec 100% obecnosci i wyraznie nizszy udzial. Pokazanie jednej z nich
-- pod etykieta "frekwencja" i przemilczenie drugiej byloby wyborem narracji,
-- a nie prezentacja danych.
--
-- Dlatego liczymy OBIE i pokazujemy OBIE. Profil posla ma podawac liczby,
-- a nie teze.
-- =====================================================================

alter table mp_stats add column if not exists voted_pct     numeric(4,1);
alter table mp_stats add column if not exists present_count int;
alter table mp_stats add column if not exists absent_count  int;

comment on column mp_stats.attendance_pct is
  'OBECNOSC: % glosowan, w ktorych posel nie byl nieobecny (wlicza PRESENT).';
comment on column mp_stats.voted_pct is
  'UDZIAL: % glosowan, w ktorych posel faktycznie oddal glos (YES/NO/ABSTAIN).';
comment on column mp_stats.present_count is
  'Ile razy posel byl obecny, ale nie oddal glosu. Roznica miedzy obecnoscia a udzialem.';

create or replace function public.refresh_mp_stats()
returns table (updated int)
language plpgsql
set search_path = ''
as $$
declare n int;
begin
  with per_vote as (
    select
      v.mp_id,
      v.value,
      vt.kind,
      cm.club_majority,
      cm.club_size,
      (v.value in ('YES','NO','ABSTAIN')) as ma_stanowisko,
      (
        v.value in ('YES','NO','ABSTAIN')
        and cm.club_size >= 3
        and vt.kind is distinct from 'ON_LIST'
      ) as liczy_sie
    from public.votes v
    join public.votings vt on vt.id = v.voting_id
    join lateral (
      select
        mode() within group (order by v2.value) as club_majority,
        count(*)                                as club_size
      from public.votes v2
      where v2.voting_id = v.voting_id
        and v2.club_seq  is not distinct from v.club_seq
        and v2.value in ('YES','NO','ABSTAIN')
    ) cm on true
  ),
  stats as (
    select
      m.id as mp_id,
      count(*)::int                                      as votes_total,

      -- OBECNOSC: byl na sali (nie ABSENT)
      count(*) filter (where pv.value <> 'ABSENT')::int   as votes_cast,
      round(100.0 * count(*) filter (where pv.value <> 'ABSENT')
            / nullif(count(*),0), 1)                      as attendance_pct,

      -- UDZIAL: nacisnal przycisk
      round(100.0 * count(*) filter (where pv.ma_stanowisko)
            / nullif(count(*),0), 1)                      as voted_pct,

      count(*) filter (where pv.value = 'PRESENT')::int   as present_count,
      count(*) filter (where pv.value = 'ABSENT')::int    as absent_count,

      count(*) filter (where pv.liczy_sie)::int           as loyalty_votings,
      count(*) filter (where pv.ma_stanowisko and pv.club_size < 3)::int         as loyalty_skipped,
      count(*) filter (where pv.value <> 'ABSENT' and pv.kind = 'ON_LIST')::int  as loyalty_skipped_onlist,
      count(*) filter (where pv.value <> 'ABSENT' and not pv.ma_stanowisko)::int as loyalty_skipped_nostance,

      round(100.0 * count(*) filter (where pv.liczy_sie and pv.value = pv.club_majority)
            / nullif(count(*) filter (where pv.liczy_sie), 0), 1) as loyalty_pct
    from public.mps m
    join per_vote pv on pv.mp_id = m.id
    group by m.id
  )
  insert into public.mp_stats
    (mp_id, votes_total, votes_cast, attendance_pct, voted_pct,
     present_count, absent_count, loyalty_pct,
     loyalty_votings, loyalty_skipped, loyalty_skipped_onlist, loyalty_skipped_nostance, computed_at)
  select mp_id, votes_total, votes_cast, attendance_pct, voted_pct,
         present_count, absent_count, loyalty_pct,
         loyalty_votings, loyalty_skipped, loyalty_skipped_onlist, loyalty_skipped_nostance, now()
  from stats
  on conflict (mp_id) do update set
    votes_total              = excluded.votes_total,
    votes_cast               = excluded.votes_cast,
    attendance_pct           = excluded.attendance_pct,
    voted_pct                = excluded.voted_pct,
    present_count            = excluded.present_count,
    absent_count             = excluded.absent_count,
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
-- Widok kontrolny: gdzie obecnosc rozjezdza sie z udzialem najmocniej.
-- To sa poslowie, przy ktorych pokazanie jednej liczby zamiast dwoch
-- bylo by najbardziej mylace — i jednoczesnie material na dobry tekst.
-- ---------------------------------------------------------------------
create or replace view obecnosc_vs_udzial as
select
  m.id, m.full_name, c.id as klub,
  s.votes_total,
  s.attendance_pct as obecnosc,
  s.voted_pct      as udzial,
  round(s.attendance_pct - s.voted_pct, 1) as roznica,
  s.present_count  as obecny_bez_glosu,
  s.absent_count   as nieobecny
from mp_stats s
join mps m   on m.id  = s.mp_id
left join clubs c on c.seq = m.club_seq
where s.attendance_pct is not null and s.voted_pct is not null
order by (s.attendance_pct - s.voted_pct) desc;

alter view obecnosc_vs_udzial set (security_invoker = on);
grant select on obecnosc_vs_udzial to anon, authenticated;

comment on view obecnosc_vs_udzial is
  'Roznica miedzy byciem na sali a oddaniem glosu. Profil posla musi pokazywac obie liczby.';
