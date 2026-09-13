/**
 * Dni posiedzen w ujeciu posla — z polem „nieobecnosc usprawiedliwiona".
 *
 *   npm run ingest:dni
 *   npm run ingest:dni -- --ile=20    tylko pierwszych N poslow
 *   npm run ingest:dni -- --sucho     pobiera i sprawdza, NIC nie zapisuje
 *
 * ---------------------------------------------------------------------
 * PO CO. Serwis mowi na kazdej podstronie „Sejm nie podaje, dlaczego posla
 * nie bylo" — i to zostaje prawda, bo POWODU rejestr nie podaje. Podaje
 * natomiast, czy nieobecnosc byla USPRAWIEDLIWIONA, i tego do 13.09.2026
 * nie pokazywalismy nigdzie.
 *
 * Znaczenie flagi ustalone POMIAREM, nie z dokumentacji: `absenceExcuse`
 * nie wystapilo ani razu przy `numMissed = 0` w zapisach czterech poslow
 * (dwa po 159 dni). Opisuje wiec sama nieobecnosc, nie dzien w ogole.
 * Pelne uzasadnienie w naglowku migracji 0030.
 *
 * ---------------------------------------------------------------------
 * KONTROLA DZIEDZINY PRZED ZAPISEM (CLAUDE.md §7.1).
 *
 * Zanim cokolwiek trafi do bazy, sprawdzamy CALA porcje danego posla:
 * czy `numVoted + numMissed = numVotings`. To jest niezmiennik, ktory
 * w probce 318 wierszy trzymal sie w 100% i ktorego pilnuje tez ograniczenie
 * w bazie. Lepiej przerwac na czytelnym komunikacie niz wywrocic sie na
 * `check_violation` w polowie zapisu.
 *
 * NIEZGODNOSC Z NASZYM ZALOZENIEM JEST RAPORTOWANA, NIE PRZERYWA (§7.2).
 * Gdyby rejestr kiedys przyslal `absenceExcuse = true` przy zerowym braku,
 * nasze zalozenie o znaczeniu flagi przestaloby obowiazywac. Skrypt to
 * policzy i wypisze — ale nie zatrzyma importu, bo to nie jest blad danych,
 * tylko sygnal, ze trzeba przeczytac je na nowo.
 */

import { db } from '../lib/db.js';
import { getJson, mapLimit } from '../lib/http.js';
import { assertSchema, WYMOGI_DNI } from '../lib/preflight.js';

const TERM = 10;

type DzienApi = {
  date: string;
  sitting: number;
  numVotings: number;
  numVoted: number;
  numMissed: number;
  absenceExcuse: boolean;
};

type Wiersz = {
  mp_id: number;
  date: string;
  sitting: number;
  num_votings: number;
  num_voted: number;
  num_missed: number;
  absence_excuse: boolean;
};

