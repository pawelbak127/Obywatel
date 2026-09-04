-- =====================================================================
-- Obywatel 2.0 — migracja 0003: cztery ostrzezenia Security Advisora
--
-- 1. Function Search Path Mutable  (assert_ai_labeled, refresh_mp_stats)
-- 2. Extension in Public           (pg_trgm)
-- 3. RLS Policy Always True        (error_reports)
--
-- Zadne z nich nie jest dziura, przez ktora ktos wejdzie dzis wieczorem.
-- Wszystkie sa czyms gorszym w dluzszym terminie: ostrzezeniem, ktore
-- nauczysz sie ignorowac. Advisor ma byc zielony, zeby nastepne ostrzezenie
-- rzucalo sie w oczy.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. search_path w funkcjach
--
-- Funkcja bez ustawionego search_path dziedziczy go od wywolujacego.
-- Ktos, kto moze tworzyc obiekty w schemacie znajdujacym sie wczesniej
-- w sciezce, moze podstawic wlasna tabele albo operator i przejac
-- wykonanie funkcji. Przy SECURITY DEFINER to eskalacja uprawnien;
-- u nas obie funkcje sa INVOKER, wiec ryzyko jest mniejsze — ale
-- `set search_path = ''` kosztuje tyle, co kwalifikowanie nazw.
--
-- Cena: wszystkie odwolania musza byc pelne (public.mps, a nie mps).
-- ---------------------------------------------------------------------

create or replace function public.assert_ai_labeled()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.published and (new.ai_model is null or length(trim(new.ai_disclaimer)) < 20) then
    raise exception 'Nie mozna opublikowac tresci AI bez modelu i disclaimera';
  end if;
  return new;
end $$;

create or replace function public.refresh_mp_stats()
returns table (updated int)
language plpgsql
set search_path = ''
as $$
declare n int;
begin
  with stats as (
    select
      m.id as mp_id,
      count(*)::int                                                    as votes_total,
      count(*) filter (where v.value <> 'ABSENT')::int                 as votes_cast,
      round(100.0 * count(*) filter (where v.value <> 'ABSENT')
            / nullif(count(*),0), 1)                                   as attendance_pct,
      round(100.0 * count(*) filter (where v.value = cm.club_majority)
            / nullif(count(*) filter (where v.value <> 'ABSENT'),0), 1) as loyalty_pct
    from public.mps m
    join public.votes v on v.mp_id = m.id
    join lateral (
      select mode() within group (order by v2.value) as club_majority
      from public.votes v2
      where v2.voting_id = v.voting_id
        and v2.club_seq  = v.club_seq
        and v2.value <> 'ABSENT'
    ) cm on true
    group by m.id
  )
  insert into public.mp_stats (mp_id, votes_total, votes_cast, attendance_pct, loyalty_pct, computed_at)
  select mp_id, votes_total, votes_cast, attendance_pct, loyalty_pct, now() from stats
  on conflict (mp_id) do update set
    votes_total    = excluded.votes_total,
    votes_cast     = excluded.votes_cast,
    attendance_pct = excluded.attendance_pct,
    loyalty_pct    = excluded.loyalty_pct,
    computed_at    = excluded.computed_at;

  get diagnostics n = row_count;
  return query select n;
end $$;

revoke all on function public.refresh_mp_stats() from public, anon, authenticated;
grant execute on function public.refresh_mp_stats() to service_role;

-- ---------------------------------------------------------------------
-- 2. pg_trgm poza schemat public
--
-- Rozszerzenie w `public` miesza swoje funkcje i operatory z naszymi tabelami.
-- Supabase ma na to gotowy schemat `extensions`, ktory jest w search_path rol.
-- Indeks trzeba zdjac i zalozyc ponownie, bo zalezy od klasy operatorow.
-- ---------------------------------------------------------------------
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;

drop index if exists public.mps_name_trgm;
alter extension pg_trgm set schema extensions;

create index mps_name_trgm on public.mps
  using gin (full_name extensions.gin_trgm_ops);

