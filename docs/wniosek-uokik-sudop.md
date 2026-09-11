# Kontakt z UOKiK w sprawie API SUDOP

**Wersja 2, 4 września 2026.** Poprzednia wersja została wyrzucona w całości.
Opierała się na twierdzeniu, że odpowiedzi API nie zawierają nagłówka `Location` —
nieprawdziwym, wynikającym z tego, że nasz klient HTTP podążał za przekierowaniem
automatycznie i konsumował ten nagłówek. Ta wersja opiera się na pomiarze z sondy 29,
który jest metodycznie poprawny: jedno zgłoszenie, jeden identyfikator, 36 odpytań
przez sześć minut.

**Dwa pisma, w tej kolejności.** Najpierw krótki e-mail techniczny do administratorów
— usterka w kolejce to rzecz, którą administrator może po prostu naprawić, i wtedy
formalny wniosek nie jest do niczego potrzebny. Jeśli po siedmiu dniach nie ma
odpowiedzi, idzie pismo B.

---

# A. E-mail techniczny — wyślij najpierw

**Do:** shrimp@uokik.gov.pl
**Temat:** API SUDOP — zgłoszenia rejestrują się, ale nie zwracają wyników (dostęp anonimowy)

Dzień dobry,

korzystam z publicznego API SUDOP i chciałbym zgłosić zachowanie, które wygląda
na usterkę w obsłudze kolejki zgłoszeń w dostępie anonimowym.

Zapytania rejestrują się poprawnie — serwer odpowiada `303` i wydaje identyfikator —
ale zasób z wynikiem nie powstaje. Sprawdziłem to 4 września 2026, odpytując
**ten sam identyfikator** przez sześć minut, co dziesięć sekund:

```
21:15:57  GET /sudop-api/api/przypadki-pomocy-bez-kolejki?nip-beneficjenta=6150022153&strona=1
          303  Location: /sudop-api/api/wynik/4976bbc9-1128-4fb0-8d39-37e46bb85aab

21:15:59  GET /sudop-api/api/przypadki-pomocy?nip-beneficjenta=6150022153&strona=1
          303  Location: /sudop-api/api/kolejka/3451e176-5e49-4c66-af69-c1adf9d3c26d
```

Następnie, 36 odpytań w odstępach 10 sekund, od 21:16:09 do 21:22:04:

- `GET /sudop-api/api/wynik/4976bbc9-1128-4fb0-8d39-37e46bb85aab`
  → za każdym razem `404`, treść: *„Brak zasobu / Nie znaleziono rekordu
  o podanym identyfikatorze"*
- `GET /sudop-api/api/kolejka/3451e176-5e49-4c66-af69-c1adf9d3c26d`
  → za każdym razem `200`, treść: *„Przygotowywanie odpowiedzi, przewidywany czas
  to 60 sekund"*, także po 365 sekundach

Zapytania słownikowe działają w tym samym czasie bez zarzutu:
`/sudop-api/slownik/gmina-siedziby` zwraca 4 170 pozycji poniżej 200 ms,
a `/sudop-api/wersja` odpowiada `{"major":"1","minor":"0","patch":"0","dateMod":"01.12.2025"}`.

Uprzejmie proszę o informację:

1. czy w dostępie anonimowym wyszukiwanie przypadków pomocy powinno zwracać wyniki,
   a jeśli tak — czy zgłoszenia z powyższymi identyfikatorami zostały przetworzone;
2. jaki jest oczekiwany czas oczekiwania i sposób odpytywania, którego Państwo
   oczekują (nie chcę odpytywać częściej ani dłużej, niż to potrzebne);
3. czy ścieżka `/api/przypadki-pomocy-bez-kolejki`, opisana w Państwa specyfikacji
   OpenAPI (`/sudop-api/v3/api-docs`), jest dostępna bez uwierzytelnienia —
   specyfikacja nie zawiera żadnego `securitySchemes`;
4. czy moduł szerszego dostępu przez indywidualny klucz, o którym mowa na stronie
   Urzędu, jest już uruchomiony.

Dane posłużą do budowy nieodpłatnej, niekomercyjnej platformy obywatelskiej
prezentującej informacje z oficjalnych rejestrów, zawsze z odesłaniem do źródła.
Odpytywanie prowadzę oszczędnie — całe badanie to kilkanaście zapytań, a nie
obciążenie serwisu.

Z wyrazami szacunku,
[imię i nazwisko] · [e-mail]

---

# B. Wniosek formalny — dopiero jeśli A pozostanie bez odpowiedzi

