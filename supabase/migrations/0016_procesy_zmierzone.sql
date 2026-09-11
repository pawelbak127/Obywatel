-- =====================================================================
-- Obywatel 2.0 — migracja 0016: procesy legislacyjne wg ZMIERZONEGO API
--
-- Tabele `legislative_processes` i `process_stages` powstaly w migracji 0001
-- na podstawie rekonesansu i nigdy nie zostaly zapelnione. Sondy 30 i 31
-- porownaly je z tym, co endpoint naprawde zwraca. Wynik jest lepszy, niz sie
-- spodziewalem — i ma dwie dziury.
--
-- ZGADZA SIE (nazwa w nazwe): number, title, titleFinal, description,
-- documentType, processStartDate, closureDate, passed, urgencyStatus, ELI,
-- links[rel=isap]. Numery procesow to same cyfry, wiec lacza sie WPROST
-- z `votings.print_numbers`.
--
-- DZIURA 1 — kolumna bez zrodla. `rcl_url` nie wystepuje w odpowiedzi API
-- w zadnej postaci. Wymyslilem ja pietnascie migracji temu. Kolumna, ktorej
-- nikt nigdy nie wypelni, to zaproszenie do wypelnienia jej czyms zmyslonym.
-- Usuwamy.
--
-- DZIURA 2 — brak `printsConsideredJointly`. Wystepuje w 9 z 40 procesow probki,
-- a proces 34 jest rozpatrywany lacznie z siedemnastoma innymi. Glosowanie
-- moze cytowac druk 2, gdy proces ma numer 1 — bez tej kolumny czesc powiazan
-- glosowanie–proces po prostu zginie i nikt tego nie zauwazy.
--
-- ETAPY — struktura jest bogatsza, niz zakladalem:
--   * drzewo o glebokosci 2 (zmierzone: 153 etapy poziomu 1, 68 poziomu 2),
--   * `decision` (6 wartosci), `committeeCode`, `sittingNum`,
--   * a w etapach typu Voting siedzi PELNY obiekt glosowania z polami
--     `sitting` i `votingNumber` — czyli dokladnie kluczem
--     `votings (term, sitting, voting_number)`, ktory mamy w bazie.
--
-- To ostatnie jest najwazniejsza rzecza w calym Sprincie 4: etap procesu
-- laczy sie z konkretnym glosowaniem imiennym bez zgadywania i bez parsowania
-- tytulow. Lancuch "obietnica -> ustawa -> glos posla" ma komplet ogniw.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Procesy
-- ---------------------------------------------------------------------
alter table legislative_processes drop column if exists rcl_url;

alter table legislative_processes
  add column if not exists prints_jointly           text[],
  add column if not exists ue                       text,
  add column if not exists shorten_procedure        boolean,
  add column if not exists document_type_enum       text,
  add column if not exists legislative_committee    boolean,
  add column if not exists principle_of_subsidiarity boolean,
  add column if not exists comments                 text,
  add column if not exists change_date              timestamptz;

comment on column legislative_processes.prints_jointly is
  'printsConsideredJointly — druki rozpatrywane lacznie. Bez tego glosowanie cytujace druk 2 nie polaczy sie z procesem nr 1.';
comment on column legislative_processes.document_type_enum is
  'documentTypeEnum — wystepuje tylko w 26% rekordow. Do filtrowania uzywaj documentType (100%).';

-- Wyszukiwanie procesow po druku rozpatrywanym lacznie.
create index if not exists processes_jointly_idx on legislative_processes using gin (prints_jointly);
create index if not exists processes_closure_idx on legislative_processes (closure_date desc nulls last);

-- ---------------------------------------------------------------------
-- 2. Etapy
-- ---------------------------------------------------------------------
alter table process_stages
  add column if not exists depth          smallint not null default 1,
  add column if not exists decision       text,
  add column if not exists committee_code text,
  add column if not exists sitting_num    smallint,
  -- Surowe wspolrzedne glosowania z API. Trzymamy je OBOK `voting_id`, a nie
  -- zamiast: jesli glosowanie nie jest jeszcze zaimportowane, powiazanie
  -- bedzie puste, ale bedzie widac, ze powinno istniec. Inaczej roznica miedzy
  -- "etap nie ma glosowania" a "nie umielismy go dopasowac" znika bez sladu.
  add column if not exists voting_sitting smallint,
  add column if not exists voting_number  smallint;

comment on column process_stages.depth is
  'Poziom w drzewie etapow: 1 = etap glowny, 2 = podetap z "children". Zmierzona maksymalna glebokosc to 2.';
comment on column process_stages.voting_sitting is
  'Surowe (sitting, voting_number) z API. voting_id moze byc puste, gdy glosowania jeszcze nie ma w bazie — te kolumny pokazuja, ze powiazanie istnieje po stronie Sejmu.';

create index if not exists stages_voting_idx on process_stages (voting_id) where voting_id is not null;
create index if not exists stages_type_idx on process_stages (stage_type);

-- ---------------------------------------------------------------------
-- 3. Widok: glosowanie razem z procesem, ktorego dotyczy
--
--    Laczymy na dwa sposoby, bo zaden pojedynczy nie wystarcza:
--      a) przez etap procesu, ktory NIESIE identyfikator glosowania — pewne,
--      b) przez `votings.print_numbers` wyluskane z tytulu — szersze, ale
--         obarczone bledem parsowania.
--    Kolumna `pewnosc_powiazania` mowi wprost, ktory to przypadek. Czytelnik
--    dostanie inny komunikat przy "wiemy z rejestru" niz przy "wynika z tytulu".
-- ---------------------------------------------------------------------
create or replace view glosowanie_z_procesem as
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
  'etap procesu'::text as pewnosc_powiazania
from votings v
join process_stages s on s.voting_id = v.id
join legislative_processes p on p.print_number = s.print_number

union

select
  v.id, v.sitting, v.voting_number, v.voted_at, v.title,
  p.print_number, p.title, p.title_final, p.document_type, p.passed, p.closure_date,
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
  'Glosowanie + proces legislacyjny. pewnosc_powiazania rozroznia powiazanie z rejestru od wyluskanego z tytulu — na stronie te dwa przypadki musza byc opisane inaczej.';

-- ---------------------------------------------------------------------
-- 4. Samosprawdzenie
-- ---------------------------------------------------------------------
do $$
declare
  wymagane text[] := array['prints_jointly','ue','shorten_procedure','document_type_enum',
                           'legislative_committee','principle_of_subsidiarity','comments','change_date'];
  brakujace text;
begin
  select string_agg(k, ', ') into brakujace from unnest(wymagane) k
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema='public' and c.table_name='legislative_processes' and c.column_name=k
  );
  if brakujace is not null then
    raise exception 'legislative_processes nie ma kolumn: %', brakujace;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='legislative_processes' and column_name='rcl_url'
  ) then
    raise exception 'Kolumna rcl_url nadal istnieje — usuniecie sie nie powiodlo.';
  end if;

  select string_agg(k, ', ') into brakujace
  from unnest(array['depth','decision','committee_code','sitting_num','voting_sitting','voting_number']) k
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema='public' and c.table_name='process_stages' and c.column_name=k
  );
  if brakujace is not null then
    raise exception 'process_stages nie ma kolumn: %', brakujace;
  end if;

  raise notice 'Schemat procesow zgodny ze zmierzonym API (sondy 30 i 31).';
end $$;
