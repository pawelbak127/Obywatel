-- =====================================================================
-- Obywatel 2.0 — migracja 0009: rankingi na przedzialach ufnosci
--
-- POPRAWKA WLASNEGO BLEDU. W migracji 0008 wprowadzilem flage `w_rankingu`
-- z progiem "co najmniej polowa glosowan kadencji". Na zywych danych okazala
-- sie zla z dwoch powodow.
--
-- POWOD PIERWSZY: prog jest urwiskiem w przypadkowym miejscu.
-- Czterech poslow ma 2 244 glosowania, czyli 49,1% kadencji, i frekwencje
-- 88–99%. Wypadaja z rankingu o jeden punkt procentowy. Poslowie z 447
-- glosowaniami (9,8%) wypadaja tak samo — choc ich sytuacja jest zupelnie inna.
-- Prog traktuje pol kadencji i dwa tygodnie identycznie.
--
-- POWOD DRUGI, powazniejszy: wykluczenie jest tez decyzja.
-- Posel z frekwencja 54% przy 100 glosowaniach ma prawo znalezc sie w zestawieniu.
-- Ukrywanie go "bo ma malo glosowan" to nie jest neutralnosc — to jest wybor
-- na jego korzysc. Apolityczna platforma nie moze chowac faktow ani ich wyolbrzymiac.
--
-- CO ROBIMY ZAMIAST TEGO.
-- Problem nie polega na tym, ze malo glosowan jest "niewazne". Polega na tym,
-- ze procent policzony ze 100 prob i procent policzony z 4 569 prob to liczby
-- o zupelnie roznej pewnosci. Jeden zly tydzien przy 100 glosowaniach zbija
-- frekwencje o 20 punktow; przy 4 569 o 0,4 punktu. Ranking po samym procencie
-- jest wiec rankingiem dlugosci mandatu, nie zachowania.
--
-- Uzywamy przedzialu ufnosci Wilsona (95%) — tego samego narzedzia, ktorym
-- sortuje sie oceny w sklepach, zeby produkt z jedna piatka nie bil produktu
-- z tysiacem czworek. Zmierzone na realnych przypadkach z bazy:
--
--   n=100,  54,0%  ->  44,3% – 63,4%   (przedzial szeroki na 19 punktow)
--   n=4569, 54,0%  ->  52,5% – 55,4%   (przedzial szeroki na 3 punkty)
--
--   100% obecnosci przy n=100   ->  dolna granica 96,3%
--   100% obecnosci przy n=4569  ->  dolna granica 99,9%
--
-- Dzieki temu posel z krotkim mandatem nie wygrywa rankingu "najlepszych"
-- przypadkiem, ale tez nie znika z zestawienia, gdy naprawde ma slaby wynik.
-- Sortujemy po dolnej granicy, a pokazujemy surowy procent RAZEM z przedzialem
-- i liczba glosowan. Czytelnik dostaje liczbe i jej niepewnosc, nie teze.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Dolna i gorna granica przedzialu Wilsona
--    IMMUTABLE, wiec da sie z tego zrobic kolumne generowana albo indeks.
-- ---------------------------------------------------------------------
create or replace function public.wilson_bounds(
  sukcesy int,
  proby   int,
  z       numeric default 1.96
)
returns table (dolna numeric, gorna numeric)
language sql
immutable
parallel safe
set search_path = ''
as $$
  select
    case when proby > 0 then round(greatest(0, (srodek - polowa)) * 100, 1) end,
    case when proby > 0 then round(least(1,  (srodek + polowa)) * 100, 1) end
  from (
    select
      (p + z*z/(2*proby)) / mianownik                                as srodek,
      (z / mianownik) * sqrt(p*(1-p)/proby + z*z/(4*proby::numeric*proby)) as polowa
    from (
      select
        sukcesy::numeric / nullif(proby,0)   as p,
        1 + z*z/nullif(proby,0)              as mianownik
    ) q
  ) w;
$$;

comment on function public.wilson_bounds is
  'Przedzial ufnosci Wilsona dla proporcji. Sortowanie po dolnej granicy nie faworyzuje wynikow z malej liczby prob.';

-- ---------------------------------------------------------------------
-- 2. Granice w mp_stats
-- ---------------------------------------------------------------------
alter table mp_stats add column if not exists attendance_lo numeric(4,1);
alter table mp_stats add column if not exists attendance_hi numeric(4,1);
alter table mp_stats add column if not exists loyalty_lo    numeric(4,1);
alter table mp_stats add column if not exists loyalty_hi    numeric(4,1);

comment on column mp_stats.attendance_lo is
  'Dolna granica 95% przedzialu ufnosci dla obecnosci. Po TYM sortujemy rankingi, nie po attendance_pct.';

