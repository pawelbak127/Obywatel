# Paczka 13c — jeden plik

```
ingest/jobs/sync-sudop-gminy.ts   — nadpisz
```

## Ten plik nie został podmieniony

Twój log mówi to wprost:

```
Pozycji: 4170. Kod: "number", nazwa: "name".
```

Wersja z paczki 13a wypisuje w tym miejscu **trzecie pole**:

```
Pozycji: 4170. Kod: "number", nazwa: "name", data: "dateEnd".
```

albo `, bez daty obowiazywania.` — i zaraz potem linijkę
`Powtorzonych kodow TERYT w slowniku: N`. Skoro ich nie ma, na dysku leży wersja
z paczki 13, bez deduplikacji. Paczka 13b tego pliku nie zawierała, więc jeśli
rozpakowałeś ją po 13a, mogła nie nadpisać niczego, a jeśli 13a nie weszła
w całości — tym bardziej.

**Sprawdzian po podmianie:** pierwsza linijka po „Pozycji" ma zawierać `data:`
albo `bez daty obowiazywania`. Jeśli nie zawiera, plik nadal jest stary.

Dołożyłem też twardy warunek tuż przed zapisem: jeśli deduplikacja z jakiegoś
powodu nie zadziała, dostaniesz zdanie o tym wprost, zamiast komunikatu Postgresa,
który nie mówi o przyczynie nic.

```
npm run ingest:sudop-gminy
```

---

# Odpowiedź na Twoje pytanie o ilość danych

**Trzydzieści wierszy wystarczy na to, co miały sprawdzić — i nie sprawdzi tego,
co jest teraz najważniejsze.**

Format jest potwierdzony: kodowanie, 14 kolumn, kwoty, daty z rozrzutem
piętnastu lat, sumy kontrolne NIP-ów, kody gmin. Większy plik tego samego rodzaju
powtórzy ten sam test głośniej i niczego nowego nie powie.

Cztery rzeczy zostają nietknięte, w kolejności ważności:

**1. Deduplikacja między eksportami.** To jest cały sens kolumny `row_sha256`
i nigdy nie została uruchomiona na prawdziwych danych. Test: pobierz **ten sam
program drugi raz** (albo dwa programy, które dzielą beneficjentów) i zaimportuj
oba. Drugi import ma pokazać `Nowych w bazie: 0` i `Bylo juz wczesniej: 30`.
Jeśli pokaże 30 nowych, każdy kolejny eksport będzie mnożył te same dotacje —
a wtedy „firma X dostała 4 mld" byłoby naszą pomyłką w mnożeniu, nie faktem.

**2. Kontrakt nagłówka na innej stronie.** Pobierz eksport z `/search/aidBeneficiary`
(szukanie po NIP-ie) i uruchom na sucho. Spodziewam się, że **przerwie** —
i to jest dobry wynik, bo pokaże, że strażnik działa i jednocześnie powie nam,
jakie kolumny ma tamten eksport. Jeśli przejdzie, to znaczy, że obie strony
dają ten sam format, co też warto wiedzieć.

**3. Wiersze bez NIP-u i bez kwot.** W Twoim pliku było ich zero, ale pomoc
dostają też rolnicy i osoby fizyczne, które NIP-u mogą nie mieć. Znajdzie się
to samo przy programach rolnych albo przy pomocy de minimis dla mikrofirm.

**4. Wielkość.** Chunki po 500 wierszy nie zostały ani razu użyte — 30 wierszy
to jedna paczka. Import na kilka tysięcy wierszy sprawdzi to przy okazji, ale
sam z siebie nie jest priorytetem.

## Jedna rzecz, którą chcę zobaczyć niezależnie

**4 095 981 200,75 PLN na 30 wierszy** to średnio 136 mln na wiersz. To może być
prawda — duże programy inwestycyjne tak wyglądają — ale to jest dokładnie ten
rodzaj liczby, który trafia do nagłówka. Zanim cokolwiek z tego pokażemy,
chcę porównać dwa albo trzy największe wiersze z tym, co widać na ekranie
w wyszukiwarce. Jeden przecinek w złym miejscu przy takich kwotach to sprostowanie.

## Kolejność, którą proponuję

```
1. npm run ingest:sudop-gminy                     (po podmianie pliku)
2. import na sucho — ten sam plik, ma być bez ostrzeżeń
3. import na serio — wklej mi kontrolę sum
4. import TEGO SAMEGO pliku drugi raz             <- najważniejszy test
5. eksport z /search/aidBeneficiary, na sucho     <- test strażnika nagłówka
```
