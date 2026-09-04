-- =====================================================================
-- Obywatel 2.0 — migracja 0005: glosowania listowe i lojalnosc bez fikcji
--
-- Sejm API zwraca glosowania w trzech odmianach (pole `kind`). Wiekszosc to
-- ELECTRONIC — zwykle za/przeciw/wstrzymal sie. Ale przy `kind = ON_LIST`
-- (wybory do organow, glosowania nad lista kandydatow) pojedynczy glos nie ma
-- prostej wartosci: zamiast `vote` posel ma obiekt `listVotes`, czyli decyzje
-- osobno dla kazdej pozycji listy.
--
-- To rodzi dwa problemy, oba ciche:
--
--   1. Gdybysmy zapisali taki glos jako ABSENT (bo pole `vote` jest puste),
--      frekwencja posla spadlaby bez powodu. Zaniżona frekwencja przy nazwisku
--      to zarzut, ktorego dane nie potwierdzaja.
--
--   2. Gdybysmy wliczyli takie glosowanie do lojalnosci partyjnej, liczylibysmy
--      zgodnosc z "wiekszoscia klubu" tam, gdzie wiekszosc klubu nie jest
--      pojeciem sensownym — bo glosuje sie na liste, a nie za albo przeciw.
--
-- Rozwiazanie: uczestnictwo liczymy (frekwencja rosnie), lojalnosc pomijamy,
-- a szczegoly listy trafiaja do osobnej, malej tabeli — zeby nic nie zginelo
-- i zeby nie dokladac kolumny do tabeli na 1,9 mln wierszy.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Szczegoly glosowan listowych
--    Osobna tabela, bo ON_LIST to rzadkosc — kilka glosowan na kadencje.
--    Kolumna jsonb w `votes` kosztowalaby miejsce przy kazdym z 1,9 mln wierszy.
-- ---------------------------------------------------------------------
create table if not exists list_votes (
  voting_id    int      not null references votings(id) on delete cascade,
  mp_id        smallint not null references mps(id),
  option_key   text     not null,   -- klucz pozycji listy z API
  value        vote_value not null,
  primary key (voting_id, mp_id, option_key)
);

alter table list_votes enable row level security;
create policy "public read list_votes" on list_votes for select using (true);
grant select on list_votes to anon, authenticated;

comment on table list_votes is
  'Rozbicie glosow przy kind = ON_LIST. Frekwencja liczy je jako uczestnictwo, lojalnosc je pomija.';

-- ---------------------------------------------------------------------
-- 2. Lojalnosc pomija glosowania listowe
--
-- Do progu z migracji 0004 (klub ponizej 3 glosujacych -> NULL) dochodzi
-- drugi warunek: glosowanie musi byc zwyklym za/przeciw.
-- ---------------------------------------------------------------------
alter table mp_stats add column if not exists loyalty_skipped_onlist int;
comment on column mp_stats.loyalty_skipped_onlist is
  'Glosowania pominiete w lojalnosci, bo byly listowe (kind = ON_LIST).';

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
      -- Glosowanie wchodzi do lojalnosci tylko gdy: posel byl obecny,
      -- klub mial min. 3 glosujacych i nie bylo to glosowanie listowe.
      (v.value <> 'ABSENT' and cm.club_size >= 3 and vt.kind is distinct from 'ON_LIST') as liczy_sie
    from public.votes v
    join public.votings vt on vt.id = v.voting_id
    join lateral (
      select
        mode() within group (order by v2.value) as club_majority,
        count(*)                                as club_size
      from public.votes v2
      where v2.voting_id = v.voting_id
        and v2.club_seq  is not distinct from v.club_seq
        and v2.value <> 'ABSENT'
    ) cm on true
  ),
  stats as (
    select
      m.id as mp_id,
      count(*)::int                                     as votes_total,
      count(*) filter (where pv.value <> 'ABSENT')::int as votes_cast,
      round(100.0 * count(*) filter (where pv.value <> 'ABSENT')
            / nullif(count(*),0), 1)                    as attendance_pct,

      count(*) filter (where pv.liczy_sie)::int         as loyalty_votings,
      count(*) filter (where pv.value <> 'ABSENT' and pv.club_size < 3)::int as loyalty_skipped,
      count(*) filter (where pv.value <> 'ABSENT' and pv.kind = 'ON_LIST')::int as loyalty_skipped_onlist,

      round(100.0 * count(*) filter (where pv.liczy_sie and pv.value = pv.club_majority)
            / nullif(count(*) filter (where pv.liczy_sie), 0), 1) as loyalty_pct
    from public.mps m
    join per_vote pv on pv.mp_id = m.id
    group by m.id
  )
  insert into public.mp_stats
    (mp_id, votes_total, votes_cast, attendance_pct, loyalty_pct,
     loyalty_votings, loyalty_skipped, loyalty_skipped_onlist, computed_at)
  select mp_id, votes_total, votes_cast, attendance_pct, loyalty_pct,
         loyalty_votings, loyalty_skipped, loyalty_skipped_onlist, now()
  from stats
  on conflict (mp_id) do update set
    votes_total            = excluded.votes_total,
    votes_cast             = excluded.votes_cast,
    attendance_pct         = excluded.attendance_pct,
    loyalty_pct            = excluded.loyalty_pct,
    loyalty_votings        = excluded.loyalty_votings,
    loyalty_skipped        = excluded.loyalty_skipped,
    loyalty_skipped_onlist = excluded.loyalty_skipped_onlist,
    computed_at            = excluded.computed_at;

  get diagnostics n = row_count;
  return query select n;
end $$;

revoke all on function public.refresh_mp_stats() from public, anon, authenticated;
grant execute on function public.refresh_mp_stats() to service_role;

-- ---------------------------------------------------------------------
-- 3. Indeks pod backfill: szukanie glosowania po kluczu naturalnym
-- ---------------------------------------------------------------------
create index if not exists votings_natural_key on votings (term, sitting, voting_number);

-- ---------------------------------------------------------------------
-- 4. Widok kontrolny: czy sumy glosow imiennych zgadzaja sie z licznikami
--    zbiorczymi z API. To jest nasz test poprawnosci importu na zywych danych.
-- ---------------------------------------------------------------------
create or replace view votings_niezgodne as
select
  v.id, v.sitting, v.voting_number, v.kind, v.title,
  v.yes, v.no, v.abstain, v.not_participating,
  count(*) filter (where vo.value = 'YES')     as votes_yes,
  count(*) filter (where vo.value = 'NO')      as votes_no,
  count(*) filter (where vo.value = 'ABSTAIN') as votes_abstain,
  count(*) filter (where vo.value = 'ABSENT')  as votes_absent
from votings v
join votes vo on vo.voting_id = v.id
where v.kind is distinct from 'ON_LIST'
group by v.id
having count(*) filter (where vo.value = 'YES')     <> v.yes
    or count(*) filter (where vo.value = 'NO')      <> v.no
    or count(*) filter (where vo.value = 'ABSTAIN') <> v.abstain;

alter view votings_niezgodne set (security_invoker = on);
grant select on votings_niezgodne to anon, authenticated;

comment on view votings_niezgodne is
  'Po backfillu ma zwrocic ZERO wierszy. Kazdy wiersz to glosowanie, w ktorym nasza suma glosow imiennych rozjezdza sie z licznikiem podanym przez Sejm API.';
