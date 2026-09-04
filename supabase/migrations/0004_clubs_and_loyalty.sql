-- =====================================================================
-- Obywatel 2.0 — migracja 0004: kluby spoza slownika i bezpiecznik lojalnosci
--
-- POWOD. Pierwszy import zalogowal:
--     UWAGA: 1 poslow bez dopasowanego klubu: Polska2050-TD
--
-- Sejm API zwraca w /clubs DWANASCIE klubow, ale w polu MP.club wystepuje
-- TRZYNASCIE roznych wartosci. Jeden posel ma kod klubu, ktorego w slowniku
-- nie ma. To nie jest blad importu — to niespojnosc po stronie zrodla.
--
-- Zostawienie club_seq = NULL wyglada niegroznie, a ma dwa skutki:
--   1. profil tego posla nie pokazuje klubu,
--   2. lojalnosc partyjna nie policzy sie dla niego wcale (NULL = NULL nigdy
--      nie jest prawda w zlaczeniu bocznym).
--
-- Ale "napraw" polegajaca na przypisaniu go do Polska2050 byloby ZMYSLANIEM
-- DANYCH. Nie wiemy, czy to ten sam klub — wiemy tylko, ze zrodlo podaje inny
-- kod. Dlatego tworzymy klub z kodu, ktory faktycznie przyszedl, i oznaczamy,
-- ze pochodzi z wnioskowania, a nie ze slownika.
--
-- DRUGA SPRAWA, POWAZNIEJSZA. Skoro istnieja kluby jednoosobowe, to lojalnosc
-- partyjna liczona wprost dalaby takiemu poslowi 100% — bo wiekszoscia wlasnego
-- klubu jest on sam. Liczba "100% lojalnosci" przy nazwisku posla, wyliczona
-- z klubu liczacego jedna osobe, to material na sprostowanie i telefon od
-- prawnika. Dokladamy prog: ponizej trzech glosujacych czlonkow klubu
-- lojalnosc jest NULL, nie 100.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Kluby: skad pochodza
-- ---------------------------------------------------------------------
alter table clubs add column if not exists from_dictionary boolean not null default true;
alter table clubs add column if not exists note text;

comment on column clubs.from_dictionary is
  'true = klub przyszedl z /sejm/termN/clubs. false = kod wystapil w danych posla lub glosu, ale nie ma go w slowniku. Frontend musi to zaznaczyc.';

-- ---------------------------------------------------------------------
-- 2. Lojalnosc: prog wiarygodnosci
-- ---------------------------------------------------------------------
alter table mp_stats add column if not exists loyalty_votings int;
alter table mp_stats add column if not exists loyalty_skipped int;

comment on column mp_stats.loyalty_votings is
  'Ile glosowan weszlo do wyliczenia lojalnosci (klub mial min. 3 glosujacych).';
comment on column mp_stats.loyalty_skipped is
  'Ile glosowan pominieto, bo klub byl za maly, zeby "wiekszosc klubu" cokolwiek znaczyla.';

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
      cm.club_majority,
      cm.club_size
    from public.votes v
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

      -- Prog: klub musi miec przynajmniej 3 glosujacych, zeby "wiekszosc klubu"
      -- byla pojeciem sensownym. Inaczej posel jest wlasna wiekszoscia.
      count(*) filter (where pv.value <> 'ABSENT' and pv.club_size >= 3)::int as loyalty_votings,
      count(*) filter (where pv.value <> 'ABSENT' and pv.club_size <  3)::int as loyalty_skipped,

      round(100.0 * count(*) filter (
              where pv.value <> 'ABSENT' and pv.club_size >= 3 and pv.value = pv.club_majority)
            / nullif(count(*) filter (where pv.value <> 'ABSENT' and pv.club_size >= 3), 0), 1)
                                                        as loyalty_pct
    from public.mps m
    join per_vote pv on pv.mp_id = m.id
    group by m.id
  )
  insert into public.mp_stats
    (mp_id, votes_total, votes_cast, attendance_pct, loyalty_pct, loyalty_votings, loyalty_skipped, computed_at)
  select mp_id, votes_total, votes_cast, attendance_pct, loyalty_pct, loyalty_votings, loyalty_skipped, now()
  from stats
  on conflict (mp_id) do update set
    votes_total     = excluded.votes_total,
    votes_cast      = excluded.votes_cast,
    attendance_pct  = excluded.attendance_pct,
    loyalty_pct     = excluded.loyalty_pct,
    loyalty_votings = excluded.loyalty_votings,
    loyalty_skipped = excluded.loyalty_skipped,
    computed_at     = excluded.computed_at;

  get diagnostics n = row_count;
  return query select n;
end $$;

revoke all on function public.refresh_mp_stats() from public, anon, authenticated;
grant execute on function public.refresh_mp_stats() to service_role;

-- ---------------------------------------------------------------------
-- 3. Widok kontrolny — kluby, ktorych nie ma w slowniku
--    Zagladamy tu po kazdym imporcie. Jesli lista rosnie, zrodlo sie zmienilo.
-- ---------------------------------------------------------------------
create or replace view clubs_poza_slownikiem as
select c.id, c.name, c.from_dictionary, c.note,
       count(m.id) as poslow
from clubs c
left join mps m on m.club_seq = c.seq
where not c.from_dictionary
group by c.id, c.name, c.from_dictionary, c.note;

alter view clubs_poza_slownikiem set (security_invoker = on);
grant select on clubs_poza_slownikiem to anon, authenticated;
