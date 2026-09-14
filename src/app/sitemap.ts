import type { MetadataRoute } from 'next';

import { publicEnv, siteUrlWygladaNaLokalny } from '@/lib/env';
import { pobierzKodyKomisji, pobierzOkregi, pobierzSkrotyKlubow, pobierzSlugi } from '@/lib/queries';

// Bez koncowego "/" - trasy nizej zaczynaja sie wlasnym "/", wiec podwojny
// znak dawalby np. "https://example.com//posel/jan-kowalski".
const BASE = publicEnv.siteUrl.replace(/\/+$/, '');

// Produkcja pod adresem lokalnym znaczy brak NEXT_PUBLIC_SITE_URL na
// hostingu. Nie przerywamy builda, ale to MUSI byc widac — patrz
// `siteUrlWygladaNaLokalny` w src/lib/env.ts.
if (siteUrlWygladaNaLokalny()) {
  console.error(`::error::mapa witryny zglasza adresy pod ${BASE} — ustaw NEXT_PUBLIC_SITE_URL na domene produkcyjna.`);
}

const TRASY_STATYCZNE = ['/', '/poslowie', '/kluby', '/komisje', '/okreg', '/status', '/zglos'];

/**
 * MAPA WITRYNY — wbudowany mechanizm Next (`MetadataRoute.Sitemap`), nie
 * recznie pisany XML. Next sam serwuje to spod `/sitemap.xml`.
 *
 * TRASY DYNAMICZNE CZYTAMY WYLACZNIE PRZEZ `src/lib/queries.ts` — to jedyny
 * dopuszczony dostep do danych dla stron publicznych (CLAUDE.md §2), a mapa
 * witryny nie jest wyjatkiem od tej zasady tylko dlatego, ze sama nie jest
 * strona.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  /*
    LASTMODIFIED = DZIS, NIE PRAWDZIWA DATA ZMIANY — i to jest napisane wprost,
    nie udawane. Widoki SQL, z ktorych korzysta serwis, licza sie na zadanie
    z tabel odswiezanych nocnym cronem; nie mamy przechowywanej daty "ta strona
    zmienila sie X-go". Podanie dzisiejszej daty jako `lastModified` kazdemu
    adresowi jest uczciwsze niz wymyslanie precyzji, ktorej dane nie daja —
    a wyszukiwarka i tak samodzielnie ponawia odwiedziny.
  */
  const lastModified = new Date();

  const wpisy: MetadataRoute.Sitemap = TRASY_STATYCZNE.map((trasa) => ({
    url: `${BASE}${trasa}`,
    lastModified,
  }));

  /*
    PUSTA LISTA TRAS DYNAMICZNYCH TO AWARIA BAZY, NIE CISZA — ten sam wzorzec
    co w `generateStaticParams` na `/posel/[slug]` i `/klub/[skrot]` (przeczytaj
    komentarz tam, to on jest zrodlem tej zasady). Cichy `catch` kiedys polknal
    `DYNAMIC_SERVER_USAGE` i produkcja przez to zwracala 500 na kazdej trasie
    z parametrem, a build konczyl sie "sukcesem". Tu stawka jest mniejsza — mapa
    bez tras dynamicznych nie wywala strony, tylko zuboza SEO — ale mechanizm
    ma byc identyczny: build NIE ma sie przerwac (brak bazy przy budowaniu jest
    dopuszczalny), lecz blad ma byc widoczny na `stderr` z prefiksem `::error::`,
    ktory GitHub Actions podswietla na czerwono.

    `Promise.all`, nie trzy osobne `try` — celowo. Zadanie wprost mowi: gdy
    zapytanie sie nie powiedzie, mapa ma zawierac SAME trasy statyczne, a nie
    dwie trzecie tras dynamicznych z jednym brakujacym zrodlem.
  */
  try {
    const [slugi, okregi, skroty, kodyKomisji] = await Promise.all([
      pobierzSlugi(),
      pobierzOkregi(),
      pobierzSkrotyKlubow(),
      pobierzKodyKomisji(),
    ]);

    for (const slug of slugi) {
      wpisy.push({ url: `${BASE}/posel/${slug}`, lastModified });
    }
    for (const o of okregi) {
      wpisy.push({ url: `${BASE}/okreg/${o.district_num}`, lastModified });
    }
    for (const skrot of skroty) {
      // Skroty klubow zawieraja kropke ("niez.") i podkreslenie
      // ("Konfederacja_KP") — kodujemy DOKLADNIE TAK SAMO jak odnosniki
      // w src/app/kluby/page.tsx, zeby adres w mapie byl tym samym adresem,
      // pod ktorym strona faktycznie odpowiada.
      wpisy.push({ url: `${BASE}/klub/${encodeURIComponent(skrot)}`, lastModified });
    }
    for (const kod of kodyKomisji) {
      wpisy.push({ url: `${BASE}/komisja/${encodeURIComponent(kod)}`, lastModified });
    }
  } catch (e) {
    console.error(`::error::sitemap nie pobralo tras dynamicznych z bazy: ${(e as Error).message}`);
  }

  return wpisy;
}
