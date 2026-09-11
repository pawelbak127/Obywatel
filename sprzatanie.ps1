# =====================================================================
# Porządki przed przejściem na Claude Code.
#
# Skrypt NICZEGO NIE KASUJE poza plikami, które da się odtworzyć jednym
# poleceniem (.next, tsbuildinfo, archiwa ZIP już rozpakowane).
# Dokumentacja paczek jest PRZENOSZONA do docs/historia/, nie usuwana —
# opisuje, dlaczego rzeczy wyglądają tak, jak wyglądają.
#
# Uruchom z katalogu C:\Projects\obywatel:
#     powershell -ExecutionPolicy Bypass -File .\sprzatanie.ps1
# =====================================================================

$ErrorActionPreference = 'Stop'

if (-not (Test-Path 'package.json')) {
  Write-Host 'Uruchom ten skrypt z katalogu C:\Projects\obywatel' -ForegroundColor Red
  exit 1
}

# --- 1. Kontrola: czy paczka 21 jest wgrana ---------------------------
Write-Host "`n=== Kontrola stanu repozytorium ===" -ForegroundColor Cyan
$ma0019 = Test-Path 'supabase\migrations\0019_los_procesu.sql'
$maLos  = (Test-Path 'src\lib\queries.ts') -and
          (Select-String -Path 'src\lib\queries.ts' -Pattern 'LOS_OPIS' -Quiet)

if ($ma0019 -and $maLos) {
  Write-Host 'Paczka 21 jest wgrana (migracja 0019 + LOS_OPIS).' -ForegroundColor Green
} else {
  Write-Host 'UWAGA: paczka 21 NIE jest wgrana.' -ForegroundColor Yellow
  Write-Host ("  migracja 0019_los_procesu.sql : {0}" -f $(if ($ma0019) {'jest'} else {'BRAK'}))
  Write-Host ("  LOS_OPIS w src/lib/queries.ts : {0}" -f $(if ($maLos)  {'jest'} else {'BRAK'}))
  Write-Host '  Rozpakuj obywatel-paczka-21.zip zanim oddasz projekt Claude Code.'
}

# --- 2. Archiwum dokumentacji paczek ----------------------------------
Write-Host "`n=== Przenoszenie historii do docs/historia ===" -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path 'docs\historia' | Out-Null

$doArchiwum = @()
$doArchiwum += Get-ChildItem -File -Filter 'KOMENDY-*.md'     -ErrorAction SilentlyContinue
$doArchiwum += Get-ChildItem -File -Filter 'JAK-WGRAC-*.md'   -ErrorAction SilentlyContinue
$doArchiwum += Get-ChildItem -File -Filter 'SPRAWDZ-*.sql'    -ErrorAction SilentlyContinue
$doArchiwum += Get-ChildItem -File -Filter 'SPRINT-*.md'      -ErrorAction SilentlyContinue

foreach ($f in $doArchiwum) {
  Move-Item -Path $f.FullName -Destination 'docs\historia\' -Force
  Write-Host "  -> docs\historia\$($f.Name)"
}
if (-not $doArchiwum) { Write-Host '  (nic do przeniesienia)' }

# --- 3. Archiwa ZIP: tylko te już rozpakowane -------------------------
# Paczki 21 NIE ruszamy, dopóki nie jest wgrana.
Write-Host "`n=== Archiwa ZIP ===" -ForegroundColor Cyan
foreach ($z in Get-ChildItem -File -Filter 'obywatel-*.zip' -ErrorAction SilentlyContinue) {
  if ($z.Name -like '*21*' -and -not ($ma0019 -and $maLos)) {
    Write-Host "  ZOSTAWIAM $($z.Name) — jeszcze nierozpakowana" -ForegroundColor Yellow
    continue
  }
  Remove-Item $z.FullName -Force
  Write-Host "  usunieto $($z.Name)"
}

# --- 4. Artefakty budowania -------------------------------------------
Write-Host "`n=== Artefakty budowania (odtwarzalne) ===" -ForegroundColor Cyan
foreach ($p in @('.next', 'tsconfig.tsbuildinfo')) {
  if (Test-Path $p) {
    Remove-Item $p -Recurse -Force
    Write-Host "  usunieto $p"
  }
}
Write-Host '  (wrocą przy najblizszym `npm run dev` / `npm run build`)'

# --- 5. Indeks archiwum -----------------------------------------------
$indeks = @"
# Historia paczek

Pliki w tym katalogu opisują **stan z chwili wysyłki danej paczki**, a nie stan
dzisiejszy. Są dobre do odpowiedzi „dlaczego to tak wygląda" i **mylące** przy
pytaniu „jak to wygląda teraz".

Aktualny stan projektu opisują: ``HANDOFF.md``, ``docs/decyzje.md`` i sam kod.

Archiwum utworzone automatycznie: $(Get-Date -Format 'yyyy-MM-dd').
"@
Set-Content -Path 'docs\historia\README.md' -Value $indeks -Encoding UTF8

Write-Host "`nGotowe. W katalogu glownym zostaly tylko pliki projektu." -ForegroundColor Green
Write-Host "Sprawdz na koniec: npm run build`n"