-- =====================================================================
-- Obywatel 2.0 — migracja 0023: zdjęcia posłów przestają być hotlinkiem
--
-- POMIAR, OD KTÓREGO TO SIĘ ZACZĘŁO (11.09.2026). Pojedyncze żądania do
-- `api.sejm.gov.pl/sejm/term10/MP/{id}/photo`:
--
--   MP  1    4,5 kB   TTFB 11,3 s
--   MP  2   16,3 kB   TTFB 18,3 s
--   MP  3   14,2 kB   TTFB 17,1 s
--   MP 12   14,4 kB   TTFB 38,1 s
--   MP 40   14,4 kB   TTFB 58,8 s
--
-- Komplet nagłówków odpowiedzi to `Content-Type` i `Content-Length`.
-- NIE MA `Cache-Control`, `ETag` ani `Last-Modified` — przeglądarka nie ma
-- na czym oprzeć zapamiętania, więc pobiera każde zdjęcie od nowa przy
-- każdym wejściu. Na `/poslowie` to 60 równoległych żądań do serwera, który
-- przy piątym z rzędu odpowiada pięć razy wolniej niż przy pierwszym.
--
-- Do tego `next.config.ts` twierdzi od Sprintu 3:
--
--     // Zdjecia poslow trzymamy u siebie (Sprint 3) - hotlink do sejm.gov.pl
--     // przy ruchu wiralowym byloby nieuprzejme wobec serwera Kancelarii.
--
-- Kod hotlinkuje wszystkie 499. Komentarz opisywał zamiar, nie stan.
-- Ta migracja jest pierwszą połową jego wykonania.
--
-- ---------------------------------------------------------------------
-- DLACZEGO OSOBNA KOLUMNA, A NIE NADPISANIE `photo_url`.
--
-- Ten sam powód, dla którego migracja 0018 nie zerowała `photo_url` przy
-- braku zdjęcia: `photo_url` jest SKŁADANY przez mapper z id posła przy
-- każdym imporcie. Cokolwiek byśmy tam wpisali, wróciłoby do adresu Sejmu
-- przy najbliższym `ingest:mps` — i to po cichu.
--
-- Mamy więc trzy kolumny, każda o jednym zadaniu:
--
--   photo_url         dokąd u ŹRÓDŁA (składany, nietykalny)
--   photo_exists      czy tam cokolwiek jest (HEAD, migracja 0018)
--   photo_stored_url  dokąd U NAS (wypełniany raz, przez ingest:zdjecia)
--
-- ---------------------------------------------------------------------
-- WIDOK: NAJPIERW NASZ ADRES, POTEM ŹRÓDŁOWY.
--
-- `coalesce(photo_stored_url, photo_url)` znaczy, że przejście jest
-- stopniowe. Poseł, którego zdjęcia jeszcze nie skopiowaliśmy, dostaje adres
-- Sejmu — czyli dokładnie to, co ma dziś. Nie ma dnia z pustymi portretami
-- i nie ma potrzeby robić wszystkiego naraz.
--
-- Warunek `photo_exists` zostaje na wierzchu i nie zmienia znaczenia:
-- widok nadal NIE WYPUSZCZA adresu, którego nikt nie sprawdził.
--
-- CZEGO TA MIGRACJA NIE ROBI: nie kopiuje ani jednego pliku. Kolumna zostaje
-- pusta do czasu uruchomienia `npm run ingest:zdjecia`.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Kubełek na portrety
--
-- Publiczny, bo zdjęcie posła jest materiałem publicznym i serwis w całości
-- jest do odczytu. Publiczny kubełek serwuje pliki spod
-- `/storage/v1/object/public/portrety/…` bez żadnej polityki RLS, a zapis
-- i tak idzie kluczem `service_role`, który RLS omija.
--
-- Limit rozmiaru: zmierzone zdjęcia mają 4–17 kB. 512 kB to zapas trzydziestu
-- razy i jednocześnie bezpiecznik — gdyby Sejm kiedyś zaczął oddawać pod tym
-- adresem coś zupełnie innego, upload padnie, zamiast po cichu wypełnić nam
-- dysk.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portrety', 'portrety', true, 524288, array['image/jpeg', 'image/png'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------
-- 2. Gdzie leży nasza kopia
-- ---------------------------------------------------------------------
alter table mps add column if not exists photo_stored_url text;
alter table mps add column if not exists photo_stored_at  timestamptz;

