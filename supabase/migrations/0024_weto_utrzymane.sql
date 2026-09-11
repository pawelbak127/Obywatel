-- =====================================================================
-- Obywatel 2.0 — migracja 0024: rejestr mówi to słowami, więc przestajemy
-- składać własne zdanie z kodów
--
-- ---------------------------------------------------------------------
-- CO ZNALEŹLIŚMY.
--
-- Piętnaście procesów jest w identycznej sytuacji faktycznej: Sejm uchwalił
-- ustawę, Prezydent ją zawetował, a przy ponownym głosowaniu Sejm nie zebrał
-- większości 3/5. Rejestr zapisuje to dwoma polami, po polsku:
--
--     process_stages.decision    = 'nie uchwalona ponownie'
--     process_stages.stage_name  = 'nie uchwalona ponownie po wecie Prezydenta'
--
-- Flaga `passed` rozkłada te piętnaście procesów na dwie grupy:
--
--     passed = false   6 procesów   druki 1424, 2064, 2363, 2528, 2529, 2530
--     passed = true    9 procesów   druki 410, 608, 643, 865, 935, 1109,
--                                         1110, 1131, 1600
--
-- I dlatego czytelnik dostawał przy nich DWA PRZECIWNE komunikaty:
--
--   przy passed = false    „nie uchwalono"  — czyta się jako „Sejm był przeciw",
--                          a Sejm był za: III czytanie ma decyzję „uchwalono"
--
--   przy passed = true     „uchwalono — Prezydent zawetował" bez ani słowa
--                          o tym, że weto się utrzymało i sprawa jest zamknięta
--
-- Jedno i drugie jest mylące, w przeciwne strony, przy tym samym fakcie.
--
-- ---------------------------------------------------------------------
-- DLACZEGO NIE ZAUWAŻYLIŚMY TEGO WCZEŚNIEJ.
--
-- W `src/lib/queries.ts` stoi przy funkcji `opisWeta()` komentarz:
--
--   „Kuszące byłoby napisać »Sejm weta nie odrzucił«, skoro nie ma podpisu —
--    ale to jest wnioskowanie z nieobecności danych, a nie fakt z rejestru."
--
-- To było SŁUSZNE — dopóki patrzyliśmy wyłącznie na `stage_type`, czyli na
-- kody. Z samych kodów rzeczywiście nie da się orzec, jak Sejm zagłosował.
--
-- Tylko że rejestr wcale nie milczy. Mówi to wprost, w polu `decision`, które
-- importujemy od migracji 0016 i **nie używamy nigdzie**. Pole ma zaledwie
-- 18 różnych wartości na 1 657 wypełnionych etapów — to zamknięty słownik
-- zdań po polsku, gotowy do czytania:
--
--     uchwalono                                 737
--     skierowano ponownie do komisji …          313
--     niezwłocznie przystąpiono do III czytania  303
--     przyjęto poprawki                          110
--     odrzucony                                   26
--     nie uchwalona ponownie                      15
--
-- Zasada „nie wnioskujemy z nieobecności danych" ma więc drugą stronę,
-- której dotąd nie zapisaliśmy: **zanim uznasz coś za niewiedzę, sprawdź,
-- czy rejestr nie powiedział tego w polu, którego nie czytasz.**
--
-- To jest ta sama lekcja co przy D18 (funkcje państwowe) — tam chodziło o to,
-- żeby nie wpisywać ręcznie faktu, który rejestr podaje. Tu o to, żeby nie
-- ogłaszać niewiedzy w sprawie, którą rejestr rozstrzyga. Czwarty raz w tym
-- projekcie fakt siedział w bazie, a my go zasłanialiśmy.
--
-- ---------------------------------------------------------------------
-- CO ROBI TA MIGRACJA.
--
-- Dokłada los `weto_utrzymane`, wyprowadzony WYŁĄCZNIE ze słów rejestru —
-- z `decision`, nie z nieobecności podpisu i nie z flagi `passed`.
--
-- Stoi NAD warunkiem `passed is not true`, i to jest istotne: sześć procesów
-- z tej piętnastki ma `passed = false`, więc przy dotychczasowej kolejności
-- nigdy by do tego warunku nie doszło. Los przestaje być zarezerwowany dla
-- procesów uchwalonych — bo „weto się utrzymało" jest faktem o procesie
-- niezależnie od tego, co Sejm ostatecznie wpisał w `passed`.
--
-- Kubełek `weto` zostaje dla wet, przy których rejestr NIE mówi, co dalej —
-- po tej zmianie 48 zamiast 57.
--
-- CZEGO NADAL NIE ROBIMY: nie mówimy, dlaczego Sejm nie odrzucił weta, ani
-- czy dobrze zrobił. Przepisujemy jedno zdanie rejestru i zostawiamy je
-- czytelnikowi.
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

  -- NOWE: nie kod etapu, tylko SŁOWO rejestru.
  e.weto_utrzymane,

  case
    -- Rejestr mówi wprost, że weto się utrzymało. Stoi NAD testem na `passed`,
    -- bo sześć z piętnastu takich procesów ma `passed = false` i nigdy by
    -- do niższych warunków nie doszło.
    when e.weto_utrzymane then 'weto_utrzymane'

    -- Proces jeszcze się nie zamknął albo Sejm go nie uchwalił.
    when p.passed is not true then null

    -- Dowód najmocniejszy: akt jest w rejestrze.
    when p.isap_url is not null or p.eli_address is not null then 'opublikowany'

    -- Podpis jest faktem późniejszym niż weto i niż skierowanie do Trybunału.
    when e.ma_podpis then 'podpisany'

    -- Rejestr mówi wprost, co Prezydent zrobił.
    when e.ma_trybunal then 'trybunal'
    when e.ma_weto     then 'weto'

    -- FAKT Z REJESTRU — nad progiem czasowym (migracja 0022).
    when e.ma_do_prezydenta then 'u_prezydenta'

    -- Świeżo uchwalone, bez żadnego etapu prezydenckiego. Próg chroni gałąź
    -- niżej, która twierdzi, że czegoś w rejestrze nie ma.
    when p.closure_date >= current_date - interval '90 days' then 'oczekuje'

    else 'bez_etapu_prezydenckiego'
  end as los

