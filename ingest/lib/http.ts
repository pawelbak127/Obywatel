/**
 * Klient HTTP do API panstwowych. Produkcyjna wersja `http.js` z paczki PoC.
 *
 * Trzy zasady, kazda wynikajaca z pomiaru, nie z ostroznosci na wyrost:
 *   1. Jawny User-Agent z kontaktem - piszemy do serwera Kancelarii Sejmu,
 *      nie do cudzego API komercyjnego.
 *   2. Ograniczona rownoleglosc. Sejm API zniosl 20 rownoleglych zapytan bez
 *      jednego 429, ale to nie powod, zeby tak robic w nocy przez rok.
 *   3. Retry z backoffem i poszanowaniem Retry-After.
 */

export const USER_AGENT =
  process.env.INGEST_USER_AGENT ??
  'Obywatel2.0/0.1 (+https://github.com/obywatel; civic-tech, dane publiczne)';

const CONCURRENCY = Number(process.env.INGEST_CONCURRENCY ?? 8);
const MIN_INTERVAL_MS = Number(process.env.INGEST_MIN_INTERVAL_MS ?? 60);

export class HttpError extends Error {
  constructor(
    override readonly message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** Semafor - trzyma liczbe rownoleglych zapytan pod kontrola. */
class Gate {
  private active = 0;
  private queue: Array<() => void> = [];
  private lastStart = 0;

  async acquire(): Promise<void> {
    if (this.active >= CONCURRENCY) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    const wait = this.lastStart + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastStart = Date.now();
  }

  release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

const gate = new Gate();

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type FetchOptions = {
  retries?: number;
  timeoutMs?: number;
  accept?: string;
};

/** Surowy strzal z retry. Zwraca Response - dekodowanie zostawiamy wolajacemu. */
async function request(url: string, opts: FetchOptions = {}): Promise<Response> {
  const { retries = 3, timeoutMs = 30_000, accept = 'application/json' } = opts;

  for (let attempt = 0; ; attempt++) {
    await gate.acquire();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ac.signal,
        headers: { 'User-Agent': USER_AGENT, Accept: accept },
      });

      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const waitS = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 2 ** attempt;
        console.warn(`  ${res.status} na ${url} — czekam ${waitS}s (proba ${attempt + 1}/${retries})`);
        await sleep(waitS * 1000);
        continue;
      }
      if (!res.ok) throw new HttpError(`HTTP ${res.status}`, res.status, url);
      return res;
    } catch (err) {
      if (err instanceof HttpError) throw err;
      if (attempt >= retries) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new HttpError(`Blad sieci: ${msg}`, 0, url);
      }
      await sleep(2 ** attempt * 1000);
    } finally {
      clearTimeout(timer);
      gate.release();
    }
  }
}

/**
 * Pobiera JSON i zwraca RAZEM z surowym tekstem.
 *
 * Surowy tekst jest tu nie przez przypadek: hash liczymy z dokladnie tych bajtow,
 * ktore przyszly z serwera. Gdybysmy hashowali `JSON.stringify(parsed)`, kolejnosc
 * kluczy po parsowaniu mogloby zmienic hash bez zmiany danych - i cala baza
 * przepisywalaby sie co noc bez powodu.
 */
export async function getJson<T>(
  url: string,
  opts?: FetchOptions,
): Promise<{ data: T; raw: string; status: number; headers: Headers }> {
  const res = await request(url, opts);
  const raw = await res.text();
  // NAGLOWKI SA CZESCIA ODPOWIEDZI, nie dodatkiem. Endpoint /processes podaje
  // rozmiar calego zbioru wylacznie w `x-total-count` i `content-range` —
  // w ciele odpowiedzi nie ma o tym ani slowa. Import, ktory ich nie czyta,
  // konczy sie sukcesem, majac 3% kadencji.
  return { data: JSON.parse(raw) as T, raw, status: res.status, headers: res.headers };
}

export async function getBuffer(url: string, opts?: FetchOptions): Promise<{ buffer: Buffer; status: number }> {
  const res = await request(url, { accept: '*/*', ...opts });
  return { buffer: Buffer.from(await res.arrayBuffer()), status: res.status };
}

/**
 * Czy pod adresem cokolwiek jest. HEAD, wiec bez sciagania tresci.
 *
 * Uzywane do zdjec poslow: adres skladamy z id (`/MP/{id}/photo`), a nie
 * dostajemy go z API — wiec nikt nie zagwarantowal, ze zdjecie istnieje.
 * Bez tej kontroli wstawilibysmy na strone zepsuty obrazek.
 *
 * NIE korzysta z `request()`, bo tamta funkcja rzuca wyjatkiem na kazdym
 * statusie != 2xx, a tutaj 404 jest ODPOWIEDZIA, nie awaria. Semafor
 * i User-Agent obowiazuja tak samo — Kancelaria Sejmu ma widziec, kto puka.
 */
export async function headExists(url: string, timeoutMs = 15_000): Promise<boolean | null> {
  await gate.acquire();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: ac.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
    });
    if (res.status === 200) return true;
    if (res.status === 404 || res.status === 410) return false;
    // 403, 429, 500 — serwer nie powiedzial "nie ma", tylko "nie teraz".
    // `null` znaczy NIE WIEM i wolajacy ma zostawic adres bez zmian.
    return null;
  } catch {
    return null; // timeout, blad sieci — tez "nie wiem"
  } finally {
    clearTimeout(timer);
    gate.release();
  }
}

/** Mapowanie z ograniczona rownoleglosc - Gate i tak pilnuje, ale czytelniej. */
export async function mapLimit<T, R>(items: readonly T[], fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}
