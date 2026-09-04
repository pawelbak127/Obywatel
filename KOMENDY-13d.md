# Paczka 13d — gotowe komendy do wklejenia

Wszystko poniżej wykonujesz w PowerShellu, w katalogu `C:\Projects\obywatel`.
Komendy są kompletne — nie ma w nich nic do uzupełnienia poza jedną ścieżką,
którą wskazuję wprost.

## Co jest w paczce

```
supabase/migrations/0013_gminy_nazwy_alternatywne.sql   — NOWY
ingest/jobs/sync-sudop-gminy.ts                         — nadpisz
ingest/mappers/sudop.ts                                 — nadpisz
ingest/mappers/sudop.test.ts                            — nadpisz
docs/sudop.md, docs/decyzje.md                          — nadpisz
```

---

## KROK 1 — migracja 0013

W SQL Editorze Supabase wklej **całą** zawartość
`supabase/migrations/0013_gminy_nazwy_alternatywne.sql`.

Oczekiwane na końcu:

```
NOTICE:  Kontrakt widoku dotacje_publiczne spelniony — 19 kolumn.
```

## KROK 2 — testy

```powershell
npm test
```

Oczekiwane: **77 passed**.

## KROK 3 — słownik gmin jeszcze raz

```powershell
npm run ingest:sudop-gminy
```

Teraz przy każdej z 11 gmin druga nazwa trafi do kolumny `nazwy_alternatywne`
zamiast zniknąć. Oczekiwane: `Gmin w bazie: 4155`.

## KROK 4 — sprawdzenie w bazie

W SQL Editorze Supabase, po kolei:

```sql
-- 1. Dotacje z nazwą gminy i źródłem
select beneficiary_name, gmina, granted_on, value_gross_pln, zrodlo_pobrano::date
from dotacje_publiczne
order by value_gross_pln desc
limit 10;
```

```sql
-- 2. Kontrola sumy: ma wyjść 4 095 981 200,75
select count(*) as wierszy,
       to_char(sum(value_gross_pln), 'FM999G999G999G999D00') as suma_pln
from dotacje_publiczne;
```

```sql
-- 3. Czy któraś dotacja trafiła w gminę bez nazwy
select teryt, count(*) from dotacje_publiczne where gmina is null group by teryt;
```

```sql
-- 4. Gminy o dwóch nazwach — te 11 przypadków
select teryt, nazwa, nazwy_alternatywne
from sudop_gminy
where cardinality(nazwy_alternatywne) > 0
order by teryt;
```

---

## KROK 5 — test strażnika nagłówka (`/search/aidBeneficiary`)

To jest test, którego brakowało. **Najpierw pobierz plik**, potem jedna komenda.

### 5a. Pobranie pliku — w przeglądarce

1. Wejdź na `https://sudop.uokik.gov.pl/search/aidBeneficiary`
2. W polu **NIP beneficjenta** wpisz: `6150022153`
   (to PGE Elektrownia Turów z Twojego eksportu — wiemy, że ma tam dane)
3. Zakres dat zostaw pusty
4. Szukaj → na stronie wyników zaznacz wiersze
5. **Format zapisu: CSV** → zapisz do `Downloads`
6. Zapamiętaj nazwę pliku, jaką nadała przeglądarka

### 5b. Import na sucho — jedna komenda

Podmień **tylko nazwę pliku** na końcu ścieżki:

```powershell
npm run ingest:sudop-csv -- "C:\Users\Kornelia\Downloads\NAZWA_POBRANEGO_PLIKU.csv" --z=aidBeneficiary --sucho
```

**Spodziewam się, że to PRZERWIE** komunikatem
`NAGLOWEK PLIKU NIE ZGADZA SIE Z KONTRAKTEM` i tabelką kolumna po kolumnie.
To jest **dobry wynik** — pokaże, że strażnik działa, i przy okazji wypisze,
jakie kolumny ma eksport z tamtej strony.

Wklej mi całą tabelkę z komunikatu. Jeśli natomiast przejdzie bez błędu,
to znaczy, że obie strony dają identyczny format — też ważna wiadomość.

---

## KROK 6 — pełne pobranie programu C 43/2005 (opcjonalnie, ale warto)

Twój eksport objął **30 wierszy z pierwszej strony**, a wyszukiwarka pokazała
**pięć stron** wyników. Eksport bierze zaznaczone wiersze bieżącej strony, nie
cały wynik wyszukiwania.

Żeby mieć komplet: przejdź kolejno strony 2, 3, 4 i 5, na każdej zaznacz wiersze
i zapisz CSV. Potem cztery komendy — po jednej na plik:

```powershell
npm run ingest:sudop-csv -- "C:\Users\Kornelia\Downloads\strona2.csv" --z=aidEvent
npm run ingest:sudop-csv -- "C:\Users\Kornelia\Downloads\strona3.csv" --z=aidEvent
npm run ingest:sudop-csv -- "C:\Users\Kornelia\Downloads\strona4.csv" --z=aidEvent
npm run ingest:sudop-csv -- "C:\Users\Kornelia\Downloads\strona5.csv" --z=aidEvent
```

Deduplikacja jest już sprawdzona, więc nawet jeśli któraś strona zachodzi na inną,
wiersze się nie zdublują — zobaczysz to w linijce `Bylo juz wczesniej`.
