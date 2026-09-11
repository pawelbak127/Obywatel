# Funkcje państwowe posłów — procedura

Tabela `mp_roles` jest **jedynym miejscem w projekcie, do którego treść wpisuje
człowiek**, a nie rejestr państwowy. Wszystko inne przychodzi z API i ma źródło
z automatu. Tutaj źródło podaje redaktor — i dlatego kontrola jest tu ostrzejsza
niż gdziekolwiek indziej.

## Po co ta tabela istnieje

Ranking obecności postawił obok siebie posła, który nie przychodzi do pracy,
i urzędującego Prezesa Rady Ministrów. Obie liczby są poprawne, powody krańcowo
różne, a **Sejm API nie podaje powodu**. Decyzja D11: publikujemy pełną listę,
ale każdy wiersz obowiązkowo niesie kontekst — w tym udokumentowaną funkcję
państwową, jeśli taka jest.

Dopóki `mp_roles` jest pusta, ranking pokazuje „powód nieznany z danych"
przy każdym nazwisku. To znaczy, że **łamiemy własną zasadę** — i to w najbardziej
zapalnym miejscu produktu.

## Czego ta tabela NIE robi

Nie usprawiedliwia. Opisuje. Wpis „Prezes Rady Ministrów od 13 grudnia 2023"
nie mówi czytelnikowi, co ma o tym myśleć — mówi, co się wydarzyło, i podaje
dokument. Ocena należy do czytelnika.

Nie wpisujemy tu powodów, których nie ma w dokumencie: choroby, spraw rodzinnych,
konfliktów wewnątrzpartyjnych. Nawet jeśli „wszyscy wiedzą".

## Co kod sprawdza, zanim cokolwiek zapisze

| Kontrola | Dlaczego |
|---|---|
| źródło **wymagane**, `https` | funkcja bez dokumentu powołania to nasza narracja pod czyimś nazwiskiem |
| host z listy oficjalnych rejestrów | encyklopedia, portal ani strona partii nie są dokumentem powołania |
| nazwisko z pliku **musi zgadzać się z bazą** | literówka w slugu przypisałaby ministra nie temu posłowi — tego nie złapie żaden kompilator |
| daty istnieją w kalendarzu, koniec nie przed początkiem | |
| rodzaj z listy: `rzad`, `prezydium_sejmu`, `ue`, `inne` | |
| klucz naturalny `(poseł, funkcja, data objęcia)` | plik importujemy wielokrotnie; bez tego funkcja dublowałaby się na profilu |

Żadnej z tych kontroli nie da się wyłączyć flagą. Komplet reguł i uzasadnienie:
`ingest/mappers/mp-roles.ts`, 19 testów w `mp-roles.test.ts`.

## Dopuszczalne źródła

```
monitorpolski.gov.pl      dziennikustaw.gov.pl     isap.sejm.gov.pl
sejm.gov.pl               api.sejm.gov.pl          senat.gov.pl
prezydent.pl              premier.gov.pl           gov.pl
europarl.europa.eu        pkw.gov.pl               nbp.pl
nik.gov.pl                brpo.gov.pl
```

Najlepszym źródłem powołania do Rady Ministrów jest **postanowienie Prezydenta RP
opublikowane w Monitorze Polskim**. Wikipedia bywa dobrym punktem wyjścia do
znalezienia numeru dokumentu — ale do bazy trafia link do dokumentu.

## Procedura

1. Wypisz z bazy posłów o najniższej obecności (zapytanie w `KOMENDY-14.md`).
   Zapytanie zwraca gotowe wiersze CSV z wypełnionym `slug` i nazwiskiem.
2. Dla każdego ustal, czy pełni albo pełnił funkcję państwową, i **znajdź dokument**.
3. Uzupełnij `data/mp-roles.csv`.
4. `npm run ingest:role -- --sucho` — sprawdza wszystko, nic nie zapisuje.
5. `npm run ingest:role` — zapis. Każdy wiersz dostaje własny wpis w `sources`.
6. `select refresh_absence_monthly();`

Krok 4 jest obowiązkowy. Przy tej tabeli pomyłka nie kosztuje błędu w logach,
tylko sprostowanie.

## Stan tabeli — otwarta pozycja

Na dziś w `mp_roles` jest **jeden wpis**: Prezes Rady Ministrów od 13 grudnia 2023.
To wystarcza, żeby najbardziej widoczny wiersz rankingu miał kontekst, ale
**nie wystarcza przed publikacją**.

Do zrobienia jednym przebiegiem, zanim strona zobaczy czytelnika spoza zespołu:
wszyscy posłowie pełniący funkcje w Radzie Ministrów, każdy z linkiem do dokumentu
powołania. Bez tego tabela dokumentuje jedno nazwisko, a przy pozostałych stoi
„powód nieznany z danych" — co jest prawdą, ale wygląda na wybór, a nie na brak.

## Czego nie da się z tego zautomatyzować

Kuszące byłoby wyciągnąć skład rządu z jakiegoś API i wpisać hurtem. Nie robimy
tego z dwóch powodów. Po pierwsze, dopasowanie „minister X" do posła po nazwisku
jest dokładnie tym łączeniem po nazwie, którego zakazaliśmy sobie w module SUDOP.
Po drugie, funkcje bywają nieoczywiste: przerwa w mandacie, wybór do Parlamentu
Europejskiego, urlop bezpłatny. Trzydzieści wierszy wpisanych ręcznie i sprawdzonych
jest warte więcej niż pięćset wpisanych automatem i niesprawdzonych.
