-- =====================================================================
-- Obywatel 2.0 — migracja 0014: mp_roles bez duplikatow
--
-- POWOD. `mp_roles` jest jedyna tabela, do ktorej tresc wpisuje czlowiek,
-- a plik z funkcjami bedzie importowany wielokrotnie — przy kazdym dopisaniu
-- kolejnego posla. Bez klucza naturalnego kazdy import dokladalby te same
-- funkcje jeszcze raz, a na stronie posla pojawiloby sie "Prezes Rady Ministrow"
-- trzy razy pod rzad.
--
-- Klucz: (posel, nazwa funkcji, data objecia). Ta sama osoba moze pelnic
-- kilka funkcji naraz i moze wrocic na te sama funkcje pozniej — dlatego
-- data poczatku jest czescia klucza, a nie sama nazwa.
-- =====================================================================

-- Gdyby w tabeli byly juz duplikaty z wczesniejszych recznych wpisow,
-- indeks unikalny by nie powstal. Sprawdzamy to i mowimy wprost, zamiast
-- zostawiac migracje, ktora "nie przeszla i nie wiadomo czemu".
do $$
declare n int;
begin
  select count(*) into n from (
    select mp_id, role_name, date_from
    from mp_roles
    group by mp_id, role_name, date_from
    having count(*) > 1
  ) d;
  if n > 0 then
    raise exception 'W mp_roles jest % powtorzonych funkcji (ten sam posel, nazwa i data objecia). Usun duplikaty, potem uruchom migracje ponownie.', n;
  end if;
end $$;

create unique index if not exists mp_roles_naturalny_klucz
  on mp_roles (mp_id, role_name, date_from);

comment on index mp_roles_naturalny_klucz is
  'Klucz naturalny funkcji: posel + nazwa + data objecia. Pozwala importowac plik z funkcjami wielokrotnie bez dublowania wpisow.';

do $$
begin
  raise notice 'mp_roles: klucz naturalny na miejscu, import mozna powtarzac.';
end $$;
