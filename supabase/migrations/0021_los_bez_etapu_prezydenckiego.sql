-- =====================================================================
-- Obywatel 2.0 — migracja 0021: „nie wiemy" rozdzielone od „nie było czego wiedzieć"
--
-- CO POKAZAŁY DANE PO 0020. Kubełek `brak_potwierdzenia` miał 185 procesów.
-- Rozbicie po typie dokumentu:
--
--   wniosek                    88
--   informacja innych organów  32
--   informacja rządowa         28
--   wniosek (bez druku)        14
--   projekt uchwały            11
--   zawiadomienie               6
--   lista kandydatów            3
--   sprawozdanie                2
--   projekt ustawy              1   <-- jeden jedyny
--
-- Czyli 184 ze 185 to sprawy, które NIGDY nie idą do Prezydenta i z definicji
-- nie kończą się publikacją aktu. A interfejs pisał przy każdej z nich:
-- „Nie mamy potwierdzenia publikacji w rejestrze i nie wiemy, na czym proces
-- stanął" — czyli sugerował lukę w naszej wiedzy tam, gdzie nie było czego
-- wiedzieć. Wniosek o wotum nieufności nie „czeka na publikację w Dzienniku
-- Ustaw"; on się po prostu skończył.
--
-- To jest ten sam błąd co „uchwalono" przy ustawie zawetowanej, tylko odwrotny:
-- opisujemy proces kategorią, która do niego nie pasuje.
--
-- ---------------------------------------------------------------------
-- CZYM TO ROZDZIELAMY — faktem z rejestru, nie typem dokumentu.
--
-- Kuszące byłoby rozdzielić po `document_type`: wniosek i informacja w jedno,
-- projekt ustawy w drugie. Ale `document_type` opisuje, czym proces JEST,
-- a my chcemy wiedzieć, którędy POSZEDŁ. To nie zawsze to samo i nie nam
-- to rozstrzygać za rejestr.
--
-- Rejestr mówi to wprost etapem `ToPresident` — „Ustawę przekazano
-- Prezydentowi do podpisu". Zmierzone pokrycie:
--
--   los                 procesów   ma ToPresident
--   opublikowany            770         482
--   brak_potwierdzenia      185           1
--   weto                     57          55
--   oczekuje                 38           6
--   trybunal                 10           9
--   podpisany                 1           1
--
-- W kubełku spornym `ToPresident` ma DOKŁADNIE JEDEN proces na 185. Rozdziela
-- więc te dane niemal idealnie — i robi to faktem rejestru, a nie naszą
-- klasyfikacją.
--
-- ---------------------------------------------------------------------
-- DWA NOWE LOSY.
--
--   `u_prezydenta`              rejestr odnotował przekazanie ustawy do podpisu
--                               i NIC WIĘCEJ: ani podpisu, ani weta, ani
--                               skierowania do Trybunału.
--
--   `bez_etapu_prezydenckiego`  rejestr nie odnotował przekazania w ogóle.
--
-- `brak_potwierdzenia` znika — po tej zmianie żaden wiersz nie może do niego
-- wpaść. Zostaje w słowniku LOS_OPIS w queries.ts wyłącznie na czas, w którym
-- baza mogłaby być jeszcze na 0020.
--
-- ---------------------------------------------------------------------
-- KOLEJNOŚĆ: „oczekuje" STOI PRZED testem na ToPresident. To jest istotne.
--
-- Ustawa uchwalona wczoraj jeszcze nie ma etapu `ToPresident`, bo rejestr nie
-- zdążył go dopisać. Gdyby test strukturalny szedł pierwszy, taka ustawa
-- dostałaby `bez_etapu_prezydenckiego` — czyli twierdzenie, że nie poszła
-- do Prezydenta, podczas gdy prawda brzmi „jeszcze nie wiadomo".
--
-- Próg 90 dni chroni więc przed wnioskiem z niekompletnego rejestru.
-- Ten sam zapas co w 0019 i z tego samego powodu.
--
-- CZEGO NADAL NIE ROBIMY: nie mówimy, dlaczego Prezydent nie podpisał.
-- Przy druku 219 (ustawa o KRS) rejestr kończy się na „przekazano do podpisu"
-- z 15.07.2024 i na tym stoi. Nie mamy prawa napisać ani „zawetował",
-- ani „zwleka" — mówimy dokładnie tyle, ile mówi rejestr.
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

    -- Świeżo uchwalone. PRZED testem na ToPresident — patrz nagłówek:
    -- brak etapu w rejestrze sprzed tygodnia nie znaczy, że etapu nie będzie.
    when p.closure_date >= current_date - interval '90 days' then 'oczekuje'

    -- Ustawa jest u Prezydenta, a rejestr nie odnotował rozstrzygnięcia.
    when e.ma_do_prezydenta then 'u_prezydenta'

    -- Rejestr nie odnotował przekazania Prezydentowi w ogóle. Przy wnioskach,
    -- informacjach i zawiadomieniach to jest normalny koniec drogi.
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
  'Co sie stalo z procesem PO uchwaleniu przez Sejm. Kolejnosc dowodow: link do aktu > podpis > Trybunal > weto > swiezosc (90 dni) > przekazanie do Prezydenta. Nigdy nie zgadujemy, dlaczego Prezydent nie podpisal.';