create or replace function public.refresh_mp_stats()
returns table (updated int)
language plpgsql
set search_path = ''
set statement_timeout = '10min'
as $$
declare n int;
begin
  with maj as (
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
      v.mp_id, v.value, vt.kind, vt.voted_at,
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
      count(*) filter (where pv.liczy_sie and pv.value = pv.club_majority)::int as loyalty_zgodnych,
      count(*) filter (where pv.ma_stanowisko and pv.club_size < 3)::int         as loyalty_skipped,
      count(*) filter (where pv.value <> 'ABSENT' and pv.kind = 'ON_LIST')::int  as loyalty_skipped_onlist,
      count(*) filter (where pv.value <> 'ABSENT' and not pv.ma_stanowisko)::int as loyalty_skipped_nostance,
      round(100.0 * count(*) filter (where pv.liczy_sie and pv.value = pv.club_majority)
            / nullif(count(*) filter (where pv.liczy_sie), 0), 1) as loyalty_pct
    from per_vote pv
    group by pv.mp_id
  ),
  z_granicami as (
    select s.*,
           wa.dolna as attendance_lo, wa.gorna as attendance_hi,
           wl.dolna as loyalty_lo,    wl.gorna as loyalty_hi
    from stats s
    cross join lateral public.wilson_bounds(s.votes_cast, s.votes_total)      wa
    cross join lateral public.wilson_bounds(s.loyalty_zgodnych, s.loyalty_votings) wl
  )
  insert into public.mp_stats
    (mp_id, votes_total, votes_cast, attendance_pct, voted_pct,
     present_count, absent_count, first_voted_at, last_voted_at, loyalty_pct,
     loyalty_votings, loyalty_skipped, loyalty_skipped_onlist, loyalty_skipped_nostance,
     attendance_lo, attendance_hi, loyalty_lo, loyalty_hi, computed_at)
  select g.mp_id, g.votes_total, g.votes_cast, g.attendance_pct, g.voted_pct,
         g.present_count, g.absent_count, g.first_voted_at, g.last_voted_at, g.loyalty_pct,
         g.loyalty_votings, g.loyalty_skipped, g.loyalty_skipped_onlist, g.loyalty_skipped_nostance,
         g.attendance_lo, g.attendance_hi, g.loyalty_lo, g.loyalty_hi, now()
  from z_granicami g
  join public.mps m on m.id = g.mp_id
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
    attendance_lo            = excluded.attendance_lo,
    attendance_hi            = excluded.attendance_hi,
    loyalty_lo               = excluded.loyalty_lo,
    loyalty_hi               = excluded.loyalty_hi,
    computed_at              = excluded.computed_at;

  get diagnostics n = row_count;
  return query select n;
end $$;

revoke all on function public.refresh_mp_stats() from public, anon, authenticated;
grant execute on function public.refresh_mp_stats() to service_role;

-- ---------------------------------------------------------------------
-- 3. Widok rankingowy — nikogo nie ukrywa, wszystkich opisuje
--
-- Zamiast flagi wlacz/wylacz mamy ETYKIETE ZAKRESU MANDATU. Frontend pokazuje
-- ja przy nazwisku, a sortuje po dolnej granicy przedzialu.
-- ---------------------------------------------------------------------
drop view if exists mp_stats_porownywalne;

create view mp_stats_ranking as
select
  m.id, m.full_name, m.slug, c.id as klub, m.active,
  s.votes_total,
  s.attendance_pct, s.attendance_lo, s.attendance_hi,
  s.voted_pct, s.present_count, s.absent_count,
  s.loyalty_pct, s.loyalty_lo, s.loyalty_hi, s.loyalty_votings,
  s.first_voted_at, s.last_voted_at,
  round(100.0 * s.votes_total / nullif((select max(votes_total) from mp_stats),0), 1) as pokrycie_kadencji,
  case
    when s.votes_total >= 0.95 * (select max(votes_total) from mp_stats) then 'pelna kadencja'
    when s.votes_total >= 0.50 * (select max(votes_total) from mp_stats) then 'ponad polowa kadencji'
    when s.votes_total >= 0.10 * (select max(votes_total) from mp_stats) then 'czesc kadencji'
    else 'krotki mandat'
  end as zakres_mandatu,
  -- Szerokosc przedzialu = miara niepewnosci. Frontend moze ja pokazac
  -- jako "+/- X pkt" albo jako szerokosc paska na wykresie.
  round(s.attendance_hi - s.attendance_lo, 1) as niepewnosc_pkt
from mp_stats s
join mps m on m.id = s.mp_id
left join clubs c on c.seq = m.club_seq;

alter view mp_stats_ranking set (security_invoker = on);
grant select on mp_stats_ranking to anon, authenticated;

comment on view mp_stats_ranking is
  'Do rankingow: sortuj po attendance_lo (lub loyalty_lo), a pokazuj attendance_pct razem z votes_total i zakresem mandatu. Nikogo nie filtrujemy — opisujemy niepewnosc.';
