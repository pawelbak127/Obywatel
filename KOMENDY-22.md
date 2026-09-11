# Paczka 22 — podpis Prezydenta bije weto

```
supabase/migrations/0020_los_procesu_podpis.sql — NOWY
src/lib/queries.ts                              — nadpisz
src/app/posel/[slug]/page.tsx                   — nadpisz
```

## Kroki

```
# 1. SQL Editor: cała treść 0020_los_procesu_podpis.sql
#    Kończy się jednym SELECT-em — odeślij tabelkę.
```

```powershell
# 2.
npm test
npm run dev
```

Build produkcyjny, lint, typy i 131 testów przechodzą u mnie.

**Uwaga dla Claude Code:** po tej paczce najnowsza migracja to **0020**,
a nie 0019. Mapa `MIGRACJE` w `src/lib/queries.ts` jest już zaktualizowana.

---

## Weryfikacja wypadła dobrze — i wykryła mój błąd

Rejestr odpowiedział jednoznacznie:

```
Veto                          "Wniosek Prezydenta (weto)"                                63
PresidentToTribunal           "Prezydent skierował ustawę do Trybunału Konstytucyjnego"   10
PresidentSignature            "Prezydent podpisał ustawę"                               491
PresidentMotionConsideration  "Rozpatrywanie na forum Sejmu wniosku Prezydenta"          15
```

**`Veto` to wniosek Prezydenta, a nie rozpatrzenie weta przez Sejm** — to drugie
ma własny kod. Etykiety z migracji 0019 są więc poprawne co do kierunku i nic
nie trzeba cofać. O to właśnie prosiłem tę tabelkę.

Ale ta sama tabelka pokazała coś, czego w 0019 nie uwzględniłem.

### `PresidentSignature` występuje 491 razy, a mojej logiki w ogóle nie dotykał

Kolejność warunków w 0019 brzmiała: link → Trybunał → weto → świeżość.
**Podpisu nie było tam wcale.**

To ma konkretny skutek. Gdy Sejm odrzuci weto większością 3/5, Prezydent ma
obowiązek ustawę podpisać. W etapach zostaje wtedy **jedno i drugie**: weto
i podpis. Widok z 0019 zatrzymywał się na wecie i pisał „Prezydent zawetował"
o ustawie, która została podpisana i czeka już tylko na druk w Dzienniku Ustaw.

Czyli **ten sam rodzaj pomyłki, który 0019 miała naprawić, tylko w drugą stronę.**
Wtedy pisaliśmy „uchwalono" o ustawie, która nie weszła w życie; teraz pisalibyśmy
„zawetowano" o ustawie, która wejdzie.

Migracja 0020 wstawia podpis w kolejność zaraz po linku do aktu, bo jest faktem
**późniejszym i mocniejszym** niż weto czy skierowanie do Trybunału. Nowy stan
nazywa się `podpisany` i mówi: „uchwalono — Prezydent podpisał", z dopiskiem,
że akt nie pojawił się jeszcze w rejestrze.

Migracja ma na to kontrolę, która się wywali, gdyby kiedykolwiek ustawa
podpisana została opisana jako zawetowana.

### „Oczekuje na publikację" przestaje stać na dacie, gdy stoi na fakcie

0019 rozpoznawała świeżo uchwalone ustawy po `closure_date` z ostatnich 90 dni.
To był ostrożny domysł z braku czegoś lepszego. Teraz mamy coś lepszego: podpis
w etapach. Próg 90 dni zostaje wyłącznie tam, gdzie rejestr nie odnotował jeszcze
żadnego etapu prezydenckiego.

---

## Czego świadomie **nie** zrobiłem

`PresidentMotionConsideration` mówi, że Sejm zajmował się wnioskiem Prezydenta —
**nie mówi, jak zagłosował.**

Kuszące byłoby napisać „Sejm weta nie odrzucił", skoro podpisu nie ma. Ale to
jest wnioskowanie z nieobecności danych, a nie fakt z rejestru — i gdyby import
kiedykolwiek przeoczył etap podpisu, wydrukowalibyśmy przy nazwisku posła zdanie
o skutku prawnym, które jest nieprawdą.

Profil pokazuje więc oba fakty osobno:

> uchwalono — Prezydent zawetował
> Nie mamy w rejestrze ani podpisu Prezydenta, ani publikacji aktu.
> Rejestr odnotowuje wniosek Prezydenta (weto) oraz rozpatrywanie tego wniosku przez Sejm.

Czytelnik składa to sam. Ta sama zasada co przy kształcie nieobecności: podajemy,
co wynika z danych, i nazywamy po imieniu to, czego nie wiemy.

---

## O co proszę

Jedną tabelkę z końca migracji — rozkład losów. Kontrola: suma wszystkiego poza
`opublikowany` i `(Sejm nie uchwalil)` powinna dać **103**.

Ciekawi mnie zwłaszcza kolumna `w_tym_z_wetem` przy stanie `opublikowany` —
to będą ustawy, przy których Sejm weto odrzucił. Jeśli takie są, znaczy to,
że 0019 faktycznie opisywałaby je błędnie.
