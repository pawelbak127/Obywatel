-- =====================================================================
-- Obywatel 2.0 — migracja 0034: `mps.email`
--
-- PO CO. Serwis mowi czytelnikowi, kto go reprezentuje, jak glosuje, czym
-- sie zajmuje i o co pyta rzad. Nie mowi, JAK SIE Z NIM SKONTAKTOWAC —
-- a to jest naturalny nastepny krok kogos, kto wlasnie przeczytal profil
-- swojego posla.
--
-- Adres jest w rejestrze od poczatku i importer go widzial, tylko mapper
-- posla go pomijal (mapper KLUBU mial `email`, mapper POSLA nie).
--
-- Zmierzone 13.09.2026: 499 z 499 poslow ma adres, WSZYSTKIE w domenie
-- `sejm.pl`. To adresy sluzbowe udostepniane przez Kancelarie Sejmu,
-- a nie prywatne — nie zbieramy ich skadkolwiek i niczego nie zgadujemy.
--
-- ---------------------------------------------------------------------
-- OGRANICZENIE NA KSZTALT, ALE NIE NA DOMENE.
--
-- Kuszace bylo wymusic `@sejm.pl`, skoro dzis maja ja wszyscy. Odrzucone:
-- rejestr moze kiedys podac adres w innej oficjalnej domenie (np. przy
-- poslach do PE albo po zmianie infrastruktury Kancelarii), a wtedy
-- ograniczenie zablokowaloby import PRAWDZIWEJ danej z rejestru.
--
-- Sprawdzamy wiec tylko, czy to w ogole wyglada na adres. To chroni przed
-- wpisaniem tam komunikatu bledu albo pustego ciagu — czyli przed
-- pokazaniem czytelnikowi odnosnika `mailto:`, ktory prowadzi donikad.
-- =====================================================================

alter table mps add column if not exists email text;

comment on column mps.email is
  'Sluzbowy adres posla z rejestru Kancelarii Sejmu. 499/499 w domenie sejm.pl (13.09.2026). Nie zbieramy adresow prywatnych.';

-- Bez `drop constraint if exists` — wpada pod bezpiecznik scripts/sql.mjs
-- razem z `drop column`.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'mps_email_ksztalt' and conrelid = 'mps'::regclass
  ) then
    alter table mps add constraint mps_email_ksztalt
      check (email is null or email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');
  end if;
end $$;

-- =====================================================================
-- BLOK KONTROLNY (CLAUDE.md §7.3)
-- =====================================================================

-- OGRANICZENIE NAPRAWDE ODRZUCA — sprawdzane ZACHOWANIEM, w podtransakcji,
-- bez zostawiania zmiany. Adres, ktory nie jest adresem, dalby na profilu
-- odnosnik `mailto:` prowadzacy donikad — a to gorsze niz brak odnosnika.
do $$
declare id_probny int;
begin
  select id into id_probny from mps order by id limit 1;
  if id_probny is null then
    raise exception 'Tabela mps jest pusta — uruchom import przed ta migracja.';
  end if;

  begin
    update mps set email = 'to nie jest adres' where id = id_probny;
    raise exception
      'Ograniczenie mps_email_ksztalt NIE dziala — kolumna przyjela wartosc, ktora nie jest '
      'adresem. Profil pokazalby wtedy odnosnik mailto: prowadzacy donikad.';
  exception
    when check_violation then null; -- tego oczekujemy
  end;

  update mps set email = null where id = id_probny and email = 'to nie jest adres';
end $$;

-- =====================================================================
-- WYNIK. Oczekiwane TERAZ: 0 — kolumne zapelnia `npm run ingest:mps`.
-- Po imporcie: 499.
-- =====================================================================
select
  count(*)            as poslow,
  count(email)        as z_adresem,
  count(*) filter (where email like '%@sejm.pl') as w_domenie_sejm
from mps;
