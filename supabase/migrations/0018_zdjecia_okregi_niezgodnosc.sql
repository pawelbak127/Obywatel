-- =====================================================================
-- Obywatel 2.0 — migracja 0018: zdjęcia, okręgi, niezgodność z klubem
--
-- Trzy rzeczy, o które prosiłeś, plus jedna, której nie planowaliśmy.
--
-- ---------------------------------------------------------------------
-- 1. ZDJĘCIA — kolumna już istnieje i jest wypełniona.
--
-- `mps.photo_url` jest w schemacie od migracji 0001, a importer wpisuje tam
-- `https://api.sejm.gov.pl/sejm/term10/MP/{id}/photo` dla KAŻDEGO posła
-- (mapper `mp.ts`, wywołanie `mpPhotoUrl`). Migracja dodająca tę kolumnę
-- byłaby więc pusta.
--
-- Jest natomiast realny problem, którego nie mieliśmy: adres jest ZŁOŻONY
-- z id, a nie POBRANY z API. Nikt nigdy nie sprawdził, czy pod nim coś jest.
-- Jeśli któryś poseł zdjęcia nie ma, wstawimy na stronę zepsuty obrazek —
-- w serwisie, którego cała teza brzmi „każda informacja ma pokrycie".
--
-- Stąd `photo_exists` + `photo_checked_at`: importer wykona HEAD na każdym
-- adresie i zapisze wynik razem z datą sprawdzenia.
--
-- Wynik trzymamy w OSOBNEJ kolumnie, a nie zerując `photo_url`, i to nie jest
-- kwestia gustu. `photo_url` jest wyliczany przez mapper przy każdym imporcie,
-- więc wyzerowany wróciłby przy najbliższym `ingest:mps` — i mielibyśmy adres
-- oznaczony jako sprawdzony, choć sprawdzenie dotyczyło poprzedniej wartości.
-- Dwie kolumny: jedna mówi „dokąd", druga „czy tam coś jest".
--
-- ---------------------------------------------------------------------
-- 2. OKRĘGI — dane też już są.
--
-- `district_num`, `district_name`, `voivodeship` są importowane od Sprintu 1.
-- Nie przechodziły tylko przez widok, z którego czyta aplikacja. Dokładamy je
-- do `mp_obecnosc_kontekst` i dorzucamy słownik okręgów, żeby lista rozwijana
-- w filtrze brała się z danych, a nie z tablicy wpisanej w kod.
--
-- ---------------------------------------------------------------------
-- 3. „WSKAŹNIK BUNTU" — liczba istnieje od migracji 0009, tylko inaczej się
--    nazywa, i NIE ZAKŁADAMY dla niej nowej kolumny. To jest ważne.
--
-- `mp_stats.loyalty_pct` to odsetek głosowań, w których poseł zagłosował
-- ZGODNIE z większością swojego klubu. Odsetek wyłamań to dokładnie
-- `100 - loyalty_pct` — ta sama liczba widziana z drugiej strony.
--
-- Gdybyśmy dołożyli kolumnę `rebel_rate` liczoną osobnym zapytaniem, mielibyśmy
-- w bazie DWA źródła tej samej prawdy. Wystarczy jedna poprawka progu klubu
-- w jednym z nich i serwis zaczyna pokazywać dwie sprzeczne liczby o tym samym
-- pośle, na dwóch podstronach. To jest klasa błędu, po której się nie tłumaczy.
--
-- Liczymy więc niezgodność w widoku, z tej jednej kolumny. Granice przedziału
-- ufności odwracają się dokładnie: przedział Wilsona dla p i dla 1-p są swoimi
-- lustrami, więc dolna granica niezgodności = 100 - loyalty_hi. Bez przybliżeń.
--
-- ---------------------------------------------------------------------
-- 4. DLACZEGO NIE „BUNT" W NAZWIE.
--
-- Napisałeś, że ma to być „obiektywny ranking bez oceny redakcyjnej" — i to
-- jest właśnie powód, dla którego kolumna nie może się nazywać „bunt".
--
-- Sejm NIE PUBLIKUJE informacji o tym, czy w danym głosowaniu obowiązywała
-- dyscyplina klubowa. Nie ma takiego pola w API i nie ma takiego rejestru.
-- Możemy zmierzyć wyłącznie jedno: czy poseł zagłosował inaczej niż większość
-- jego klubu. To samo w sobie nie mówi, czy się „wyłamał":
--
--   - głosowanie mogło być zwolnione z dyscypliny (głosowania światopoglądowe),
--   - klub mógł nie mieć stanowiska,
--   - poseł mógł nacisnąć zły przycisk (Sejm zna sprostowania do protokołu),
--   - „większość klubu" przy klubie 4-osobowym to trzy osoby.
--
-- Słowo „bunt" dokłada do zmierzonego faktu motyw, którego nie zmierzyliśmy.
-- Kolumna nazywa się więc `niezgodnosc_z_klubem_pct` i mówi dokładnie tyle,
-- ile wiemy. Interpretację zostawiamy czytelnikowi — tak jak ustaliliśmy przy
-- kolumnie zgodności z klubem.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Ślad po sprawdzeniu zdjęcia
-- ---------------------------------------------------------------------
alter table mps add column if not exists photo_exists     boolean;
alter table mps add column if not exists photo_checked_at timestamptz;

