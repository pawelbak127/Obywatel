-- =====================================================================
-- Obywatel 2.0 — migracja 0025: niezmienniki, których zabrakło w 0024
--
-- WIDOK NIE ZMIENIA SIĘ ANI O JEDNO WYRAŻENIE. Definicja `proces_los` jest
-- przepisana z 0024 znak w znak. Migracja dokłada wyłącznie BLOKI KONTROLNE.
--
-- Dlaczego mimo to odtwarzamy widok, zamiast wykonać same bloki: w tym
-- projekcie bloki kontrolne żyją razem z definicją widoku i są przenoszone
-- do każdej kolejnej migracji, która go dotyka (0020 → 0022 → 0024). Blok
-- zapisany osobno, bez widoku obok, zostałby przy następnej zmianie pominięty
-- — bo nikt by go tam nie szukał. Ta migracja staje się więc kanoniczną
-- definicją do skopiowania przy 0026.
--
-- ---------------------------------------------------------------------
-- CZEGO ZABRAKŁO W 0024 (ustalenie recenzji).
--
-- Gałąź `weto_utrzymane` stoi NAD `opublikowany` i NAD `ma_podpis`, więc jako
-- jedyna nie podlega doktrynie z 0022: „podpis jest faktem późniejszym niż
-- weto". Bloki przeniesione z 0020–0022 sprawdzają wyłącznie `los = 'weto'`,
-- a blok z 0024 pilnuje tylko obecności etapu `Veto`.
--
-- Dziś nic z tego nie wynika — zmierzone: 0 z 15 procesów ma adres aktu,
-- podpis albo Trybunał. Ale gdyby taki wiersz powstał, skutek nie byłby
-- subtelny: `adresAktu()` w interfejsie zadziałałby i etykieta
-- „weto Prezydenta utrzymane" stałaby się LINKIEM DO OPUBLIKOWANEGO AKTU.
--
-- ---------------------------------------------------------------------
-- CZEGO TA MIGRACJA ŚWIADOMIE NIE ROBI: nie przenosi `opublikowany` nad
-- `passed is not true`.
--
-- Recenzja zaproponowała to jako domknięcie tej samej asymetrii (druk 921:
-- proces z adresem aktu, ale bez `passed`, nie dostaje żadnego losu).
-- Sprawdziłem, co to za proces, ZANIM przestawiłem warunek:
--
--     druk 921   passed = false   eli MP/2025/55
--     „Poselski wniosek o wyrażenie wotum nieufności…"
--
-- To jest wniosek o wotum nieufności, którego Sejm NIE przyjął. Adres
-- w Monitorze Polskim wskazuje dokument O TEJ SPRAWIE, a nie akt, który
-- wszedł w życie. Przeniesienie `opublikowany` wyżej kazałoby nam napisać
-- przy odrzuconym wniosku „uchwalono i opublikowano" — czyli dokładnie ten
-- rodzaj nieprawdy, który naprawiały 0019 i 0024.
--
-- Obecność adresu NIE jest więc dowodem uchwalenia, gdy `passed` mówi „nie".
-- Kolejność zostaje. Prawdziwa usterka była węższa i siedzi w interfejsie:
-- napis „nie uchwalono" był opakowywany w LINK do tego adresu. Poprawione
-- w `src/app/posel/[slug]/page.tsx` — linkujemy wyłącznie wtedy, gdy etykieta
-- pochodzi z losu, a nie z gołej flagi.
-- =====================================================================

drop view if exists glosowanie_z_procesem;
drop view if exists proces_los;

create view proces_los as
select
  p.print_number,
  p.passed,
  p.closure_date,
  p.isap_url,
  p.eli_address,

  e.ma_weto,
  e.ma_trybunal,
  e.ma_podpis,
  e.ma_rozpatrzenie_wniosku,
  e.ma_do_prezydenta,
  e.weto_utrzymane,

  case
    -- Rejestr mówi słowami, że weto się utrzymało (0024).
    when e.weto_utrzymane then 'weto_utrzymane'

    -- Proces jeszcze się nie zamknął albo Sejm go nie uchwalił.
    -- ZOSTAJE nad `opublikowany` — patrz nagłówek, druk 921.
    when p.passed is not true then null

    -- Dowód najmocniejszy: akt jest w rejestrze.
    when p.isap_url is not null or p.eli_address is not null then 'opublikowany'

    -- Podpis jest faktem późniejszym niż weto i niż Trybunał (0020).
    when e.ma_podpis then 'podpisany'

    when e.ma_trybunal then 'trybunal'
    when e.ma_weto     then 'weto'

    -- Fakt z rejestru nad progiem czasowym (0022).
    when e.ma_do_prezydenta then 'u_prezydenta'

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
    bool_or(s.stage_type = 'PresidentMotionConsideration'
            and s.decision = 'nie uchwalona ponownie')     as weto_utrzymane
  from process_stages s
  where s.print_number = p.print_number
) e on true;

