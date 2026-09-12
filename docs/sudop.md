# SUDOP — rekonesans i import

**Status:** rozpoznanie **zamknięte i rozstrzygnięte**. Importer CSV działa
i ma w bazie pierwszy kompletny program (127 wierszy). API rejestruje zgłoszenia,
ale ich nie kończy — pomiar w sekcji 1d.
**Moduł:** „Radar Sąsiedzki" i „Paragon Podatkowy" — nadal poza MVP, ale **wykonalne**
(patrz korekta w 3a).
**Co odblokuje pełną skalę:** odpowiedź UOKiK — najpierw e-mail techniczny
do administratorów, potem ewentualnie wniosek formalny (`wniosek-uokik-sudop.md`,
wersja 2). Bez tego moduł działa, tylko rośnie ręcznie, program po programie.

Ten dokument istnieje po to, żeby powrót do tematu nie wymagał powtarzania
całego rekonesansu. Wszystko poniżej jest **zmierzone**, nie założone —
a to, co kiedyś było założone i okazało się nieprawdą, zostaje w tekście
razem z powodem.

---

## Stan wiedzy w jednym akapicie

SUDOP ma dwa niezależne systemy. **REST API** (`api-sudop.uokik.gov.pl`) działa
dla słowników i **poprawnie rejestruje** wyszukiwania przypadków pomocy — wydaje
identyfikator zgłoszenia — ale w dostępie anonimowym nie wytwarza wyników.
Zmierzone na jednym identyfikatorze przez sześć minut, sekcja **1d**.
**Aplikacja webowa** (`sudop.uokik.gov.pl`) to JSF/PrimeFaces, nie korzysta z tego API,
zwraca dane natychmiast i eksportuje je do **CSV** — i to jest dziś nasza droga:
człowiek pobiera plik, importer go wczytuje. Pierwszy kompletny program
(C 43/2005, 127 wierszy) jest w bazie.

---

## 1. REST API — co działa, a co nie

Baza: `https://api-sudop.uokik.gov.pl/sudop-api`

### Słowniki — działają bez zarzutu

| Endpoint | Pozycji | Czas |
|---|---:|---:|
| `/slownik/forma-pomocy` | 70 | 126 ms |
| `/slownik/przeznaczenie-pomocy` | 450 | 49 ms |
| `/slownik/srodek-pomocowy` | 1 837 | 113 ms |
| `/slownik/sektor-dzialalnosci` | 3 518 | 103 ms |
| `/slownik/gmina-siedziby` | **4 170** | 96 ms |

Format pozycji: `{"name": "...", "number": "A1.1", "dateEnd": "9999-12-31"}`.
`gmina-siedziby` niesie kody TERYT w polu `number` — to gotowy indeks lokalizacji
dla całego modułu.

**Kody TERYT w tym słowniku się powtarzają.** Pierwszy import wywalił się na
`ON CONFLICT DO UPDATE command cannot affect row a second time` — Postgres odmawia
zaktualizowania tego samego wiersza dwa razy w jednej kwerendzie i ma rację.
4 170 pozycji przy około 2 477 gminach w Polsce oznacza, że słownik niesie też wpisy
historyczne (zmiany nazw, połączenia gmin). Import wybiera wpis z najpóźniejszą
datą końca obowiązywania, a każdy przypadek **różnych nazw pod jednym kodem**
wypisuje na ekran — żeby wybór był widoczny, a nie cichy.

### Przypadki pomocy — WNIOSEK WYCOFANY, patrz niżej

> **KOREKTA z 4 września 2026.** Wszystko w tej sekcji opisuje, co zobaczyliśmy —
> ale wniosek, który z tego wyciągnąłem, był błędny. Urząd publikuje specyfikację
> OpenAPI pod `https://api-sudop.uokik.gov.pl/sudop-api/v3/api-docs` i wynika z niej,
> że protokół jest inny, niż zakładałem, a jedna ze ścieżek nigdy nie została
> przez nas wywołana. Szczegóły w sekcji **1a**. Poniższe zapisy zostawiam jako
> zapis tego, co zmierzyliśmy, nie jako opis możliwości API.

`/api/przypadki-pomocy?nip-beneficjenta=…&strona=1` → **HTTP 200** z ciałem:

```
"Przygotowywanie odpowiedzi, przewidywany czas to 60 sekund"
```

Sprawdzone w trzech niezależnych seriach, łącznie kilkanaście minut odpytywania,
odstępy 20–60 s. **Ani razu nie wróciły dane.**

Wykluczone przyczyny:

- **Zła ścieżka.** Dokumentacja podaje `/sudop-api/api/…` (bez `/v1`); sprawdzone obie.
- **Ciasteczko sesji.** Odpowiedzi nie zawierają `Set-Cookie` — nie ma czym powiązać
  ponownego zapytania ze zgłoszeniem. Hipoteza sprawdzona i obalona sondą 27.
- **Złe parametry.** Serwer sam je nazywa w komunikatach błędów, więc je rozpoznaje.

### Parametry — potwierdzone przez komunikaty serwera

```
nip-beneficjenta            nip-udzielajacego-pomocy
srodek-pomocowy-numer       forma-pomocy-kod
przeznaczenie-pomocy-kod    sektor-dzialalnosci-kod
gmina-siedziby-kod          dzien-udzielenia-pomocy-od / -do
strona
```

Zapytanie zawężone **wyłącznie datą** zwraca:

> „Nie podano żadnych wymaganych kryteriów. Dodaj kryteria wyszukiwania inne niż
> strona oraz dzień udzielenia pomocy"

To jest dowód, że parametry dat są przetwarzane — data musi jedynie występować
razem z innym kryterium. Limit: do 10 000 wierszy na stronę.

### Limitowanie

Deklarowane 8 zapytań na sekundę. W praktyce nginx zwraca `429` znacznie wcześniej —
sonda strzelająca co 2 s dostała `429` po kilkunastu zapytaniach. Limit jest
prawdopodobnie minutowy lub godzinowy, nie sekundowy.

---

## 1a. Specyfikacja OpenAPI — czego nie przeczytałem

Urząd publikuje maszynową specyfikację swojego API:

```
https://api-sudop.uokik.gov.pl/sudop-api/v3/api-docs
```

Adres dokumentacji podany na stronie UOKiK (`…:9443/devportal/apis`) przekierowuje
dziś na `/swagger/`, czyli na interfejs Swaggera, który ładuje właśnie tę
specyfikację. Nie otworzyłem jej ani razu przez cały rekonesans.

### Co jest w specyfikacji

**Ścieżki, których nie próbowaliśmy:**

| Ścieżka | Znaczenie |
|---|---|
| `/api/przypadki-pomocy-bez-kolejki` | te same parametry co wyżej, **z pominięciem kolejki** |
| `/api/kolejka/{queueId}` | stan zgłoszenia |
| `/api/wynik/{requestId}?csv=true` | wynik, opcjonalnie **od razu jako CSV** |
| `/wersja` | wersja usługi |

**Protokół jest inny, niż zakładałem.** Specyfikacja opisuje odpowiedź
`303 „Zarejestrowano wyszukanie"` z nagłówkiem `Location`, a nie `200`
z komunikatem o czekaniu.

**Brak `securitySchemes`.** W całej specyfikacji nie ma żadnego schematu
uwierzytelniania — API nie deklaruje wymogu klucza.

**Schemat wyniku** (`AidEventEntity`) zawiera ~~29~~ **28** pól, w tym
`gmina-siedziby-kod` i `gmina-siedziby-nazwa`, `wielkosc-beneficjenta-kod`,
`sektor-dzialalnosci-wersja` oraz wszystkie trzy wartości pomocy. To **więcej**,
niż daje eksport CSV.

> **Poprawka z 12.09.2026.** Było 29, jest 28 — policzone z zapisanego pliku
> specyfikacji (`scripts/probes/out/32-sudop-openapi.json`), a nie z lektury.
> Pełna lista pól i porównanie z oboma eksportami CSV:
> [`uokik-korespondencja.md`](uokik-korespondencja.md) §6.
>
> Przy okazji wyszło coś ważniejszego: **`gmina-siedziby-kod` jest także
> PARAMETREM wyszukiwania**, tablicowym i opcjonalnym. Specyfikacja dopuszcza
> więc zapytanie „cała pomoc w gminach X, Y, Z w okresie od–do" — czyli
> „Radar Sąsiedzki" jednym zapytaniem na gminę zamiast setek po NIP-ach.
> Sprzeczne z zapisem niżej o walidacji formularza WWW; nierozstrzygnięte.

