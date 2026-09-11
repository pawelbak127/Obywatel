# Dziennik decyzji

Każda pozycja: co postanowiliśmy, **dlaczego** i co z tego wynika w kodzie.
Decyzje wycofane zostają w dokumencie razem z powodem wycofania — to jest
najbardziej wartościowa część, bo pokazuje, na czym się przejechaliśmy.

---

## D1 · Compliance wymuszony przez bazę, nie przez konwencję

Dokumentacja projektu wymaga, żeby każda informacja miała link do oficjalnego
rejestru, a każde streszczenie AI — widoczną metkę. Konwencje zespołowe pękają
przy trzeciej refaktoryzacji, więc oba wymogi są w schemacie:

- `sources.url NOT NULL` + `source_id NOT NULL` w każdej tabeli faktów
- `ai_contents.ai_generated boolean NOT NULL CHECK (ai_generated)` — nie da się ustawić `false`
- `CHECK (length(trim(ai_disclaimer)) > 20)`
- frontend czyta widok `public_ai_contents`, nie tabelę

Po stronie React ta sama zasada: `<SourceLink>` ma `href` jako prop **wymagany,
bez wartości domyślnej**. `<SourceLink />` nie skompiluje się.

**Sprawdzone:** smoke test, 25 asercji, każda odmowa z kodem SQLSTATE.

---

## D2 · Cron w GitHub Actions, nie na Vercelu

Backfill to ~4 200 zapytań i 12,8 minuty. Limit czasu funkcji na darmowym planie
Vercela liczy się w sekundach. Actions dają długie zadania, historię przebiegów
i retry, a dla repozytorium publicznego są bezpłatne bez limitu minut.

Efekt uboczny na naszą korzyść: codzienne zapytanie utrzymuje darmową bazę
Supabase w stanie aktywnym.

---

## D3 · Typy w `votes` zwężone do granic rozsądku

Zmierzone: 2 099 638 wierszy. Przy pierwotnych typach (`bigint`, `int`, `text`, `enum`)
tabela zajmowałaby ~380 MB razem ze snapshotami — mieściłaby się w darmowej bazie,
ale nie zostawiała miejsca na nic innego.

`voting_id int`, `mp_id smallint`, `club_seq smallint`, zdjęty indeks `(mp_id, value)`,
snapshoty surowych odpowiedzi poza Postgresem (R2). Wynik: **136 MB**.

Nie zmieniaj tych typów bez ponownego policzenia budżetu.

---

## D4 · Klub bierzemy z głosu, nie z profilu posła

Posłowie zmieniają kluby w trakcie kadencji. Lojalność historyczna musi porównywać
posła z klubem, w którym był **w momencie głosowania**. Sejm API podaje to w każdym
rekordzie głosu, więc nie ma powodu sięgać do profilu.

---

## D5 · Klub spoza słownika zachowuje swój kod

`/clubs` zwraca 12 klubów, a pole `MP.club` ma 13 różnych wartości — jeden poseł
ma `Polska2050-TD`, którego w słowniku nie ma.

Kuszące byłoby przypisać go do „Polska2050". **To byłoby wymyślenie danych.**
Nie wiemy, czy to ten sam klub; wiemy tylko, że źródło podaje inny kod. Tworzymy
klub z kodu, który przyszedł, z flagą `from_dictionary = false` i notatką.

---

## D6 · Lojalność ma próg wiarygodności

Skoro istnieją kluby jednoosobowe, lojalność liczona wprost dałaby takiemu posłowi
**100%** — bo większością własnego klubu jest on sam. Liczba „100% lojalności"
przy nazwisku, wyliczona z klubu liczącego jedną osobę, to materiał na sprostowanie.

Próg: poniżej trzech głosujących członków klubu `loyalty_pct` jest `NULL`, nie 100.
Pominięte głosowania trafiają do `loyalty_skipped`.

