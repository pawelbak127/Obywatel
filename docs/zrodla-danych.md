# Źródła danych — stan rozpoznania

Wszystkie liczby w tym dokumencie są **zmierzone na żywych API**, nie wzięte
z dokumentacji. Gdzie dokumentacja mówiła co innego niż rzeczywistość, zapisany
jest wynik pomiaru.

| Źródło | Stan | Co daje | Moduł |
|---|---|---|---|
| Sejm API — posłowie | działa | 499 posłów, 13 klubów | Sprint 1 |
| Sejm API — głosowania | działa | 4 569 głosowań, 2,1 mln głosów imiennych | Sprint 2 |
| Sejm API — procesy legislacyjne | działa | etapy z numerami głosowań | Sprint 4 |
| ELI — akty prawne | działa | pełny tekst ustaw w PDF | Sprint 5 |
| Oświadczenia majątkowe | **zablokowane** | skany PDF, brak API | poza MVP |
| SUDOP — API przypadków pomocy | **działa, ale wolno** | kolejka od minut do kilkudziesięciu minut; wynik żyje 60 min | nie automatyzujemy (D13) |
| SUDOP — słownik gmin (API) | działa | 4 170 kodów TERYT z nazwami | `ingest:sudop-gminy` |
| SUDOP — eksport CSV | działa, ręcznie | 14 kolumn z TERYT, kwotami i formą pomocy | `ingest:sudop-csv` |

---

> ### SPROSTOWANIE z 12.09.2026 — SUDOP
>
> Wiersz o API przypadków pomocy mówił wcześniej **„nie działa — anonimowe
> zapytania nie wychodzą z kolejki"**. To było nieprawdziwe i zostało obalone
> przez samego UOKiK w odpowiedzi na nasze pismo.
>
> API działa anonimowo i zgodnie z projektem. Konkretny wynik, który uznaliśmy
> za nieistniejący (`4976bbc9-…`), **został policzony i zapisany**. Nasza sonda
> odpytywała go przez **sześć minut co dziesięć sekund**, podczas gdy urząd
> podaje, że kolejka potrafi trwać **kilkadziesiąt minut**, i zaleca odstęp
> **60 sekund**. Zmierzyliśmy zbyt krótko i wyciągnęliśmy wniosek o mechanizmie
> z obserwacji, która go nie obejmowała.
>
> Dwie twarde liczby stamtąd: zadanie w kolejce czekało **62 min 18 s**,
> a wynik **wygasa po 60 minutach** — więc zadanie czekające dłużej niż godzinę
> nigdy nie zostanie wykonane.
>
> **Wszystkie ustalenia sond 27–29 dotyczące czasów i dostępności SUDOP
> są niezweryfikowane.** Pełny zapis korespondencji i lista rzeczy do
> ponownego sprawdzenia: [`uokik-korespondencja.md`](uokik-korespondencja.md).
>
> D13 (nie automatyzujemy) **zostaje** — urząd napisał wprost, że ruch
> przekracza jego możliwości infrastrukturalne, więc zobowiązanie jest teraz
> lepiej uzasadnione niż wtedy, gdy opieraliśmy je na „to i tak nie działa".

---

## Sejm API — `api.sejm.gov.pl/sejm`

### Posłowie i kluby

`GET /term10/MP` zwraca **wszystko w jednym zapytaniu**. Detal `/MP/{id}` nie ma
ani jednego pola więcej niż lista — 499 osobnych zapytań byłoby czystą stratą.

| | |
|---|---:|
| Posłów w kadencji X | 499 |
| Aktywnych | 460 |
| Klubów w `/clubs` | 12 |
| Różnych wartości w polu `MP.club` | **13** |

**Pułapka.** Jeden poseł ma kod klubu `Polska2050-TD`, którego nie ma w słowniku
`/clubs`. Niespójność jest po stronie źródła. Nie przypisujemy go do podobnie
brzmiącego klubu — to byłoby wymyślenie danych. Klub powstaje z kodu, który
naprawdę przyszedł, z flagą `from_dictionary = false`.

Pokrycie pól (odsetek rekordów): wszystkie kluczowe 100%, `profession` 99%,
`secondName` 66%, `inactiveCause` 7%, `mandateExpiryDate` i `waiverDesc` po 8%.

**Brak `ETag` i `Last-Modified`** na listach — delty po stronie API nie istnieją.
Jedynym mechanizmem wykrywania zmian jest `payload_sha256` liczony z surowych bajtów
odpowiedzi (nie z `JSON.stringify` — kolejność kluczy po parsowaniu potrafi się zmienić
bez zmiany danych).

### Głosowania

`GET /term10/votings/{sitting}/{nr}` — **tu są głosy imienne**, w liście ich nie ma.

| | |
|---|---:|
| Posiedzeń z głosowaniami | 64 |
| Wpisów w `/proceedings` z `number = 0` | 11 (zapowiedziane, do odfiltrowania) |
| Głosowań w kadencji | 4 569 |
| Głosów imiennych | 2 099 638 |
| Rozmiar tabeli `votes` | 136 MB |
| Czas pełnego backfillu | 12,8 min |

