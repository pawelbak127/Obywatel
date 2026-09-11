-- =====================================================================
-- Obywatel 2.0 — migracja 0019: „uchwalono" to nie to samo co „jest prawem"
--
-- CO SIĘ STAŁO. Szukaliśmy luki w imporcie: 103 z 744 uchwalonych procesów
-- nie miało linku do aktu. Rozkład w czasie miał rozstrzygnąć, czy to zwykłe
-- opóźnienie publikacji, czy nasz błąd. Rozstrzygnął co innego.
--
-- Wśród dziesięciu najstarszych pozycji bez linku są między innymi:
--
--   druk 233  o zmianie ustawy o mniejszościach narodowych i etnicznych
--   druk 219  o zmianie ustawy o Krajowej Radzie Sądownictwa
--   druk 351  o uchyleniu ustawy o Państwowej Komisji ds. wpływów rosyjskich
--   druk 254  Przepisy wprowadzające ustawę o Trybunale Konstytucyjnym
--
-- Te ustawy Sejm uchwalił i nigdy nie weszły w życie. Nie ma ich w Dzienniku
-- Ustaw, bo nie ma czego tam publikować.
--
-- Pole `passed` z Sejm API znaczy „SEJM UCHWALIŁ", a nie „stało się prawem".
-- Droga ustawy nie kończy się na Sejmie: jest jeszcze Senat, podpis Prezydenta,
-- weto i wniosek do Trybunału Konstytucyjnego. My renderowaliśmy `passed`
-- jako jedno słowo — „uchwalono" — i czytelnik miał pełne prawo przeczytać
-- to jako „ta ustawa obowiązuje".
--
-- To NIE jest brak danych. Etapy weta i skierowania do TK siedzą w naszej
-- tabeli `process_stages` od migracji 0016. Zaimportowaliśmy fakt i sami go
-- zasłoniliśmy — dokładnie ten sam błąd co przy funkcji państwowej Tuska.
--
-- I jest to najgorszy możliwy rodzaj pomyłki dla tego serwisu: przy ustawie
-- o KRS albo o Trybunale Konstytucyjnym napisać „uchwalono" bez słowa o wecie
-- to nie usterka wyświetlania, tylko wprowadzenie czytelnika w błąd w sprawie,
-- w której najbardziej zależy mu na prawdzie.
--
-- ---------------------------------------------------------------------
-- CZEGO TA MIGRACJA NIE ROBI.
--
-- Nie zgaduje. Los procesu wyprowadzamy WYŁĄCZNIE z etapów, które przysłał
-- rejestr. Gdy etapy nie mówią nic, a linku nie ma, piszemy właśnie to:
-- „brak potwierdzenia publikacji" — a nie „prawdopodobnie zawetowano".
--
-- Kolejność warunków jest ważna. Adres w rejestrze jest dowodem NAJMOCNIEJSZYM
-- i bije wszystko: ustawa zawetowana, której weto Sejm odrzucił większością
-- 3/5, zostaje opublikowana — i wtedy „opublikowany" jest prawdą, mimo że
-- w etapach stoi weto.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Los procesu wyprowadzony z etapów
-- ---------------------------------------------------------------------
create or replace view proces_los as
select
  p.print_number,
  p.passed,
  p.closure_date,
  p.isap_url,
  p.eli_address,

  -- Surowe fakty z rejestru. Wystawiamy je osobno, żeby interfejs (i my przy
  -- następnym sporze) mógł sprawdzić, na czym stoi etykieta.
  e.ma_weto,
  e.ma_trybunal,
  e.ma_podpis,

  case
    -- Proces jeszcze się nie zamknął albo Sejm go nie uchwalił.
    when p.passed is not true then null

    -- Dowód najmocniejszy: akt jest w rejestrze.
    when p.isap_url is not null or p.eli_address is not null then 'opublikowany'

    -- Rejestr mówi wprost, co się stało dalej.
    when e.ma_trybunal then 'trybunal'
    when e.ma_weto     then 'weto'

    -- Świeżo uchwalone. 90 dni to nie jest próg prawny — Konstytucja daje
    -- Prezydentowi 21 dni, a publikacja idzie po podpisie — tylko ostrożny
    -- zapas na opóźnienia po stronie rejestru. Dlatego etykieta mówi
    -- „oczekuje", a nie „zostanie opublikowany".
    when p.closure_date >= current_date - interval '90 days' then 'oczekuje'

    else 'brak_potwierdzenia'
  end as los

from legislative_processes p
left join lateral (
  select
    bool_or(s.stage_type = 'PresidentToTribunal') as ma_trybunal,
    bool_or(s.stage_type = 'Veto')                as ma_weto,
    bool_or(s.stage_type = 'PresidentSignature')  as ma_podpis
  from process_stages s
  where s.print_number = p.print_number
) e on true;