comment on column mps.photo_exists is
  'true = HEAD na photo_url zwrocil 200. false = 404/410, zdjecia NIE MA. NULL = nie sprawdzano albo serwer nie odpowiedzial jednoznacznie. Interfejs pokazuje zdjecie WYLACZNIE przy true.';

comment on column mps.photo_checked_at is
  'Kiedy importer sprawdzil, czy pod photo_url faktycznie jest zdjecie. Adres jest skladany z id, nie pobierany z API — bez tej kontroli nie wiadomo, czy dziala.';

comment on column mps.photo_url is
  'Adres zdjecia w Sejm API, skladany z id posla. Sam w sobie NIE jest dowodem, ze zdjecie istnieje — o tym mowi photo_exists.';

-- ---------------------------------------------------------------------
-- 2. Słownik okręgów — do listy rozwijanej w filtrze
--
-- Bierze się z danych, nie z tablicy w kodzie. Gdy poseł zmieni okręg albo
-- dojdzie kadencja, lista poprawi się sama.
-- ---------------------------------------------------------------------
create or replace view okregi_wyborcze as
select
  m.district_num,
  m.district_name,
  m.voivodeship,
  count(*)::int                          as poslow,
  count(*) filter (where m.active)::int  as poslow_aktywnych
from mps m
where m.district_num is not null and m.district_name is not null
group by m.district_num, m.district_name, m.voivodeship;

alter view okregi_wyborcze set (security_invoker = on);
grant select on okregi_wyborcze to anon, authenticated;

comment on view okregi_wyborcze is
  '41 okregow wyborczych z liczba poslow. Zrodlo listy rozwijanej w filtrze — lista nigdy nie rozjedzie sie z danymi.';

-- ---------------------------------------------------------------------
-- 3. Widok kontekstu: zdjęcie, okręg, niezgodność z klubem
--
-- `create or replace` nie wystarczy — dokładamy kolumny w środku listy,
-- a Postgres pozwala tylko dopisywać na końcu przy zachowanej kolejności.
-- ---------------------------------------------------------------------
drop view if exists mp_obecnosc_kontekst;