Każdy głos niesie **klub w momencie oddania głosu** — nie trzeba go brać z profilu
posła, co jest istotne, bo posłowie zmieniają kluby w trakcie kadencji.

Każde głosowanie ma w `links[]` wpis `rel: "pdf"` z oficjalnym protokołem
na serwerze Kancelarii Sejmu. To gotowe `sources.url` dla wymogu „zawsze do źródła".

**Wartości pola `vote`** (zmierzone, nie z OpenAPI):

| wartość | udział | frekwencja | lojalność |
|---|---:|---|---|
| `YES` / `NO` / `ABSTAIN` | ~91% | tak | tak |
| `ABSENT` | ~4,5% | nie | nie |
| **`PRESENT`** | **~2,5%** | **tak** | **nie** |

`PRESENT` nie ma w schemacie OpenAPI. Znaczy: obecny na sali, nie oddał głosu.
Nie występuje wyłącznie przy głosowaniach listowych — na posiedzeniu bez ani jednego
`ON_LIST` było go 863 wystąpienia. Do lojalności wchodzą **wyłącznie** `YES`, `NO`,
`ABSTAIN` — lista dozwolonych, nie zakazanych, żeby przyszła nieznana wartość
nie wpadła tam sama z siebie.

**Import przyrostowy działa.** `/votings/search?dateFrom=` filtruje poprawnie
(pierwsze zero wyników nie było błędem parametru — w sierpniu Sejm nie obradował).
Nocny cron to kilkanaście zapytań zamiast 4 200. Uwaga: `sort_by` jest ignorowane,
wyniki przychodzą od najstarszych, paginacja po `offset`.

### Procesy legislacyjne

`GET /term10/processes/{nr}` — etapy z datami, typami i numerami druków, plus
`passed`, `closureDate` i `ELI`. Etap „III czytanie" niesie w `children[]` pełny
obiekt `voting` i `sittingNum`, czyli **twarde złączenie ustawa → głosowanie**.

Fallback dla procesów bez tego pola: numer druku wyłuskany z tytułu głosowania.
Skuteczność zmierzona na posiedzeniu 63: **69 z 74 głosowań, czyli 93%**.

---

## ELI — `api.sejm.gov.pl/eli`

`textHTML: false` w **20 na 20** sprawdzonych ustaw z bieżącego rocznika. Endpoint
`text.html` odpowiada `200`, ale z zerową długością. Treść jest wyłącznie w PDF.

Dobra wiadomość: to **PDF tekstowe, nie skany**. Po rozpakowaniu strumieni
`FlateDecode` z 48-stronicowej ustawy wychodzi 68 557 znaków z zachowanymi polskimi
diakrytykami — ~22 900 tokenów, około **$0,07 za streszczenie**. OCR niepotrzebny.

Import przyrostowy: `/changes/acts?since=` w formacie `yyyy-MM-dd'T'HH:mm:ss`,
**bez `Z` na końcu** — z `Z` zwraca `400`.

Korekta wcześniejszego założenia: druk sejmowy w PDF ma 299 stron i ~65 800 tokenów,
czyli **trzy razy więcej** niż sama ustawa, bo zawiera projekt, uzasadnienie, OSR
i opinie w jednym pliku. Ale w załącznikach jest osobny `{nr}-uzasadnienie.docx` —
do zmierzenia sondą 25.

---

## Oświadczenia majątkowe — zablokowane

Brak API w jakiejkolwiek formie. PDF-y na serwisie Lotus Domino
(`sejm.gov.pl/sejm10.nsf`), w dużej części skany odręcznie wypełnionych formularzy.

`agent.xsp?symbol=ROSWIADCZENIA` zwraca listę maszynowo (302 linki, 257 nazwisk),
więc Playwright jest niepotrzebny — ale zejście do samego pliku PDF wymaga jeszcze
jednego poziomu i nie zostało dokończone.

**Decyzja: moduł „Wizualizacja Majątku" poza MVP.** Automatyczny parsing skanu daje
wynik, który wygląda wiarygodnie i bywa błędny, a błędna kwota przy nazwisku posła
to najkrótsza droga do prawnika. Docelowo: ręczne wprowadzanie dla 30–50 posłów
z podwójną weryfikacją (tabela `asset_declarations` wymusza `verified_by`
przed publikacją), reszta profili pokazuje uczciwe „brak danych" z linkiem do PDF.

---

## Zasada, która wynikła z trzech pomyłek

W tym projekcie trzykrotnie wyciągnąłem wniosek z własnego wyobrażenia o strukturze
danych zamiast ją odczytać: wartość `PRESENT` spoza schematu OpenAPI, kolumny widoku
opisane z pamięci zamiast sprawdzone, i nazwy parametrów SUDOP zgadnięte zamiast
wzięte z dokumentacji.

**Za każdym razem kod działał na danych syntetycznych i psuł się na prawdziwych.**

Stąd wzorzec obowiązujący w całym projekcie: przed zapisem sprawdzamy dziedzinę
wartości, migracje kończą się kontrolą własnych założeń, a import zatrzymuje się
z instrukcją zamiast wywracać w połowie.