alter view proces_los set (security_invoker = on);
grant select on proces_los to anon, authenticated;

comment on view proces_los is
  'Co sie stalo z procesem PO uchwaleniu przez Sejm. Wyprowadzone wylacznie z etapow rejestru i z obecnosci adresu aktu — nigdy zgadywane.';

-- ---------------------------------------------------------------------
-- 2. Widok dla interfejsu niesie los razem z linkiem
-- ---------------------------------------------------------------------
drop view if exists glosowanie_z_procesem;

create view glosowanie_z_procesem as
select
  v.id                as voting_id,
  v.sitting,
  v.voting_number,
  v.voted_at,
  v.title             as voting_title,
  p.print_number,
  p.title             as process_title,
  p.title_final,
  p.document_type,
  p.passed,
  p.closure_date,
  p.isap_url,
  p.eli_address,
  l.los               as los_procesu,
  'etap procesu'::text as pewnosc_powiazania
from votings v
join process_stages s on s.voting_id = v.id
join legislative_processes p on p.print_number = s.print_number
left join proces_los l on l.print_number = p.print_number

union

select
  v.id, v.sitting, v.voting_number, v.voted_at, v.title,
  p.print_number, p.title, p.title_final, p.document_type, p.passed, p.closure_date,
  p.isap_url, p.eli_address,
  l.los,
  'numer druku z tytulu'::text
from votings v
join legislative_processes p on p.print_number = any (v.print_numbers)
left join proces_los l on l.print_number = p.print_number
where not exists (
  select 1 from process_stages s2
  where s2.voting_id = v.id and s2.print_number = p.print_number
);

alter view glosowanie_z_procesem set (security_invoker = on);
grant select on glosowanie_z_procesem to anon, authenticated;

comment on view glosowanie_z_procesem is
  'Glosowanie + proces + link do aktu + LOS PROCESU. `passed` znaczy tylko "Sejm uchwalil"; los_procesu mowi, czy akt faktycznie wszedl do rejestru.';

-- ---------------------------------------------------------------------
-- KONTROLA KONTRAKTU — lista identyczna z zapytaniem w src/lib/queries.ts
-- ---------------------------------------------------------------------
do $$
declare
  wymagane text[] := array['voting_id','print_number','process_title','title_final',
    'document_type','passed','closure_date','isap_url','eli_address','los_procesu',
    'pewnosc_powiazania'];
  brakujace text;
begin
  select string_agg(k, ', ') into brakujace from unnest(wymagane) k
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema='public' and c.table_name='glosowanie_z_procesem' and c.column_name=k
  );
  if brakujace is not null then
    raise exception 'Widok glosowanie_z_procesem nie wystawia kolumn: %', brakujace;
  end if;
end $$;

-- =====================================================================
-- WYNIK 1 — rozkład losów. Wklej mi tę tabelkę.
--
-- Suma wierszy 'weto', 'trybunal', 'oczekuje' i 'brak_potwierdzenia' powinna
-- dać 103, czyli dokładnie te procesy, które wcześniej nie miały linku.
-- =====================================================================
select
  coalesce(los, '(Sejm nie uchwalil)') as los,
  count(*)                             as procesow,
  min(closure_date)                    as najstarszy,
  max(closure_date)                    as najnowszy
from proces_los
group by 1
order by procesow desc;

-- =====================================================================
-- WYNIK 2 — KONTROLA NAZW ETAPÓW, i to jest najważniejsze zapytanie w tym
-- pliku.
--
-- Etykiety wyżej opieram na typach 'Veto' i 'PresidentToTribunal'. Typ to kod
-- z API, a nie zdanie po polsku — nie mam pewności, czy 'Veto' oznacza samo
-- weto Prezydenta, czy może ROZPATRZENIE weta przez Sejm. Te dwie rzeczy
-- znaczą co innego i pomylenie ich dałoby dokładnie ten błąd, który tą
-- migracją naprawiam.
--
-- Zapytanie pokazuje prawdziwe nazwy etapów spod tych kodów. Jeśli nazwy
-- będą mówiły co innego niż etykiety, poprawię widok — dlatego los liczy się
-- w widoku, a nie w kolumnie: poprawka to jeden `create or replace`.
-- =====================================================================
select
  s.stage_type,
  s.stage_name,
  count(*) as wystapien
from process_stages s
where s.stage_type in ('Veto', 'PresidentToTribunal', 'PresidentSignature',
                       'PresidentMotionConsideration')
group by s.stage_type, s.stage_name
order by s.stage_type, wystapien desc;
