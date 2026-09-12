/**
 * Sonda 33 — akty powołania i zmian w składzie Rady Ministrów z Monitora Polskiego.
 *
 *   npx tsx scripts/probes/33-akty-rady-ministrow.ts
 *   npx tsx scripts/probes/33-akty-rady-ministrow.ts --tekst MP/2023/1383
 *
 * ---------------------------------------------------------------------
 * PO CO. `mp_roles` jest jedyną tabelą, do której treść wpisuje człowiek
 * (D12), a jedynym dopuszczalnym źródłem jest akt powołania. Te akty są
 * w ELI — trzeba tylko umieć je znaleźć i przeczytać.
 *
 * TA SONDA NICZEGO NIE ZAPISUJE. Sprawdza dwie rzeczy:
 *   1. czy wyszukiwanie po tytule znajduje komplet aktów,
 *   2. czy `ingest/lib/pdf-text.ts` czyta je BEZ GUBIENIA POLSKICH ZNAKÓW.
 *
 * Punkt drugi jest powodem jej istnienia. Prosty ekstraktor tekstu dawał
 * „Pana -Kamysza" zamiast „Pana Władysława Kosiniaka-Kamysza" — czyli cichą
 * dziurę dokładnie w miejscu, gdzie stoi nazwisko. Sonda wypisuje liczbę
 * nieprzetłumaczonych kodów przy każdym akcie; ma być zero.
 *
 * ELI to API Kancelarii Sejmu, nie UOKiK — D13 go nie dotyczy. Mimo to
 * pobieramy każdy plik raz i z odstępem.
 */

import { pdfDoTekstu } from '../../ingest/lib/pdf-text.js';

const BAZA = 'https://api.sejm.gov.pl/eli';
const UA = 'Obywatel2.0/0.1 (+civic-tech, dane publiczne)';

/** Frazy z prawdziwych tytułów. Odmiana ma znaczenie: „powołaniu", nie „powołania". */
const FRAZY = ['powołaniu w skład Rady Ministrów', 'zmianie w składzie Rady Ministrów', 'powołaniu Prezesa Rady Ministrów'];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Akt = { ELI: string; title: string; announcementDate: string };

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status} przy ${url}`);
  return (await r.json()) as T;
}

async function szukaj(fraza: string): Promise<Akt[]> {
  const u = `${BAZA}/acts/search?publisher=MP&title=${encodeURIComponent(fraza)}&dateFrom=2023-11-01&limit=50`;
  const j = await json<{ totalCount: number; items: Akt[] }>(u);
  return j.items ?? [];
}

async function tekstAktu(eli: string): Promise<ReturnType<typeof pdfDoTekstu>> {
  const r = await fetch(`${BAZA}/acts/${eli}/text.pdf`, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status} przy PDF ${eli}`);
  return pdfDoTekstu(Buffer.from(await r.arrayBuffer()));
}

async function main() {
  const tylkoTen = process.argv.find((a, i) => process.argv[i - 1] === '--tekst');

  if (tylkoTen) {
    const w = await tekstAktu(tylkoTen);
    console.log(`nieznanych kodow: ${w.nieznanychKodow} | fontow z mapa: ${w.fontowZMapa}, bez mapy: ${w.fontowBezMapy}`);
    console.log('');
    console.log(w.tekst.slice(0, 2500));
    return;
  }

  console.log('='.repeat(72));
  console.log('SONDA 33 — akty o skladzie Rady Ministrow');
  console.log('='.repeat(72));

  const wszystkie = new Map<string, Akt>();
  for (const f of FRAZY) {
    const akty = await szukaj(f);
    console.log(`\n„${f}" -> ${akty.length}`);
    for (const a of akty) wszystkie.set(a.ELI, a);
    await sleep(800);
  }

  const lista = [...wszystkie.values()].sort((a, b) => a.announcementDate.localeCompare(b.announcementDate));
  console.log('');
  console.log(`Lacznie unikalnych aktow: ${lista.length}`);
  console.log('');
  console.log('='.repeat(72));
  console.log('CZYTANIE PDF-ow — kolumna "nieznane" MA BYC ZEREM');
  console.log('='.repeat(72));

  let sumaNieznanych = 0;
  for (const a of lista) {
    try {
      const w = await tekstAktu(a.ELI);
      sumaNieznanych += w.nieznanychKodow;
      const polskie = (w.tekst.match(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g) ?? []).length;
      console.log(
        `  ${a.ELI.padEnd(13)} ${a.announcementDate}  znakow ${String(w.tekst.length).padStart(6)}  ` +
          `polskich ${String(polskie).padStart(4)}  nieznane ${String(w.nieznanychKodow).padStart(4)}`,
      );
    } catch (e) {
      console.log(`  ${a.ELI.padEnd(13)} ${a.announcementDate}  BLAD: ${(e as Error).message}`);
    }
    await sleep(800);
  }

  console.log('');
  console.log(sumaNieznanych === 0
    ? 'Wszystkie akty odczytane bez ani jednego nieznanego kodu.'
    : `UWAGA: ${sumaNieznanych} nieprzetlumaczonych kodow. Tekst ma dziury — NIE uzywac do mp_roles.`);
}

main().catch((e) => {
  console.error(`\n${(e as Error).message}`);
  process.exitCode = 1;
});