-- ---------------------------------------------------------------------
-- Widok dla interfejsu — definicja bez zmian wobec 0020. Odtwarzamy go,
-- bo zalezy od proces_los, ktory musial zginac.
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
-- Kontrola sensu 1: ustawa podpisana NIE MOZE byc opisana jako zawetowana.
-- (przeniesiona z 0020 — ma obowiazywac dalej)
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
-- Kontrola sensu 2: `u_prezydenta` znaczy „przekazano i CISZA". Jesli przy
-- takim procesie stoi podpis, weto albo Trybunal, to znaczy, ze ktos przestawil
-- kolejnosc warunkow i etykieta klamie.
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
-- Kontrola sensu 3: `bez_etapu_prezydenckiego` znaczy „rejestr nie odnotowal
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
-- Kontrola sensu 4: po tej migracji zaden wiersz nie moze miec juz losu
-- `brak_potwierdzenia` — CASE nie ma jak go wyprodukowac.
-- ---------------------------------------------------------------------
do $$
declare zostalo int;
begin
  select count(*) into zostalo from proces_los where los = 'brak_potwierdzenia';
  if zostalo > 0 then
    raise exception 'Zostalo % wierszy z losem brak_potwierdzenia — CASE nie zostal przepisany do konca.', zostalo;
  end if;
end $$;

-- =====================================================================
-- WYNIK — rozklad losow po zmianie.
--
-- ZMIERZONE po uruchomieniu, 11.09.2026:
--
--   opublikowany              770
--   (Sejm nie uchwalil)       601
--   bez_etapu_prezydenckiego  184
--   weto                       57
--   oczekuje                   38
--   trybunal                   10
--   podpisany                   1
--   u_prezydenta                1      <- druk 219, closure_date 2024-07-12
--
-- Rachunek jest prosty: dawne `brak_potwierdzenia` (185) rozpadlo sie na
-- 184 + 1. Kubelek `oczekuje` zostal nietkniety (38 przed i po), bo prog
-- 90 dni stoi w CASE PRZED testem na ToPresident i nic z niego nie wypuscil.
--
-- Pierwsza wersja tego komentarza prognozowala 216 i tlumaczyla to
-- przesunieciem 32 procesow z `oczekuje`. Bylo to bledne rozumowanie
-- o wlasnym kodzie — kolejnosc warunkow, ktora sam wyzej opisalem, wyklucza
-- takie przesuniecie. Zostawiam zapis pomylki zamiast cichej korekty.
-- =====================================================================
select
  coalesce(los, '(Sejm nie uchwalil)')      as los,
  count(*)                                  as procesow,
  count(*) filter (where ma_do_prezydenta)  as w_tym_do_prezydenta,
  count(*) filter (where ma_weto)           as w_tym_z_wetem,
  min(closure_date)                         as najstarszy,
  max(closure_date)                         as najnowszy
from proces_los
group by 1
order by procesow desc;
