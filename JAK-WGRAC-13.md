# Paczka 13 — import dotacji z SUDOP

**Nadpisz pliki w `C:\Projects\obywatel`, zachowując strukturę katalogów.**
Nic nie usuwaj — ta paczka nie zastępuje żadnego wcześniejszego pliku poza
czterema wymienionymi niżej jako zmienione.

## Co jest w paczce

**Nowe:**

```
supabase/migrations/0012_sudop_dotacje.sql
ingest/lib/csv.ts
ingest/mappers/sudop.ts
ingest/mappers/sudop.test.ts
ingest/jobs/import-sudop-csv.ts
ingest/jobs/sync-sudop-gminy.ts
```

**Zmienione (nadpisz):**

```
ingest/lib/source-recorder.ts   — nowy rodzaj źródła `sudop_csv` + data pobrania pliku
ingest/lib/preflight.ts         — assertSchema() przyjmuje wymogi modułu
package.json                    — dwa nowe skrypty
docs/sudop.md                   — korekta: eksport JEDNAK zawiera lokalizację
docs/decyzje.md                 — decyzja D15
docs/zrodla-danych.md           — trzy wiersze zamiast jednego „zaparkowane"
docs/wniosek-uokik-sudop.md     — usunięte zdanie, które okazało się nieprawdą
```

## Kroki

### 1. Migracja

W SQL Editorze Supabase wykonaj **całą** zawartość
`supabase/migrations/0012_sudop_dotacje.sql`.

Na końcu powinieneś zobaczyć:

```
NOTICE:  Kontrakt widoku dotacje_publiczne spelniony — 18 kolumn.
```

Jeśli zamiast tego wyskoczy `ERROR`, wklej go — migracja jest napisana tak,
żeby raczej nie przejść, niż przejść po cichu w połowie.

### 2. Testy

```
npm test
```

Oczekiwane: **67 passed** (36 poprzednich + 31 nowych).

### 3. Słownik gmin

```
npx tsx --env-file=.env.local ingest/jobs/sync-sudop-gminy.ts
```

Oczekiwane: około **4 170 gmin**. To jedyny endpoint API SUDOP, który działa —
bez niego kod `0264011` w interfejsie zostanie siedmioma cyframi zamiast
napisu „Wrocław".

Jeśli zamiast tego zobaczysz `NIE ROZPOZNAJE KSZTALTU SLOWNIKA GMIN` razem
z wypisanym rekordem — wklej mi ten rekord. Kształt tej odpowiedzi sprawdziłem
na innym słowniku i celowo nie zakładam, że ten wygląda tak samo.

### 4. Import próbki na sucho

```
npx tsx --env-file=.env.local ingest/jobs/import-sudop-csv.ts C:\sciezka\do\przypadki_pomocy.csv --z=aidEvent --sucho
```

`--sucho` przetwarza cały plik i raportuje, ale **nic nie zapisuje**.
Zobaczysz kodowanie, liczbę kolumn, zakres dat, sumę kwot, ile wierszy jest
bez NIP-u i bez kodu gminy.

### 5. Import na serio

Ten sam wiersz bez `--sucho`. Na końcu leci kontrola sum:

```
Wierszy w pliku:      N
Duplikaty w pliku:    x
Nowych w bazie:       y
Bylo juz wczesniej:   z
Kontrola sum: OK.
```

Jeśli `Kontrola sum` nie wyjdzie, job krzyknie i **nie wolno wtedy niczego z tego
importu publikować**, dopóki nie sprawdzimy, gdzie zniknęły wiersze.

### 6. Sprawdzenie w bazie

```sql
select * from dotacje_publiczne;
```

Powinieneś zobaczyć nazwę gminy obok kodu TERYT oraz adres źródła i datę pobrania
przy każdym wierszu.

---

## Czego potrzebuję od Ciebie dalej

**Jednego większego eksportu.** Próbka miała jeden wiersz — wystarczyła, żeby
ustalić format co do bajtu, ale nie sprawdzi zachowania przy tysiącach wierszy
ani przy powtórkach między dwoma eksportami tego samego programu.

Wejdź na `/search/aidSource`, wybierz jakiś duży program, przejdź do beneficjentów
i zapisz wynik jako CSV. Potem krok 4 i wklej mi log.

**Nie otwieraj pliku w Excelu przed importem.** Excel przekoduje polskie znaki
i potrafi przenumerować kolumny — import to wykryje i przerwie, ale szkoda czasu.
