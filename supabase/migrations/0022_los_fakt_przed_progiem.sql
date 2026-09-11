-- =====================================================================
-- Obywatel 2.0 — migracja 0022: fakt z rejestru przed progiem czasowym
--
-- CO BYŁO ŹLE W 0021. Postawiłem próg 90 dni („oczekuje") PRZED testem na
-- etap `ToPresident`, uzasadniając to tak: ustawa uchwalona wczoraj nie ma
-- jeszcze tego etapu, bo rejestr nie zdążył go dopisać, więc test strukturalny
-- przed progiem twierdziłby, że nie poszła do Prezydenta.
--
-- Uzasadnienie jest słuszne, ale dotyczy WYŁĄCZNIE gałęzi negatywnej.
--
--   `else 'bez_etapu_prezydenckiego'`   twierdzi, że czegoś W REJESTRZE NIE MA.
--                                        Takie twierdzenie o świeżym procesie
--                                        jest ryzykowne i próg 90 dni ma sens.
--
--   `when e.ma_do_prezydenta`            stwierdza FAKT, który w rejestrze JEST.
--                                        Fakt nie przeterminowuje się i nie
--                                        potrzebuje żadnego zapasu czasowego.
--
-- Zrównanie obu gałęzi jednym progiem kosztowało dokładnie to, przed czym
-- ten projekt się broni. Sześć ustaw przekazanych Prezydentowi dostawało los
-- `oczekuje`, a przy nim zdanie ze słownika LOS_OPIS:
--
--     „Sejm uchwalił niedawno; rejestr nie odnotował jeszcze ŻADNEGO
--      etapu prezydenckiego."
--
-- Zdanie było nieprawdziwe, i to sprzecznie z kolumną `ma_do_prezydenta`,
-- którą migracja 0021 sama wystawiła. Zmierzone 11.09.2026:
--
--     druk 2648, 2695              closure_date 2026-07-17   ToPresident: tak
--     druk 2600, 2669, 2675, 2822  closure_date 2026-07-31   ToPresident: tak
--
-- W widoku `glosowanie_z_procesem` prowadzi do nich dziewięć głosowań, więc
-- to zdanie było widoczne dla czytelnika.
--
-- Znalazła to recenzja migracji 0021. Liczba 6 stała w kolumnie
-- `w_tym_do_prezydenta` w wyniku końcowego zapytania 0021 — była na ekranie
-- i została przeoczona.
--
-- ---------------------------------------------------------------------
-- POPRAWKA. `u_prezydenta` idzie NAD próg 90 dni. Po zmianie:
--
--   `oczekuje` znaczy: uchwalono niedawno i rejestr NIE MA jeszcze żadnego
--                      etapu prezydenckiego — czyli dokładnie to, co mówi
--                      o nim słownik LOS_OPIS. Zdanie staje się prawdziwe
--                      bez zmiany jego treści.
--
--   Gałąź negatywna zostaje pod progiem i jest chroniona tak jak była.
--
-- Oczekiwany skutek: sześć procesów przechodzi z `oczekuje` do `u_prezydenta`
-- (38 -> 32 i 1 -> 7). Żaden inny kubełek się nie rusza.
--
-- ---------------------------------------------------------------------
-- DRUGA ZMIANA: blok kontrolny, który naprawdę czegoś pilnuje.
--
-- 0021 kończyła się blokiem sprawdzającym, czy został jakiś wiersz z losem
-- `brak_potwierdzenia`. To była tautologia: `CASE` w tym samym pliku nie miał
-- jak takiego wiersza wyprodukować, więc blok przechodził niezależnie od
-- danych — a mimo to liczył się w zdaniu „cztery bloki kontrolne przeszły".
--
-- Zastępujemy go dwoma niezmiennikami, które wywalą się przy przestawieniu
-- kolejności warunków:
--
--   * `oczekuje` nie może stać przy procesie z etapem `ToPresident`
--     (to jest dokładnie błąd naprawiany tą migracją),
--   * każdy proces z `passed = true` musi dostać jakiś los — `CASE` ma być
--     wyczerpujący, a nie „prawie wyczerpujący".
-- =====================================================================

-- Kolejność wymuszona zależnością: glosowanie_z_procesem czyta proces_los.
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
  e.ma_do_prezydenta,

  case
    -- Proces jeszcze się nie zamknął albo Sejm go nie uchwalił.
    when p.passed is not true then null

    -- Dowód najmocniejszy: akt jest w rejestrze.
    when p.isap_url is not null or p.eli_address is not null then 'opublikowany'

    -- Podpis jest faktem późniejszym niż weto i niż skierowanie do Trybunału.
    -- Ustawa podpisana NIE jest ustawą zawetowaną, choćby weto było w etapach.
    when e.ma_podpis then 'podpisany'

    -- Rejestr mówi wprost, co Prezydent zrobił.
    when e.ma_trybunal then 'trybunal'
    when e.ma_weto     then 'weto'

    -- FAKT Z REJESTRU — nad progiem czasowym. Ustawa jest u Prezydenta,
    -- a rejestr nie odnotował rozstrzygnięcia. To jest prawda tak samo
    -- dla ustawy sprzed tygodnia, jak dla druku 219 z lipca 2024.
    when e.ma_do_prezydenta then 'u_prezydenta'

    -- Świeżo uchwalone, bez ŻADNEGO etapu prezydenckiego. Próg chroni gałąź
    -- niżej, która twierdzi, że czegoś w rejestrze nie ma — a przy procesie
    -- sprzed tygodnia takie twierdzenie byłoby przedwczesne.
    when p.closure_date >= current_date - interval '90 days' then 'oczekuje'

    -- Rejestr nie odnotował przekazania Prezydentowi ani adresu aktu.
    else 'bez_etapu_prezydenckiego'
  end as los

from legislative_processes p
left join lateral (
  select
    bool_or(s.stage_type = 'PresidentToTribunal')          as ma_trybunal,
    bool_or(s.stage_type = 'Veto')                         as ma_weto,
    bool_or(s.stage_type = 'PresidentSignature')           as ma_podpis,
    bool_or(s.stage_type = 'PresidentMotionConsideration') as ma_rozpatrzenie_wniosku,
    bool_or(s.stage_type = 'ToPresident')                  as ma_do_prezydenta
  from process_stages s
  where s.print_number = p.print_number
) e on true;

alter view proces_los set (security_invoker = on);
grant select on proces_los to anon, authenticated;

comment on view proces_los is
  'Co sie stalo z procesem PO uchwaleniu przez Sejm. Kolejnosc: link do aktu > podpis > Trybunal > weto > przekazanie do Prezydenta (FAKT) > swiezosc 90 dni (chroni gale negatywna) > brak etapu. Nigdy nie zgadujemy, dlaczego Prezydent nie podpisal.';

-- ---------------------------------------------------------------------
-- Widok dla interfejsu — definicja bez zmian. Odtwarzamy go, bo zalezy
-- od proces_los, ktory musial zginac.
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
-- Kontrola 1: ustawa podpisana NIE MOZE byc opisana jako zawetowana.
-- ---------------------------------------------------------------------
do $$
declare bledne int;
begin
  select count(*) into bledne from proces_los where ma_podpis and los = 'weto';
  if bledne > 0 then
    raise exception 'U % procesow podpis Prezydenta jest opisany jako weto.', bledne;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Kontrola 2: `u_prezydenta` znaczy „przekazano i CISZA".
-- ---------------------------------------------------------------------
do $$
declare bledne int;
begin
  select count(*) into bledne from proces_los
   where los = 'u_prezydenta' and (ma_podpis or ma_weto or ma_trybunal);
  if bledne > 0 then
    raise exception 'U % procesow los to u_prezydenta, mimo ze rejestr zna rozstrzygniecie.', bledne;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Kontrola 3: `bez_etapu_prezydenckiego` znaczy „rejestr nie odnotowal
-- przekazania". Proces z etapem ToPresident nie ma prawa tam stac.
-- ---------------------------------------------------------------------
do $$
declare bledne int;
begin
  select count(*) into bledne from proces_los
   where los = 'bez_etapu_prezydenckiego' and ma_do_prezydenta;
  if bledne > 0 then
    raise exception 'U % procesow los to bez_etapu_prezydenckiego, mimo etapu ToPresident.', bledne;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Kontrola 4 (NOWA — to jest blad naprawiany ta migracja).
--
-- Slownik LOS_OPIS mowi przy `oczekuje`: „rejestr nie odnotowal jeszcze
-- ZADNEGO etapu prezydenckiego". Jesli ten blok kiedykolwiek sie wywali,
-- znaczy to, ze to zdanie znowu klamie.
-- ---------------------------------------------------------------------
do $$
declare bledne int;
begin
  select count(*) into bledne from proces_los
   where los = 'oczekuje' and (ma_do_prezydenta or ma_podpis or ma_weto or ma_trybunal);
  if bledne > 0 then
    raise exception
      'U % procesow los to oczekuje, mimo ze rejestr ma juz etap prezydencki. '
      'Slownik LOS_OPIS twierdzi przy tym losie, ze zadnego etapu nie ma.', bledne;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Kontrola 5 (NOWA — zastepuje tautologie z 0021).
--
-- 0021 sprawdzala, czy zostal wiersz z losem `brak_potwierdzenia` — ale CASE
-- w tym samym pliku nie mial jak go wyprodukowac, wiec blok przechodzil
-- niezaleznie od danych. Tu sprawdzamy niezmiennik, ktory da sie zlamac:
-- CASE ma byc WYCZERPUJACY dla kazdego uchwalonego procesu.
-- ---------------------------------------------------------------------
do $$
declare bez_losu int;
begin
  select count(*) into bez_losu from proces_los where passed and los is null;
  if bez_losu > 0 then
    raise exception '% uchwalonych procesow nie dostalo zadnego losu — CASE nie jest wyczerpujacy.', bez_losu;
  end if;
end $$;

-- =====================================================================
-- WYNIK — rozklad losow. Oczekiwane wzgledem 0021: oczekuje 38 -> 32,
-- u_prezydenta 1 -> 7, reszta bez zmian.
-- =====================================================================
select
  coalesce(los, '(Sejm nie uchwalil)')      as los,
  count(*)                                  as procesow,
  count(*) filter (where ma_do_prezydenta)  as w_tym_do_prezydenta,
  min(closure_date)                         as najstarszy,
  max(closure_date)                         as najnowszy
from proces_los
group by 1
order by procesow desc;
