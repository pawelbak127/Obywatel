-- =====================================================================
-- Obywatel 2.0 — migracja 0013: gmina moze miec wiecej niz jedna nazwe
--
-- POWOD, ZMIERZONY. Slownik gmin z API SUDOP ma 4 170 pozycji i 4 155
-- unikalnych kodow TERYT. Jedenascie kodow wystepuje pod DWIEMA roznymi nazwami:
--
--   0223083  ŚWIĘTA KATARZYNA   | SIECHNICE
--   3214011  STARGARD SZCZECIŃSKI | STARGARD
--   0417052  RYŃSK              | WĄBRZEŹNO
--   2604172  SITKÓWKA-NOWINY    | NOWINY
--   ... i siedem podobnych
--
-- Sprawdzenie tych par bylo wazniejsze, niz wyglada: gdyby pod jednym kodem
-- staly dwie ROZNE gminy, znaczyloby to, ze pole `number` nie jest kodem TERYT
-- i cala kolumna 7 w eksporcie CSV nie znaczy tego, co myslimy. Wszystkie
-- jedenascie par to ta sama jednostka pod stara i nowa nazwa. Zalozenie
-- potwierdzone danymi.
--
-- CZEGO NIE WIEMY. Slownik nie ma daty obowiazywania, wiec z samego API nie da
-- sie ustalic, ktora nazwa jest dzisiejsza. Zgadywanie po kolejnosci w tablicy
-- byloby dokladnie tym bledem, ktory kosztowal ten projekt piec pomylek.
--
-- CO ROBIMY. Nie wyrzucamy zadnej nazwy. Jedna trafia do `nazwa`, pozostale
-- do `nazwy_alternatywne` — dzieki czemu wyszukanie "Siechnice" trafia w gmine
-- zapisana jako "Święta Katarzyna", zamiast nie trafiac w nic. Ustalenie nazwy
-- OBOWIAZUJACEJ wymaga rejestru TERYT prowadzonego przez GUS i bedzie zrobione
-- tak samo jak `mp_roles`: recznie, dla jedenastu wierszy, zawsze ze zrodlem.
-- =====================================================================

alter table sudop_gminy
  add column if not exists nazwy_alternatywne text[] not null default '{}';

comment on column sudop_gminy.nazwy_alternatywne is
  'Inne nazwy tego samego kodu TERYT wystepujace w slowniku UOKiK (zmiany nazw gmin). Sluza wyszukiwaniu — nie sa nazwa obowiazujaca.';

-- Wyszukiwanie po dowolnej z nazw.
create index if not exists sudop_gminy_alt_idx on sudop_gminy using gin (nazwy_alternatywne);

-- ---------------------------------------------------------------------
-- Widok: dotacja niesie komplet nazw gminy
--
-- DROP, nie CREATE OR REPLACE. PostgreSQL pozwala przez REPLACE tylko DOPISAC
-- kolumny na koncu; wstawienie `gmina_nazwy_alternatywne` obok `gmina` konczy sie
--     ERROR: cannot change name of view column "pkd" to "gmina_nazwy_alternatywne"
-- Kolejnosc kolumn ma tu znaczenie praktyczne: nazwy gminy maja stac obok siebie,
-- bo `select *` w SQL Editorze jest najczestszym sposobem ogladania tych danych.
-- ---------------------------------------------------------------------
drop view if exists dotacje_publiczne;

create view dotacje_publiczne as
select
  s.id,
  s.beneficiary_name,
  case when s.nip_valid then s.beneficiary_nip end as beneficiary_nip,
  s.beneficiary_size,
  s.teryt,
  g.nazwa as gmina,
  -- Komplet nazw, po ktorych ta gmina wystepuje w danych o pomocy publicznej.
  -- Frontend moze pokazac "Siechnice (w danych takze: Święta Katarzyna)".
  coalesce(g.nazwy_alternatywne, '{}') as gmina_nazwy_alternatywne,
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

alter view dotacje_publiczne set (security_invoker = on);
grant select on dotacje_publiczne to anon, authenticated;

-- ---------------------------------------------------------------------
-- Samosprawdzenie kontraktu
-- ---------------------------------------------------------------------
do $$
declare
  wymagane text[] := array['id','beneficiary_name','beneficiary_nip','beneficiary_size','teryt',
    'gmina','gmina_nazwy_alternatywne','pkd','grantor_name','legal_basis','measure_number','granted_on',
    'value_nominal_pln','value_gross_pln','value_gross_eur','aid_form','aid_purpose',
    'zrodlo_url','zrodlo_pobrano'];
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
