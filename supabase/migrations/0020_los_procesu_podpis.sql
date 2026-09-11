-- =====================================================================
-- Obywatel 2.0 — migracja 0020: podpis Prezydenta jako osobny stan
--
-- WERYFIKACJA MIGRACJI 0019. Drugie zapytanie z 0019 miało rozstrzygnąć,
-- czy kod etapu `Veto` oznacza weto Prezydenta, czy rozpatrzenie weta przez
-- Sejm. Rejestr odpowiedział jednoznacznie:
--
--   Veto                          "Wniosek Prezydenta (weto)"                              63
--   PresidentToTribunal           "Prezydent skierował ustawę do Trybunału Konstytucyjnego" 10
--   PresidentSignature            "Prezydent podpisał ustawę"                             491
--   PresidentMotionConsideration  "Rozpatrywanie na forum Sejmu wniosku Prezydenta"        15
--
-- Etykiety z 0019 są więc poprawne co do kierunku. Ta migracja ich nie cofa —
-- dokłada dwie rzeczy, które dopiero teraz widać.
--
-- ---------------------------------------------------------------------
-- ZMIANA PIERWSZA: `PresidentSignature` bije weto, a 0019 tego nie wiedziała.
--
-- W 0019 kolejność warunków była: link → Trybunał → weto → oczekuje.
-- Podpisu nie było w niej wcale, choć jest w bazie 491 razy.
--
-- To ma konkretny skutek. Gdy Sejm odrzuci weto większością 3/5, Prezydent
-- ma obowiązek ustawę podpisać. W etapach zostaje wtedy JEDNO I DRUGIE:
-- weto i podpis. Widok z 0019 zatrzymywał się na wecie i pisał „Prezydent
-- zawetował" o ustawie, która została podpisana i czeka już tylko na druk
-- w Dzienniku Ustaw. Czyli dokładnie ten sam rodzaj pomyłki, który 0019
-- miała naprawić — tyle że w drugą stronę.
--
-- Podpis jest faktem PÓŹNIEJSZYM i mocniejszym niż weto czy skierowanie do
-- Trybunału, więc wchodzi w kolejności zaraz po linku do aktu.
--
-- ---------------------------------------------------------------------
-- ZMIANA DRUGA: „oczekuje" przestaje stać na dacie, gdy stoi na fakcie.
--
-- 0019 rozpoznawała świeżo uchwalone ustawy po `closure_date` z ostatnich
-- 90 dni. To był ostrożny domysł z braku czegoś lepszego. Teraz mamy coś
-- lepszego: jeśli w etapach jest podpis, a linku nie ma, to nie jest domysł —
-- ustawa jest podpisana i publikacja to kwestia dni. Próg 90 dni zostaje
-- wyłącznie dla uchwał i ustaw, przy których rejestr nie odnotował jeszcze
-- żadnego etapu prezydenckiego.
--
-- ---------------------------------------------------------------------
-- CZEGO NADAL NIE ROBIMY: nie wnioskujemy o wyniku rozpatrzenia weta.
--
-- `PresidentMotionConsideration` mówi, że Sejm zajmował się wnioskiem
-- Prezydenta — nie mówi, jak głosował. Kuszące byłoby napisać „Sejm weta nie
-- odrzucił", skoro brak podpisu, ale to już jest nasz wniosek z nieobecności
-- danych, a nie fakt z rejestru. Pokazujemy więc oba fakty obok siebie
-- i zostawiamy czytelnikowi złożenie ich w całość.
--
-- ---------------------------------------------------------------------
-- POPRAWKA PO PIERWSZYM URUCHOMIENIU: blad 42P16.
--
-- Pierwsza wersja tej migracji zaczynala sie od `create or replace view
-- proces_los` i Supabase odrzucil ja w pierwszym poleceniu:
--
--   ERROR: 42P16: cannot change name of view column "los"
--          to "ma_rozpatrzenie_wniosku"
--
-- POWOD. Widok z migracji 0019 ma kolumny w tej kolejnosci:
--   1-5  print_number, passed, closure_date, isap_url, eli_address
--   6-8  ma_weto, ma_trybunal, ma_podpis
--   9    los
--
-- Ta migracja dokłada `ma_rozpatrzenie_wniosku` OBOK pozostalych surowych
-- faktow, czyli na pozycje 9 — a `create or replace view` potrafi wylacznie
-- DOPISAC kolumne na koncu listy. Nie umie wstawic kolumny w srodek ani
-- przemianowac istniejacej. Postgres nie widzi wiec "nowej kolumny 9",
-- tylko "kolumna 9 zmienila nazwe z los na ma_rozpatrzenie_wniosku" —
-- i slusznie odmawia.
--
-- To jest dokladnie wzorzec C z HANDOFF.md §3.3, ktorego pierwsza wersja
-- tej migracji nie zastosowala do `proces_los`, choc zastosowala go do
-- `glosowanie_z_procesem` kilkadziesiat linii nizej.
--
-- ROZWIAZANIE: drop + create, w kolejnosci zaleznosci. Najpierw ginie widok
-- zalezny (`glosowanie_z_procesem` czyta `proces_los`), potem sam `proces_los`.
--
-- SWIADOMIE BEZ `cascade`. Gdyby od `proces_los` zalezalo cos jeszcze, o czym
-- nie wiemy, `cascade` usunaloby to po cichu. Bez niego migracja zatrzyma sie
-- i poda nazwe tego obiektu — a to jest informacja, ktorej chcemy.
--
-- Kolejnosc kolumn nie jest tu kosmetyka: `ma_rozpatrzenie_wniosku` stoi przy
-- `ma_weto`, `ma_trybunal` i `ma_podpis`, bo to jeden zestaw surowych faktow
-- z rejestru. `los` jest WNIOSKIEM z nich i dlatego zostaje na koncu.
--
-- Migracja jest odporna na powtorzenie: `drop view if exists` przechodzi
-- niezaleznie od tego, czy poprzednia proba cokolwiek zdazyla zmienic.
-- =====================================================================