### Dlaczego tego nie zobaczyliśmy

`fetch()` domyślnie sam podąża za przekierowaniem. Odpowiedź `303` z nagłówkiem
`Location` została skonsumowana przez klienta, sonda pokazała `HTTP 200` z treścią
„Przygotowywanie odpowiedzi, przewidywany czas to 60 sekund" — czyli **stan kolejki
spod adresu, na który nas przekierowano**. Na tej podstawie zapisałem w dokumentacji
i w projekcie pisma do Urzędu, że „odpowiedzi nie zawierają nagłówka `Location`,
nie ma więc możliwości powiązania ponownego zapytania ze zgłoszeniem".

Nagłówek był. Nie zobaczyłem go, bo klient go za mnie odczytał i wyrzucił.

To jest **szósty** przypadek tego samego błędu w tym projekcie i najpoważniejszy:
o krok od wysłania do organu administracji pisma z nieprawdziwym twierdzeniem
o jego własnym systemie. Sonda 28 (`npm run probe:sudop-api`) używa
`redirect: 'manual'` i wypisuje każdy skok osobno.

### 1b. Co zmierzyła sonda 28 — protokół działa

Uruchomiona 4 września 2026, 19:40 UTC:

```
GET /sudop-api/wersja
    200  {"major":"1","minor":"0","patch":"0","dateMod":"01.12.2025"}

GET /sudop-api/api/przypadki-pomocy-bez-kolejki?nip-beneficjenta=…
    303  Location: /sudop-api/api/wynik/3f19ceef-c30a-4e9e-a676-48c017abfa07

GET /sudop-api/api/wynik/3f19ceef-…   (1,5 s później)
    404  {"error-result":"Brak zasobu","error-reason":"Nie znaleziono rekordu…"}

GET /sudop-api/api/przypadki-pomocy?nip-beneficjenta=…
    303  Location: /sudop-api/api/kolejka/71b7281b-5222-454e-bad5-8379cf036e79

GET /sudop-api/api/kolejka/71b7281b-…   (8 razy przez ~40 s)
    200  "Przygotowywanie odpowiedzi, przewidywany czas to 60 sekund"
```

Ustalone: **ścieżka bazowa to `/sudop-api`** (bez niej nginx zwraca 404),
API odpowiada, wersja z 1 grudnia 2025, identyfikatory zgłoszeń istnieją
i mają postać UUID.

### 1c. Dwa błędy po naszej stronie, oba wykryte tym pomiarem

**Starsze sondy tworzyły nowe zgłoszenie zamiast odpytywać stare.** Zapisałem
wcześniej, że „ponawiałem odpytywanie tego samego adresu w odstępach 30–60 sekund
przez łącznie ponad cztery minuty". Ponawiany był adres `/api/przypadki-pomocy`,
a **każde jego wywołanie rejestruje nowe wyszukanie z nowym identyfikatorem**.
Odpytywaliśmy więc za każdym razem świeżo utworzone zadanie. Ani razu nie
sprawdziliśmy tego samego identyfikatora dwa razy z rzędu.

**Sonda 28 poddała się przed czasem, o który prosi serwer.** Osiem prób co pięć
sekund to około 40 sekund. Serwer deklaruje 60.

Stąd sonda 29 (`npm run probe:sudop-czekaj`): rejestruje każde z dwóch wyszukań
**dokładnie raz** i odpytuje te same dwa identyfikatory na przemian przez sześć
minut. Obciążenie serwera: dwa wyszukania na całe uruchomienie.

### 1d. Sonda 29 — pomiar rozstrzygający

**4 września 2026, 21:15:57–21:22:04 UTC.** Dwie rejestracje, 36 odpytań tych
samych dwóch identyfikatorów, 365 sekund.