function flaga(nazwa: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${nazwa}=`))?.split('=')[1];
}

async function main() {
  const sucho = process.argv.includes('--sucho') || process.argv.includes('--dry');
  const limit = Number(flaga('ile') ?? 0) || 0;

  await assertSchema(WYMOGI_DNI);

  let q = db().from('mps').select('id').order('id', { ascending: true });
  if (limit) q = q.limit(limit);
  const { data, error } = await q;
  if (error) throw new Error(`mps.select: ${error.message}`);

  const poslowie = (data ?? []) as Array<{ id: number }>;
  if (!poslowie.length) {
    console.log('Brak poslow w bazie — uruchom najpierw ingest:mps.');
    return;
  }

  console.log(`Poslow do pobrania: ${poslowie.length}.`);
  if (sucho) console.log('--sucho: niczego nie zapiszemy.');
  console.log('');

  const start = Date.now();
  let gotowe = 0;
  let wierszy = 0;
  let zapisanych = 0;
  let sprzecznychZZalozeniem = 0;
  const bledy: string[] = [];

  const przetworz = async (m: { id: number }) => {
    try {
      const dni = await getJson<DzienApi[]>(`https://api.sejm.gov.pl/sejm/term${TERM}/MP/${m.id}/votings/stats`);
      const lista = Array.isArray(dni.data) ? dni.data : [];

      // KONTROLA DZIEDZINY — cala porcja, zanim cokolwiek zapiszemy.
      const zle = lista.filter((d) => d.numVoted + d.numMissed !== d.numVotings);
      if (zle.length) {
        const p = zle[0]!;
        throw new Error(
          `niezgodna suma w ${zle.length} dniach, np. ${p.date}/${p.sitting}: ` +
            `${p.numVoted} + ${p.numMissed} != ${p.numVotings}`,
        );
      }

      // Sygnal, ze zalozenie o znaczeniu flagi przestalo obowiazywac.
      sprzecznychZZalozeniem += lista.filter((d) => d.numMissed === 0 && d.absenceExcuse).length;

      wierszy += lista.length;
      if (sucho || !lista.length) return;

      const doZapisu: Wiersz[] = lista.map((d) => ({
        mp_id: m.id,
        date: d.date,
        sitting: d.sitting,
        num_votings: d.numVotings,
        num_voted: d.numVoted,
        num_missed: d.numMissed,
        absence_excuse: d.absenceExcuse,
      }));

      /*
        `upsert` jest tu POPRAWNY, w odroznieniu od przypadku ze zdjeciami
        (§7.7). Tam problemem bylo podanie dwoch kolumn z kilkunastu wymaganych;
        tutaj podajemy KOMPLET kolumn wiersza, wiec Postgres ma co walidowac
        jeszcze przed konfliktem.

        `onConflict` z trzema kolumnami, bo klucz jest trojelementowy — jedna
        data potrafi miec dwa posiedzenia (zmierzone, migracja 0030).
      */
      const zapis = await db().from('mp_sitting_days').upsert(doZapisu, { onConflict: 'mp_id,date,sitting' });
      if (zapis.error) throw new Error(`upsert: ${zapis.error.message}`);
      zapisanych += doZapisu.length;
    } catch (e) {
      bledy.push(`  posel ${m.id}: ${(e as Error).message}`);
    } finally {
      gotowe++;
      if (gotowe % 25 === 0 || gotowe === poslowie.length) {
        const sek = (Date.now() - start) / 1000;
        process.stdout.write(`\r  ${gotowe}/${poslowie.length}  (${(sek / gotowe).toFixed(2)} s/posla)   `);
      }
    }
  };

  // `mapLimit` ma globalna, wspolna dla importow rownoleglosc (ingest/lib/http.ts)
  // — nie przyjmuje wlasnej liczby i celowo tego nie obchodzimy.
  await mapLimit(poslowie, przetworz);
  process.stdout.write('\n\n');

  console.log(`Dni pobranych: ${wierszy}, zapisanych: ${zapisanych}, bledow: ${bledy.length}`);
  console.log(`Czas: ${((Date.now() - start) / 60000).toFixed(1)} min`);

  if (sprzecznychZZalozeniem > 0) {
    console.log('');
    console.log(
      `UWAGA: ${sprzecznychZZalozeniem} dni ma absenceExcuse = true PRZY ZEROWEJ LICZBIE ` +
        'opuszczonych glosowan. Nasze zalozenie brzmi, ze ta flaga opisuje sama nieobecnosc ' +
        '(migracja 0030, zmierzone na 4 poslach). Jesli ta liczba rosnie, zalozenie trzeba ' +
        'przeczytac na nowo, a zdanie na profilu przeredagowac.',
    );
  }

  if (bledy.length) {
    console.log('');
    console.log(`${bledy.length} poslow nie udalo sie pobrac:`);
    console.log(bledy.slice(0, 10).join('\n'));
  }

  if (bledy.length && bledy.length === poslowie.length) {
    console.log('');
    console.log(`::error::Nie udalo sie pobrac ANI JEDNEGO posla (${bledy.length}/${poslowie.length}).`);
    process.exitCode = 1;
  }

  if (!sucho) {
    const { count, error: e2 } = await db()
      .from('mp_sitting_days')
      .select('mp_id', { count: 'exact', head: true });
    if (e2) throw new Error(`kontrola: ${e2.message}`);
    console.log('');
    console.log(`W bazie lacznie dni posiedzen: ${count}`);
  }
}

main().catch((e) => {
  console.error(`\n${(e as Error).message}`);
  process.exit(1);
});