from legislative_processes p
left join lateral (
  select
    bool_or(s.stage_type = 'PresidentToTribunal')          as ma_trybunal,
    bool_or(s.stage_type = 'Veto')                         as ma_weto,
    bool_or(s.stage_type = 'PresidentSignature')           as ma_podpis,
    bool_or(s.stage_type = 'PresidentMotionConsideration') as ma_rozpatrzenie_wniosku,
    bool_or(s.stage_type = 'ToPresident')                  as ma_do_prezydenta,

    -- Kontrakt ze słowem rejestru, co do znaku — tak samo jak przy nagłówku
    -- eksportu SUDOP (D15). Gdyby Sejm zmienił to sformułowanie, przestaniemy
    -- dopasowywać i kubełek `weto_utrzymane` opustoszeje; importer raportuje
    -- nieznane wartości `decision`, żeby nie stało się to po cichu.
    bool_or(s.stage_type = 'PresidentMotionConsideration'
            and s.decision = 'nie uchwalona ponownie')     as weto_utrzymane
  from process_stages s
  where s.print_number = p.print_number
) e on true;

alter view proces_los set (security_invoker = on);
grant select on proces_los to anon, authenticated;

comment on view proces_los is
  'Co sie stalo z procesem. Kolejnosc: slowo rejestru o utrzymanym wecie > passed > link do aktu > podpis > Trybunal > weto > przekazanie do Prezydenta > swiezosc 90 dni. Nigdy nie zgadujemy, dlaczego Prezydent nie podpisal ani dlaczego Sejm nie odrzucil weta.';

-- ---------------------------------------------------------------------
-- Widok dla interfejsu — definicja bez zmian.
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
-- KONTROLA KONTRAKTU
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
-- Kontrole sensu z migracji 0020-0022 — maja obowiazywac dalej.
-- ---------------------------------------------------------------------
do $$
declare bledne int;
begin
  select count(*) into bledne from proces_los where ma_podpis and los = 'weto';
  if bledne > 0 then
    raise exception 'U % procesow podpis Prezydenta jest opisany jako weto.', bledne;
  end if;

  select count(*) into bledne from proces_los
   where los = 'u_prezydenta' and (ma_podpis or ma_weto or ma_trybunal);
  if bledne > 0 then
    raise exception 'U % procesow los to u_prezydenta, mimo ze rejestr zna rozstrzygniecie.', bledne;
  end if;

  select count(*) into bledne from proces_los
   where los = 'bez_etapu_prezydenckiego' and ma_do_prezydenta;
  if bledne > 0 then
    raise exception 'U % procesow los to bez_etapu_prezydenckiego, mimo etapu ToPresident.', bledne;
  end if;

  select count(*) into bledne from proces_los
   where los = 'oczekuje' and (ma_do_prezydenta or ma_podpis or ma_weto or ma_trybunal);
  if bledne > 0 then
    raise exception 'U % procesow los to oczekuje, mimo etapu prezydenckiego.', bledne;
  end if;

  select count(*) into bledne from proces_los where passed and los is null;
  if bledne > 0 then
    raise exception '% uchwalonych procesow nie dostalo zadnego losu.', bledne;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Kontrola NOWA 1: `weto_utrzymane` musi miec w etapach weto.
-- Slowo „nie uchwalona ponownie" bez wczesniejszego weta znaczyloby, ze
-- zle odczytalismy, czego dotyczy ponowne glosowanie.
-- ---------------------------------------------------------------------
do $$
declare bledne int;
begin
  select count(*) into bledne from proces_los where los = 'weto_utrzymane' and not coalesce(ma_weto, false);
  if bledne > 0 then
    raise exception 'U % procesow los to weto_utrzymane, ale rejestr nie ma dla nich etapu Veto.', bledne;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Kontrola NOWA 2: kontrakt ze slowem rejestru zyje.
--
-- Etykieta stoi na dokladnym brzmieniu 'nie uchwalona ponownie'. Gdyby Sejm
-- zmienil to sformulowanie, dopasowanie przestaloby dzialac PO CICHU —
-- kubelek opustoszalby i nikt by nie zauwazyl. Zmierzone 11.09.2026: 15.
-- ---------------------------------------------------------------------
do $$
declare ile int;
begin
  select count(*) into ile from proces_los where los = 'weto_utrzymane';
  if ile = 0 then
    raise exception
      'Zaden proces nie pasuje do decision = ''nie uchwalona ponownie''. '
      'Albo rejestr zmienil brzmienie, albo import nie wypelnia pola decision. '
      'Sprawdz: select distinct decision from process_stages where stage_type = ''PresidentMotionConsideration'';';
  end if;
end $$;

-- =====================================================================
-- WYNIK. Oczekiwane wzgledem 0022: weto 57 -> 48, (Sejm nie uchwalil)
-- 601 -> 595, nowy kubelek weto_utrzymane = 15.
-- =====================================================================
select
  coalesce(los, '(brak losu — Sejm nie uchwalil)') as los,
  count(*)                                         as procesow,
  count(*) filter (where passed)                   as w_tym_passed_true,
  min(closure_date)                                as najstarszy,
  max(closure_date)                                as najnowszy
from proces_los
group by 1
order by procesow desc;