comment on column mps.photo_stored_url is
  'Publiczny adres NASZEJ kopii zdjecia w Supabase Storage. NULL = jeszcze nie skopiowane, widok wraca wtedy do photo_url. Wypelnia ingest:zdjecia.';

comment on column mps.photo_stored_at is
  'Kiedy skopiowalismy zdjecie do Storage. Sluzy do odswiezania, nie do wyswietlania.';

-- ---------------------------------------------------------------------
-- 3. Widok podaje nasz adres, gdy go mamy
--
-- `create or replace` WYSTARCZA, bo lista kolumn, ich nazwy, typy i kolejnosc
-- sa identyczne — zmienia sie wylacznie wyrazenie pod `photo_url`. Wzorzec C
-- (drop + create) obowiazuje przy zmianie KSZTALTU widoku, a tu ksztalt stoi.
-- ---------------------------------------------------------------------
create or replace view mp_obecnosc_kontekst as
select
  r.id, r.full_name, r.slug, r.klub, r.active,

  -- Adres wychodzi z widoku TYLKO wtedy, gdy sprawdziliśmy, że pod nim coś
  -- jest (`photo_exists`, migracja 0018). Frontend nie ma więc jak
  -- wyrenderować zepsutego obrazka — dostaje NULL i rysuje inicjały.
  --
  -- NOWE w 0023: najpierw nasza kopia, potem adres źródłowy. Poseł bez kopii
  -- zachowuje się dokładnie tak jak przed tą migracją.
  case when m.photo_exists then coalesce(m.photo_stored_url, m.photo_url) end as photo_url,
  m.district_num,
  m.district_name,
  m.voivodeship,

  -- obecnosc: byl na sali
  r.votes_total, r.attendance_pct, r.attendance_lo, r.attendance_hi,

  -- udzial: nacisnal przycisk (migracja 0007)
  r.voted_pct, r.present_count, r.absent_count,

  -- zgodnosc z klubem (migracje 0004, 0006, 0009)
  r.loyalty_pct, r.loyalty_lo, r.loyalty_hi, r.loyalty_votings,

  -- Ta sama liczba widziana z drugiej strony. Nie jest przechowywana —
  -- jest LICZONA z loyalty_pct, zeby nie dalo sie doprowadzic do stanu,
  -- w ktorym zgodnosc i niezgodnosc nie sumuja sie do stu.
  case when r.loyalty_pct is not null then round(100.0 - r.loyalty_pct, 1) end as niezgodnosc_z_klubem_pct,
  case when r.loyalty_hi  is not null then round(100.0 - r.loyalty_hi,  1) end as niezgodnosc_lo,
  case when r.loyalty_lo  is not null then round(100.0 - r.loyalty_lo,  1) end as niezgodnosc_hi,

  r.niepewnosc_pkt, r.zakres_mandatu,
  r.first_voted_at, r.last_voted_at,

  a.miesiecy_lacznie,
  a.miesiecy_prawie_bez_obecnosci,
  case
    when r.attendance_pct >= 90 then 'brak istotnych nieobecnosci'
    when a.miesiecy_prawie_bez_obecnosci >= 0.5 * a.miesiecy_lacznie then 'nieobecnosc ciagla — sprawdz funkcje panstwowa lub przerwe w mandacie'
    when a.miesiecy_prawie_bez_obecnosci > 0 then 'nieobecnosc czesciowo skupiona w czasie'
    else 'nieobecnosc rozproszona'
  end as ksztalt_nieobecnosci,
  (select string_agg(ro.role_name || ' (od ' || ro.date_from || coalesce(' do ' || ro.date_to, '') || ')', '; ')
     from mp_roles ro where ro.mp_id = r.id) as funkcje_panstwowe,

  m.inactive_cause,
  m.waiver_desc,

  case
    when m.active then null
    when m.inactive_cause = 'Zgon' then 'Mandat wygasł — poseł zmarł w trakcie kadencji.'
    when m.waiver_desc is not null then 'Mandat wygasł: ' || m.waiver_desc || '.'
    when m.inactive_cause is not null then 'Mandat wygasł: ' || m.inactive_cause || '.'
    else 'Mandat wygasł w trakcie kadencji.'
  end as powod_zakonczenia,

  (m.inactive_cause is distinct from 'Zgon') as w_rankingu

