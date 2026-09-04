/**
 * Slownik gmin z API SUDOP — jedyny endpoint tego API, ktory realnie dziala.
 *
 *   npx tsx --env-file=.env.local ingest/jobs/sync-sudop-gminy.ts
 *
 * Po co, skoro API nie zwraca przypadkow pomocy: eksport CSV podaje lokalizacje
 * jako siedmiocyfrowy kod TERYT (`0264011`). Bez slownika to jest siedem cyfr.
 * Z nim to jest "Wroclaw" — i dopiero wtedy modul lokalny ma sens.
 *
 * Zmierzone: 4 170 pozycji, 96 ms. Jedno zapytanie, raz na kwartal wystarczy.
 *
 * KSZTALT ODPOWIEDZI SPRAWDZAMY, NIE ZAKLADAMY. W dokumentacji pozycja slownika
 * ma pola `name` / `number` / `dateEnd`, ale sprawdzilem to na slowniku form
 * pomocy, nie na tym. Jesli tu jest inaczej, job ma wypisac pierwszy rekord
 * i przerwac — a nie zapisac 4 170 wierszy z `undefined` w kolumnie nazwy.
 */

import { db } from '../lib/db.js';
import { getJson } from '../lib/http.js';
import { recordSource } from '../lib/source-recorder.js';
import { assertSchema, WYMOGI_SUDOP } from '../lib/preflight.js';
import { dedupujGminy } from '../mappers/sudop.js';

const URL_SLOWNIKA = 'https://api-sudop.uokik.gov.pl/sudop-api/slownik/gmina-siedziby';

type Pozycja = Record<string, unknown>;

/**
 * Wyciaga (teryt, nazwa, data konca) z pozycji slownika albo mowi, czego nie rozumie.
 *
 * Data jest opcjonalna — sluzy tylko do rozstrzygania, ktory z powtorzonych wpisow
 * o tym samym kodzie jest aktualny. Jesli jej nie ma, mowimy o tym wprost.
 */
function rozpoznajPola(pierwsza: Pozycja): { poleKodu: string; poleNazwy: string; poleDaty?: string } {
  const klucze = Object.keys(pierwsza);
  const poleKodu = klucze.find((k) => /^\d{7}$/.test(String(pierwsza[k])));
  const poleDaty = klucze.find((k) => /^\d{4}-\d{2}-\d{2}/.test(String(pierwsza[k])));
  const poleNazwy = klucze.find(
    (k) =>
      k !== poleKodu &&
      k !== poleDaty &&
      typeof pierwsza[k] === 'string' &&
      (pierwsza[k] as string).trim().length > 1 &&
      !/^\d+$/.test(pierwsza[k] as string),
  );

  if (!poleKodu || !poleNazwy) {
    throw new Error(
      [
        '',
        'NIE ROZPOZNAJE KSZTALTU SLOWNIKA GMIN — nic nie zapisano.',
        '',
        'Pierwsza pozycja z odpowiedzi:',
        `  ${JSON.stringify(pierwsza)}`,
        '',
        `Szukalem pola z siedmiocyfrowym kodem TERYT ${poleKodu ? `(znalazlem: ${poleKodu})` : '(NIE ZNALAZLEM)'}`,
        `oraz pola z nazwa gminy ${poleNazwy ? `(znalazlem: ${poleNazwy})` : '(NIE ZNALAZLEM)'}.`,
        '',
        'Popraw `rozpoznajPola` w tym pliku, opierajac sie na powyzszym rekordzie.',
        '',
      ].join('\n'),
    );
  }
  return { poleKodu, poleNazwy, poleDaty };
}

