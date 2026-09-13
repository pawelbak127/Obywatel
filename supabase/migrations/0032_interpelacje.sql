-- =====================================================================
-- Obywatel 2.0 — migracja 0032: interpelacje i zapytania poselskie
--
-- PO CO — DWA POWODY, I DRUGI JEST WAZNIEJSZY.
--
-- 1. Profil posla mowil dotad WYLACZNIE o tym, jak ktos nacisnal przycisk.
--    Interpelacja to aktywnosc, ktora nie jest glosowaniem.
--
-- 2. TO PIERWSZY ZBIOR W SERWISIE, KTORY MOWI COS O RZADZIE, A NIE O POSLE.
--    Rejestr podaje przy kazdym dokumencie, czy przyszla odpowiedz i o ile
--    dni po terminie. To nie jest nasza ocena — to liczba z rejestru
--    o tym, jak administracja odpowiada na pytania poslow.
--
-- Zmierzone 13.09.2026 na pelnym zbiorze (nie na probce):
--
--   interpelacje   19 756   441 autorow   829 bez odpowiedzi   579 po terminie
--   zapytania       3 971   343 autorow   227 bez odpowiedzi   115 po terminie
--   RAZEM          23 727              1 056 bez odpowiedzi   694 po terminie
--
--   najdluzsze opoznienie: 914 dni (interpelacje), 731 dni (zapytania)
--
-- ---------------------------------------------------------------------
-- OSTRZEZENIE REDAKCYJNE, ktore musi trafic do interfejsu.
--
-- LICZBA INTERPELACJI NIE JEST MIARA JAKOSCI POSLA i nie wolno jej tak
-- pokazac. Jeden posel sklada dwiescie pytan o sprawy lokalne, drugi
-- dziesiec po pracy w komisji. Rejestr nie mowi, ktore bylo potrzebne.
-- To jest DOKLADNIE ten sam problem co przy obecnosci (D11): liczba bez
-- kontekstu czyta sie jako ocena, a my kontekstu nie mamy.
--
-- Dlatego nie budujemy z tego rankingu poslow. Wolno pokazac: ile zlozyl,
-- ile z nich zostalo bez odpowiedzi i ile odpowiedziano po terminie —
-- przy czym dwie ostatnie liczby mowia o ADRESACIE, nie o autorze.
--
-- ---------------------------------------------------------------------
-- DWIE TABELE, NIE JEDNA Z TABLICA.
--
-- Autorow bywa wielu (interpelacje skladane wspolnie). Tablica `mp_id[]`
-- w jednym wierszu wymagalaby indeksu GIN i uniemozliwiala klucz obcy do
-- `mps` — czyli baza nie pilnowalaby, ze autor w ogole istnieje. Tabela
-- laczaca daje jedno i drugie.
--
-- Klucz glowny jest PARA (rodzaj, numer), bo numeracja interpelacji
-- i zapytan jest NIEZALEZNA: istnieje interpelacja nr 1 i zapytanie nr 1.
-- Sam `numer` gubilby polowe zbioru.
-- =====================================================================

create table if not exists interpellations (
  kind          text        not null check (kind in ('interpelacja', 'zapytanie')),
  num           integer     not null,
  term          integer     not null default 10,
  title         text        not null,
  recipients    text[]      not null default '{}',
  receipt_date  date,
  sent_date     date,
  delayed_days  integer,
  replies_count integer     not null default 0,
  sejm_url      text,
  last_modified timestamptz,
  updated_at    timestamptz not null default now(),
  primary key (kind, num)
);

comment on table interpellations is
  'Interpelacje i zapytania poselskie z rejestru Sejmu. Klucz to PARA (kind, num) — numeracja obu rodzajow jest niezalezna.';
comment on column interpellations.delayed_days is
  'O ile dni odpowiedz przekroczyla termin. Liczba z rejestru, nie nasza — mowi o ADRESACIE, nie o autorze.';
comment on column interpellations.replies_count is
  '0 znaczy BRAK ODPOWIEDZI. Zmierzone 13.09.2026: 1 056 dokumentow na 23 727.';

create table if not exists interpellation_authors (
  kind  text    not null,
  num   integer not null,
  mp_id integer not null references mps(id) on delete cascade,
  primary key (kind, num, mp_id),
  foreign key (kind, num) references interpellations(kind, num) on delete cascade
);

create index if not exists interpellation_authors_mp_idx on interpellation_authors (mp_id);

alter table interpellations        enable row level security;
alter table interpellation_authors enable row level security;

drop policy if exists "public read interpellations" on interpellations;
create policy "public read interpellations" on interpellations for select using (true);