create view mp_obecnosc_kontekst as
select
  r.id, r.full_name, r.slug, r.klub, r.active,

  -- NOWE: twarz i miejsce, z którego poseł został wybrany
  --
  -- Adres wychodzi z widoku TYLKO wtedy, gdy sprawdziliśmy, że pod nim coś
  -- jest. Frontend nie ma więc jak wyrenderować zepsutego obrazka — dostaje
  -- NULL i rysuje inicjały. Ten sam wzorzec co przy treściach AI: kontrolę
  -- stawiamy w widoku, nie w komponencie, bo komponentów będzie wiele.
  case when m.photo_exists then m.photo_url end as photo_url,
  m.district_num,
  m.district_name,
  m.voivodeship,

  -- obecnosc: byl na sali
  r.votes_total, r.attendance_pct, r.attendance_lo, r.attendance_hi,

  -- udzial: nacisnal przycisk (migracja 0007)
  r.voted_pct, r.present_count, r.absent_count,

  -- zgodnosc z klubem (migracje 0004, 0006, 0009)
  r.loyalty_pct, r.loyalty_lo, r.loyalty_hi, r.loyalty_votings,

  -- ------------------------------------------------------------------
  -- NOWE: ta sama liczba widziana z drugiej strony.
  --
  -- Nie jest przechowywana. Jest LICZONA z loyalty_pct, żeby nie dało się
  -- doprowadzić do stanu, w którym zgodność i niezgodność nie sumują się
  -- do stu. Granice przedziału odwracają się (lo <-> hi), bo przedział
  -- Wilsona dla p jest lustrem przedziału dla 1-p.
  -- ------------------------------------------------------------------
  case when r.loyalty_pct is not null then round(100.0 - r.loyalty_pct, 1) end as niezgodnosc_z_klubem_pct,
  case when r.loyalty_hi  is not null then round(100.0 - r.loyalty_hi,  1) end as niezgodnosc_lo,
  case when r.loyalty_lo  is not null then round(100.0 - r.loyalty_lo,  1) end as niezgodnosc_hi,

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

  m.inactive_cause,
  m.waiver_desc,

  case
    when m.active then null
    when m.inactive_cause = 'Zgon' then 'Mandat wygasł — poseł zmarł w trakcie kadencji.'
    when m.waiver_desc is not null then 'Mandat wygasł: ' || m.waiver_desc || '.'
    when m.inactive_cause is not null then 'Mandat wygasł: ' || m.inactive_cause || '.'
    else 'Mandat wygasł w trakcie kadencji.'
  end as powod_zakonczenia,

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
  'Kontrakt dla src/lib/queries.ts. niezgodnosc_* jest LICZONA z loyalty_*, nie przechowywana osobno — jedna prawda, jedno miejsce.';

-- ---------------------------------------------------------------------
-- KONTROLA KONTRAKTU — lista identyczna z KOLUMNY_KONTEKST w queries.ts
-- ---------------------------------------------------------------------
do $$
declare
  wymagane text[] := array[
    'id','full_name','slug','klub','active',
    'photo_url','district_num','district_name','voivodeship',
    'votes_total','attendance_pct','attendance_lo','attendance_hi',
    'voted_pct','present_count','absent_count',
    'loyalty_pct','loyalty_lo','loyalty_hi','loyalty_votings',
    'niezgodnosc_z_klubem_pct','niezgodnosc_lo','niezgodnosc_hi',
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
end $$;

-- ---------------------------------------------------------------------
-- Kontrola spójności: zgodność i niezgodność MUSZĄ sumować się do 100.
-- Jeśli kiedykolwiek przestaną, znaczy to, że ktoś rozdzielił te liczby
-- na dwa źródła — i wtedy migracja ma się wywalić, a nie przemilczeć.
-- ---------------------------------------------------------------------
do $$
declare rozjazd int;
begin
  select count(*) into rozjazd
  from mp_obecnosc_kontekst
  where loyalty_pct is not null
    and abs((loyalty_pct + niezgodnosc_z_klubem_pct) - 100) > 0.05;
  if rozjazd > 0 then
    raise exception 'U % poslow zgodnosc i niezgodnosc nie sumuja sie do 100. Liczby pochodza z dwoch zrodel.', rozjazd;
  end if;
end $$;

-- =====================================================================
-- WYNIK — wklej mi tę tabelkę
-- =====================================================================
select 'poslow ze zdjeciem jeszcze NIEsprawdzonym' as co,
       count(*) filter (where photo_checked_at is null)::text as ile
from mps
union all
select 'okregow wyborczych w slowniku', count(*)::text from okregi_wyborcze
union all
select 'poslow z policzona niezgodnoscia', count(*)::text
from mp_obecnosc_kontekst where niezgodnosc_z_klubem_pct is not null
union all
select 'poslow BEZ niezgodnosci (klub < 3 glosujacych)', count(*)::text
from mp_obecnosc_kontekst where niezgodnosc_z_klubem_pct is null
union all
select 'najwyzsza niezgodnosc (dolna granica przedzialu)',
       coalesce(max(niezgodnosc_lo)::text, '—')
from mp_obecnosc_kontekst where w_rankingu;
