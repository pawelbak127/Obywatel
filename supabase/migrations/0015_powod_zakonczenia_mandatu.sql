-- =====================================================================
-- Obywatel 2.0 — migracja 0015: oficjalny powód zakończenia mandatu
--
-- POWÓD — I JEST POWAŻNY.
--
-- Zapytanie o trzydziestu posłów o najniższej obecności zwróciło między innymi to:
--
--   izabela-mrzyglocka  active=false  inactive_cause='Zgon'  waiver_desc='Zmarła'   68,6%
--   rajmund-miller      active=false  inactive_cause='Zgon'  waiver_desc='Zmarł'    71,2%
--
-- Dwoje posłów zmarło w trakcie kadencji i stoi w naszym rankingu obecności.
-- Publikacja listy „posłowie o najniższej obecności", na której są osoby zmarłe,
-- byłaby czymś, czego nie da się obronić żadnym argumentem o poprawności danych.
-- Liczby są poprawne. Zestawienie jest nie do przyjęcia.
--
-- To NIE jest przypadek D9 (arbitralny próg 50%, wycofany). Tam wykluczaliśmy
-- kogoś na podstawie liczby, którą sami wybraliśmy. Tu wykluczamy na podstawie
-- faktu z rejestru państwowego: mandat wygasł z powodu śmierci, więc nie ma
-- czego i nie ma kogo rozliczać. Ranking jest narzędziem rozliczalności
-- sprawujących mandat.
--
-- DRUGI POWÓD. Rejestr podaje przyczynę wygaśnięcia mandatu dla 37 z 39 posłów
-- nieaktywnych, a my jej nie pokazywaliśmy:
--
--   artur-sobon      Zrzeczenie  „Powołany na członka Zarządu NBP"           100 głosowań
--   michal-dworczyk  Zrzeczenie  „Wybrany na posła do Parlamentu Europejskiego" 447
--   michal-kobosko, stanislaw-tyszka, grzegorz-braun — to samo
--
-- Przy Soboniu widniało „54% obecności" bez słowa wyjaśnienia, przy stu
-- głosowaniach na cztery i pół tysiąca. Powód był w bazie od pierwszego importu.
--
-- CO Z mp_roles. Zostaje — dla przypadku, którego rejestr NIE opisuje: poseł
-- aktywny, z pełnym mandatem, nieobecny z powodu sprawowania urzędu. W tej
-- trzydziestce to Tusk i Morawiecki. Ziobro i Romanowski mają `active=true`
-- i puste `inactive_cause`, więc rejestr nie podaje o nich nic — i my też nie
-- podamy niczego ponad kształt nieobecności.
-- =====================================================================

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
     from mp_roles ro where ro.mp_id = r.id) as funkcje_panstwowe,

  -- ------------------------------------------------------------------
  -- NOWE: to, co mówi rejestr o zakończeniu mandatu
  --
  -- Przepisujemy dokładnie dwa pola z Sejm API i nie dokładamy do nich
  -- ani słowa interpretacji. `inactive_cause` to kategoria ('Zgon',
  -- 'Zrzeczenie'), `waiver_desc` to zdanie rejestru („Wybrany na posła
  -- do Parlamentu Europejskiego").
  -- ------------------------------------------------------------------
  m.inactive_cause,
  m.waiver_desc,

  -- Gotowe zdanie dla interfejsu. Przy zgonie NIE powtarzamy opisu z rejestru
  -- („Zmarła") — wystarczy sam fakt wygaśnięcia mandatu.
  case
    when m.active then null
    when m.inactive_cause = 'Zgon' then 'Mandat wygasł — poseł zmarł w trakcie kadencji.'
    when m.waiver_desc is not null then 'Mandat wygasł: ' || m.waiver_desc || '.'
    when m.inactive_cause is not null then 'Mandat wygasł: ' || m.inactive_cause || '.'
    else 'Mandat wygasł w trakcie kadencji.'
  end as powod_zakonczenia,

  -- ------------------------------------------------------------------
  -- Czy wiersz wchodzi do RANKINGU
  --
  -- Wykluczenie dotyczy WYŁĄCZNIE zestawień porównawczych. Profil posła
  -- zostaje i nadal pokazuje wszystkie liczby razem z powodem z rejestru.
  -- Nie usuwamy nikogo z serwisu — nie zestawiamy zmarłych w rankingu
  -- rozliczającym z obecności.
  -- ------------------------------------------------------------------
  (m.inactive_cause is distinct from 'Zgon') as w_rankingu

from mp_stats_ranking r
join mps m on m.id = r.id
left join lateral (
  select
    count(*)::int                                   as miesiecy_lacznie,
    count(*) filter (where mm.absent_pct >= 80)::int as miesiecy_prawie_bez_obecnosci
  from mp_absence_monthly mm
  where mm.mp_id = r.id
) a on true;

alter view mp_obecnosc_kontekst set (security_invoker = on);
grant select on mp_obecnosc_kontekst to anon, authenticated;

comment on view mp_obecnosc_kontekst is
  'Kontrakt dla src/lib/queries.ts. Kolumna w_rankingu wyklucza z zestawien porownawczych posłów, ktorych mandat wygasl z powodu smierci — profil pozostaje dostepny.';

-- ---------------------------------------------------------------------
-- KONTROLA KONTRAKTU — lista identyczna z KOLUMNY_KONTEKST w queries.ts
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
    'ksztalt_nieobecnosci','funkcje_panstwowe',
    'inactive_cause','waiver_desc','powod_zakonczenia','w_rankingu'
  ];
  brakujace text;
begin
  select string_agg(k, ', ') into brakujace from unnest(wymagane) k
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'mp_obecnosc_kontekst' and c.column_name = k
  );
  if brakujace is not null then
    raise exception 'Widok mp_obecnosc_kontekst nie wystawia kolumn wymaganych przez aplikacje: %', brakujace;
  end if;
  raise notice 'Kontrakt widoku mp_obecnosc_kontekst spelniony — % kolumn.', array_length(wymagane, 1);
end $$;

-- ---------------------------------------------------------------------
-- Ile wierszy to zmienia — liczba trafia do logu migracji, zeby nie trzeba
-- bylo jej szukac osobnym zapytaniem.
-- ---------------------------------------------------------------------
do $$
declare zmarli int; z_powodem int;
begin
  select count(*) into zmarli from mp_obecnosc_kontekst where not w_rankingu;
  select count(*) into z_powodem from mp_obecnosc_kontekst where powod_zakonczenia is not null;
  raise notice 'Poza rankingiem (mandat wygasl z powodu smierci): %.', zmarli;
  raise notice 'Poslow z oficjalnym powodem zakonczenia mandatu: %.', z_powodem;
end $$;
