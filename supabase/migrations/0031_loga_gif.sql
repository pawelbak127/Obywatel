-- =====================================================================
-- Obywatel 2.0 — migracja 0031: kubelek `loga` przyjmuje takze GIF
--
-- ZNALEZIONE PRZY PIERWSZYM PRAWDZIWYM URUCHOMIENIU IMPORTU (13.09.2026).
--
-- Kubelek powstal w 0029 z typami `image/jpeg` i `image/png`, bo tyle
-- pokazywal pomiar: `curl` zwracal dla wszystkich klubow nagłowek
-- `content-type: image/jpeg`.
--
-- NAGLOWEK KLAMAL. Import sprawdza PIERWSZE BAJTY, nie nagłowek, i na tym
-- sie zatrzymal:
--
--   Konfederacja: 2552 B, pierwsze bajty 47494638
--   PiS:          1883 B, pierwsze bajty 47494638
--
-- `47 49 46 38` to ASCII „GIF8" — naglowek pliku GIF87a/GIF89a. Serwer
-- deklaruje JPEG, a wysyla GIF-a.
--
-- To jest dokladnie ten przypadek, dla ktorego wzorzec „sprawdzamy bajty,
-- nie naglowek" w ogole powstal (CLAUDE.md §6, komentarz w sync-mp-photos).
-- Bez niego zapisalibysmy GIF-a pod nazwa `.jpg` z typem `image/jpeg`
-- i dwa najwieksze kluby opozycji mialyby zepsuty znak — a przegladarki
-- czesto i tak by go pokazaly, wiec nikt by tego nie zauwazyl.
--
-- Kubelek przyjmuje wiec teraz trzy typy. Limit rozmiaru zostaje bez zmian:
-- najwiekszy znak ma 7,3 kB przy limicie 256 kB.
-- =====================================================================

update storage.buckets
   set allowed_mime_types = array['image/jpeg', 'image/png', 'image/gif']
 where id = 'loga';

-- =====================================================================
-- BLOK KONTROLNY (CLAUDE.md §7.3)
-- =====================================================================

do $$
declare typy text[];
begin
  select allowed_mime_types into typy from storage.buckets where id = 'loga';

  if typy is null then
    raise exception 'Kubelek "loga" nie istnieje — uruchom najpierw migracje 0029.';
  end if;

  if not ('image/gif' = any(typy)) then
    raise exception
      'Kubelek "loga" nadal nie przyjmuje image/gif. Dwa kluby (Konfederacja, PiS) '
      'maja znak w tym formacie i import bedzie je odrzucal.';
  end if;
end $$;

-- =====================================================================
-- WYNIK. `raise notice` jest niewidoczne w edytorze SQL Supabase (§6).
-- =====================================================================
select
  id                               as kubelek,
  array_to_string(allowed_mime_types, ', ') as dozwolone_typy,
  file_size_limit                  as limit_bajtow
from storage.buckets
where id = 'loga';