```
21:15:57  GET /api/przypadki-pomocy-bez-kolejki?nip-beneficjenta=6150022153&strona=1
          303  Location: /sudop-api/api/wynik/4976bbc9-1128-4fb0-8d39-37e46bb85aab

21:15:59  GET /api/przypadki-pomocy?nip-beneficjenta=6150022153&strona=1
          303  Location: /sudop-api/api/kolejka/3451e176-5e49-4c66-af69-c1adf9d3c26d

21:16:09 → 21:22:04   (36 odpytań, co 10 s, TE SAME identyfikatory)

  /api/wynik/4976bbc9-…    404  {"error-result":"Brak zasobu",
                                 "error-reason":"Nie znaleziono rekordu
                                  o podanym identyfikatorze"}          ← 36 razy
  /api/kolejka/3451e176-…  200  "Przygotowywanie odpowiedzi,
                                 przewidywany czas to 60 sekund"       ← 36 razy
```

**Wynik: żadna z dwóch ścieżek nie zwróciła danych.** Kolejka podawała ten sam
komunikat o 60 sekundach jeszcze po 365 sekundach — sześciokrotnie dłużej,
niż deklaruje. Ścieżka `bez-kolejki` rejestruje wyszukanie i wydaje identyfikator
wyniku, ale zasób pod tym identyfikatorem nie powstaje.

To jest pomiar, którego brakowało przez cały rekonesans: **jedno zgłoszenie,
jeden identyfikator, cierpliwe odpytywanie**. Wcześniejsze próby mierzyły
wyłącznie to, że świeżo utworzone zadanie nie jest gotowe od razu.

Wniosek — tym razem oparty na poprawnie wykonanym pomiarze: **anonimowy dostęp
do API rejestruje wyszukania, ale ich nie kończy.** Ograniczenie jest po stronie
przetwarzania zgłoszeń, nie po stronie konstrukcji zapytań ani nagłówków.

---

## 2. Aplikacja webowa — inny system, te same dane

`https://sudop.uokik.gov.pl` — **JSF / PrimeFaces**, stan serwerowy w `javax.faces.ViewState`,
identyfikatory komponentów generowane automatycznie (`j_idt11`, `j_idt37`…).
**Nie odwołuje się do `api-sudop`** — ma własne zaplecze.

### Trzy strony wyszukiwania

| Adres | Opis |
|---|---|
| `/search/aidSource` | Wyszukiwanie środków pomocowych |
| `/search/aidEvent` | **Wyszukiwanie beneficjentów wybranych środków pomocowych** |
| `/search/aidBeneficiary` | Wyszukiwanie pomocy otrzymanej przez beneficjenta |

### `/search/aidBeneficiary` — inny format pliku, nie inna tabela

Kryteria: NIP beneficjenta, data od, data do, „Zakres pomocy".
Format zapisu: **`PDF` albo `CSV`**, wybierany przed wysłaniem formularza.
Żądanie: `POST /search/aidBeneficiary` z polami JSF i `ViewState`.

**Eksport z tej strony to RAPORT, nie tabela danych.** Zmierzone na pliku
`przypadki_pomocy_beneficjenta.csv` (12,5 KB, CP1250): parser zobaczył 5 kolumn
zamiast 14, a nagłówek wygląda tak:

```
Nazwa beneficjenta pomocy
Numer Identyfikacji Personalnej (NIP) beneficjenta pomocy
Zakres raportu od
do
Data wygenerowania raportu
```

To nie są nazwy kolumn danych — to **metryczka raportu**: kto, za jaki okres,
kiedy wygenerowano. Dane szczegółowe muszą siedzieć niżej, w innym układzie.
Kontrakt nagłówka przerwał import i nic nie zapisał, czyli zachował się dokładnie
tak, jak miał: plik o innym znaczeniu nie wjechał do tabeli `subsidies` po cichu.

### Układ pliku — zmierzony

Plik ma **trzy warstwy**, nie jedną tabelę:

```
wiersz 1   naglowek metryczki   (5 kolumn)
wiersz 2   metryczka            beneficjent, NIP, zakres od, do, data wygenerowania
wiersz 3   naglowek danych      (19 kolumn)
wiersz 4+  dane                 po jednym przypadku pomocy
```

Kolumny danych (19):