**Sprawdzone:** poseł w klubie 10-osobowym głosujący z większością → 100%,
przeciw → 0%, w klubie jednoosobowym → `NULL` z `loyalty_skipped = 100`.

---

## D7 · Do lojalności wchodzą tylko stanowiska — lista dozwolonych

Backfill przerwał się na wartości `PRESENT`, której nie ma w schemacie OpenAPI.
Sama brakująca wartość to drobiazg; groźne było to, co by się stało, gdyby przeszła.

Logika brzmiała „wszystko poza `ABSENT`". Przy takiej regule `PRESENT` — obecność
bez zajęcia stanowiska — byłby porównywany z większością klubu i wychodził
jako **nielojalność**. Poseł dostałby zarzut za głos, którego nie oddał.

Warunek zmieniony z listy zakazanych na **listę dozwolonych**: `YES`, `NO`, `ABSTAIN`.
Każda przyszła nieznana wartość zostaje poza lojalnością automatycznie.
To samo przy liczeniu większości klubu.

Importer sprawdza dziedzinę **przed** zapisem całego posiedzenia i przerywa
z gotowym poleceniem SQL, zamiast wywracać się na porcji nr 2000.

---

## D8 · Obecność i udział to dwie różne liczby — pokazujemy obie

`PRESENT` to 2,5% wszystkich głosów. Przy takim udziale „obecność" (wszystko poza
`ABSENT`) i „udział" (tylko stanowiska) rozjeżdżają się na tyle, że poseł może mieć
100% obecności i wyraźnie niższy udział.

Pokazanie jednej z nich pod etykietą „frekwencja" i przemilczenie drugiej byłoby
wyborem narracji, a nie prezentacją danych — i to w obie strony.
`attendance_pct` i `voted_pct` stoją obok siebie, `present_count` podaje różnicę wprost.

---

## D9 · ~~Ranking tylko dla posłów z ponad połową kadencji~~ — WYCOFANE

**Wprowadzone w migracji 0008, wycofane w 0009.**

Flaga `w_rankingu` z progiem 50% okazała się zła na żywych danych z dwóch powodów.

**Próg jest urwiskiem w przypadkowym miejscu.** Czterech posłów ma 2 244 głosowania,
czyli 49,1% kadencji, i frekwencję 88–99%. Wypadali o jeden punkt procentowy,
tak samo jak posłowie z 447 głosowaniami (9,8%). Próg traktował pół kadencji
i dwa tygodnie identycznie.

**Wykluczenie też jest decyzją.** Poseł z frekwencją 54% przy 100 głosowaniach ma
prawo znaleźć się w zestawieniu. Ukrywanie go „bo ma mało głosowań" to nie neutralność,
tylko wybór na jego korzyść.

→ zastąpione przez **D10**.

---

## D10 · Rankingi na przedziałach ufności Wilsona

Problem nie polega na tym, że mało głosowań jest „nieważne", tylko na tym,
że procent ze 100 prób i procent z 4 569 prób to liczby o różnej pewności.

Sortujemy po **dolnej granicy** przedziału Wilsona (95%), pokazujemy surowy procent
razem z przedziałem i liczbą głosowań. Zmierzone:

| głosowań | surowy % | przedział | szerokość |
|---:|---:|---|---:|
| 100 | 54,0% | 44,3 – 63,4% | 19,1 pkt |
| 4 569 | 54,0% | 52,5 – 55,4% | 2,9 pkt |
| 100 | 100,0% | dolna granica 96,3% | |
| 4 569 | 100,0% | dolna granica 99,9% | |

Krótki mandat nie wygrywa rankingu przypadkiem, ale też nikt z niego nie znika.
Koszt: 21 ms na 920 wywołań funkcji.

---

## D11 · Ranking publikujemy — ale każdy wiersz z kontekstem

Pierwszy uczciwie policzony ranking postawił w czołówce posłów z pełną kadencją
i obecnością 11,6%, 14,6% oraz 50,5% — w tym urzędującego Prezesa Rady Ministrów.