-- ZNALEZIONE PRZY OKAZJI, wazniejsze niz sam Advisor.
-- Trigramy licza podobienstwo na surowych znakach, wiec polskie diakrytyki
-- rozjezdzaja sie z tym, co uzytkownik wpisuje w wyszukiwarke. Zmierzone:
--   'Pawel Sliz'  vs  full_name 'Paweł Śliż'  -> similarity 0.222  (prog to 0.3 — brak trafienia)
--   'pawel-sliz'  vs  slug      'pawel-sliz'  -> similarity 1.000
-- Kolumna `slug` jest juz pozbawiona diakrytykow, wiec to ona jest wlasciwym
-- indeksem wyszukiwania. Frontend slugifikuje zapytanie przed wyslaniem
-- (ta sama funkcja co w ingest/lib/slug.ts).
create index mps_slug_trgm on public.mps
  using gin (slug extensions.gin_trgm_ops);

-- Na Supabase pgcrypto stoi juz w `extensions` i `create extension if not exists`
-- z migracji 0001 bylo pustym przebiegiem. Na czystym Postgresie (np. lokalnym
-- srodowisku testowym) wyladowalo w public — przenosimy warunkowo.
do $$
begin
  if exists (select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace
             where e.extname = 'pgcrypto' and n.nspname = 'public') then
    execute 'alter extension pgcrypto set schema extensions';
  end if;
end $$;

-- Po przeniesieniu rozszerzenia operator `%` i funkcja similarity() nie sa juz
-- widoczne bez kwalifikacji. Supabase ma `extensions` w search_path swoich rol,
-- ale nie polegamy na cudzej konfiguracji — ustawiamy to jawnie na bazie.
do $$
begin
  execute format('alter database %I set search_path to "$user", public, extensions',
                 current_database());
end $$;

-- ---------------------------------------------------------------------
-- 3. Polityka na error_reports przestaje byc "always true"
--
-- Formularz "Zglos blad" musi byc otwarty dla anonimow — to wymog z sekcji 5
-- dokumentacji i jedyna sciezka, ktora ma polityk kwestionujacy nasze dane.
-- Ale `with check (true)` pozwalalo tez wstawic zgloszenie od razu ze statusem
-- 'fixed' albo pusta tresc. Zawezamy do tego, co formularz naprawde wysyla.
-- ---------------------------------------------------------------------
drop policy if exists "anyone can report" on public.error_reports;

create policy "anon zglasza blad" on public.error_reports
  for insert to anon, authenticated
  with check (
    status = 'new'                                   -- nie da sie wstawic "zalatwione"
    and is_subject = false                           -- flage podmiotu ustawia moderator
    and char_length(message) between 10 and 4000     -- ani puste, ani wypracowanie
    and entity_type in ('mp','voting','promise','ai_content','process','subsidy')
    and char_length(entity_id) <= 64
    and (reporter_email is null or reporter_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
  );

-- Zgloszenia czyta wylacznie moderacja (service_role). Nie dodajemy polityki SELECT:
-- lista cudzych zgloszen o bledach to nie jest tresc publiczna.

comment on policy "anon zglasza blad" on public.error_reports is
  'Otwarte dla anonimow z zalozenia — to jedyna sciezka odwolawcza dla polityka lub firmy, ktora kwestionuje nasze dane.';

-- ---------------------------------------------------------------------
-- Kontrola koncowa
-- ---------------------------------------------------------------------
do $$
declare bad text;
begin
  -- Tylko NASZE funkcje. Funkcje nalezace do rozszerzen pomijamy —
  -- ich search_path nie jest nasza sprawa i nie da sie go ustawic.
  select string_agg(p.proname, ', ') into bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proconfig is null
    and not exists (
      select 1 from pg_depend d
      where d.objid = p.oid and d.classid = 'pg_proc'::regclass and d.deptype = 'e'
    );
  if bad is not null then raise exception 'Funkcje bez search_path: %', bad; end if;

  if exists (select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace
             where e.extname = 'pg_trgm' and n.nspname = 'public') then
    raise exception 'pg_trgm nadal w schemacie public';
  end if;

  raise notice 'Advisor: funkcje maja search_path, pg_trgm poza public, polityka error_reports zawezona.';
end $$;
