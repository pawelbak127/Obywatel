# Wniosek do UOKiK o dostęp do danych SUDOP

Szkic do wysłania. **Uzupełnij pola w nawiasach kwadratowych** i przeczytaj całość —
to ma być Twoje pismo, nie moje. Nie jestem prawnikiem; podstawa prawna jest
przytoczona za stronami BIP urzędów, a procedura jest standardowa i darmowa.

**Gdzie wysłać:** UOKiK, kancelaria ogólna — e-mail albo ePUAP.
Adresy są na stronie urzędu; ePUAP daje urzędowe poświadczenie doręczenia,
co przy liczeniu terminu 14 dni bywa istotne.

**Czego się spodziewać:** urząd ma rozpatrzyć wniosek bez zbędnej zwłoki,
nie później niż w 14 dni. Jeśli nie zdąży, musi zawiadomić o przyczynie i nowym
terminie, nieprzekraczalnie 2 miesiące od złożenia. Odmowa wymaga decyzji
administracyjnej z uzasadnieniem, od której przysługuje odwołanie.

---

## Treść wniosku

**Nadawca:** [imię i nazwisko] · [adres do korespondencji] · [e-mail]

**Adresat:** Urząd Ochrony Konkurencji i Konsumentów, pl. Powstańców Warszawy 1, 00-950 Warszawa

**Data:** [data]

### Wniosek o ponowne wykorzystywanie informacji sektora publicznego

Na podstawie art. 39 ustawy z dnia 11 sierpnia 2021 r. o otwartych danych
i ponownym wykorzystywaniu informacji sektora publicznego (Dz.U. 2021 poz. 1641
z późn. zm.) wnoszę o udostępnienie informacji sektora publicznego w celu ich
ponownego wykorzystywania.

**1. Zakres wnioskowanych informacji**

Dane o udzielonej pomocy publicznej i pomocy de minimis, gromadzone w Systemie
Udostępniania Danych o Pomocy Publicznej (SUDOP), w zakresie odpowiadającym
zasobowi udostępnianemu publicznie przez wyszukiwarkę SUDOP, obejmującym
w szczególności: beneficjenta pomocy wraz z numerem NIP, podmiot udzielający
pomocy, dzień udzielenia pomocy, wartość pomocy, formę pomocy, przeznaczenie
pomocy, numer środka pomocowego oraz kod gminy siedziby beneficjenta.

**2. Sposób udostępnienia — wnoszę alternatywnie o jedno z dwóch**

a) **Wydanie indywidualnego klucza dostępu do interfejsu API SUDOP**
   (`https://api-sudop.uokik.gov.pl/sudop-api/`), o którym mowa w informacji
   na stronie Urzędu jako o module przygotowywanym, albo

b) **Udostępnienie zbiorczego pliku** z danymi we wskazanym wyżej zakresie
   w formacie nadającym się do odczytu maszynowego (CSV, XML lub JSON),
   z określeniem częstotliwości jego aktualizacji.

Wariant (b) jest z mojej perspektywy w pełni wystarczający i prawdopodobnie
mniej obciążający dla Urzędu niż obsługa zapytań przez API.

Zaznaczam, że nie zamierzam pozyskiwać danych przez automatyzację webowej
wyszukiwarki SUDOP. Interfejs ten jest przeznaczony do obsługi przez człowieka
i jego zautomatyzowane odpytywanie w skali, jakiej wymaga omawiany projekt,
obciążałoby zasoby Urzędu bez potrzeby. Wnoszę właśnie o to, by uzyskać dostęp
kanałem do tego przewidzianym.

**3. Uzasadnienie techniczne wniosku**

Publiczny interfejs API SUDOP w dostępie anonimowym nie zwraca danych.
Sprawdziłem to w dniach [daty testów], wykonując zapytania zgodne
z dokumentacją opublikowaną przez Urząd:

- Zapytania do słowników działają poprawnie i natychmiast. Endpointy
  `/sudop-api/slownik/forma-pomocy`, `/przeznaczenie-pomocy`, `/srodek-pomocowy`,
  `/sektor-dzialalnosci` oraz `/gmina-siedziby` zwracają kompletne dane
  (odpowiednio 70, 450, 1837, 3518 i 4170 pozycji) w czasie poniżej 200 ms.

- Zapytania o przypadki pomocy pod adresem `/sudop-api/api/przypadki-pomocy`,
  z parametrami zgodnymi z dokumentacją (`nip-beneficjenta`, `gmina-siedziby-kod`,
  `strona`), niezmiennie zwracają odpowiedź o treści *„Przygotowywanie odpowiedzi,
  przewidywany czas to 60 sekund"*. Ponawiałem odpytywanie tego samego adresu
  w odstępach 30–60 sekund przez łącznie ponad cztery minuty, w kilku niezależnych
  seriach w różnych dniach. Ani razu nie otrzymałem danych.

