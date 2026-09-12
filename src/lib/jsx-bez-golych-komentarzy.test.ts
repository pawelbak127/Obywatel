/**
 * Straznik jednego, konkretnego bledu, ktory 12.09.2026 stal na produkcji
 * przez caly dzien i przeszedl przez recenzje.
 *
 *   npx tsx --test src/lib/jsx-bez-golych-komentarzy.test.ts
 *
 * ---------------------------------------------------------------------
 * CO SIE STALO. W `poslowie/page.tsx`, w kolumnie paska, stal komentarz
 * zapisany tak:
 *
 *     <div className="flex …">…</div>
 *     &#47;*
 *       WYSOKOSC h-2.5, nie h-1.5. Przy szescdziesieciu wierszach …
 *     *&#47;
 *     <div className="relative mt-1.5 h-2.5 …">
 *
 * W JSX komentarz musi stac w klamrach — `{&#47;* … *&#47;}`. Bez nich to nie
 * jest komentarz, tylko ZWYKLY TEKST: przy kazdym z szescdziesieciu poslow
 * czytelnik widzial akapit o wysokosci paska w CSS-ie, razem z gwiazdkami
 * i ukosnikami.
 *
 * DLACZEGO NIC TEGO NIE ZLAPALO.
 *   - `tsc --noEmit` nie ma prawa: to poprawny JSX. Tekst w dziecku elementu
 *     jest legalna trescia.
 *   - `npm run build` przechodzi z tego samego powodu.
 *   - Sprawdzanie strony przez `curl | grep "szukana fraza"` tez nie —
 *     bo szuka sie tego, czego sie spodziewa, a nie tego, co tam jest.
 *   - Recenzja czytala DIFF, a w diffie te szesc linii wyglada jak komentarz.
 *
 * ---------------------------------------------------------------------
 * DLACZEGO PARSER, A NIE WYRAZENIE REGULARNE.
 *
 * Wciecie nie rozstrzyga. Wciety `&#47;*` wewnatrz ciala funkcji jest zwyklym,
 * poprawnym komentarzem i w tym repozytorium jest ich mnostwo. Ten sam znak
 * w dziecku elementu JSX jest bledem. Roznica jest skladniowa, wiec pyta sie
 * o nia parser, a nie o ksztalt linii.
 *
 * Kompilator TypeScriptu widzi to wprost: goly komentarz w dziecku elementu
 * laduje w wezle `JsxText`. Prawdziwy komentarz JSX laduje w `JsxExpression`
 * i w `JsxText` nie zostawia sladu. Test szuka wiec `JsxText`, ktory zawiera
 * `&#47;*` albo `*&#47;` — i nie ma tu miejsca na heurystyke.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const KATALOG = 'src';
const OTWARCIE = '/' + '*';
const ZAMKNIECIE = '*' + '/';

function plikiTsx(katalog: string): string[] {
  const out: string[] = [];
  for (const wpis of readdirSync(katalog)) {
    const sciezka = join(katalog, wpis);
    if (statSync(sciezka).isDirectory()) out.push(...plikiTsx(sciezka));
    else if (wpis.endsWith('.tsx')) out.push(sciezka);
  }
  return out;
}

/** Zwraca opisy miejsc, w ktorych tekst JSX zawiera skladnie komentarza. */
function goleKomentarze(sciezka: string): string[] {
  const kod = readFileSync(sciezka, 'utf8');
  const zrodlo = ts.createSourceFile(sciezka, kod, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const znalezione: string[] = [];

  const obejdz = (wezel: ts.Node): void => {
    if (ts.isJsxText(wezel)) {
      const tresc = wezel.getText();
      if (tresc.includes(OTWARCIE) || tresc.includes(ZAMKNIECIE)) {
        const { line } = zrodlo.getLineAndCharacterOfPosition(wezel.getStart());
        const podglad = tresc.trim().split('\n')[0]?.slice(0, 60) ?? '';
        znalezione.push(`${sciezka}:${line + 1} — ${podglad}`);
      }
    }
    ts.forEachChild(wezel, obejdz);
  };

  obejdz(zrodlo);
  return znalezione;
}

test('zaden komentarz w JSX nie stoi bez klamer, czyli nie renderuje sie jako tekst', () => {
  const pliki = plikiTsx(KATALOG);
  assert.ok(pliki.length > 0, 'nie znaleziono ani jednego pliku .tsx — sprawdz sciezke');

  const bledy = pliki.flatMap(goleKomentarze);

  assert.deepEqual(
    bledy,
    [],
    `Komentarz stoi w JSX bez klamer i BEDZIE WIDOCZNY NA STRONIE.\n` +
      `Zamien na {${OTWARCIE} … ${ZAMKNIECIE}}:\n${bledy.join('\n')}`,
  );
});

test('straznik naprawde wykrywa blad, a nie tylko swieci na zielono', () => {
  /*
    Test bez tej kontroli jest gorszy niz brak testu: daje poczucie
    bezpieczenstwa, nie sprawdzajac niczego. Gdyby ktos przy refaktoryzacji
    zepsul `goleKomentarze` tak, ze zawsze zwraca pusta liste, test wyzej
    nadal swiecilby na zielono przy kazdej zmianie.

    Dlatego karmimy parser tym samym ksztaltem, ktory naprawde stal
    w poslowie/page.tsx, i zadamy, zeby zostal zlapany.
  */
  const zepsuty = [
    'export function X() {',
    '  return (',
    '    <div>',
    `      ${OTWARCIE} komentarz bez klamer ${ZAMKNIECIE}`,
    '      <span>tresc</span>',
    '    </div>',
    '  );',
    '}',
  ].join('\n');

  const zrodlo = ts.createSourceFile('probny.tsx', zepsuty, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let zlapane = 0;
  const obejdz = (w: ts.Node): void => {
    if (ts.isJsxText(w) && (w.getText().includes(OTWARCIE) || w.getText().includes(ZAMKNIECIE))) zlapane++;
    ts.forEachChild(w, obejdz);
  };
  obejdz(zrodlo);

  assert.ok(zlapane > 0, 'parser nie rozpoznal golego komentarza — straznik jest slepy');
});

test('poprawny komentarz JSX w klamrach NIE jest zglaszany jako blad', () => {
  // Kontrola odwrotna: bezpiecznik, ktory krzyczy na poprawny kod, zostanie
  // wylaczony przy pierwszym falszywym alarmie i przestanie chronic cokolwiek.
  const poprawny = [
    'export function X() {',
    '  return (',
    '    <div>',
    `      {${OTWARCIE} to jest prawdziwy komentarz JSX ${ZAMKNIECIE}}`,
    '      <span>tresc</span>',
    '    </div>',
    '  );',
    '}',
  ].join('\n');

  const zrodlo = ts.createSourceFile('probny.tsx', poprawny, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let zlapane = 0;
  const obejdz = (w: ts.Node): void => {
    if (ts.isJsxText(w) && (w.getText().includes(OTWARCIE) || w.getText().includes(ZAMKNIECIE))) zlapane++;
    ts.forEachChild(w, obejdz);
  };
  obejdz(zrodlo);

  assert.equal(zlapane, 0, 'komentarz w klamrach zostal zgloszony jako blad — falszywy alarm');
});
