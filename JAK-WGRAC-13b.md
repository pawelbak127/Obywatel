# Paczka 13b — `.env.local` czytany sam + zmierzona dziedzina „wielkości"

```
ingest/lib/env.ts          — NOWY plik
ingest/lib/db.ts           — nadpisz
ingest/mappers/sudop.ts    — nadpisz
ingest/mappers/sudop.test.ts — nadpisz
docs/sudop.md              — nadpisz
```

## 1. `npm run ingest:*` nie widziało `.env.local` — to był mój błąd w instrukcji

Skrypty w `package.json` nie mają `--env-file=.env.local`, więc `npm run
ingest:sudop-gminy` czytał puste środowisko, mimo że plik jest wypełniony
poprawnie. Do tej pory uruchamiałeś wszystko przez `npx tsx --env-file=…`,
więc problem nie wychodził — dopóki nie napisałem w instrukcji `npm run`.

Naprawione **w kodzie, nie w instrukcji**: `ingest/lib/env.ts` wczytuje
`.env.local` (a potem `.env`) przez `process.loadEnvFile`, wbudowane w Node
od 20.12. Zmienne już obecne w środowisku mają pierwszeństwo, więc sekrety
w GitHub Actions nic nie nadpisze, a brak pliku nie jest błędem.

Od teraz **oba warianty działają tak samo**:

```
npm run ingest:sudop-gminy
npx tsx --env-file=.env.local ingest/jobs/sync-sudop-gminy.ts
```

Komunikat o brakującej zmiennej mówi teraz dodatkowo, w którym katalogu szukałem
pliku i czy go znalazłem — bo drugą przyczyną tego błędu jest uruchamianie
polecenia spoza katalogu projektu.

## 2. „Wielkość beneficjenta" — dziedzina zmierzona zamiast zgadniętej

Twój eksport pokazał trzy brzmienia, których nie było na mojej liście:

```
duży przedsiębiorca
beneficjent nienależący do kategorii określonych kodem od 0 do 2
przedsiębiorstwo nienależące do kategorii określonych kodem od 0 do 2
```

Z pierwotnej listy potwierdziło się dokładnie **jedno** brzmienie
(„małe przedsiębiorstwo"). Reszta była moim wyobrażeniem o tym, jak urząd
nazywa kategorie. Lista jest teraz oparta na danych.

To sformułowanie zdradza przy okazji słownik źródłowy: **0 = mikro, 1 = małe,
2 = średnie**, a wszystko powyżej nie ma własnej nazwy i przez lata opisywano
je różnie.

**Świadomie nie sklejam tych brzmień w jedną kategorię.** „Duży przedsiębiorca"
i „beneficjent nienależący do kategorii 0–2" to nie jest dowodliwie to samo —
drugie może obejmować podmioty, które w ogóle nie są przedsiębiorcami (fundacje,
instytuty). Gdy przyjdzie filtrowanie po wielkości, zrobimy osobną mapę
z komentarzem, a nie ciche zlepienie przy imporcie.

## 3. Kroki

```
npm test                       # oczekiwane: 74 passed
npm run ingest:sudop-gminy     # teraz zadziała bez --env-file
```

Przy słowniku interesuje mnie ta sekcja, jeśli się pojawi:

```
UWAGA: N kodow ma ROZNE nazwy
```

Potem import na sucho, tym razem bez ostrzeżenia o wielkościach i — jeśli
te 5 kodów jest w słowniku — bez ostrzeżenia o TERYT:

```
npm run ingest:sudop-csv -- "C:\Users\Kornelia\Downloads\przypadkiPomocyDuze.csv" --z=aidEvent --sucho
```

Jeśli przejdzie czysto, to samo bez `--sucho` i wklej mi kontrolę sum.

## Co już wiemy z Twojego eksportu

30 wierszy, CP1250, 14 kolumn, zakres **2008-04-01 … 2023-01-01**, zero wierszy
bez NIP-u, zero z błędną sumą kontrolną NIP-u, zero bez kodu gminy. Pięć różnych
gmin. Parser przeszedł przez plik z 15-letnim rozrzutem dat bez jednego wyjątku —
to jest lepszy wynik, niż się spodziewałem po pierwszym kontakcie z tym formatem.
