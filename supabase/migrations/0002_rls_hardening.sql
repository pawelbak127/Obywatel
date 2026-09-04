-- =====================================================================
-- Obywatel 2.0 — migracja 0002: domkniecie RLS
--
-- Audyt migracji 0001 na zywym PostgreSQL 16 wykazal trzy dziury.
-- Zadna nie jest katastrofa (klucz anon i tak ma tylko SELECT), ale kazda
-- oznacza, ze bezpieczenstwo opiera sie na GRANT-ach zamiast na politykach —
-- czyli na tym, ze nikt nigdy nie doda przez pomylke jednego GRANT-a.
--
--   1. Piec tabel bez wlaczonego RLS: clubs, sources, legislative_processes,
--      process_stages, sync_state. W panelu Supabase widac je jako "Unrestricted".
--   2. Widok public_ai_contents dziala jako SECURITY DEFINER (domyslnie w PG),
--      czyli OMIJA RLS tabel pod spodem. Caly sens tego widoku — "frontend nie
--      jest w stanie pokazac tresci AI bez metki" — opieral sie na tym, ze widok
--      respektuje polityki. Nie respektowal.
--   3. mp_stats byl widokiem zmaterializowanym. RLS nie dziala na matviews
--      w ogole — nie da sie ich zabezpieczyc politykami, mozna tylko odebrac
--      GRANT. Zamieniamy na zwykla tabele odswiezana funkcja.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. RLS na pozostalych tabelach
-- ---------------------------------------------------------------------
alter table clubs                 enable row level security;
alter table sources               enable row level security;
alter table legislative_processes enable row level security;
alter table process_stages        enable row level security;
alter table sync_state            enable row level security;

-- Kluby, zrodla i proces legislacyjny sa jawne z zalozenia — to jest produkt.
create policy "public read clubs"     on clubs                 for select using (true);
create policy "public read sources"   on sources               for select using (true);
create policy "public read processes" on legislative_processes for select using (true);
create policy "public read stages"    on process_stages        for select using (true);

-- sync_state CELOWO nie dostaje zadnej polityki.
-- RLS wlaczone + zero polityk = nikt poza service_role tego nie widzi.
-- To stan wewnetrzny importu (kursory, komunikaty bledow) — nie ma powodu,
-- zeby wyciekal, a komunikat bledu potrafi zdradzic strukture zaplecza.
revoke all on sync_state from anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Widok respektuje RLS wywolujacego, nie wlasciciela
-- ---------------------------------------------------------------------
-- Bez tego widok czyta ai_contents z uprawnieniami postgresa i polityka
-- "public read ai USING (published)" nigdy nie jest sprawdzana.
alter view public_ai_contents set (security_invoker = on);

-- ---------------------------------------------------------------------
-- 3. mp_stats: widok zmaterializowany -> zwykla tabela
-- ---------------------------------------------------------------------
drop materialized view if exists mp_stats;

create table mp_stats (
  mp_id          smallint primary key references mps(id) on delete cascade,
  votes_total    int not null default 0,
  votes_cast     int not null default 0,
  attendance_pct numeric(4,1),
  loyalty_pct    numeric(4,1),
  computed_at    timestamptz not null default now()
);

alter table mp_stats enable row level security;
create policy "public read stats" on mp_stats for select using (true);
grant select on mp_stats to anon, authenticated;

-- Przeliczenie metryk. Wolane przez nocny cron po imporcie glosowan:
--   await db().rpc('refresh_mp_stats')
-- Nie jest SECURITY DEFINER — celowo. Ma dzialac z uprawnieniami tego,
-- kto ja wywoluje, czyli service_role. Gdyby byla DEFINER, kazdy zalogowany
-- uzytkownik moglby zmusic baze do przeliczenia 1,9 mln wierszy.
create or replace function refresh_mp_stats()
returns table (updated int)
language plpgsql
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
    from mps m
    join votes v on v.mp_id = m.id
    join lateral (
      select mode() within group (order by v2.value) as club_majority
      from votes v2
      where v2.voting_id = v.voting_id
        and v2.club_seq  = v.club_seq
        and v2.value <> 'ABSENT'
    ) cm on true
    group by m.id
  )
  insert into mp_stats (mp_id, votes_total, votes_cast, attendance_pct, loyalty_pct, computed_at)
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

revoke all on function refresh_mp_stats() from public, anon, authenticated;
grant execute on function refresh_mp_stats() to service_role;

-- ---------------------------------------------------------------------
-- 4. Kontrola koncowa — po tej migracji zapytanie ma zwrocic ZERO wierszy
-- ---------------------------------------------------------------------
do $$
declare bez_rls text;
begin
  select string_agg(c.relname, ', ')
    into bez_rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

  if bez_rls is not null then
    raise exception 'Tabele bez RLS: %', bez_rls;
  end if;
  raise notice 'RLS wlaczone na wszystkich tabelach w schemacie public.';
end $$;