drop policy if exists "public read interpellation_authors" on interpellation_authors;
create policy "public read interpellation_authors" on interpellation_authors for select using (true);

grant select on interpellations, interpellation_authors to anon, authenticated;

-- =====================================================================
-- WIDOK — liczby wyprowadzamy, nie przechowujemy (CLAUDE.md §6).
-- =====================================================================

drop view if exists mp_interpelacje;

create view mp_interpelacje
with (security_invoker = on) as
select
  a.mp_id,
  count(*) filter (where i.kind = 'interpelacja')            as interpelacji,
  count(*) filter (where i.kind = 'zapytanie')               as zapytan,
  count(*) filter (where i.replies_count = 0)                as bez_odpowiedzi,
  count(*) filter (where coalesce(i.delayed_days, 0) > 0)    as po_terminie,
  max(i.receipt_date)                                        as ostatnia
from interpellation_authors a
join interpellations i on i.kind = a.kind and i.num = a.num
group by a.mp_id;

comment on view mp_interpelacje is
  'Interpelacje i zapytania w ujeciu posla. `bez_odpowiedzi` i `po_terminie` mowia o ADRESACIE dokumentu, nie o jego autorze.';

grant select on mp_interpelacje to anon, authenticated;

-- =====================================================================
-- BLOKI KONTROLNE (CLAUDE.md §7.3)
-- =====================================================================

-- 1. KONTRAKT Z `queries.ts` — literowka w nazwie kolumny ujawnilaby sie
--    dopiero przy wejsciu na profil posla.
do $$
declare brakujace text;
begin
  select string_agg(k, ', ') into brakujace
  from unnest(array['mp_id', 'interpelacji', 'zapytan', 'bez_odpowiedzi', 'po_terminie', 'ostatnia']) as k
  where not exists (
    select 1 from information_schema.columns
    where table_name = 'mp_interpelacje' and column_name = k
  );
  if brakujace is not null then
    raise exception 'Widok mp_interpelacje nie ma kolumn: %', brakujace;
  end if;
end $$;

-- 2. SLOWNIK RODZAJU NAPRAWDE ODRZUCA. Sprawdzane ZACHOWANIEM, nie obecnoscia
--    wpisu w katalogu — ograniczenie moze istniec jako `not valid`.
do $$
begin
  begin
    insert into interpellations (kind, num, title) values ('cokolwiek', -1, 'proba');
    raise exception
      'Ograniczenie na `kind` NIE dziala — przeszedl wiersz z rodzajem spoza slownika. '
      'Widok liczy po tej kolumnie, wiec kazda liczba na profilu bylaby niesprawdzalna.';
  exception
    when check_violation then null; -- tego oczekujemy
  end;
  delete from interpellations where num = -1;
end $$;

-- 3. KLUCZ OBCY DO `mps` NAPRAWDE PILNUJE. To jest cala przewaga tabeli
--    laczacej nad tablica `mp_id[]` — jesli nie dziala, wybralismy gorszy
--    model bez zysku.
do $$
begin
  insert into interpellations (kind, num, title) values ('interpelacja', -1, 'proba klucza obcego');
  begin
    insert into interpellation_authors (kind, num, mp_id) values ('interpelacja', -1, -999);
    raise exception 'Klucz obcy do mps NIE dziala — przeszedl autor, ktorego nie ma w bazie.';
  exception
    when foreign_key_violation then null; -- tego oczekujemy
  end;
  delete from interpellations where num = -1;
end $$;

-- 4. ANON CZYTA OBA OBIEKTY. Bez tego sekcja na profilu byla by pusta —
--    tak jak sekcja swiezosci na /status przez cala dobe (migracja 0028).
do $$
begin
  if not has_table_privilege('anon', 'mp_interpelacje', 'SELECT') then
    raise exception 'anon nie ma prawa SELECT na mp_interpelacje.';
  end if;
  if not has_table_privilege('anon', 'interpellations', 'SELECT') then
    raise exception 'anon nie ma prawa SELECT na interpellations.';
  end if;
end $$;

-- =====================================================================
-- WYNIK. Oczekiwane TERAZ: zera — tabele zapelnia `npm run ingest:interpelacje`.
-- Po imporcie: 19 756 interpelacji i 3 971 zapytan (zmierzone 13.09.2026).
-- =====================================================================
select
  (select count(*) from interpellations where kind = 'interpelacja') as interpelacji,
  (select count(*) from interpellations where kind = 'zapytanie')    as zapytan,
  (select count(*) from interpellation_authors)                      as powiazan_z_poslami,
  (select count(*) from mp_interpelacje)                             as poslow_w_widoku;
