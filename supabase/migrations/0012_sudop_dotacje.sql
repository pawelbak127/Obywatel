-- =====================================================================
-- Obywatel 2.0 — migracja 0012: dotacje z SUDOP
--
-- POWOD. Prawdziwy eksport CSV z wyszukiwarki UOKiK obalil wniosek, ktory
-- zapisalem w docs/sudop.md 3a. Twierdzilem, ze "lokalizacji w wyniku NIE MA",
-- bo takich naglowkow nie bylo widac na stronie wynikow. Plik ma 14 kolumn,
-- a nie 6 widocznych na ekranie, i wsrod nich:
--     "Identyfikator terytorialny siedziby beneficjenta" = 0264011
-- czyli kod TERYT gminy, w tym samym formacie co slownik `gmina-siedziby`
-- z API (4 170 pozycji, dziala). Modul lokalny jest wiec wykonalny — nie przez
-- filtrowanie po stronie UOKiK, tylko po naszej.
--
-- To byla piata pomylka tego samego typu w tym projekcie: wniosek z wygladu
-- interfejsu zamiast z bajtow. Stad ksztalt tej tabeli: `row_sha256` jako
-- klucz deduplikacji, bo dane beda przychodzic kawalkami z wielu eksportow,
-- i `nip_valid`, bo NIP jest jedynym identyfikatorem, po ktorym wolno nam
-- cokolwiek laczyc.
--
-- ROZMIAR. Pomiar z probki: 14 pol, srednio ~230 B tekstu na wiersz.
-- Przy 200 000 wierszy to ~55 MB. Baza ma dzis 136 MB przy limicie 500 MB,
-- wiec miesci sie z zapasem, ale to jest granica dla tego modulu — przy
-- imporcie calego kraju trzeba bedzie zwezic teksty do slownikow.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Nowy rodzaj zrodla
--    Plik pobrany recznie z wyszukiwarki webowej to NIE jest `sudop_api`.
--    Rozroznienie jest istotne przy republikacji: przy pliku podajemy date
--    pobrania przez czlowieka, nie date odpytania API.
--    (osobna kwerenda — PostgreSQL nie pozwala uzyc swiezo dodanej wartosci
--     enuma w tej samej transakcji, w ktorej zostala dodana)
-- ---------------------------------------------------------------------
alter type source_kind add value if not exists 'sudop_csv';

-- ---------------------------------------------------------------------
-- 2. Slownik gmin (TERYT)
--    Z dzialajacego endpointu /sudop-api/slownik/gmina-siedziby.
--    Bez niego kod 0264011 w interfejsie jest tylko siedmioma cyframi.
-- ---------------------------------------------------------------------
create table if not exists sudop_gminy (
  teryt      char(7) primary key check (teryt ~ '^\d{7}$'),
  nazwa      text not null,
  source_id  uuid not null references sources(id),
  updated_at timestamptz not null default now()
);

alter table sudop_gminy enable row level security;
drop policy if exists "public read gminy" on sudop_gminy;
create policy "public read gminy" on sudop_gminy for select using (true);
grant select on sudop_gminy to anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Dotacje
-- ---------------------------------------------------------------------
create table if not exists subsidies (
  id bigserial primary key,

  -- Beneficjent
  beneficiary_name text not null check (length(trim(beneficiary_name)) > 0),
  beneficiary_nip  char(10),
  -- Suma kontrolna NIP-u policzona przy imporcie. NIE jest to CHECK na kolumnie:
  -- rejestr moze zawierac bledny NIP i mamy obowiazek pokazac to, co w nim jest.
  -- Ale zestawien po NIP-ie nie wolno budowac na wierszach z `false`.
  nip_valid        boolean not null default false,
  beneficiary_size text,
  -- CELOWO bez klucza obcego do sudop_gminy. Slownik z API zawiera gminy
  -- obowiazujace dzis, a dotacje siegaja 2007 roku — kod gminy, ktora zostala
  -- polaczona z inna, nie ma prawa wywrocic importu prawdziwego wiersza
  -- z rejestru. Nieznane kody raportujemy w logu i zostawiamy bez nazwy.
  teryt            char(7) check (teryt ~ '^\d{7}$'),
  pkd              text,

  -- Kto dal i na jakiej podstawie
  grantor_name   text not null check (length(trim(grantor_name)) > 0),
  legal_basis    text,
  measure_number text,

  granted_on date not null,

  -- Kwoty. numeric, nie float — to sa pieniadze publiczne w tekscie obok nazwiska.
  value_nominal_pln numeric(16,2),
  value_gross_pln   numeric(16,2),
  value_gross_eur   numeric(16,2),

  aid_form    text,
  aid_purpose text,

  -- Deduplikacja miedzy eksportami. Ten sam wiersz przyjdzie ponownie przy
  -- kazdym kolejnym pobraniu tego samego srodka pomocowego.
  row_sha256 char(64) not null unique,

  -- D1: fakt bez zrodla nie ma prawa istniec.
  source_id   uuid not null references sources(id),
  imported_at timestamptz not null default now()
);