Wszystkie liczby poprawne, powody krańcowo różne, a **Sejm API nie podaje powodu**.
Ranking bez kontekstu sugeruje, że sprawowanie urzędu i nieprzychodzenie do pracy
to to samo zjawisko. Każda strona sceny uzna to za atak na siebie i obie będą miały rację.

**Decyzja (Paweł):** publikujemy pełną listę, ale każdy wiersz obowiązkowo niesie
cztery rzeczy obok procentu — mianownik „X z Y głosowań", przedział ufności,
kształt nieobecności i udokumentowaną funkcję państwową, jeśli jest w `mp_roles`.

Nikogo nie ukrywamy i nikogo nie pokazujemy bez kontekstu.

---

## D12 · Kształt nieobecności zamiast zgadywania powodu

Nie wolno nam wymyślać powodów, których źródło nie podaje. Możemy pokazać to,
co z danych **wynika** — czy nieobecności skupiają się w czasie.

| kształt | interpretacja |
|---|---|
| ciągła, blokiem od konkretnego miesiąca | przyczyna strukturalna: urząd, wyjazd, choroba |
| rozproszona po całej kadencji | wzorzec zachowania |

Dwie identyczne liczby 50,0% dają w tym ujęciu zupełnie różny obraz. Tabela
`mp_absence_monthly` (15 171 wierszy) i oś czasu jako inline SVG bez JavaScriptu.

`mp_roles` — funkcje państwowe uzupełniane ręcznie i **zawsze ze źródłem**, tak samo
jak każdy inny fakt. Wpis „minister od marca 2024" bez linku do powołania jest
tak samo niedopuszczalny jak kwota z oświadczenia majątkowego bez skanu.

---

## D13 · Nie automatyzujemy wyszukiwarki SUDOP

Pełne uzasadnienie w [`sudop.md`](sudop.md). Skrót: to projekt o rozliczalności
instytucji publicznych, więc pierwsze pytanie przy pierwszym tekście o dotacjach
będzie dotyczyło pochodzenia danych. Do tego skala obciążyłaby serwer UOKiK,
a identyfikatory JSF psułyby import bez ostrzeżenia.

Droga dopuszczalna: człowiek pobiera oficjalny eksport CSV, my importujemy plik.

---

## D14 · `null` nie jest zerem

Lojalność posła w klubie jednoosobowym albo głosującego wyłącznie `PRESENT`
nie wynosi 0% — nie da się jej policzyć. `StatBar` renderuje wtedy „brak danych"
z wyjaśnieniem, zamiast pustego paska, który wygląda jak zero i czyta się jak zarzut.

---

## D15 · Eksport SUDOP importujemy z pliku, a kontraktem jest nagłówek

Prawdziwy eksport CSV obalił moje wcześniejsze twierdzenie, że wynik wyszukiwania
nie zawiera lokalizacji. Na ekranie widać 6 kolumn, w pliku jest ich **14**,
a kolumna 7 to kod TERYT gminy — ten sam format co słownik `gmina-siedziby` z API.
„Radar Sąsiedzki" jest więc wykonalny: filtrujemy po naszej stronie, nie po ich.

Z tego wyszedł kształt importera:

- **Kontraktem jest nagłówek, co do znaku** — z literówką urzędu w „Wartość
  **nominana** pomocy [PLN]" włącznie. Gdyby UOKiK zamienił miejscami kwotę
  nominalną i brutto, żaden typ danych by nie zaprotestował; opublikowalibyśmy
  nieprawdziwe liczby przy czyimś nazwisku. Zmiana nagłówka **zatrzymuje** import.
- **Kodowanie wykrywamy z bajtów, nie z wyglądu tekstu.** Plik jest w CP1250.
- **`row_sha256` jako klucz deduplikacji** — dane będą przychodzić kawałkami
  z wielu eksportów, a wiersz raz zapisany zostaje przy swoim pierwotnym źródle.
