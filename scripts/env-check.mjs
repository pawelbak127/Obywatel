#!/usr/bin/env node
/**
 * DIAGNOSTYKA `.env.local` BEZ UJAWNIANIA WARTOŚCI.
 *
 *   npm run env:check
 *   npm run env:check -- --sprawdz-token    dodatkowo pyta Management API, czy token żyje
 *
 * ---------------------------------------------------------------------
 * DLACZEGO TEN PLIK POWSTAŁ DOPIERO TERAZ.
 *
 * `package.json` deklarował `env:check` od dawna, a `CLAUDE.md` i `HANDOFF.md`
 * wskazują tę komendę jako **bezpieczną alternatywę dla otwierania
 * `.env.local`**. Pliku `scripts/env-check.mjs` nigdy nie było — komenda
 * kończyła się błędem „Cannot find module".
 *
 * Czyli zasada bezpieczeństwa („nie otwieramy .env.local, do diagnostyki jest
 * env:check") opierała się na narzędziu, którego nie ma. Każdy, kto chciał
 * sprawdzić konfigurację, musiał tę zasadę złamać.
 *
 * ---------------------------------------------------------------------
 * CZEGO TEN SKRYPT NIE WYPISUJE: żadnego fragmentu żadnej wartości.
 *
 * `scripts/diagnose.mjs` pokazuje pierwsze 28 znaków klucza. Przy tokenie
 * `sbp_…` (48 znaków) to ponad połowa sekretu na ekranie, w logu terminala
 * i — gdyby ktoś wkleił wynik — w historii czatu. Tutaj wychodzą wyłącznie:
 * długość, rozpoznany KSZTAŁT i obecność znaków, które psują pliki .env.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const SPRAWDZ_TOKEN = process.argv.includes('--sprawdz-token');

for (const nazwa of ['.env.local', '.env']) {
  if (existsSync(resolve(nazwa))) {
    try {
      process.loadEnvFile(resolve(nazwa));
    } catch (e) {
      console.error(`Nie udalo sie wczytac ${nazwa}: ${e.message}`);
    }
  }
}

const linia = (s = '') => console.log(s);

/**
 * Rozpoznanie kształtu wartości. Nazwy kształtów, nie wartości.
 *
 * `sbp_` — Personal Access Token Supabase (Management API)
 * `eyJ`  — JWT, czyli anon key albo service_role key
 * `sb_`  — nowy format kluczy publishable/secret
 */