**Nadawca:** [imię i nazwisko] · [adres do korespondencji] · [e-mail]

**Adresat:** Urząd Ochrony Konkurencji i Konsumentów, pl. Powstańców Warszawy 1, 00-950 Warszawa

**Data:** [data]

## Wniosek o ponowne wykorzystywanie informacji sektora publicznego

Na podstawie art. 39 ustawy z dnia 11 sierpnia 2021 r. o otwartych danych
i ponownym wykorzystywaniu informacji sektora publicznego (Dz.U. 2021 poz. 1641
z późn. zm.) wnoszę o udostępnienie informacji sektora publicznego w celu ich
ponownego wykorzystywania.

**1. Zakres wnioskowanych informacji**

Dane o udzielonej pomocy publicznej i pomocy de minimis gromadzone w Systemie
Udostępniania Danych o Pomocy Publicznej (SUDOP), w zakresie odpowiadającym
zasobowi udostępnianemu publicznie przez wyszukiwarkę SUDOP i opisanemu
w specyfikacji OpenAPI Urzędu jako `AidEventEntity`, obejmującym w szczególności:
beneficjenta wraz z numerem NIP i kodem gminy siedziby, podmiot udzielający pomocy
wraz z jego numerem NIP, dzień udzielenia pomocy, wartość nominalną i wartość brutto
pomocy, formę i przeznaczenie pomocy oraz numer środka pomocowego.

**2. Sposób udostępnienia — wnoszę alternatywnie o jedno z dwóch**

a) **Doprowadzenie do działania publicznego interfejsu API** w zakresie wyszukiwania
   przypadków pomocy albo wydanie indywidualnego klucza dostępowego, o którym Urząd
   informuje na swojej stronie, albo

b) **Udostępnienie zbiorczego pliku** z danymi we wskazanym zakresie w formacie
   nadającym się do odczytu maszynowego (CSV, XML lub JSON), z określeniem
   częstotliwości aktualizacji.

Wariant (b) jest z mojej perspektywy w pełni wystarczający i prawdopodobnie mniej
obciążający dla Urzędu niż obsługa zapytań przez interfejs programistyczny.

Zaznaczam, że nie pozyskuję i nie zamierzam pozyskiwać danych przez automatyzację
webowej wyszukiwarki SUDOP. Interfejs ten jest przeznaczony do obsługi przez
człowieka i jego zautomatyzowane odpytywanie w skali, jakiej wymaga omawiany projekt,
obciążałoby zasoby Urzędu bez potrzeby. Wnoszę właśnie o to, by uzyskać dostęp
kanałem do tego przewidzianym.

**3. Uzasadnienie techniczne wniosku**

Publiczny interfejs API SUDOP w dostępie anonimowym rejestruje wyszukiwania,
ale ich nie kończy.

Sprawdziłem to 4 września 2026, wykonując zapytania zgodne ze specyfikacją OpenAPI
opublikowaną przez Urząd pod adresem `https://api-sudop.uokik.gov.pl/sudop-api/v3/api-docs`.

- **Zapytania słownikowe działają poprawnie i natychmiast.** Endpointy
  `/slownik/forma-pomocy`, `/przeznaczenie-pomocy`, `/srodek-pomocowy`,
  `/sektor-dzialalnosci` i `/gmina-siedziby` zwracają odpowiednio 70, 450, 1 837,
  3 518 i 4 170 pozycji w czasie poniżej 200 ms. Usługa raportuje wersję
  `1.0.0` z dnia 1 grudnia 2025.

- **Wyszukiwanie przypadków pomocy rejestruje się poprawnie.** Zapytanie
  `/api/przypadki-pomocy` zwraca `303` z nagłówkiem `Location` wskazującym
  na `/api/kolejka/{identyfikator}`, a `/api/przypadki-pomocy-bez-kolejki` —
  `303` z odesłaniem wprost do `/api/wynik/{identyfikator}`.

- **Wyniki nie powstają.** Odpytując **ten sam identyfikator** 36 razy
  w odstępach 10 sekund, przez 365 sekund (21:16:09–21:22:04):
  `/api/wynik/4976bbc9-1128-4fb0-8d39-37e46bb85aab` za każdym razem zwracał `404`
  z komunikatem „Brak zasobu — nie znaleziono rekordu o podanym identyfikatorze",
  a `/api/kolejka/3451e176-5e49-4c66-af69-c1adf9d3c26d` za każdym razem `200`
  z komunikatem „Przygotowywanie odpowiedzi, przewidywany czas to 60 sekund" —
  także po upływie sześciokrotności deklarowanego czasu.