from mp_stats_ranking r
join mps m on m.id = r.id
left join lateral (
  select
    count(*)::int                                   as miesiecy_lacznie,
    count(*) filter (where mm.absent_pct >= 80)::int as miesiecy_prawie_bez_obecnosci
  from mp_absence_monthly mm
  where mm.mp_id = r.id
) a on true;

alter view mp_obecnosc_kontekst set (security_invoker = on);
grant select on mp_obecnosc_kontekst to anon, authenticated;

comment on view mp_obecnosc_kontekst is
  'Kontrakt dla src/lib/queries.ts. niezgodnosc_* jest LICZONA z loyalty_*, nie przechowywana osobno. photo_url to NASZA kopia, gdy jest, inaczej adres Sejmu — i zawsze tylko przy photo_exists.';

-- ---------------------------------------------------------------------
-- KONTROLA KONTRAKTU — lista identyczna z KOLUMNY_KONTEKST w queries.ts
-- ---------------------------------------------------------------------
do $$
declare
  wymagane text[] := array['id','full_name','slug','klub','active','photo_url',
    'district_num','district_name','voivodeship','votes_total','attendance_pct',
    'attendance_lo','attendance_hi','voted_pct','present_count','absent_count',
    'loyalty_pct','loyalty_lo','loyalty_hi','loyalty_votings',
    'niezgodnosc_z_klubem_pct','niezgodnosc_lo','niezgodnosc_hi','niepewnosc_pkt',
    'zakres_mandatu','first_voted_at','last_voted_at','miesiecy_lacznie',
    'miesiecy_prawie_bez_obecnosci','ksztalt_nieobecnosci','funkcje_panstwowe',
    'inactive_cause','waiver_desc','powod_zakonczenia','w_rankingu'];
  brakujace text;
begin
  select string_agg(k, ', ') into brakujace from unnest(wymagane) k
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema='public' and c.table_name='mp_obecnosc_kontekst' and c.column_name=k
  );
  if brakujace is not null then
    raise exception 'Widok mp_obecnosc_kontekst nie wystawia kolumn: %', brakujace;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Kontrola sensu: widok nie ma prawa wypuscic adresu przy photo_exists
-- innym niz true. To jest zabezpieczenie z 0018 i ma dzialac dalej —
-- coalesce dolozony w tej migracji nie moze go obejsc.
-- ---------------------------------------------------------------------
do $$
declare wyciek int;
begin
  select count(*) into wyciek
  from mp_obecnosc_kontekst k
  join mps m on m.id = k.id
  where k.photo_url is not null and m.photo_exists is distinct from true;
  if wyciek > 0 then
    raise exception 'Widok wypuszcza adres zdjecia dla % poslow bez potwierdzenia HEAD-em.', wyciek;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Kontrola sensu: kubelek musi byc publiczny, inaczej strona pokaze
-- 499 zepsutych obrazkow zamiast portretow.
-- ---------------------------------------------------------------------
do $$
declare publiczny boolean;
begin
  select public into publiczny from storage.buckets where id = 'portrety';
  if publiczny is null then
    raise exception 'Kubelek "portrety" nie powstal.';
  end if;
  if not publiczny then
    raise exception 'Kubelek "portrety" nie jest publiczny — strona nie odczyta zdjec.';
  end if;
end $$;

-- =====================================================================
-- WYNIK — stan kopiowania. Po tej migracji wszystko ma byc jeszcze
-- niekopiowane; zdjecia przenosi `npm run ingest:zdjecia`.
-- =====================================================================
select
  count(*)                                            as poslow,
  count(*) filter (where photo_exists)                as ze_zdjeciem_u_zrodla,
  count(*) filter (where photo_stored_url is not null) as skopiowanych_do_nas,
  count(*) filter (where photo_exists and photo_stored_url is null) as do_skopiowania
from mps;