```
 0  Podstawa prawna - informacje podstawowe 2a      6  Numer środka pomocowego
 1  2b                                              7  Dzień udzielenia pomocy
 2  2c                                              8  Nazwa podmiotu udzielającego pomocy
 3  Podstawa prawna - informacje szczegółowe 3a     9  NIP podmiotu udzielającego pomocy
 4  3b                                             10  Wartość nominalna pomocy [PLN]
 5  3c                                             11  Wartość pomocy brutto [PLN]
                                                   12  Wartość pomocy brutto [EURO]
13  Forma pomocy            15  Klasa PKD          17  Wielkość beneficjenta kod
14  Przeznaczenie pomocy    16  Wersja PKD         18  Wielkość beneficjenta
```

Różnice wobec eksportu z `aidEvent`, wszystkie istotne:

- **Nazwa i NIP beneficjenta są w metryczce, nie w wierszu.** Jeden plik = jeden podmiot.
- **Jest NIP podmiotu udzielającego pomocy** — `aidEvent` daje tylko nazwę.
- **Nie ma kodu TERYT.** Ten eksport nie wspiera modułu lokalnego.
- **Słowniki są kodowane:** `A1.1 dotacja`, `E inne`, `C1.4 pożyczki warunkowo umorzone`,
  `a14 pomoc na szkolenia` — kod i nazwa w jednym polu. W `aidEvent` jest sam tekst
  („zwolnienie z podatku").
- **`Wielkość beneficjenta kod` = 3 przy „duży przedsiębiorca"** — potwierdza odczytanie
  słownika: 0 = mikro, 1 = małe, 2 = średnie, 3 = powyżej.
- **W nagłówku jest „nominalna", bez literówki** — ta sama wartość, inna pisownia
  niż w `aidEvent`. Dwa eksporty, dwa kontrakty.
- Numer środka pomocowego **bywa pusty** (starsze wpisy sprzed systemu numeracji).

### Dlaczego mapper czeka

Ten sam przypadek pomocy występuje w obu eksportach: PGE Elektrownia Turów,
`C 43/2005`, 01.04.2008, 438 463 177,00 zł jest i w naszej bazie z `aidEvent`,
i w tym pliku. Import bez klucza naturalnego **podwoiłby kwoty** — a to jest
najgorszy możliwy błąd w tekście o pieniądzach publicznych.

Do tego specyfikacja OpenAPI (sekcja 1a) opisuje odpowiedź z **29 polami**,
w tym `gmina-siedziby-kod`, czyli bogatszą niż oba eksporty CSV razem wzięte.
Pisanie drugiego parsera CSV, zanim wiadomo, czy API działa, byłoby pracą
prawdopodobnie do wyrzucenia. **Najpierw sonda 28.**

### `/search/aidEvent` — ma lokalizację, to jest ta strona

Etykiety pól odczytane z DOM:

```
Środek pomocowy - numer referencyjny        (1 109 pozycji)
Przeznaczenie pomocy                        (173)
Wielkość beneficjenta                       (6)
Sektor działalności
Lokalizacja siedziby beneficjenta      <-- KLUCZOWE
Dzień udzielenia pomocy od - do
Forma pomocy                                (59)
Podmiot udzielający pomocy - NIP            (6 919)
Wartość pomocy brutto — od / do, PLN / EURO
```

Atrybut `required` nie występuje w DOM, ale **walidacja jest po stronie serwera**:
bez wskazania środka pomocowego formularz nie przepuszcza wyszukiwania.
Sprawdzone ręcznie — nie da się wyszukać po samej lokalizacji i dacie.

### Rzeczywisty przebieg pracy w aplikacji

```
/search/aidSource   →  /results/aidSource
                       lista środków, checkboxy, eksport CSV
                       „Zaznacz do zapisu/wydruku środków lub wyszukania beneficjentów"
                              ↓ wybór środków
/search/aidEvent    →  /results/aidEvent
                       lista beneficjentów, checkboxy, eksport CSV
```

**Środek pomocowy jest obowiązkowy na drugim kroku.** W UI jest ich 1 109.

### Kolumny wyniku `/results/aidEvent` — ekran kłamie, plik nie

Na ekranie widać sześć kolumn:

```
Nazwa beneficjenta pomocy · NIP beneficjenta · Numer środka pomocowego
Dzień udzielenia pomocy · Wartość pomocy brutto [PLN] · Wartość pomocy brutto [EURO]
```

**Plik CSV ma ich czternaście.** Zmierzone na prawdziwym eksporcie
(`przypadki_pomocy.csv`, pobrany 2026-09), bajt po bajcie:

| # | Kolumna | Wartość w próbce |
|---:|---|---|
| 0 | Nazwa beneficjenta pomocy | `Opolska Sp. z o.o.` |
| 1 | NIP beneficjenta | `8992747797` |
| 2 | Podmiot udzielający pomocy | `Prezydent Wrocławia` |
| 3 | Ustawa | `ustawa z dnia 12 stycznia 1991 r. o podatkach i opłatach lokalnych` |
| 4 | Numer środka pomocowego | `XR97/2007` |
| 5 | Dzień udzielenia pomocy | `31.01.2020` |
| 6 | Wielkość beneficjenta | `małe przedsiębiorstwo` |
| 7 | **Identyfikator terytorialny siedziby beneficjenta** | **`0264011`** |
| 8 | Klasa PKD | `68.20` |
| 9 | Wartość **nominana** pomocy [PLN] | `184 122,10` |
| 10 | Wartość pomocy brutto [PLN] | `184 122,10` |
| 11 | Wartość pomocy brutto [EURO] | `42 809,14` |
| 12 | Forma pomocy | `zwolnienie z podatku` |
| 13 | Przeznaczenie pomocy | `regionalna pomoc inwestycyjna` |

**„Wielkość beneficjenta" to tekst z epoki, nie słownik.** W eksportach wystąpiły
cztery różne brzmienia, w tym „duży przedsiębiorca" obok „beneficjent nienależący
do kategorii określonych kodem od 0 do 2" i „przedsiębiorstwo nienależące…".
Sformułowanie zdradza słownik źródłowy: 0 = mikro, 1 = małe, 2 = średnie, a wszystko
powyżej nie ma własnej nazwy. **Nie sprowadzamy tych brzmień do jednej kategorii** —
„duży przedsiębiorca" i „beneficjent nienależący do kategorii 0–2" to nie jest
dowodliwie to samo, bo drugie może obejmować podmioty, które w ogóle nie są
przedsiębiorcami. Import przepuszcza nowe brzmienia, ale je wypisuje.

Format pliku: **CP1250** (bajt `0xB9` w „udzielający"; w ISO-8859-2 byłoby `0xB1`),
separator `;`, wszystkie pola w cudzysłowach, końce linii CRLF, bez BOM.
Kwoty ze spacją jako separatorem tysięcy i przecinkiem dziesiętnym, daty `dd.mm.rrrr`.
Literówka „nominana" jest w źródle — parser trzyma ją w kontrakcie nagłówka celowo.

**Kolumna 7 to kod TERYT gminy**, w dokładnie tym samym formacie co słownik
`gmina-siedziby` z API (4 170 pozycji, endpoint działa). Eksport **niesie
lokalizację**.

Eksport CSV jest dostępny na obu stronach wyników.

Uwaga: słowniki w UI są **mniejsze** niż w API (1109 vs 1837 środków, 173 vs 450
przeznaczeń, 59 vs 70 form). Wyszukiwarka pokazuje prawdopodobnie tylko pozycje
obowiązujące, API zwraca komplet historyczny. Nasze słowniki będą pełniejsze
niż to, co widać w formularzu.

---

## 3. Czego NIE robimy i dlaczego

**Nie automatyzujemy wyszukiwarki webowej.** Trzy powody, w kolejności wagi:

1. **To projekt o rozliczalności instytucji publicznych.** Pierwszy zarzut przy
   pierwszym tekście o czyichś dotacjach będzie dotyczył pochodzenia danych.
   „Obchodziliśmy oficjalny kanał, automatyzując interfejs dla ludzi" to odpowiedź,
   której nie chcemy udzielać.
2. **Skala.** Każde wyszukanie to serwerowa sesja JSF i wpis w kolejce. Przy 2 477 gminach
   z logów UOKiK wyglądałoby to jak atak.
3. **Kruchość.** `j_idt11`, `j_idt37` to identyfikatory generowane automatycznie.
   Zmienią się przy dodaniu jednego pola w formularzu. Import psułby się bez ostrzeżenia
   i bez naszej winy.

Droga dopuszczalna: **człowiek pobiera oficjalny eksport CSV, my importujemy plik.**
Bez skrobania, bez kruchości, bez zarzutu.

---

## 3a. Co z tego wynika dla modułów — po korekcie

> **Korekta.** Wcześniejsza wersja tej sekcji mówiła, że „Radar Sąsiedzki" jest
> niewykonalny, bo lokalizacji nie ma w kolumnach wyniku. To było błędne.
> Napisałem to, patrząc na nagłówki widoczne na stronie wyników, a nie na plik.
> Plik ma kolumnę z kodem TERYT. Zostawiam błąd w dokumencie razem z powodem,
> bo to była **piąta** pomyłka tego samego rodzaju w tym projekcie i jedyne,
> co z niej zostaje pożytecznego, to zapis, jak wygląda.

| Ścieżka | Wykonalna? | Jak |
|---|---|---|
| **Radar Sąsiedzki** — dotacje w mojej gminie | **tak, ale nie wprost** | Wyszukiwarka nie pozwala pytać o samą gminę, więc filtrujemy **po naszej stronie**: importujemy eksporty programów, indeksujemy `subsidies.teryt`, pytanie „co dostano w mojej gminie" obsługuje nasza baza. Koszt: pokrycie rośnie programami, nie gminami. |
| **Kto dostał z programu X** | **tak** | Jeden środek pomocowy → lista beneficjentów → CSV. Kilkanaście kliknięć na program. |
| **Sprawdź firmę po NIP** | **tak** | `/search/aidBeneficiary`, NIP + zakres dat → CSV. Jedno wyszukanie. |

Wniosek praktyczny: **jednostką pracy jest środek pomocowy, nie gmina.**
Każdy pobrany program powiększa pokrycie mapy w całym kraju naraz. Przy 1 109
środkach w UI pełne pokrycie to zadanie na miesiące ręcznej pracy — ale pierwsze
kilkadziesiąt największych programów da moduł, który już coś pokazuje.

Do czasu pełnego pokrycia interfejs **musi mówić wprost, czego nie wie**:
„na podstawie N zaimportowanych programów, stan na DATA", a nie „dotacje w Twojej
gminie". To ta sama zasada co przy `null` w rankingach (D14) — brak danych nie
jest zerem.

Osobno zostaje argument do wniosku: przy zapytaniu zawężonym samą datą API
odpowiada „dodaj kryteria inne niż strona oraz dzień udzielenia pomocy", co znaczy,
że `gmina-siedziby-kod` sam w sobie jest kryterium wystarczającym. **API pozwala
zadać pytanie o gminę wprost**, interfejs webowy nie. Prosimy więc o dostęp do
możliwości, którą system Urzędu już ma.

## 3ab. Weryfikacja na żywych danych — przeprowadzona

Import został sprawdzony na eksporcie środka pomocowego **C 43/2005** (rekompensaty
KDT dla elektrowni): 30 wierszy, lata 2008–2023, beneficjenci od PGE Elektrownia
Turów po CEZ Chorzów.

**Kwoty zgadzają się co do grosza.** Trzydzieści wartości „Wartość pomocy brutto
[PLN]" odczytanych z **ekranu wyszukiwarki** sumuje się do
`4 095 981 200,75 PLN` — dokładnie tyle, ile podał importer po sparsowaniu pliku.
Przy średniej 136 mln zł na wiersz jeden przecinek w złym miejscu byłby
materiałem na sprostowanie; ta kontrola została zrobiona **zanim** cokolwiek
z tych danych zobaczy czytelnik.

Sprawdzone przy okazji:

| Co | Wynik |
|---|---|
| Deduplikacja między importami | ten sam plik dwa razy → `Nowych w bazie: 0`, `Bylo juz wczesniej: 30` |
| Kontrola sum | `OK` w każdym z sześciu przebiegów |
| Komplet programu | 5 stron wyników → **127 wierszy** w `subsidies`, bez duplikatów |
| Strażnik nagłówka | eksport z `/search/aidBeneficiary` (5 kolumn zamiast 14) **przerwany, nic nie zapisano** |
| Sumy kontrolne NIP-ów | 30/30 poprawnych |
| Kody TERYT | 30/30 obecnych, 5 różnych gmin |
| Kurs walutowy jako sanity check | 438 463 177 PLN / 124 882 704,93 EUR = 3,51 — zgodne z kursem z kwietnia 2008 |

**Uwaga operacyjna:** wyszukiwarka pokazała wyniki na **pięciu stronach**,
a eksport objął wiersze z jednej. Eksport bierze zaznaczone wiersze bieżącej
strony, nie cały wynik wyszukiwania — przy pobieraniu programu trzeba przejść
wszystkie strony albo sprawdzić, czy zaznaczenie w nagłówku obejmuje komplet.

---

## 3b. Import — co jest gotowe

| Element | Plik | Stan |
|---|---|---|
| Parser CP1250 + CSV | `ingest/lib/csv.ts` | działa, wykrywa kodowanie z bajtów |
| Kontrakt nagłówka, kwoty, daty, NIP, TERYT, dedup gmin | `ingest/mappers/sudop.ts` | 36 testów na prawdziwym pliku |
| Tabele `subsidies`, `sudop_gminy`, widok `dotacje_publiczne` | `supabase/migrations/0012_sudop_dotacje.sql` | przetestowana na PostgreSQL 16 |
| Słownik gmin z API | `ingest/jobs/sync-sudop-gminy.ts` | uruchomiony: 4 170 pozycji, powtórzone kody TERYT deduplikowane |
| Import pliku | `ingest/jobs/import-sudop-csv.ts` | gotowy, czeka na prawdziwy eksport |

Uruchomienie:

```
npm run ingest:sudop-gminy
npm run ingest:sudop-csv -- <plik.csv> --z=aidEvent --sucho   # próba na sucho
npm run ingest:sudop-csv -- <plik.csv> --z=aidEvent           # zapis
```

## 4. Co dalej

Kroki 1–3 z poprzedniej wersji tego dokumentu (dokończyć badanie, napisać parser
przeciwko prawdziwemu plikowi, zbudować import) są **wykonane**. Zostaje to:

### Krok A — pierwszy prawdziwy eksport

Próbka miała jeden wiersz. To wystarczyło na kontrakt formatu, ale nie sprawdzi
zachowania przy tysiącach wierszy, duplikatach między eksportami ani przy nazwie
firmy zawierającej średnik. Pobierz **jeden większy program** z `/results/aidEvent`
i uruchom import najpierw z `--sucho`.

### Krok B — kilkadziesiąt największych programów

Jednostką pracy jest środek pomocowy. Zacznij od tych z największą liczbą
beneficjentów — pokrycie mapy rośnie najszybciej na złotówkę wysiłku.
`sync_state` z kluczem `sudop` może trzymać listę już pobranych numerów środków.

### Krok C — wniosek do UOKiK

`docs/wniosek-uokik-sudop.md` — gotowy szkic. Wyślij **niezależnie** od kroków A–B.
Ręczne pobieranie pliku to proteza; docelowo potrzebny jest kanał działający
bez udziału człowieka.

---

## 5. Ryzyko, o którym nie wolno zapomnieć

**Zbieżność nazw i nazwisk.** Zestawienie „firma X dostała dotację" z „X to krewny
posła Y" bez twardego identyfikatora to zniesławienie. W module SUDOP łączymy
wyłącznie po **NIP**, nigdy po nazwie ani nazwisku. Wszystko poza dokładnym
dopasowaniem opisujemy jako „możliwe powiązanie — zweryfikuj w KRS".

## 6. Alternatywa awaryjna

Unijny **Transparency Award Module** Komisji Europejskiej
([webgate.ec.europa.eu](https://webgate.ec.europa.eu/competition/transparency/public?lang=en))
zawiera polskich beneficjentów, ale **wyłącznie pomoc powyżej 100 tys. euro**
i bez udokumentowanego eksportu masowego. Realna alternatywa dla dużych kwot,
bezużyteczna dla lokalnych dotacji.

## Źródła

- [UOKiK — SUDOP: endpointy, parametry, limity](https://archiwum.uokik.gov.pl/sudop.php)
- [Wątek o integracji z API SUDOP](https://4programmers.net/Forum/PHP/349839-sudop_integracja_php)
- [Komisja Europejska — baza przejrzystości pomocy publicznej](https://competition-policy.ec.europa.eu/state-aid/aid-beneficiaries_en)