- **Specyfikacja nie przewiduje uwierzytelnienia.** Opublikowany dokument OpenAPI
  nie zawiera komponentu `securitySchemes`, a strona Urzędu podaje wprost:
  „Korzystanie z API SUDOP jest możliwe bez rejestracji użytkownika".

Poprawność samych zapytań potwierdza to, że Urząd odpowiada na nie merytorycznie —
zapytanie zawężone wyłącznie datą zwraca komunikat „Dodaj kryteria wyszukiwania
inne niż strona oraz dzień udzielenia pomocy", z czego wynika, że parametry są
rozpoznawane i przetwarzane, a `gmina-siedziby-kod` jest kryterium wystarczającym.

Problem leży zatem w przetwarzaniu zarejestrowanych zgłoszeń w dostępie anonimowym,
a nie w konstrukcji zapytań.

Jednocześnie webowa wyszukiwarka SUDOP (`sudop.uokik.gov.pl`) zwraca te same dane
bez zwłoki i pozwala pobrać je jako plik CSV. Dane są więc gotowe i dostępne;
niedostępny jest wyłącznie kanał, który Urząd przeznaczył do dostępu maszynowego.

Podkreślam, że **interfejs webowy jest węższy niż API**. Wyszukiwanie beneficjentów
(`/search/aidEvent`) wymaga wskazania środka pomocowego i nie pozwala zawęzić wyników
wyłącznie do lokalizacji siedziby beneficjenta i zakresu dat. Pytanie „jaka pomoc
trafiła do podmiotów mających siedzibę w danej gminie" — możliwe do zadania przez API —
przez wyszukiwarkę wymaga odrębnego wyszukania dla każdego z ponad tysiąca środków
pomocowych i łączenia wyników poza systemem Urzędu.

**4. Cel ponownego wykorzystywania**

Dane posłużą do budowy nieodpłatnej, niekomercyjnej platformy obywatelskiej
udostępniającej informacje o wydatkowaniu środków publicznych w formie przystępnej
dla osób bez przygotowania specjalistycznego. Platforma prezentuje wyłącznie dane
z oficjalnych rejestrów państwowych i przy każdej informacji podaje odesłanie
do źródła.

**5. Warunki ponownego wykorzystywania**

Zobowiązuję się do przestrzegania warunków określonych przez Urząd, w szczególności
do podawania przy każdej publikowanej informacji: źródła danych, daty ich pozyskania,
informacji o możliwości ich zmiany oraz informacji, że Urząd nie ponosi
odpowiedzialności za dalsze ich wykorzystanie. Wymogi te są w projekcie
zaimplementowane na poziomie modelu danych — każdy rekord ma obowiązkowe pole
ze źródłem i datą pozyskania, bez których nie może zostać zapisany.

**6. Forma przekazania**

Proszę o przekazanie informacji drogą elektroniczną na adres [e-mail], a w przypadku
wariantu (b) — o wskazanie adresu, pod którym plik będzie dostępny.

[podpis]

---

## Notatka dla Ciebie (nie wysyłaj)

**Najpierw A, nie B.** Usterka w kolejce to rzecz, którą administrator naprawia
w pół dnia. Formalny wniosek uruchamia procedurę, terminy i decyzję administracyjną —
niepotrzebnie, jeśli wystarczy e-mail. Do tego pismo A jest łatwiejsze do odpowiedzenia:
podajesz identyfikatory zgłoszeń, więc administrator ma czego szukać w logach.

**Nie pisz, po co dokładnie potrzebujesz danych, więcej niż w punkcie 4.**
Prawo do ponownego wykorzystywania nie zależy od celu i nie trzeba go uzasadniać.
Punkt 4 jest tam po to, żeby ułatwić urzędnikowi decyzję, a nie dlatego, że musi być.

**Terminy przy piśmie B.** Urząd ma rozpatrzyć wniosek bez zbędnej zwłoki,
nie później niż w 14 dni. Jeśli nie zdąży, musi zawiadomić o przyczynie i nowym
terminie, nieprzekraczalnie 2 miesiące od złożenia. Odmowa wymaga decyzji
administracyjnej z uzasadnieniem, od której przysługuje odwołanie. ePUAP daje
urzędowe poświadczenie doręczenia, co przy liczeniu terminu bywa istotne.

**Nie jestem prawnikiem.** Podstawa prawna jest przytoczona za stronami BIP urzędów,
procedura jest standardowa i darmowa, ale przeczytaj całość — to ma być Twoje pismo.
