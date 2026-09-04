-- =====================================================================
-- Obywatel 2.0 - schemat bazy, wersja 0.2
-- Zmiany wzgledem 0.1 wynikaja z POMIARU, nie z przeczucia.
--
-- Pomiary z tury 2 (posiedzenia 59-63, kadencja X):
--   ~64,8 glosowania na posiedzenie x 64 posiedzenia  = ~4 150 glosowan
--   460 glosow imiennych na glosowanie                 = ~1 900 000 wierszy
--   ~44 KB JSON na glosowanie                          = ~177 MB surowych danych
--
-- Darmowy plan Supabase to rzad 500 MB. Wersja 0.1 tego nie miescila:
--   votes w 0.1 : bigint+int+text+enum -> ~56 B/wiersz -> ~106 MB + 98 MB indeksow
--   sources.raw_snapshot jsonb          -> +177 MB
--   RAZEM ~380 MB samych danych glosowan. Za ciasno, zeby cokolwiek dolozyc.
--
-- Wersja 0.2 robi dwie rzeczy:
--   1. Zwezenie typow w tabeli votes  -> ~40 B/wiersz -> ~76 MB + ~38 MB indeksu
--   2. Snapshoty surowych odpowiedzi ida do R2, nie do Postgresa
--   RAZEM ~115 MB. Miesci sie z zapasem na obietnice, tresci AI i indeksy.
-- =====================================================================

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- ---------------------------------------------------------------------
-- 0. REJESTR ZRODEL
-- ---------------------------------------------------------------------
create type source_kind as enum ('sejm_api','eli_api','sudop_api','dane_gov','gus_bdl',
                                 'sejm_pdf','sejm_nsf','video','press','user_submission');

create table sources (
  id             uuid primary key default gen_random_uuid(),
  kind           source_kind not null,
  -- Link do OFICJALNEGO rejestru - to on idzie na frontend przy kazdej liczbie.
  -- Dla glosowan mamy gotowca z API: links[rel=pdf], np.
  --   https://api.sejm.gov.pl/sejm/term10/votings/63/1/pdf
  url            text not null check (url ~ '^https?://'),
  api_endpoint   text,
  retrieved_at   timestamptz not null default now(),   -- wymog UOKiK przy republikacji
  payload_sha256 char(64),                             -- jedyny mechanizm delty, jaki mamy
  http_status    smallint,
  -- ZMIANA 0.2: surowa odpowiedz NIE trafia do Postgresa. Ladunek idzie do R2,
  -- tu zostaje tylko wskaznik. Bez tego 177 MB JSON-a zjada cala darmowa baze.
  snapshot_url   text,
  created_at     timestamptz not null default now()
);
create index on sources (kind, retrieved_at desc);
create unique index on sources (url, payload_sha256) where payload_sha256 is not null;

-- Kursor importu przyrostowego.
-- Pomiar potwierdzil, ze /votings/search?dateFrom=YYYY-MM-DD DZIALA, a ELI przyjmuje
-- /changes/acts?since=YYYY-MM-DDTHH:mm:ss (bez 'Z'!). Dzieki temu po backfillu
-- nocny cron robi kilkanascie zapytan zamiast 4200.
create table sync_state (
  job        text primary key,          -- 'votings' | 'mps' | 'eli' | 'sudop'
  cursor_at  timestamptz,               -- ostatni przetworzony moment
  cursor_num int,                       -- ostatnie posiedzenie / strona
  last_run   timestamptz,
  last_error text
);

-- ---------------------------------------------------------------------
-- 1. PODMIOTY
-- ---------------------------------------------------------------------
-- ZMIANA 0.2: klucz zastepczy `seq`, zeby w tabeli votes trzymac 2 bajty
-- zamiast tekstu. Przy 1,9 mln wierszy to ~19 MB roznicy.
create table clubs (
  seq           smallserial primary key,
  id            text not null unique,      -- kod z Sejm API: 'PiS', 'KO', 'PSL-TD'
  name          text not null,
  phone         text,
  fax           text,
  email         text,
  members_count smallint,
  logo_url      text,
  source_id     uuid not null references sources(id),
  updated_at    timestamptz not null default now()
);

