/**
 * Walidacja adresu projektu Supabase.
 *
 * Powstalo po realnym bledzie, ktory kosztowal godzine diagnostyki:
 * w .env.local znalazlo sie
 *     NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co/rest/v1/
 * zamiast samego
 *     NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
 *
 * supabase-js doklada `/rest/v1/` samodzielnie, wiec kazde zapytanie szlo na
 *     /rest/v1/rest/v1/mps   ->   404 PGRST125
 *
 * Blad byl podstepny, bo wyglada jak problem z uprawnieniami, a nie z adresem.
 * Lepiej wywalic sie od razu z czytelnym komunikatem niz debugowac RLS,
 * ktore nigdy nie bylo uruchomione.
 */

export function normalizeSupabaseUrl(raw: string | undefined, varName: string): string {
  // CRLF z plikow .env edytowanych na Windowsie potrafi zostac w wartosci —
  // ale .trim() traktuje \r i \n jako biale znaki i usuwa je z obu brzegow
  // sam, wiec osobny krok na to nie jest potrzebny.
  const value = (raw ?? '').trim();

  if (!value) {
    throw new Error(`Brak zmiennej ${varName}. Skopiuj .env.example do .env.local i uzupelnij.`);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${varName} nie jest poprawnym adresem URL: "${value}"`);
  }

  if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
    throw new Error(`${varName} musi zaczynac sie od https:// (jest: ${url.protocol}//)`);
  }

  const path = url.pathname.replace(/\/+$/, '');
  if (path) {
    throw new Error(
      `${varName} zawiera sciezke "${url.pathname}", a powinien byc samym adresem projektu.\n` +
        `  jest:     ${value}\n` +
        `  powinno:  ${url.origin}\n` +
        'supabase-js sam doklada /rest/v1/ — ze sciezka w zmiennej powstaje /rest/v1/rest/v1/ i kazde\n' +
        'zapytanie konczy sie bledem 404 PGRST125, ktory wyglada jak problem z uprawnieniami.',
    );
  }

  if (url.search || url.hash) {
    throw new Error(`${varName} zawiera parametry lub kotwice — zostaw sam adres: ${url.origin}`);
  }

  return url.origin;
}
