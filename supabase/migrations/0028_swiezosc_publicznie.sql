-- =====================================================================
-- Obywatel 2.0 — migracja 0028: widok `swiezosc_danych`
--
-- BLAD, KTORY TO NAPRAWIA (zgloszony przez Pawla 13.09.2026).
--
-- `/status` mowi czytelnikowi: „Ta strona mowi, KIEDY pobralismy je ostatnio
-- i ile tego mamy". Drugiej polowy dotrzymuje. Pierwszej nie dotrzymala ANI
-- RAZU: sekcja swiezosci nie wyrenderowala sie nigdy, od dnia, w ktorym
-- zostala napisana jako „GLOWNY fakt tej strony".
--
-- Przyczyna: `sync_state` ma RLS wlaczone, ZERO polityk i `anon` nie ma na
-- niej prawa SELECT. Zapytanie ze strony wracalo z bledem, a `readFreshness()`
-- lapalo go i zwracalo pusta liste — wiec sekcja znikala bez sladu.
--
-- Ironia warta zapisania: ta sekcja powstala jako CZUJNIK CICHYCH AWARII
-- („gdyby istniala wczesniej, zauwazylibysmy, ze nocny import przestal
-- chodzic"). Sama zawiodla dokladnie w ten sposob, ktory miala wykrywac.
--
-- ---------------------------------------------------------------------
-- DLACZEGO WIDOK, A NIE GRANT NA `sync_state`.
--
-- Nadanie `anon` prawa SELECT na tabeli otworzyloby tez `last_error` —
-- surowy komunikat bledu importu. Te komunikaty zawieraja nazwy tabel,
-- fragmenty zapytan i tresc odpowiedzi HTTP z serwerow, ktore odpytujemy.
-- Czytelnikowi nalezy sie informacja, ZE import sie nie powiodl; nie nalezy
-- mu sie nasz stos wywolan.
--
-- Widok wystawia wiec trzy rzeczy: ktory import, kiedy chodzil ostatnio
-- i czy zglosil blad — jako `boolean`. Kursory (`cursor_at`, `cursor_num`)
-- zostaja poza nim, bo sa wewnetrzna mechanika wznawiania.
--
-- ---------------------------------------------------------------------
-- DLACZEGO `security_invoker = off`, WBREW WZORCOWI Z RESZTY PROJEKTU.
--
-- Pozostale widoki maja `security_invoker = on`, zeby RLS tabel zrodlowych
-- obowiazywal tak samo przez widok. Tutaj cel jest ODWROTNY i swiadomy:
-- widok ma byc waskim, kontrolowanym oknem na tabele, ktorej anon czytac
-- nie moze i czytac nie powinien. Z `security_invoker = on` widok
-- dziedziczylby brak dostepu i nie rozwiazalby niczego.
--
-- Bezpieczenstwo stoi tu na liscie kolumn, a nie na RLS: widok nie ma
-- parametrow, nie przyjmuje danych od uzytkownika i zwraca najwyzej
-- kilkanascie wierszy o naszych wlasnych zadaniach importu.
-- =====================================================================

drop view if exists swiezosc_danych;

create view swiezosc_danych as
select
  s.job,
  s.last_run,
  (s.last_error is not null) as byl_blad
from sync_state s;

comment on view swiezosc_danych is
  'Publiczne okno na sync_state dla /status: ktory import, kiedy, czy zglosil blad. Bez tresci bledu i bez kursorow.';

grant select on swiezosc_danych to anon, authenticated;

-- =====================================================================
-- BLOKI KONTROLNE (CLAUDE.md §7.3)
-- =====================================================================

-- 1. WIDOK NIE WYSTAWIA TRESCI BLEDU ANI KURSOROW.
--    To jest caly powod, dla ktorego nie zrobilismy zwyklego granta.
--    Gdyby ktos przy nastepnej zmianie dopisal `select *`, ten blok ma
--    przerwac migracje, a nie zostawic wyciek do odkrycia pozniej.
do $$
declare zabronione text;
begin
  select string_agg(column_name, ', ') into zabronione
  from information_schema.columns
  where table_name = 'swiezosc_danych'
    and column_name in ('last_error', 'cursor_at', 'cursor_num');

  if zabronione is not null then
    raise exception
      'Widok swiezosc_danych wystawia kolumny, ktorych wystawiac nie wolno: %. '
      'Tresc bledu importu i kursory sa wewnetrzne — czytelnikowi nalezy sie '
      'informacja, ZE import sie nie powiodl, nie nasz stos wywolan.', zabronione;
  end if;
end $$;

-- 2. `anon` NAPRAWDE CZYTA WIDOK I NAPRAWDE NIE CZYTA TABELI.
--    Sprawdzamy uprawnieniem, nie zalozeniem — bo caly blad polegal na tym,
--    ze nikt nigdy nie sprawdzil, czy anon moze cokolwiek z tego przeczytac.
do $$
begin
  if not has_table_privilege('anon', 'swiezosc_danych', 'SELECT') then
    raise exception 'anon nie ma prawa SELECT na swiezosc_danych — sekcja na /status znowu bedzie pusta.';
  end if;

  if has_table_privilege('anon', 'sync_state', 'SELECT') then
    raise exception
      'anon ma prawo SELECT na sync_state. Widok mial byc jedyna droga, '
      'bo tabela zawiera tresc bledow importu.';
  end if;
end $$;

-- 3. KONTRAKT Z `src/app/status/page.tsx`. Strona opisuje trzy importy.
--    Blok NIE przerywa migracji, gdy ktoregos brakuje — brak wpisu znaczy
--    „ten import jeszcze nie chodzil" i jest poprawnym stanem. Ma natomiast
--    powiedziec to wprost w wyniku nizej, zeby nie odkrywac tego z ekranu.
-- =====================================================================
-- WYNIK. `raise notice` jest niewidoczne w edytorze SQL Supabase (§6).
-- =====================================================================
select
  oczekiwany                                        as job,
  coalesce(s.last_run::date::text, 'NIGDY NIE CHODZIL') as ostatnio,
  coalesce(s.byl_blad::text, '—')                   as byl_blad
from unnest(array['mps', 'votings', 'processes']) as oczekiwany
left join swiezosc_danych s on s.job = oczekiwany
order by oczekiwany;