create table mps (
  id                  smallint primary key,     -- MP.id z API; zmierzone max 499
  term                smallint not null default 10,
  first_name          text not null,
  second_name         text,                     -- wypelnione w 66% rekordow
  last_name           text not null,
  full_name           text generated always as (first_name || ' ' || last_name) stored,
  slug                text not null unique,
  club_seq            smallint references clubs(seq),
  district_num        smallint,
  district_name       text,
  voivodeship         text,
  profession          text,
  education_level     text,
  birth_date          date,
  birth_location      text,
  number_of_votes     int,
  oath_date           date,                     -- ZMIANA 0.2: jest w API, przydatne
  mandate_expiry_date date,                     -- ZMIANA 0.2: wypelnione w 8%
  waiver_desc         text,                     -- ZMIANA 0.2: powod wygasniecia mandatu
  active              boolean not null default true,
  inactive_cause      text,
  photo_url           text,
  nsf_id              text,                     -- ZMIANA 0.2: id z serwisu NSF (oswiadczenia)
  source_id           uuid not null references sources(id),
  first_seen_at       timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index on mps (club_seq) where active;
create index mps_name_trgm on mps using gin (full_name gin_trgm_ops);
comment on table mps is '499 rekordow w kadencji X, w tym 460 aktywnych';

-- ---------------------------------------------------------------------
-- 2. GLOSOWANIA
-- ---------------------------------------------------------------------
-- Zmierzone wartosci pola `vote`: YES, NO, ABSTAIN, ABSENT.
-- Uwaga: nieobecnosc jest wartoscia glosu, nie brakiem wiersza.
create type vote_value as enum ('YES','NO','ABSTAIN','ABSENT','VOTE_VALID','VOTE_INVALID');

create table votings (
  id                int generated by default as identity primary key,  -- ~4150 rekordow
  term              smallint not null,
  sitting           smallint not null,
  sitting_day       smallint,
  voting_number     smallint not null,
  voted_at          timestamptz not null,
  title             text not null,
  topic             text,
  description       text,
  kind              text,                   -- ELECTRONIC | ON_LIST | TRADITIONAL
  majority_type     text,                   -- SIMPLE_MAJORITY | …
  majority_votes    smallint,
  yes               smallint not null default 0,
  no                smallint not null default 0,
  abstain           smallint not null default 0,
  not_participating smallint not null default 0,
  total_voted       smallint not null default 0,
  -- ZMIANA 0.2: oficjalny PDF glosowania z links[rel=pdf]. To jest nasz source.url.
  pdf_url           text,
  -- Numery drukow wyluskane z tytulu ("Glosowanie … dotyczace druku nr 2848").
  print_numbers     text[],
  eli_address       text,
  source_id         uuid not null references sources(id),
  unique (term, sitting, voting_number)
);
create index on votings (voted_at desc);
create index on votings using gin (print_numbers);

-- NAJWIEKSZA TABELA SYSTEMU: ~1,9 mln wierszy.
-- Kolejnosc kolumn celowa - Postgres wyrownuje pola do granic slowa,
-- wiec szerokie ida pierwsze. Bez tego dokladamy kilka bajtow na wiersz.
create table votes (
  voting_id int        not null references votings(id) on delete cascade,  -- 4 B
  mp_id     smallint   not null references mps(id),                        -- 2 B
  club_seq  smallint   references clubs(seq),   -- klub W MOMENCIE glosowania (jest w API!)
  value     vote_value not null,                                           -- 4 B
  primary key (voting_id, mp_id)
);
comment on table votes is
  '~1,9 mln wierszy/kadencje. ~40 B/wiersz -> ~76 MB + ~38 MB indeksu PK. '
  'NIE dodawac indeksu (mp_id, value) - kosztuje ~60 MB, a mp_stats i tak jest materializowany.';

-- ---------------------------------------------------------------------
-- 3. PROCES LEGISLACYJNY (nowe w 0.2 - odkryte przez sonde 13)
-- ELI zwraca prints[].linkProcessAPI -> /sejm/term10/processes/{nr},
-- a tam siedzi gotowa os czasu: 12 etapow z datami i typami.
-- To jest fundament "Osi Czasu Obietnic", ktorego w wersji 0.1 nie bylo.
-- ---------------------------------------------------------------------
create table legislative_processes (
  print_number   text primary key,       -- '2698'
  term           smallint not null,
  title          text not null,
  title_final    text,
  description    text,
  document_type  text,                   -- 'projekt ustawy'
  process_start  date,
  closure_date   date,
  passed         boolean,
  urgency_status text,
  eli_address    text,                   -- 'DU/2026/1123' - zlaczenie z ustawa
  isap_url       text,
  rcl_url        text,
  source_id      uuid not null references sources(id),
  updated_at     timestamptz not null default now()
);

create table process_stages (
  print_number text not null references legislative_processes(print_number) on delete cascade,
  ordinal      smallint not null,
  stage_date   date,
  stage_type   text,                     -- 'Start' | …
  stage_name   text not null,
  child_print  text,
  -- Jesli etap da sie powiazac z konkretnym glosowaniem - tu ladujemy klucz.
  voting_id    int references votings(id),
  primary key (print_number, ordinal)
);

-- ---------------------------------------------------------------------
-- 4. METRYKI - liczone nocnym cronem, nigdy na zywo
-- ---------------------------------------------------------------------
create materialized view mp_stats as
select
  m.id as mp_id,
  count(*)                                                         as votes_total,
  count(*) filter (where v.value <> 'ABSENT')                      as votes_cast,
  round(100.0 * count(*) filter (where v.value <> 'ABSENT') / nullif(count(*),0), 1) as attendance_pct,
  round(100.0 * count(*) filter (where v.value = cm.club_majority) /
        nullif(count(*) filter (where v.value <> 'ABSENT'),0), 1)   as loyalty_pct
from mps m
join votes v on v.mp_id = m.id
join lateral (
  select mode() within group (order by v2.value) as club_majority
  from votes v2
  where v2.voting_id = v.voting_id and v2.club_seq = v.club_seq and v2.value <> 'ABSENT'
) cm on true
group by m.id;
create unique index on mp_stats (mp_id);

-- ---------------------------------------------------------------------
-- 5. OBIETNICE
-- ---------------------------------------------------------------------
create type promise_status as enum ('pending','kept','broken','partial','disputed');

create table promises (
  id                  uuid primary key default gen_random_uuid(),
  mp_id               smallint references mps(id),
  club_seq            smallint references clubs(seq),
  title               text not null,
  quote               text not null,
  said_at             date not null,
  status              promise_status not null default 'pending',
  evidence_source_id  uuid not null references sources(id),   -- bez dowodu nie publikujemy
  verifying_voting_id int  references votings(id),
  verifying_print     text references legislative_processes(print_number),
  created_by          uuid,
  published           boolean not null default false,
  created_at          timestamptz not null default now(),
  constraint promise_needs_mp_or_club check (mp_id is not null or club_seq is not null)
);

create table promise_votes (
  promise_id uuid not null references promises(id) on delete cascade,
  user_id    uuid not null,
  verdict    promise_status not null,
  created_at timestamptz not null default now(),
  primary key (promise_id, user_id)
);

-- ---------------------------------------------------------------------
-- 6. TRESCI AI - metka wymuszona przez baze
-- ---------------------------------------------------------------------
create type ai_content_kind as enum ('act_summary','voting_explainer','glossary','promise_context');

create table ai_contents (
  id              uuid primary key default gen_random_uuid(),
  kind            ai_content_kind not null,
  voting_id       int  references votings(id) on delete cascade,
  eli_address     text,
  print_number    text references legislative_processes(print_number),
  promise_id      uuid references promises(id) on delete cascade,

  body_md         text not null,

  ai_generated    boolean not null default true check (ai_generated),
  ai_model        text not null,
  ai_prompt_ver   text not null,
  ai_generated_at timestamptz not null default now(),
  ai_disclaimer   text not null default
    'Podsumowanie wygenerowane przez sztuczną inteligencję na podstawie oficjalnego dokumentu źródłowego. Nie stanowi wykładni prawa ani porady prawnej.',
  source_id       uuid not null references sources(id),

  input_tokens      int,
  output_tokens     int,
  cost_usd          numeric(10,6),
  human_reviewed_by uuid,
  human_reviewed_at timestamptz,
  published         boolean not null default false,
  created_at        timestamptz not null default now(),

  constraint ai_content_has_target check (
    num_nonnulls(voting_id, eli_address, print_number, promise_id) = 1
  ),
  constraint ai_disclaimer_not_empty check (length(trim(ai_disclaimer)) > 20)
);
create index on ai_contents (kind, published);

create or replace function assert_ai_labeled() returns trigger as $$
begin
  if new.published and (new.ai_model is null or length(trim(new.ai_disclaimer)) < 20) then
    raise exception 'Nie mozna opublikowac tresci AI bez modelu i disclaimera';
  end if;
  return new;
end $$ language plpgsql;
create trigger trg_ai_labeled before insert or update on ai_contents
  for each row execute function assert_ai_labeled();

-- Frontend czyta TEN widok, nie tabele. Nie jest wiec w stanie wyrenderowac
-- tresci AI bez disclaimera i bez linku do zrodla.
create view public_ai_contents as
select a.id, a.kind, a.voting_id, a.eli_address, a.print_number, a.promise_id, a.body_md,
       a.ai_generated, a.ai_model, a.ai_disclaimer, a.ai_generated_at,
       s.url as source_url, s.retrieved_at as source_retrieved_at
from ai_contents a join sources s on s.id = a.source_id
where a.published;

-- ---------------------------------------------------------------------
-- 7. OSWIADCZENIA MAJATKOWE - wpis reczny z podwojna kontrola
-- Poza MVP jako pipeline automatyczny; tabela istnieje od poczatku,
-- zeby nie migrowac schematu, gdy modul wejdzie.
-- ---------------------------------------------------------------------
create table asset_declarations (
  id             uuid primary key default gen_random_uuid(),
  mp_id          smallint not null references mps(id),
  year           smallint not null,
  pdf_source_id  uuid not null references sources(id),   -- skan/PDF, zawsze obok liczby
  data           jsonb not null default '{}',            -- pola przepisane z formularza
  entered_by     uuid not null,
  verified_by    uuid,                                    -- druga osoba, niezalezny wpis
  verified_at    timestamptz,
  published      boolean not null default false,
  unique (mp_id, year, entered_by)
);
-- Publikacja dopiero po niezaleznym potwierdzeniu przez druga osobe.
alter table asset_declarations add constraint published_needs_verification
  check (not published or verified_by is not null);

-- ---------------------------------------------------------------------
-- 8. ZGLASZANIE BLEDOW
-- ---------------------------------------------------------------------
create table error_reports (
  id             uuid primary key default gen_random_uuid(),
  entity_type    text not null,
  entity_id      text not null,
  reporter_email text,
  is_subject     boolean not null default false,
  message        text not null,
  status         text not null default 'new',
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 9. RLS
-- ---------------------------------------------------------------------
alter table mps                enable row level security;
alter table votings            enable row level security;
alter table votes              enable row level security;
alter table promises           enable row level security;
alter table promise_votes      enable row level security;
alter table ai_contents        enable row level security;
alter table asset_declarations enable row level security;
alter table error_reports      enable row level security;

create policy "public read mps"      on mps      for select using (true);
create policy "public read votings"  on votings  for select using (true);
create policy "public read votes"    on votes    for select using (true);
create policy "public read promises" on promises for select using (published);
create policy "public read ai"       on ai_contents for select using (published);
create policy "public read assets"   on asset_declarations for select using (published);
create policy "anyone can report"    on error_reports for insert with check (true);
create policy "own verdict only"     on promise_votes for insert with check (auth.uid() = user_id);
-- Fakty zapisuje wylacznie service_role z crona. Klucz anon nie pisze niczego poza zgloszeniami.

-- ---------------------------------------------------------------------
-- 10. UPRAWNIENIA
-- Supabase ustawia domyslne przywileje dla ról anon/authenticated, ale
-- zapisujemy je jawnie: schemat ma byc czytelny bez znajomosci konfiguracji.
-- Zasada: publicznosc CZYTA, nikt poza service_role nie PISZE faktow.
-- ---------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

grant select on
  mps, clubs, votings, votes, sources,
  legislative_processes, process_stages,
  promises, promise_votes, ai_contents, asset_declarations,
  public_ai_contents, mp_stats
to anon, authenticated;

grant insert on error_reports to anon, authenticated;
grant insert on promise_votes to authenticated;

-- Zadnych UPDATE/DELETE dla nikogo poza service_role.
revoke insert, update, delete on
  mps, clubs, votings, votes, sources,
  legislative_processes, process_stages, ai_contents, asset_declarations
from anon, authenticated;
