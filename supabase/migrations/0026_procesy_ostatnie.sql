-- =====================================================================
-- Obywatel 2.0 — migracja 0026: widok `procesy_ostatnie`
--
-- PO CO. Strona glowna nie pokazywala ani jednego nazwiska, glosowania czy
-- ustawy — cztery zaokraglone liczby i trzy akapity o zasadach. Migracja
-- 0026 daje jej material na wiersz konkretu: co ostatnio przeszlo przez
-- Sejm, z data, z losem i z odnosnikiem do rejestru.
--
-- `proces_los` (0021-0025) liczy LOS, ale nie zna TYTULU — tytul siedzi
-- w `legislative_processes`. Bez tego zlaczenia interfejs musialby robic
-- dwa zapytania i skladac je w JavaScripcie, czyli trzymac ksztalt danych
-- w dwoch miejscach naraz. To jest dokladnie ten wzorzec, ktory w tym
-- projekcie zawsze konczyl sie rozjechaniem (CLAUDE.md §6).
--
-- `proces_los` NIE ZMIENIA SIE ANI O JEDNO WYRAZENIE. Ta migracja tylko
-- dokłada widok NAD nim, wiec kanoniczna definicja `proces_los` zostaje
-- w 0025 i to ja nalezy skopiowac przy nastepnej zmianie tamtego widoku.
--
-- DLACZEGO NIE NAZYWAMY TEGO „rozstrzygnietymi". Kusilo, zeby przefiltrowac
-- do losow koncowych (opublikowany, podpisany, weto_utrzymane) i nazwac
-- sekcje „ostatnio rozstrzygniete". Odrzucone: „uchwalono — Prezydent
-- zawetowal" i „oczekuje na publikacje" NIE sa rozstrzygnieciami, a wpadlyby
-- pod ten sam naglowek albo zniknelyby z serwisu w momencie, w ktorym sa
-- najciekawsze. Widok zwraca wszystko, co ma los i date zamkniecia,
-- a prawde o kazdym wierszu mowi jego wlasna etykieta losu.
-- =====================================================================

drop view if exists procesy_ostatnie;

create view procesy_ostatnie
with (security_invoker = on) as
select
  l.print_number,
  -- `title_final` to tytul po poprawkach, `title` — pierwotny z druku.
  -- Bierzemy koncowy, gdy istnieje; `nullif(btrim(...))` bo rejestr
  -- zapisuje „brak tytulu koncowego" pustym ciagiem, nie NULL-em.
  coalesce(nullif(btrim(p.title_final), ''), p.title) as tytul,
  p.closure_date,
  l.los,
  p.isap_url,
  p.eli_address
from proces_los l
join legislative_processes p using (print_number)
where l.los is not null
  and p.closure_date is not null;

comment on view procesy_ostatnie is
  'Procesy z ustalonym losem i data zamkniecia, z tytulem. Zrodlo dla sekcji na stronie glownej.';

grant select on procesy_ostatnie to anon, authenticated;

-- =====================================================================
-- BLOKI KONTROLNE — migracja sprawdza wlasne zalozenia (CLAUDE.md §7.3).
-- =====================================================================

-- 1. KONTRAKT Z `queries.ts`. `LOS_OPIS` jest slownikiem Record<LosProcesu, …>,
--    wiec los spoza zestawu daje `undefined` i wywraca renderowanie wiersza.
--    Ten blok lapie to przy migracji, a nie na produkcji.
do $$
declare nieznane text;
begin
  select string_agg(distinct los, ', ') into nieznane
  from procesy_ostatnie
  where los not in (
    'opublikowany', 'podpisany', 'weto', 'trybunal', 'oczekuje',
    'u_prezydenta', 'bez_etapu_prezydenckiego', 'weto_utrzymane'
  );

  if nieznane is not null then
    raise exception
      'Widok zwraca losy, ktorych nie zna LOS_OPIS w src/lib/queries.ts: %. '
      'Dopisz je TAM, zanim ta migracja pojdzie na produkcje.', nieznane;
  end if;
end $$;

-- 2. TYTUL NIGDY PUSTY. Wiersz bez tytulu to na stronie glownej pusta linia
--    z data i losem — czyli fakt bez podmiotu.
do $$
declare puste int;
begin
  select count(*) into puste
  from procesy_ostatnie
  where tytul is null or btrim(tytul) = '';

  if puste > 0 then
    raise exception
      '% procesow ma pusty tytul mimo coalesce(title_final, title). '
      'Znaczy to, ze `title` tez bywa puste — widok potrzebuje trzeciego zrodla '
      'albo filtra, nie zaokraglenia problemu.', puste;
  end if;
end $$;

-- 3. DATA NIE Z PRZYSZLOSCI. Sekcja sortuje malejaco po dacie, wiec jeden
--    wiersz z bledna data z przyszlosci przykrylby soba cala sekcje i stal
--    tam, dopoki ktos by nie zauwazyl.
do $$
declare z_przyszlosci int;
begin
  select count(*) into z_przyszlosci
  from procesy_ostatnie
  where closure_date > current_date;

  if z_przyszlosci > 0 then
    raise exception
      '% procesow ma date zamkniecia z przyszlosci. Sprawdz import, zanim '
      'te wiersze stana na stronie glownej.', z_przyszlosci;
  end if;
end $$;

-- =====================================================================
-- WYNIK. `raise notice` jest niewidoczne w edytorze SQL Supabase (§6),
-- wiec migracja konczy sie zwyklym SELECT-em.
-- =====================================================================
select
  los,
  count(*)            as procesow,
  max(closure_date)   as najswiezszy
from procesy_ostatnie
group by los
order by najswiezszy desc nulls last;
