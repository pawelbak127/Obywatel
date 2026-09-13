import type { MetadataRoute } from 'next';

import { publicEnv, siteUrlWygladaNaLokalny } from '@/lib/env';

// Bez koncowego "/" - patrz ten sam zabieg w src/app/sitemap.ts.
const BASE = publicEnv.siteUrl.replace(/\/+$/, '');

// Produkcja pod adresem lokalnym znaczy brak NEXT_PUBLIC_SITE_URL na
// hostingu. Nie przerywamy builda, ale to MUSI byc widac — patrz
// `siteUrlWygladaNaLokalny` w src/lib/env.ts.
if (siteUrlWygladaNaLokalny()) {
  console.error(`::error::robots.txt zglasza adresy pod ${BASE} — ustaw NEXT_PUBLIC_SITE_URL na domene produkcyjna.`);
}

/**
 * /robots.txt — wbudowany mechanizm Next (`MetadataRoute.Robots`), nie plik
 * statyczny pisany recznie. Next sam serwuje to spod `/robots.txt`.
 *
 * WYLACZAMY WYLACZNIE `/api/`. To punkty zapisu (`/api/zglos` przyjmuje
 * zgloszenia bledow), nie tresc do zaindeksowania — nie maja czego robic
 * w wynikach wyszukiwania i nie powinny byc odpytywane przez roboty.
 *
 * `allow: '/'` TUTAJ NIE WLACZA INDEKSOWANIA SERWISU. Prawdziwy wylacznik
 * siedzi w `src/app/layout.tsx` (`robots: { index: false, follow: false }`,
 * zdejmowany osobno, jako ostatni krok przed premiera — nie ruszamy go stad).
 * Ten plik odpowiada wylacznie za to, co WOLNO ROBOTOM POBRAC; znacznik
 * `noindex` na kazdej stronie decyduje o tym, co WOLNO IM ZAPISAC W INDEKSIE,
 * i obowiazuje niezaleznie od tego, co pozwala robots.txt. Celowo NIE
 * blokujemy tu calego serwisu przez `disallow` — gdyby roboty nie mogly go
 * pobrac, nie zobaczylyby tez `noindex`, co czasem konczy sie adresem bez
 * tresci widocznym w wynikach mimo wszystko.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: '/api/',
    },
    sitemap: `${BASE}/sitemap.xml`,
  };
}