-- Kolejnosc wymuszona zaleznoscia: glosowanie_z_procesem czyta proces_los,
-- wiec widok zalezny musi zginac pierwszy.
drop view if exists glosowanie_z_procesem;
drop view if exists proces_los;

create view proces_los as
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
  e.ma_rozpatrzenie_wniosku,

  case
    -- Proces jeszcze się nie zamknął albo Sejm go nie uchwalił.
    when p.passed is not true then null

    -- Dowód najmocniejszy: akt jest w rejestrze.
    when p.isap_url is not null or p.eli_address is not null then 'opublikowany'

    -- Podpis jest faktem późniejszym niż weto i niż skierowanie do Trybunału.
    -- Ustawa podpisana NIE jest ustawą zawetowaną, choćby weto było w etapach.
    when e.ma_podpis then 'podpisany'

    -- Rejestr mówi wprost, co się stało dalej.
    when e.ma_trybunal then 'trybunal'
    when e.ma_weto     then 'weto'

    -- Świeżo uchwalone, bez żadnego etapu prezydenckiego. 90 dni to nie jest
    -- próg prawny — tylko ostrożny zapas na opóźnienia po stronie rejestru.
    -- Dlatego etykieta mówi „oczekuje", a nie „zostanie opublikowana".
    when p.closure_date >= current_date - interval '90 days' then 'oczekuje'

    else 'brak_potwierdzenia'
  end as los

from legislative_processes p
left join lateral (
  select
    bool_or(s.stage_type = 'PresidentToTribunal')          as ma_trybunal,
    bool_or(s.stage_type = 'Veto')                         as ma_weto,
    bool_or(s.stage_type = 'PresidentSignature')           as ma_podpis,
    bool_or(s.stage_type = 'PresidentMotionConsideration') as ma_rozpatrzenie_wniosku
  from process_stages s
  where s.print_number = p.print_number
) e on true;

alter view proces_los set (security_invoker = on);
grant select on proces_los to anon, authenticated;

comment on view proces_los is
  'Co sie stalo z procesem PO uchwaleniu przez Sejm. Kolejnosc dowodow: link do aktu > podpis Prezydenta > Trybunal > weto > swiezosc. Nigdy nie zgadujemy wyniku rozpatrzenia weta.';

-- ---------------------------------------------------------------------
-- Widok dla interfejsu: dokładamy fakty o wecie, żeby profil posła mógł
-- pokazać je obok siebie, nie sklejając ich we wniosek.
--
-- Widok zostal juz usuniety na gorze pliku, razem z `proces_los` — musial
-- zginac PRZED nim, bo od niego zalezy. Powtorka `drop` byla tu myląca,
-- wiec zostaje samo `create`.
-- ---------------------------------------------------------------------
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
  l.los                              as los_procesu,
  coalesce(l.ma_weto, false)                 as ma_weto,
  coalesce(l.ma_rozpatrzenie_wniosku, false) as ma_rozpatrzenie_wniosku,
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
  coalesce(l.ma_weto, false),
  coalesce(l.ma_rozpatrzenie_wniosku, false),
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
  'Glosowanie + proces + link do aktu + los procesu. `passed` znaczy tylko "Sejm uchwalil"; los_procesu mowi, co bylo dalej.';

-- ---------------------------------------------------------------------
-- KONTROLA KONTRAKTU — lista identyczna z zapytaniem w src/lib/queries.ts
-- ---------------------------------------------------------------------
do $$
declare
  wymagane text[] := array['voting_id','print_number','process_title','title_final',
    'document_type','passed','closure_date','isap_url','eli_address','los_procesu',
    'ma_weto','ma_rozpatrzenie_wniosku','pewnosc_powiazania'];
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

-- ---------------------------------------------------------------------
-- Kontrola sensu: ustawa podpisana NIE MOŻE być opisana jako zawetowana.
-- Gdyby kiedykolwiek mogła, znaczyłoby to, że ktoś przestawił kolejność
-- warunków — i wtedy migracja ma się wywalić, a nie przemilczeć.
-- ---------------------------------------------------------------------
do $$
declare bledne int;
begin
  select count(*) into bledne from proces_los where ma_podpis and los = 'weto';
  if bledne > 0 then
    raise exception 'U % procesow podpis Prezydenta jest opisany jako weto.', bledne;
  end if;
end $$;

-- =====================================================================
-- WYNIK — rozkład losów. Wklej mi tę tabelkę.
--
-- Suma wszystkiego poza 'opublikowany' i '(Sejm nie uchwalil)' powinna dać
-- 103 — tyle uchwalonych procesów nie ma linku do aktu.
-- =====================================================================
select
  coalesce(los, '(Sejm nie uchwalil)') as los,
  count(*)                             as procesow,
  count(*) filter (where ma_weto)      as w_tym_z_wetem,
  min(closure_date)                    as najstarszy,
  max(closure_date)                    as najnowszy
from proces_los
group by 1
order by procesow desc;