- Odpowiedzi nie zawierają nagłówka `Set-Cookie`, identyfikatora zgłoszenia
  ani nagłówka `Location`, nie ma więc możliwości powiązania ponownego zapytania
  z wcześniejszym zgłoszeniem w kolejce ani sprawdzenia jego statusu.

Poprawność samych zapytań potwierdza to, że Urząd odpowiada na nie merytorycznie
w innych przypadkach — na przykład zapytanie zawężone wyłącznie datą zwraca
komunikat *„Dodaj kryteria wyszukiwania inne niż strona oraz dzień udzielenia pomocy"*,
co dowodzi, że parametry są rozpoznawane i przetwarzane.

Wynika z tego, że problem leży po stronie mechanizmu kolejkowania w dostępie
anonimowym, a nie po stronie konstrukcji zapytań.

Jednocześnie webowa wyszukiwarka SUDOP (`sudop.uokik.gov.pl`) zwraca te same dane
bez żadnej zwłoki i umożliwia ich pobranie w postaci pliku CSV. Wyszukiwarka nie korzysta
przy tym z interfejsu `api-sudop.uokik.gov.pl` — komunikuje się z własnym zapleczem.
Dane są więc dostępne i gotowe; niedostępny jest wyłącznie ten kanał, który Urząd
przeznaczył do dostępu maszynowego.

Podkreślam przy tym, że **interfejs webowy jest węższy niż API**. Wyszukiwanie
beneficjentów (`/search/aidEvent`) wymaga wskazania środka pomocowego i nie pozwala
zawęzić wyników wyłącznie do lokalizacji siedziby beneficjenta i zakresu dat.
Interfejs API takie zapytanie dopuszcza — świadczy o tym komunikat zwracany przy
zapytaniu zawężonym samą datą: *„Dodaj kryteria wyszukiwania inne niż strona oraz
dzień udzielenia pomocy"*, z którego wynika, że parametr `gmina-siedziby-kod` jest
kryterium wystarczającym.

W praktyce oznacza to, że pytanie „jaka pomoc trafiła do podmiotów mających siedzibę
w danej gminie" — możliwe do zadania przez API — przez wyszukiwarkę webową wymaga
odrębnego wyszukania dla każdego z ponad tysiąca środków pomocowych i późniejszego
łączenia wyników poza systemem Urzędu.

Nie wnoszę zatem o funkcję, której system nie posiada — wnoszę o dostęp do możliwości,
którą interfejs programistyczny Urzędu już realizuje.

**4. Cel ponownego wykorzystywania**

Dane posłużą do budowy nieodpłatnej, niekomercyjnej platformy obywatelskiej,
udostępniającej informacje o wydatkowaniu środków publicznych w formie przystępnej
dla osób bez przygotowania specjalistycznego. Platforma prezentuje wyłącznie dane
pochodzące z oficjalnych rejestrów państwowych i przy każdej informacji podaje
odesłanie do źródła.

**5. Warunki ponownego wykorzystywania**

Zobowiązuję się do przestrzegania warunków określonych przez Urząd,
w szczególności do podawania przy każdej publikowanej informacji:
źródła danych, daty ich pozyskania, informacji o możliwości ich zmiany
oraz informacji, że Urząd nie ponosi odpowiedzialności za dalsze wykorzystanie
danych. Wymogi te są w projekcie zaimplementowane na poziomie modelu danych —
każdy rekord ma obowiązkowe pole ze źródłem i datą pobrania, bez których
nie może zostać zapisany.

**6. Forma przekazania**

Proszę o przekazanie informacji drogą elektroniczną na adres [e-mail],
a w przypadku wariantu (b) — o wskazanie adresu, pod którym plik będzie dostępny.

[podpis]

---

## Notatka dla Ciebie (nie wysyłaj tej części)

**Dlaczego wariant (b) jest w pierwszej kolejności.** Zbiorczy plik raz w miesiącu
jest dla nas lepszy niż klucz API: żadnych limitów, żadnej kolejki, pełne pokrycie,
import w kilka minut. Dla Urzędu też jest tańszy. Klucz API zostawiamy jako opcję,
bo strona Urzędu sama o nim wspomina.

**Uzupełnij daty testów.** Sondy uruchamiałeś w kilku seriach — podaj dni.
Konkretne daty i liczby są tu najmocniejszym argumentem: pokazują, że nie piszemy
„nie działa", tylko „sprawdziliśmy w taki sposób i oto co się stało".

**Nie pisz, po co dokładnie potrzebujesz danych, więcej niż w punkcie 4.**
Prawo do ponownego wykorzystywania nie zależy od celu i nie trzeba go uzasadniać.
Punkt 4 jest w piśmie po to, żeby ułatwić urzędnikowi decyzję, a nie dlatego,
że musi tam być.
