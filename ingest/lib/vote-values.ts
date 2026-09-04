/**
 * Dziedzina wartosci glosu — i dlaczego ma wlasny plik.
 *
 * Enum `vote_value` w bazie zbudowalem na podstawie schematu OpenAPI Sejm API.
 * Backfill posiedzenia 63 wywalil sie na wartosci, ktorej tam nie bylo:
 *     invalid input value for enum vote_value: "PRESENT"
 *
 * Wniosek ogolniejszy niz jedna brakujaca wartosc: dziedzine tego pola
 * kontroluje ZRODLO, nie my. Kazde kolejne posiedzenie moze przyniesc nowa
 * wartosc, a my dowiemy sie o tym w polowie zapisu 1,9 mln wierszy.
 *
 * Dlatego importer sprawdza wartosci PRZED zapisem calego posiedzenia
 * i przerywa z gotowym poleceniem SQL, zamiast wywracac sie na porcji nr 2000.
 */

/** Wartosci, ktore zna nasz enum w bazie (migracje 0001 + 0006). */
export const ZNANE_WARTOSCI = [
  'YES',
  'NO',
  'ABSTAIN',
  'ABSENT',
  'PRESENT',       // obecny, ale bez prostego stanowiska — typowe przy ON_LIST
  'VOTE_VALID',
  'VOTE_INVALID',
] as const;

export type VoteValue = (typeof ZNANE_WARTOSCI)[number];

const ZNANE = new Set<string>(ZNANE_WARTOSCI);

/**
 * STANOWISKA — tylko te trzy wartosci znacza "posel opowiedzial sie za czyms".
 *
 * To jest lista dozwolonych, a nie lista zakazanych, i to jest celowe.
 * Gdyby lojalnosc liczyla "wszystko poza ABSENT", to PRESENT — czyli obecnosc
 * bez stanowiska — bylaby porownywana z wiekszoscia klubu i wychodzilaby jako
 * NIELOJALNOSC. Posel dostalby zarzut za glos, ktorego nie oddal.
 *
 * Nowa, nieznana wartosc od Sejmu automatycznie NIE wejdzie do lojalnosci,
 * bo nie ma jej na tej liscie. Domyslnie ostrozniej.
 */
export const STANOWISKA: readonly VoteValue[] = ['YES', 'NO', 'ABSTAIN'];

export const jestStanowiskiem = (v: string): boolean => (STANOWISKA as readonly string[]).includes(v);

/** Obecnosc: wszystko poza jawna nieobecnoscia. */
export const jestObecnoscia = (v: string): boolean => v !== 'ABSENT';

export function nieznaneWartosci(wartosci: Iterable<string | undefined | null>): string[] {
  const nieznane = new Set<string>();
  for (const v of wartosci) if (v && !ZNANE.has(v)) nieznane.add(v);
  return [...nieznane].sort();
}

/** Komunikat, ktory ma od razu mowic, co zrobic — a nie tylko, co poszlo nie tak. */
export function komunikatONieznanych(nieznane: readonly string[], gdzie: string): string {
  return [
    '',
    `NIEZNANE WARTOSCI GLOSU (${gdzie}): ${nieznane.join(', ')}`,
    '',
    'Sejm API zwrocilo wartosc, ktorej nie zna nasz enum. Przerywam PRZED zapisem,',
    'zeby nie wpisac do bazy frekwencji policzonej z niepelnej dziedziny.',
    '',
    'Zeby to naprawic, w SQL Editorze:',
    ...nieznane.map((v) => `    alter type vote_value add value if not exists '${v}';`),
    '',
    'Potem dopisz te wartosci do ZNANE_WARTOSCI w ingest/lib/vote-values.ts',
    'i ROZSTRZYGNIJ, czy sa stanowiskiem (wchodza do lojalnosci) czy tylko',
    'obecnoscia. Zle zaklasyfikowana wartosc daje falszywy zarzut nielojalnosci.',
    '',
  ].join('\n');
}
