/**
 * Generator adresow /posel/[slug].
 *
 * Trzy rzeczy, ktore latwo przeoczyc, a ktore zapiekaja sie w adresach URL
 * na zawsze - a adresy sa tym, co ludzie wysylaja sobie na X:
 *
 *  1. "ł" NIE normalizuje sie przez NFD. Unicode traktuje je jako osobna litere,
 *     a nie "l" z kreska, wiec samo `normalize('NFD').replace(diakrytyki)` zostawia
 *     "ł" nietkniete. Stad jawna mapa.
 *  2. Nazwiska sie powtarzaja. W kadencji X sa posłowie o identycznym imieniu
 *     i nazwisku - drugi dostaje sufiks z okregiem, nie losowa liczbe.
 *  3. Slug raz nadany jest niezmienny. Zmiana lamie linki i psuje cache
 *     obrazkow OG. Dlatego przy kolejnych importach czytamy istniejacy slug
 *     z bazy zamiast liczyc go od nowa.
 */

const PL: Record<string, string> = {
  ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z',
  Ą: 'a', Ć: 'c', Ę: 'e', Ł: 'l', Ń: 'n', Ó: 'o', Ś: 's', Ź: 'z', Ż: 'z',
};

export function slugify(input: string): string {
  return input
    .replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, (ch) => PL[ch] ?? ch)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export type SlugCandidate = { id: number; firstName: string; lastName: string; districtNum: number };

/**
 * Nadaje slugi calej liscie naraz, rozstrzygajac kolizje deterministycznie.
 * `existing` to mapa mpId -> slug juz zapisany w bazie; te maja pierwszenstwo.
 */
export function assignSlugs(people: readonly SlugCandidate[], existing = new Map<number, string>()): Map<number, string> {
  const out = new Map<number, string>();
  const taken = new Set<string>(existing.values());

  // Najpierw utrwalone - nie ruszamy ich nigdy.
  for (const p of people) {
    const kept = existing.get(p.id);
    if (kept) out.set(p.id, kept);
  }

  // Kolizje liczymy tylko wsrod nowych, w kolejnosci id - deterministycznie.
  const pending = people.filter((p) => !out.has(p.id)).sort((a, b) => a.id - b.id);

  for (const p of pending) {
    const base = slugify(`${p.firstName} ${p.lastName}`);
    let slug = base;
    if (taken.has(slug)) slug = `${base}-${p.districtNum}`;      // okreg rozroznia imienników
    if (taken.has(slug)) slug = `${base}-${p.districtNum}-${p.id}`; // ostatnia deska ratunku
    taken.add(slug);
    out.set(p.id, slug);
  }

  return out;
}