- **`nip_valid`** — suma kontrolna NIP-u liczona przy imporcie. Wiersz z błędnym
  NIP-em zapisujemy (to dane urzędu), ale widok `dotacje_publiczne` go nie wystawia
  i nie wolno go użyć do żadnego zestawienia. Łączenie po NIP-ie z błędną sumą
  kontrolną to łączenie po literówce, a stąd krok do zniesławienia.
- **Data pobrania z czasu modyfikacji pliku**, nie `now()`. Plik może leżeć
  na dysku tydzień, a UOKiK wymaga przy republikacji prawdziwej daty pozyskania.

**Sprawdzone:** 31 testów przeciwko prawdziwemu plikowi (trzymanemu w teście
jako oryginalne bajty CP1250, nie jako przepisana treść); migracja 0012 uruchomiona
na PostgreSQL 16 — kontrakt widoku, blokada wiersza bez źródła, blokada duplikatu,
ukrycie błędnego NIP-u.

---

## D16 · Żadna nazwa gminy nie jest wyrzucana

Słownik gmin z API ma 4 170 pozycji i **4 155 unikalnych kodów TERYT**.
Jedenaście kodów występuje pod dwiema różnymi nazwami:

```
0223083  ŚWIĘTA KATARZYNA     | SIECHNICE
3214011  STARGARD SZCZECIŃSKI | STARGARD
0417052  RYŃSK                | WĄBRZEŹNO
2604172  SITKÓWKA-NOWINY      | NOWINY
```

Sprawdzenie tych par było ważniejsze, niż wygląda. Gdyby pod jednym kodem stały
dwie **różne** gminy, znaczyłoby to, że pole `number` nie jest kodem TERYT — a wtedy
kolumna 7 w eksporcie CSV nie znaczy tego, co myślimy, i cały „Radar Sąsiedzki"
opiera się na nieporozumieniu. Wszystkie jedenaście par to ta sama jednostka pod
starą i nową nazwą. **Założenie potwierdzone danymi, nie rozumowaniem.**

Czego przy tym **nie wiemy**: słownik nie ma daty obowiązywania, więc z samego API
nie da się ustalić, która nazwa jest dzisiejsza. Wybór po kolejności w tablicy
byłby dokładnie tym błędem, który kosztował ten projekt pięć pomyłek.

Dlatego nie wyrzucamy żadnej: jedna trafia do `nazwa`, pozostałe do
`nazwy_alternatywne`. Wyszukanie „Siechnice" trafia w gminę zapisaną jako
„Święta Katarzyna", zamiast nie trafiać w nic. Ustalenie nazwy **obowiązującej**
wymaga rejestru TERYT prowadzonego przez GUS i będzie zrobione tak samo jak
`mp_roles`: ręcznie, dla jedenastu wierszy, zawsze ze źródłem.

---

## D17 · Zmarli posłowie nie stoją w rankingu

Zapytanie o trzydziestu posłów o najniższej obecności zwróciło między innymi to:

```
izabela-mrzyglocka   inactive_cause='Zgon'   68,6%   704 głosowania
rajmund-miller       inactive_cause='Zgon'   71,2%   288 głosowań
```

Dwoje posłów zmarło w trakcie kadencji i stało w naszym rankingu obecności.
Liczby były poprawne. Zestawienie było nie do obrony.

**To nie jest powrót do D9.** Tam wykluczaliśmy kogoś progiem, który sami
wymyśliliśmy — i dlatego to wycofaliśmy. Tu wykluczamy na podstawie faktu
z rejestru państwowego: mandat wygasł z powodu śmierci. Ranking jest narzędziem
rozliczalności osób sprawujących mandat; nie ma czego rozliczać i nie ma kogo.

Wykluczenie dotyczy **wyłącznie zestawień porównawczych**. Profil posła zostaje,
z pełnymi liczbami i z powodem z rejestru. Nie usuwamy nikogo z serwisu.