function ksztalt(v) {
  if (/^sbp_[a-f0-9]{40}$/.test(v)) return 'token osobisty Supabase (sbp_ + 40 znakow hex) — POPRAWNY KSZTALT';
  if (/^sbp_/.test(v)) return `zaczyna sie od "sbp_", ale dalsza czesc ma ${v.length - 4} znakow zamiast 40 — PODEJRZANE`;
  if (/^eyJ[A-Za-z0-9_-]+\.eyJ/.test(v)) return 'JWT (anon albo service_role)';
  if (/^sb_(publishable|secret)_/.test(v)) return 'klucz w nowym formacie sb_*';
  if (/^https:\/\//.test(v)) return 'adres https';
  if (/^[a-z0-9]{20}$/.test(v)) return 'reference ID projektu (20 znakow)';
  return 'nierozpoznany ksztalt';
}

function sprawdz(nazwa, { wymagane = false, oczekiwany = null } = {}) {
  const surowa = process.env[nazwa];
  if (surowa === undefined || surowa === '') {
    linia(`  ${nazwa}`);
    linia(`     ${wymagane ? 'BRAK — wymagane' : 'brak (opcjonalne)'}`);
    return;
  }

  const v = surowa.trim();
  // Bialy znak wewnatrz wartosci i CR z CRLF to dwie najczestsze przyczyny
  // „klucz wyglada dobrze, a serwer go nie przyjmuje" na Windowsie.
  const sterujace = [...surowa].filter((c) => c.charCodeAt(0) < 32).length;
  const obcietoBiale = surowa.length !== v.length;
  const bialeWSrodku = /\s/.test(v);

  linia(`  ${nazwa}`);
  linia(`     dlugosc ${v.length}, ksztalt: ${ksztalt(v)}`);
  if (sterujace) linia(`     !! ${sterujace} znakow sterujacych w wartosci (CR z CRLF?)`);
  if (obcietoBiale) linia('     !  biale znaki na poczatku/koncu — obcinamy je w kodzie, ale lepiej usunac');
  if (bialeWSrodku) linia('     !! BIALY ZNAK W SRODKU WARTOSCI — prawie na pewno uciety wklej');
  if (oczekiwany && !ksztalt(v).includes(oczekiwany)) {
    linia(`     !! spodziewalem sie: ${oczekiwany}`);
  }
}

linia('');
linia('=== Konfiguracja .env.local (wartosci NIE sa wypisywane) ===');
linia('');
linia('Publiczne — trafiaja do przegladarki:');
sprawdz('NEXT_PUBLIC_SUPABASE_URL', { wymagane: true, oczekiwany: 'adres https' });
sprawdz('NEXT_PUBLIC_SUPABASE_ANON_KEY', { wymagane: true });
sprawdz('NEXT_PUBLIC_SITE_URL');
linia('');
linia('Serwerowe — NIGDY nie trafiaja do przegladarki:');
sprawdz('SUPABASE_SERVICE_ROLE_KEY', { wymagane: true });
linia('');
linia('Narzedziowe:');
sprawdz('SUPABASE_PROJECT_ID', { oczekiwany: 'reference ID' });
sprawdz('SUPABASE_ACCESS_TOKEN', { oczekiwany: 'token osobisty' });
sprawdz('ANTHROPIC_API_KEY');

// ---------------------------------------------------------------------
// Kontrola adresu — najczestszy blad konfiguracji w tym projekcie.
// ---------------------------------------------------------------------
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
if (url) {
  try {
    const u = new URL(url);
    const sciezka = u.pathname.replace(/\/+$/, '');
    if (sciezka) {
      linia('');
      linia(`!! NEXT_PUBLIC_SUPABASE_URL zawiera sciezke "${u.pathname}"`);
      linia(`   Powinno byc samo: ${u.origin}`);
      linia('   supabase-js doklada /rest/v1/ SAM — ze sciezka powstaje /rest/v1/rest/v1/');
      linia('   i kazde zapytanie konczy sie 404 PGRST125.');
    }
  } catch {
    linia('');
    linia('!! NEXT_PUBLIC_SUPABASE_URL nie jest poprawnym adresem.');
  }
}

// ---------------------------------------------------------------------
// Zywy test tokenu — wylacznie na zadanie, bo wychodzi do sieci.
//
// Pyta o LISTE PROJEKTOW, a nie o konkretny projekt. To rozdziela dwie
// zupelnie rozne przyczyny bledu 401, ktorych inaczej nie da sie odroznic:
//   * token uniewazniony / wygasly     -> 401 takze na liscie projektow
//   * token zyje, ale nie ma dostepu
//     do TEGO projektu                 -> lista 200, projekt 401/403
// ---------------------------------------------------------------------
if (SPRAWDZ_TOKEN) {
  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  linia('');
  linia('=== Zywy test tokenu w Management API ===');
  if (!token) {
    linia('  Brak SUPABASE_ACCESS_TOKEN — nie ma czego sprawdzac.');
  } else {
    try {
      const res = await fetch('https://api.supabase.com/v1/projects', {
        headers: { Authorization: `Bearer ${token}` },
      });
      linia(`  GET /v1/projects  ->  HTTP ${res.status}`);
      if (res.status === 200) {
        const lista = await res.json();
        linia(`  Token ZYJE. Widzi ${Array.isArray(lista) ? lista.length : '?'} projektow.`);
        const ref = process.env.SUPABASE_PROJECT_ID?.trim();
        if (ref && Array.isArray(lista)) {
          const ma = lista.some((p) => p.id === ref);
          linia(`  Projekt z SUPABASE_PROJECT_ID jest na liscie: ${ma ? 'TAK' : 'NIE'}`);
          if (!ma) {
            linia('  -> Token nalezy do innego konta albo organizacji niz ten projekt.');
          }
        }
      } else if (res.status === 401) {
        linia('  Token ODRZUCONY na poziomie konta, nie projektu.');
        linia('  Znaczy to, ze zostal uniewazniony, wygasl albo zostal przepisany z bledem.');
        linia('  Nowy: https://supabase.com/dashboard/account/tokens');
      } else if (res.status === 429) {
        linia('  HTTP 429 — ograniczenie liczby zapytan. Token jest dobry, trzeba odczekac.');
      } else {
        linia(`  Nieoczekiwany status. Tresc: ${(await res.text()).slice(0, 200)}`);
      }
    } catch (e) {
      linia(`  Nie udalo sie polaczyc: ${e.message}`);
    }
  }
}

linia('');
linia('Zadna wartosc nie zostala wypisana powyzej — mozna wkleic ten wynik.');
linia('');
