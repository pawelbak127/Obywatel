-- =====================================================================
-- Obywatel 2.0 — migracja 0006: wartosc PRESENT i lojalnosc liczona ze stanowisk
--
-- POWOD. Backfill posiedzenia 63 przerwal sie na:
--     invalid input value for enum vote_value: "PRESENT"
--
-- Enum zbudowalem ze schematu OpenAPI Sejm API. Na zywych danych pojawila sie
-- wartosc, ktorej tam nie bylo. Sama w sobie jest to drobnostka — gorsze jest
-- to, co by sie stalo, gdyby przeszla niezauwazona.
--
-- PRESENT znaczy: posel byl obecny, ale nie zajal prostego stanowiska
-- (typowo przy glosowaniu listowym, gdzie decyzje sa w listVotes).
--
-- Dotychczasowa logika lojalnosci brzmiala "wszystko poza ABSENT". Przy takiej
-- regule PRESENT bylby porownywany z wiekszoscia klubu i wychodzil jako
-- NIELOJALNOSC — posel dostalby zarzut za glos, ktorego nie oddal.
--
-- Zmieniamy warunek z listy zakazanych na LISTE DOZWOLONYCH: do lojalnosci
-- wchodza wylacznie YES, NO i ABSTAIN. Kazda przyszla, nieznana dzis wartosc
-- automatycznie zostaje poza lojalnoscia, zamiast wpadac do niej po cichu.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Brakujaca wartosc enuma
-- ---------------------------------------------------------------------
alter type vote_value add value if not exists 'PRESENT';

-- ---------------------------------------------------------------------
-- 2. Lojalnosc wylacznie ze stanowisk
--    (osobna kwerenda — PostgreSQL nie pozwala uzyc swiezo dodanej wartosci
--     enuma w tej samej transakcji, w ktorej zostala dodana)
-- ---------------------------------------------------------------------
alter table mp_stats add column if not exists loyalty_skipped_nostance int;
comment on column mp_stats.loyalty_skipped_nostance is
  'Glosowania pominiete w lojalnosci, bo posel byl obecny, ale nie zajal stanowiska (np. PRESENT).';

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
      -- LISTA DOZWOLONYCH, nie zakazanych. Nowa wartosc od Sejmu nie wejdzie
      -- do lojalnosci sama z siebie — i o to chodzi.
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
        -- Wiekszosc klubu tez liczymy WYLACZNIE ze stanowisk. Inaczej klub,
        -- w ktorym polowa byla "obecna bez stanowiska", mialby wiekszosc
        -- PRESENT i wszyscy glosujacy wyszliby na nielojalnych.
        and v2.value in ('YES','NO','ABSTAIN')
    ) cm on true
  ),
  stats as (
    select
      m.id as mp_id,
      count(*)::int                                     as votes_total,
      count(*) filter (where pv.value <> 'ABSENT')::int  as votes_cast,
      round(100.0 * count(*) filter (where pv.value <> 'ABSENT')
            / nullif(count(*),0), 1)                     as attendance_pct,

      count(*) filter (where pv.liczy_sie)::int          as loyalty_votings,
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
    (mp_id, votes_total, votes_cast, attendance_pct, loyalty_pct,
     loyalty_votings, loyalty_skipped, loyalty_skipped_onlist, loyalty_skipped_nostance, computed_at)
  select mp_id, votes_total, votes_cast, attendance_pct, loyalty_pct,
         loyalty_votings, loyalty_skipped, loyalty_skipped_onlist, loyalty_skipped_nostance, now()
  from stats
  on conflict (mp_id) do update set
    votes_total              = excluded.votes_total,
    votes_cast               = excluded.votes_cast,
    attendance_pct           = excluded.attendance_pct,
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
-- 3. Widok kontrolny: jakie wartosci glosu realnie wystepuja w bazie.
--    Zagladamy tu po backfillu — jesli pojawi sie cos spoza znanej listy,
--    lojalnosc mogla policzyc sie z niepelnej dziedziny.
-- ---------------------------------------------------------------------
create or replace view wartosci_glosow as
select value,
       count(*) as wystapien,
       value in ('YES','NO','ABSTAIN') as liczy_sie_do_lojalnosci,
       value <> 'ABSENT'               as liczy_sie_do_frekwencji
from votes
group by value
order by 2 desc;

alter view wartosci_glosow set (security_invoker = on);
grant select on wartosci_glosow to anon, authenticated;