-- Trzy pytania, ktore modul ma obslugiwac, to trzy indeksy.
create index if not exists subsidies_teryt_idx   on subsidies (teryt, granted_on desc);
create index if not exists subsidies_nip_idx     on subsidies (beneficiary_nip) where nip_valid;
create index if not exists subsidies_measure_idx on subsidies (measure_number);

alter table subsidies enable row level security;
drop policy if exists "public read subsidies" on subsidies;
create policy "public read subsidies" on subsidies for select using (true);
grant select on subsidies to anon, authenticated;

comment on column subsidies.nip_valid is
  'Suma kontrolna NIP zgodna. Laczenie dotacji z jakimkolwiek innym rejestrem WYLACZNIE po wierszach z true.';
comment on column subsidies.row_sha256 is
  'SHA-256 z przycietych pol wiersza CSV. Klucz deduplikacji miedzy eksportami.';

-- ---------------------------------------------------------------------
-- 4. Widok dla frontendu — dotacja zawsze z nazwa gminy i linkiem do zrodla
-- ---------------------------------------------------------------------
create or replace view dotacje_publiczne as
select
  s.id,
  s.beneficiary_name,
  case when s.nip_valid then s.beneficiary_nip end as beneficiary_nip,
  s.beneficiary_size,
  s.teryt,
  g.nazwa as gmina,
  s.pkd,
  s.grantor_name,
  s.legal_basis,
  s.measure_number,
  s.granted_on,
  s.value_nominal_pln,
  s.value_gross_pln,
  s.value_gross_eur,
  s.aid_form,
  s.aid_purpose,
  src.url          as zrodlo_url,
  src.retrieved_at as zrodlo_pobrano
from subsidies s
join sources src on src.id = s.source_id
left join sudop_gminy g on g.teryt = s.teryt;

-- Bez tego widok czyta tabele z uprawnieniami wlasciciela i polityki RLS
-- nizej nigdy nie sa sprawdzane (ta sama pulapka co przy public_ai_contents w 0002).
alter view dotacje_publiczne set (security_invoker = on);
grant select on dotacje_publiczne to anon, authenticated;

comment on view dotacje_publiczne is
  'Widok dla frontendu. NIP wystawiany tylko przy poprawnej sumie kontrolnej; kazdy wiersz niesie URL zrodla i date pobrania (wymog UOKiK przy republikacji).';

-- ---------------------------------------------------------------------
-- 5. Samosprawdzenie kontraktu (wzorzec z 0011)
-- ---------------------------------------------------------------------
do $$
declare
  wymagane text[] := array['id','beneficiary_name','beneficiary_nip','beneficiary_size','teryt',
    'gmina','pkd','grantor_name','legal_basis','measure_number','granted_on','value_nominal_pln',
    'value_gross_pln','value_gross_eur','aid_form','aid_purpose','zrodlo_url','zrodlo_pobrano'];
  brakujace text;
begin
  select string_agg(k, ', ') into brakujace from unnest(wymagane) k
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'dotacje_publiczne' and c.column_name = k
  );
  if brakujace is not null then
    raise exception 'Widok dotacje_publiczne nie wystawia kolumn: %', brakujace;
  end if;
  raise notice 'Kontrakt widoku dotacje_publiczne spelniony — % kolumn.', array_length(wymagane, 1);
end $$;
