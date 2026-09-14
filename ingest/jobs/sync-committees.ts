/**
 * Komisje sejmowe i czlonkostwo poslow.
 *
 *   npm run ingest:komisje
 *   npm run ingest:komisje -- --sucho    pobiera i sprawdza, NIC nie zapisuje
 *
 * ---------------------------------------------------------------------
 * PO CO. Profil posla mowi, jak glosowal i o co pytal rzad — nie mowi, CZYM
 * SIE ZAJMUJE. Komisja jest na to odpowiedzia z rejestru, bez domyslu.
 *
 * Caly zbior to jedno zadanie i 40 rekordow, wiec nie ma tu ani stronicowania,
 * ani puli rownoleglosci. Pelne uzasadnienie schematu — naglowek migracji 0033.
 *
 * ---------------------------------------------------------------------
 * KOLEJNOSC ZAPISU MA ZNACZENIE. `committee_members` ma klucz obcy do
 * `committees`, wiec komisje ida pierwsze. Odwrotnie caly import wywrocilby
 * sie na pierwszym czlonku.
 *
 * FUNKCJE ZAPISUJEMY SLOWAMI REJESTRU (D20). Rejestr rozroznia
 * „przewodniczacy" i „przewodniczaca", „zastepca przewodniczacej"
 * i „zastepczyni przewodniczacej". Sprowadzenie tego do dwoch kodow
 * zmienialoby to, co rejestr napisal o konkretnej osobie.
 */

import { db } from '../lib/db.js';
import { writeCursor } from '../lib/source-recorder.js';
import { getJson } from '../lib/http.js';
import { assertSchema, WYMOGI_KOMISJE } from '../lib/preflight.js';

const TERM = 10;
const TYPY = ['STANDING', 'EXTRAORDINARY', 'INVESTIGATIVE'] as const;

type CzlonekApi = { id: number; function?: string | null; joinDate?: string | null };
type KomisjaApi = {
  code: string;
  name: string;
  nameGenitive?: string | null;
  type: string;
  scope?: string | null;
  phone?: string | null;
  appointmentDate?: string | null;
  compositionDate?: string | null;
  subCommittees?: string[] | null;
  members?: CzlonekApi[] | null;
};

async function main() {
  const sucho = process.argv.includes('--sucho') || process.argv.includes('--dry');

  await assertSchema(WYMOGI_KOMISJE);

  const odp = await getJson<KomisjaApi[]>(`https://api.sejm.gov.pl/sejm/term${TERM}/committees`);
  const komisje = Array.isArray(odp.data) ? odp.data : [];
  if (!komisje.length) throw new Error('API zwrocilo pusta liste komisji — nie nadpisujemy tego, co mamy.');

  /*
    KONTROLA DZIEDZINY PRZED ZAPISEM (CLAUDE.md §7.1).

    Sprawdzamy CALA porcje, zanim cokolwiek trafi do bazy. Typ spoza slownika
    odrzucilaby dopiero baza — w polowie zapisu, z komunikatem o naruszeniu
    ograniczenia zamiast o tym, ktora komisja jest winna.

    Wzorzec §7.2 („nieznana wartosc slownikowa jest raportowana, nie przerywa")
    NIE MA tu zastosowania: `type` steruje tlumaczeniem na polska nazwe
    w interfejsie, wiec nieznana wartosc nie jest niedoskonaloscia danych,
    tylko dziura w tym, co pokazemy czytelnikowi.
  */
  const zleTypy = komisje.filter((k) => !TYPY.includes(k.type as (typeof TYPY)[number]));
  if (zleTypy.length) {
    throw new Error(
      `${zleTypy.length} komisji ma typ spoza slownika, np. ${zleTypy[0]!.code} = "${zleTypy[0]!.type}". ` +
        `Dopisz go do TYPY w tym pliku, do ograniczenia w migracji i do tlumaczenia w interfejsie.`,
    );
  }
  const bezNazwy = komisje.filter((k) => !k.code?.trim() || !k.name?.trim());
  if (bezNazwy.length) throw new Error(`${bezNazwy.length} komisji nie ma kodu albo nazwy.`);

  const czlonkowie = komisje.flatMap((k) =>
    (k.members ?? []).map((m) => ({
      code: k.code,
      mp_id: m.id,
      function: m.function ?? null,
      join_date: m.joinDate ?? null,
    })),
  );

  console.log(`Komisji: ${komisje.length} (w tym sledczych: ${komisje.filter((k) => k.type === 'INVESTIGATIVE').length}).`);
  console.log(`Czlonkostw: ${czlonkowie.length}, poslow: ${new Set(czlonkowie.map((c) => c.mp_id)).size}.`);
  if (sucho) {
    console.log('--sucho: niczego nie zapiszemy.');
    return;
  }

  const doZapisu = komisje.map((k) => ({
    code: k.code,
    term: TERM,
    name: k.name,
    name_genitive: k.nameGenitive ?? null,
    type: k.type,
    scope: k.scope ?? null,
    phone: k.phone ?? null,
    appointment_date: k.appointmentDate ?? null,
    composition_date: k.compositionDate ?? null,
    sub_committees: k.subCommittees ?? [],
    updated_at: new Date().toISOString(),
  }));

  const zapisK = await db().from('committees').upsert(doZapisu, { onConflict: 'code' });
  if (zapisK.error) throw new Error(`committees.upsert: ${zapisK.error.message}`);

  /*
    CZLONKOWIE SPOZA BAZY SA RAPORTOWANI, NIE PRZERYWAJA (§7.2) — to jest
    niedoskonalosc danych, a nie dziura w interfejsie. Klucz obcy i tak by
    ich odrzucil, ale wtedy padlby caly `upsert` i nie zapisalibysmy nikogo.
  */
  const znani = new Set<number>();
  const { data: mps, error: bladMps } = await db().from('mps').select('id');
  if (bladMps) throw new Error(`mps.select: ${bladMps.message}`);
  for (const m of (mps ?? []) as Array<{ id: number }>) znani.add(m.id);

  const doZapisuCzl = czlonkowie.filter((c) => znani.has(c.mp_id));
  const pominieci = czlonkowie.length - doZapisuCzl.length;

  const zapisC = await db().from('committee_members').upsert(doZapisuCzl, { onConflict: 'code,mp_id' });
  if (zapisC.error) throw new Error(`committee_members.upsert: ${zapisC.error.message}`);

  console.log('');
  console.log(`Zapisano: ${doZapisu.length} komisji, ${doZapisuCzl.length} czlonkostw.`);
  if (pominieci > 0) {
    console.log(
      `UWAGA: pominieto ${pominieci} czlonkostw — to poslowie, ktorych nie ma w tabeli mps. ` +
        'Uruchom najpierw ingest:mps.',
    );
  }

  // Kontrola sum — po zapisie, na tym, co naprawde jest w bazie.
  const { count, error: e2 } = await db()
    .from('committee_members')
    .select('code', { count: 'exact', head: true });
  if (e2) throw new Error(`kontrola: ${e2.message}`);
  console.log(`W bazie lacznie czlonkostw: ${count}`);

  await writeCursor('committees', { cursorAt: new Date().toISOString(), error: null });
}

main().catch(async (e) => {
  const msg = (e as Error).message;
  console.error(`\n${msg}`);
  await writeCursor('committees', { error: msg }).catch(() => {});
  process.exit(1);
});
