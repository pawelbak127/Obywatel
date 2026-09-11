-- =====================================================================
-- Obywatel 2.0 — migracja 0017: proces w widoku niesie link do aktu
--
-- POWOD. Na profilu posla pod glosowaniem stoi teraz zdanie:
--
--     "projekt ustawy nr 2600: o zmianie ustawy o ochotniczych strazach
--      pozarnych · uchwalono"
--
-- i NIE MA przy nim zadnego odnosnika. To lamie decyzje D1, ktora jest
-- fundamentem calego projektu: kazda informacja ma prowadzic do oficjalnego
-- rejestru. Glosowanie ma link do protokolu PDF, obecnosc ma link do profilu
-- w Sejm API, a slowo "uchwalono" — czyli zdanie o skutku prawnym — nie ma nic.
--
-- Adresy sa w bazie od migracji 0016 (`isap_url`, `eli_address`), po prostu
-- nie przechodzily przez widok. To jest dokladnie ten rodzaj przeoczenia,
-- ktory zamienia zasade w deklaracje.
-- =====================================================================

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
  'etap procesu'::text as pewnosc_powiazania
from votings v
join process_stages s on s.voting_id = v.id
join legislative_processes p on p.print_number = s.print_number

union

select
  v.id, v.sitting, v.voting_number, v.voted_at, v.title,
  p.print_number, p.title, p.title_final, p.document_type, p.passed, p.closure_date,
  p.isap_url, p.eli_address,
  'numer druku z tytulu'::text
from votings v
join legislative_processes p on p.print_number = any (v.print_numbers)
where not exists (
  select 1 from process_stages s2
  where s2.voting_id = v.id and s2.print_number = p.print_number
);

alter view glosowanie_z_procesem set (security_invoker = on);
grant select on glosowanie_z_procesem to anon, authenticated;

comment on view glosowanie_z_procesem is
  'Glosowanie + proces + LINK DO AKTU. pewnosc_powiazania rozroznia powiazanie z rejestru od wyluskanego z tytulu.';

-- ---------------------------------------------------------------------
-- Kontrola kontraktu — lista identyczna z zapytaniem w src/lib/queries.ts
-- ---------------------------------------------------------------------
do $$
declare
  wymagane text[] := array['voting_id','print_number','process_title','title_final',
    'document_type','passed','closure_date','isap_url','eli_address','pewnosc_powiazania'];
  brakujace text;
  bez_linku int;
  razem int;
begin
  select string_agg(k, ', ') into brakujace from unnest(wymagane) k
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema='public' and c.table_name='glosowanie_z_procesem' and c.column_name=k
  );
  if brakujace is not null then
    raise exception 'Widok glosowanie_z_procesem nie wystawia kolumn: %', brakujace;
  end if;

  -- Ile procesow zakonczonych NIE ma linku do aktu. Nie przerywamy: nie kazdy
  -- proces konczy sie publikacja (wnioski, informacje, listy kandydatow).
  -- Ale liczba ma byc widoczna, bo od niej zalezy, ile razy interfejs napisze
  -- "uchwalono" bez mozliwosci sprawdzenia.
  select count(*) into razem from legislative_processes where passed;
  select count(*) into bez_linku from legislative_processes
   where passed and isap_url is null and eli_address is null;

  raise notice 'Kontrakt widoku spelniony. Procesow uchwalonych: %, w tym bez linku do aktu: %.', razem, bez_linku;
end $$;