Filtr siedzi w `pobierzRanking()` w `src/lib/queries.ts`, a nie w komponencie —
żeby nowa strona z zestawieniem nie mogła go pominąć przez przeoczenie.
`pobierzPosla()` tego filtra nie ma i mieć nie powinno.

---

## D18 · Powód wygaśnięcia mandatu bierzemy z rejestru, nie z domysłu

Chciałem wypełnić `mp_roles` ręcznie, szukając dokumentów powołania. Zanim
zacząłem, sprawdziłem schemat — i okazało się, że **Sejm API podaje powód
i importujemy go od pierwszego dnia**:

| kolumna | co zawiera | pokrycie |
|---|---|---|
| `mps.inactive_cause` | kategoria: `Zgon`, `Zrzeczenie` | 37 z 39 nieaktywnych |
| `mps.waiver_desc` | zdanie rejestru | 39 z 39 |

```
artur-sobon      Zrzeczenie  „Powołany na członka Zarządu NBP"                100 głosowań
michal-dworczyk  Zrzeczenie  „Wybrany na posła do Parlamentu Europejskiego"   447
```

Przy Soboniu widniało „54% obecności" bez słowa wyjaśnienia. Powód był w bazie
przez cały czas — po prostu go nie pokazywaliśmy.

Wniosek na przyszłość, ważniejszy niż sama poprawka: **zanim dopiszemy fakt
od siebie, sprawdzamy, czy rejestr już go nie podaje.** Ręczne wpisywanie
danych, które mamy z oficjalnego źródła, to dokładanie sobie ryzyka pomyłki
bez żadnego zysku.

`mp_roles` zostaje dla przypadku, którego rejestr NIE opisuje: poseł aktywny,
z pełnym mandatem, nieobecny z powodu sprawowania urzędu. Ziobro i Romanowski
mają `active = true` i puste `inactive_cause` — rejestr nie mówi o nich nic
i my też nie powiemy niczego ponad kształt nieobecności.

---

## D19 · „Nie wiemy" to nie to samo co „nie było czego wiedzieć"

Widok `proces_los` miał kubełek `brak_potwierdzenia` — 185 procesów, przy
których interfejs pisał: „Nie mamy potwierdzenia publikacji w rejestrze
i nie wiemy, na czym proces stanął".

Rozbicie po typie dokumentu pokazało, czym te 185 procesów naprawdę jest:

```
wniosek                    88     projekt uchwały   11
informacja innych organów  32     zawiadomienie      6
informacja rządowa         28     lista kandydatów   3
wniosek (bez druku)        14     sprawozdanie       2
                                  projekt ustawy     1
```

**184 ze 185 to sprawy, które nigdy nie idą do Prezydenta.** Wniosek o wotum
nieufności nie czeka na publikację w Dzienniku Ustaw — on się po prostu
skończył. Pisanie przy nim „nie wiemy, na czym proces stanął" sugerowało lukę
w naszej wiedzy tam, gdzie nie było czego wiedzieć.

To ten sam błąd co „uchwalono" przy ustawie zawetowanej (D-kontekst migracji
0019), tylko odwrócony: opisywaliśmy proces kategorią, która do niego nie pasuje.