alter view proces_los set (security_invoker = on);
grant select on proces_los to anon, authenticated;

comment on view proces_los is
  'Co sie stalo z procesem. Kolejnosc: slowo rejestru o utrzymanym wecie > passed > link do aktu > podpis > Trybunal > weto > przekazanie do Prezydenta > swiezosc 90 dni. Adres aktu przy passed = false NIE jest dowodem uchwalenia (druk 921).';

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
-- NIEZMIENNIKI KOLEJNOSCI. Kazdy z nich lamie sie przy przestawieniu
-- warunkow w CASE — i o to chodzi.
-- ---------------------------------------------------------------------
do $$
declare bledne int;
begin
  -- 0020: podpis jest faktem pozniejszym niz weto
  select count(*) into bledne from proces_los where ma_podpis and los = 'weto';
  if bledne > 0 then
    raise exception 'U % procesow podpis Prezydenta jest opisany jako weto.', bledne;
  end if;

  -- 0021: u_prezydenta znaczy „przekazano i cisza"
  select count(*) into bledne from proces_los
   where los = 'u_prezydenta' and (ma_podpis or ma_weto or ma_trybunal);
  if bledne > 0 then
    raise exception 'U % procesow los to u_prezydenta, mimo ze rejestr zna rozstrzygniecie.', bledne;
  end if;

  -- 0021: bez_etapu_prezydenckiego znaczy „rejestr nie odnotowal przekazania"
  select count(*) into bledne from proces_los
   where los = 'bez_etapu_prezydenckiego' and ma_do_prezydenta;
  if bledne > 0 then
    raise exception 'U % procesow los to bez_etapu_prezydenckiego, mimo etapu ToPresident.', bledne;
  end if;

  -- 0022: slownik LOS_OPIS twierdzi przy `oczekuje`, ze nie ma ZADNEGO etapu
  select count(*) into bledne from proces_los
   where los = 'oczekuje' and (ma_do_prezydenta or ma_podpis or ma_weto or ma_trybunal);
  if bledne > 0 then
    raise exception 'U % procesow los to oczekuje, mimo etapu prezydenckiego.', bledne;
  end if;

  -- 0024: weto_utrzymane musi miec w etapach weto
  select count(*) into bledne from proces_los
   where los = 'weto_utrzymane' and not coalesce(ma_weto, false);
  if bledne > 0 then
    raise exception 'U % procesow los to weto_utrzymane bez etapu Veto.', bledne;
  end if;

  -- 0022: CASE ma byc wyczerpujacy dla kazdego uchwalonego procesu
  select count(*) into bledne from proces_los where passed and los is null;
  if bledne > 0 then
    raise exception '% uchwalonych procesow nie dostalo zadnego losu.', bledne;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- NIEZMIENNIK NOWY — to jest powod istnienia tej migracji.
--
-- `weto_utrzymane` stoi na szczycie CASE, wiec jako jedyny los moze przyslonic
-- adres aktu, podpis albo Trybunal. Gdyby taki wiersz powstal, interfejs
-- zrobilby z etykiety „weto Prezydenta utrzymane" LINK DO AKTU, ktory rzekomo
-- nie wszedl w zycie.
--
-- Jesli ten blok kiedys sie wywali, NIE jest oczywiste, ze winna jest kolejnosc.
-- Moze tez znaczyc, ze rejestr dopuszcza sytuacje, ktorej nie przewidzielismy:
-- ustawe nieuchwalona ponownie, a mimo to opublikowana. Wtedy trzeba
-- ROZSTRZYGNAC, co jest prawda, a nie przestawiac warunki do skutku.
-- ---------------------------------------------------------------------
do $$
declare bledne int; druki text;
begin
  select count(*), string_agg(print_number, ', ' order by print_number)
    into bledne, druki
  from proces_los
  where los = 'weto_utrzymane'
    and (isap_url is not null or eli_address is not null
         or coalesce(ma_podpis, false) or coalesce(ma_trybunal, false));
  if bledne > 0 then
    raise exception
      'U % procesow los to weto_utrzymane, ale rejestr ma dla nich adres aktu, '
      'podpis albo Trybunal. Druki: %. Rozstrzygnij, co jest prawda — '
      'nie przestawiaj warunkow do skutku.', bledne, druki;
  end if;
end $$;

-- =====================================================================
-- WYNIK — rozklad ma byc IDENTYCZNY jak po 0024. Ta migracja niczego nie
-- przelicza; jesli ktorakolwiek liczba sie rozjedzie, znaczy to, ze widok
-- zostal przepisany z bledem.
--
-- Oczekiwane: opublikowany 770, (brak losu) 595, bez_etapu_prezydenckiego 184,
-- weto 48, oczekuje 32, weto_utrzymane 15, trybunal 10, u_prezydenta 7,
-- podpisany 1.
-- =====================================================================
select
  coalesce(los, '(brak losu)') as los,
  count(*)                     as procesow
from proces_los
group by 1
order by procesow desc;