async function main() {
  await assertSchema(WYMOGI_SUDOP);

  console.log(`Pobieram ${URL_SLOWNIKA}`);
  const { data, raw, status } = await getJson<Pozycja[] | { content?: Pozycja[] }>(URL_SLOWNIKA);

  const pozycje = Array.isArray(data) ? data : (data.content ?? []);
  const pierwsza = pozycje[0];
  if (!pierwsza) throw new Error('Slownik gmin wrocil pusty. Sprawdz, czy API znowu nie kolejkuje odpowiedzi.');

  const { poleKodu, poleNazwy, poleDaty } = rozpoznajPola(pierwsza);
  console.log(
    `Pozycji: ${pozycje.length}. Kod: "${poleKodu}", nazwa: "${poleNazwy}"${poleDaty ? `, data: "${poleDaty}"` : ', bez daty obowiazywania'}.`,
  );

  const zrodlo = await recordSource({
    kind: 'sudop_api',
    url: URL_SLOWNIKA,
    apiEndpoint: '/sudop-api/slownik/gmina-siedziby',
    httpStatus: status,
    rawPayload: raw,
  });
  if (!zrodlo.changed) console.log('Slownik nie zmienil sie od ostatniego pobrania — odswiezam mimo to.');

  // Kontrola dziedziny PRZED zapisem: wszystkie kody musza byc siedmiocyfrowe.
  const surowe = pozycje.map((p) => ({
    teryt: String(p[poleKodu] ?? '').trim(),
    nazwa: String(p[poleNazwy] ?? '').trim(),
    koniec: String(p[poleDaty ?? ''] ?? ''),
  }));
  const zle = surowe.filter((w) => !/^\d{7}$/.test(w.teryt) || !w.nazwa);
  if (zle.length) {
    throw new Error(
      `${zle.length} pozycji slownika ma zly kod albo pusta nazwe, np. ${JSON.stringify(zle[0])}. Nic nie zapisano.`,
    );
  }

  // 4 170 pozycji przy okolo 2 477 gminach w Polsce sugerowalo od poczatku,
  // ze slownik niesie tez wpisy historyczne. Logika wyboru — i uzasadnienie —
  // siedzi w `dedupujGminy`, zeby dalo sie ja przetestowac bez sieci i bazy.
  const { wybrane, konflikty } = dedupujGminy(surowe);
  const wiersze = wybrane.map((w) => ({
    teryt: w.teryt,
    nazwa: w.nazwa,
    nazwy_alternatywne: w.warianty,
    source_id: zrodlo.sourceId,
    updated_at: new Date().toISOString(),
  }));

  const usuniete = surowe.length - wiersze.length;
  if (usuniete > 0) {
    console.log(`Powtorzonych kodow TERYT w slowniku: ${usuniete}. Zostaje ${wiersze.length} unikalnych.`);
    if (poleDaty) console.log(`Przy powtorce wybieram wpis z najpozniejsza wartoscia "${poleDaty}".`);
    else console.log('Pozycje nie maja daty obowiazywania — przy powtorce zostaje pierwszy wpis.');
  }
  if (konflikty.length) {
    console.log('');
    console.log(`UWAGA: ${konflikty.length} kodow ma ROZNE nazwy. Pierwsze ${Math.min(15, konflikty.length)}:`);
    console.log(konflikty.slice(0, 15).join('\n'));
    console.log('');
    console.log('To sa najpewniej zmiany nazw albo polaczenia gmin. Jesli ktoras para wyglada');
    console.log('na dwie rozne gminy pod jednym kodem — wklej mi to, bo wtedy `number` nie jest');
    console.log('tym, czym myslimy, ze jest.');
  }

  // Pas i szelki. Gdyby deduplikacja kiedykolwiek przestala dzialac, Postgres
  // powie tylko "ON CONFLICT DO UPDATE command cannot affect row a second time",
  // co nie mowi nic o przyczynie. Wolimy powiedziec to sami i wprost.
  const unikalne = new Set(wiersze.map((w) => w.teryt));
  if (unikalne.size !== wiersze.length) {
    throw new Error(
      `Deduplikacja nie zadzialala: ${wiersze.length} wierszy, ${unikalne.size} unikalnych kodow. ` +
        'Nic nie zapisano. To blad w kodzie, nie w danych.',
    );
  }

  for (let i = 0; i < wiersze.length; i += 500) {
    const r = await db().from('sudop_gminy').upsert(wiersze.slice(i, i + 500), { onConflict: 'teryt' });
    if (r.error) throw new Error(`sudop_gminy.upsert: ${r.error.message}`);
    process.stdout.write(`\r  zapisano ${Math.min(i + 500, wiersze.length)}/${wiersze.length}`);
  }
  process.stdout.write('\n');

  const licz = await db().from('sudop_gminy').select('teryt', { count: 'exact' }).limit(0);
  if (licz.error) throw new Error(`sudop_gminy.count: ${licz.error.message}`);
  console.log(`Gmin w bazie: ${licz.count}`);
  if (licz.count !== wiersze.length) {
    console.log(`(Slownik przyniosl ${wiersze.length} — roznica to gminy z wczesniejszych pobran, ktore zniknely ze slownika.)`);
  }
}

main().catch((e) => {
  console.error(`\n${(e as Error).message}`);
  process.exit(1);
});
