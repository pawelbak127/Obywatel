-- =====================================================================
-- Obywatel 2.0 — migracja 0011: widok musi oddawac to, o co pyta aplikacja
--
-- BLAD. Widok `mp_obecnosc_kontekst` z migracji 0010 przekazywal dalej tylko
-- czesc kolumn z `mp_stats_ranking`. Zapomnialem o siedmiu:
--
--     voted_pct, present_count, absent_count,
--     loyalty_pct, loyalty_lo, loyalty_hi, loyalty_votings
--
-- Czyli dokladnie o udziale w glosowaniach i o calej lojalnosci partyjnej —
-- rzeczach, dla ktorych powstaly migracje 0004, 0006 i 0007. Strona profilu
-- pytala o nie i dostawala:
--     column mp_obecnosc_kontekst.voted_pct does not exist
--
-- DLACZEGO SIE ZDARZYLO. Napisalem warstwe zapytan aplikacji z pamieci o tym,
-- co widok POWINIEN zawierac, zamiast sprawdzic, co ZAWIERA. To ten sam rodzaj
-- pomylki co przy PRESENT: zaufalem wlasnemu wyobrazeniu o strukturze zamiast
-- ja odczytac.
--
-- ZEBY SIE NIE POWTORZYLO. Migracja konczy sie kontrola kontraktu: sprawdza,
-- czy widok wystawia komplet kolumn, ktorych zada `src/lib/queries.ts`.
-- Jesli kiedys ktos usunie kolumne albo zmieni nazwe, migracja padnie tutaj,
-- a nie na produkcji przy pierwszym wejsciu na profil posla.
-- =====================================================================

-- CREATE OR REPLACE VIEW pozwala dodawac kolumny wylacznie na koncu listy,
-- a my wstawiamy je w srodku — stad drop.
drop view if exists mp_obecnosc_kontekst;

create view mp_obecnosc_kontekst as
select
  r.id, r.full_name, r.slug, r.klub, r.active,

  -- obecnosc: byl na sali
  r.votes_total, r.attendance_pct, r.attendance_lo, r.attendance_hi,

  -- udzial: nacisnal przycisk (migracja 0007)
  r.voted_pct, r.present_count, r.absent_count,

  -- zgodnosc z klubem (migracje 0004, 0006, 0009)
  r.loyalty_pct, r.loyalty_lo, r.loyalty_hi, r.loyalty_votings,

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
    count(*)::int                                   as miesiecy_lacznie,
    count(*) filter (where m.absent_pct >= 80)::int as miesiecy_prawie_bez_obecnosci
  from mp_absence_monthly m
  where m.mp_id = r.id
) a on true;

alter view mp_obecnosc_kontekst set (security_invoker = on);
grant select on mp_obecnosc_kontekst to anon, authenticated;

comment on view mp_obecnosc_kontekst is
  'Kontrakt dla src/lib/queries.ts. Kazda kolumna z KOLUMNY_KONTEKST musi tu byc — pilnuje tego kontrola na koncu migracji 0011.';

-- ---------------------------------------------------------------------
-- KONTROLA KONTRAKTU
-- Lista musi byc identyczna z KOLUMNY_KONTEKST w src/lib/queries.ts.
-- ---------------------------------------------------------------------
do $$
declare
  wymagane text[] := array[
    'id','full_name','slug','klub','active','votes_total',
    'attendance_pct','attendance_lo','attendance_hi',
    'voted_pct','present_count','absent_count',
    'loyalty_pct','loyalty_lo','loyalty_hi','loyalty_votings',
    'niepewnosc_pkt','zakres_mandatu','first_voted_at','last_voted_at',
    'miesiecy_lacznie','miesiecy_prawie_bez_obecnosci',
    'ksztalt_nieobecnosci','funkcje_panstwowe'
  ];
  brakujace text;
begin
  select string_agg(k, ', ')
    into brakujace
  from unnest(wymagane) k
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name   = 'mp_obecnosc_kontekst'
      and c.column_name  = k
  );

  if brakujace is not null then
    raise exception 'Widok mp_obecnosc_kontekst nie wystawia kolumn wymaganych przez aplikacje: %', brakujace;
  end if;

  raise notice 'Kontrakt widoku mp_obecnosc_kontekst spelniony — % kolumn.', array_length(wymagane, 1);
end $$;