**Rozdzielamy faktem z rejestru, nie typem dokumentu.** Kuszące byłoby podzielić
po `document_type` — wniosek w jedno, ustawa w drugie. Ale `document_type` mówi,
czym proces **jest**, a nie którędy **poszedł**, a to nie zawsze to samo i nie
nam to rozstrzygać za rejestr. Rejestr mówi wprost etapem `ToPresident`
(„Ustawę przekazano Prezydentowi do podpisu"). W spornym kubełku miał go
**dokładnie jeden proces na 185** — rozdziela te dane niemal idealnie.

Stąd dwa losy zamiast jednego (migracja 0021):

| los | znaczy |
|---|---|
| `u_prezydenta` | rejestr odnotował przekazanie do podpisu i nic więcej |
| `bez_etapu_prezydenckiego` | rejestr nie odnotował przekazania w ogóle |

**Kolejność w `CASE` ma znaczenie i kosztowała osobną migrację.** W 0021 próg
90 dni („świeżo uchwalone") stał przed testem na `ToPresident`, więc sześć
ustaw świeżo przekazanych Prezydentowi dostawało los `oczekuje` wraz ze zdaniem
„rejestr nie odnotował jeszcze żadnego etapu prezydenckiego" — nieprawdziwym
i sprzecznym z kolumną, którą ta sama migracja wystawiła.

Poprawione w 0022: **próg czasowy chroni wyłącznie gałąź, która twierdzi,
że czegoś w rejestrze NIE MA.** Gałąź stwierdzająca fakt nie potrzebuje zapasu
czasowego, bo fakt się nie przeterminowuje.

**Sprawdzone:** migracje 0021 i 0022 z pięcioma blokami kontrolnymi;
`oczekuje` 38 → 32 (zero z etapem `ToPresident`), `u_prezydenta` 1 → 7.
Błąd kolejności wyłapała recenzja, nie autor — patrz D21.

---

## D20 · Kody grupują, słowa mówią. Przy sporze wygrywają słowa rejestru

Przy funkcji `opisWeta()` w `src/lib/queries.ts` stało:

> Kuszące byłoby napisać „Sejm weta nie odrzucił", skoro nie ma podpisu — ale
> to jest wnioskowanie z nieobecności danych, a nie fakt z rejestru.

Zdanie było słuszne i uchroniło nas przed realnym błędem. Ale wyciągnęliśmy
z niego wniosek o jeden krok za daleko: **uznaliśmy sprawę za niepoznawalną,
zamiast sprawdzić, czy rejestr nie rozstrzyga jej gdzie indziej.**

Rozstrzyga. Pole `process_stages.decision` niesie zdanie „nie uchwalona
ponownie", a `stage_name` etapu końcowego — „nie uchwalona ponownie po wecie
Prezydenta". Oba importujemy od migracji 0016 i nie czytaliśmy ich nigdzie.
Pole ma zaledwie **18 różnych wartości na 1 657 wypełnionych etapów** — to
zamknięty słownik zdań po polsku, gotowy do czytania.

Kosztowało to konkretną nieprawdę na stronie. Piętnaście procesów jest
w identycznej sytuacji: Sejm uchwalił, Prezydent zawetował, Sejm nie zebrał 3/5.
Flaga `passed` rozkładała je na dwie grupy — sześć z `false`, dziewięć z `true` —
i czytelnik dostawał **dwa przeciwne komunikaty przy tym samym fakcie**:

- przy `passed = false` → „nie uchwalono", czyli „Sejm był przeciw"
  (a Sejm był za: III czytanie ma decyzję „uchwalono"),
- przy `passed = true` → „uchwalono — Prezydent zawetował", bez słowa o tym,
  że weto się utrzymało i sprawa jest zamknięta.

**Zasada.** „Nie wnioskujemy z nieobecności danych" zostaje w mocy. Dochodzi
do niej druga, lustrzana: **zanim ogłosisz niewiedzę, sprawdź, czy rejestr nie
powiedział tego w polu, którego nie czytasz.** Gdy rejestr mówi coś słowami,
przepisujemy jego słowa zamiast składać własne zdanie z kodów etapu.

To jest ta sama lekcja co D18, odwrócona. D18 mówi: nie wpisuj ręcznie faktu,
który rejestr podaje. D20 mówi: nie ogłaszaj niewiedzy w sprawie, którą rejestr
rozstrzyga. **Czwarty raz w tym projekcie fakt siedział w bazie, a my go
zasłanialiśmy** — po funkcji państwowej Tuska, po powodzie wygaśnięcia mandatu
i po etapach weta z 0019.

**Sprawdzone:** migracja 0024, los `weto_utrzymane` wyprowadzony z `decision`,
a nie z flagi `passed` ani z nieobecności podpisu. 15 procesów, 225 głosowań
w widoku interfejsowym. Dwa bloki kontrolne, w tym jeden pilnujący, że kontrakt
ze słowem rejestru żyje — gdyby Sejm zmienił brzmienie, kubełek opustoszałby
po cichu.

---

## D21 · Większe zmiany recenzuje osobny agent, nie autor

Po migracji 0021 zrobiłem samodzielną recenzję i uznałem kolejność warunków
za „potwierdzoną danymi", bo kubełek `oczekuje` miał te same 38 procesów przed
zmianą i po niej.

Ten test mierzył **stabilność rozkładu**, a nie **prawdziwość etykiety** —
i przeszedł, mimo że sześć wierszy niosło zdanie sprzeczne z kolumną dołożoną
przez tę samą migrację. Liczba 6 była wypisana na ekranie w wyniku końcowego
zapytania migracji. Nie zobaczyłem jej.

Znalazła to recenzja uruchomiona jako osobny agent, bez kontekstu autora.
Ta sama recenzja rozstrzygnęła zapytaniem pytanie, które zostawiłem jako
hipotezę (wszystkie 149 opublikowanych uchwał ma adres w Monitorze Polskim,
więc przy 11 bez adresu mamy lukę w imporcie, a nie „normalny koniec drogi").

**Zasada:** każda zmiana dotykająca migracji, `src/lib/queries.ts` albo warstwy
importu idzie do recenzji osobnym agentem, **zanim** zostanie zgłoszona jako
gotowa. Recenzent dostaje commit, `CLAUDE.md`, `docs/decyzje.md`, dostęp do bazy
tylko do odczytu i wyraźny zakaz zmieniania czegokolwiek.

Powód jest prosty i nie chodzi o staranność: **autor sprawdza, czy jego
rozumowanie się trzyma, a nie czy jest prawdziwe.** Przy jednoosobowym zespole
bez testów integracyjnych to jedyna dostępna druga para oczu.

---

## Wzorzec, który wynikł z pięciu pomyłek

Pięć razy wyciągnąłem wniosek z własnego wyobrażenia o danych zamiast je odczytać:
wartość `PRESENT`, kolumny widoku opisane z pamięci, nazwy parametrów SUDOP zgadnięte
zamiast wzięte z dokumentacji, zasięg wyszukiwarki SUDOP oceniony po etykietach pól
i wreszcie kolumny eksportu opisane po tym, co widać na ekranie, zamiast po tym,
co jest w pliku. Za każdym razem kod działał na danych syntetycznych i psuł się
na prawdziwych — albo, co gorsza, nie psuł się wcale, tylko podawał zły wniosek.

Stąd cztery mechanizmy obowiązujące w całym projekcie:

1. **Kontrola dziedziny przed zapisem** — importer sprawdza wartości całego
   posiedzenia, zanim cokolwiek zapisze, i przerywa z gotowym poleceniem SQL.
2. **Migracje sprawdzają własne założenia** — `0002` weryfikuje RLS na wszystkich
   tabelach, `0011` sprawdza, czy widok wystawia komplet kolumn wymaganych
   przez `src/lib/queries.ts`.
3. **`assertSchema()` na starcie każdego importu** — kolumny z kolejnych migracji
   sprawdzane zapytaniem `limit 0`, zanim cokolwiek zostanie pobrane.
4. **Testy na oryginalnych bajtach, nie na przepisanej treści.** Fixture eksportu
   SUDOP siedzi w teście jako base64 prawdziwego pliku w CP1250. Test na
   „poprawionej" próbce sprawdzałby moje wyobrażenie o pliku, czyli dokładnie to,
   co zawodziło pięć razy.
