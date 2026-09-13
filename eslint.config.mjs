// Konfiguracja ESLint (flat config, ESLint 9 + Next.js 15.5).
//
// Next.js jeszcze nie publikuje czystych presetow flat - "next/core-web-vitals"
// i "next/typescript" to wciaz konfiguracje w starym formacie (eslintrc).
// FlatCompat z @eslint/eslintrc tlumaczy je na format flat w locie. To jest
// oficjalnie zalecany sposob az Next.js nie wyda wlasnych presetow flat.
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  // Globalne pominiecia - dotycza wszystkich ponizszych blokow konfiguracji.
  // Artefakty builda, zaleznosci i dane wprowadzane recznie (data/, patrz
  // .gitignore) nie sa kodem i nie maja sensu do lintowania.
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'data/**',
      'next-env.d.ts',
      '**/*.tsbuildinfo',
      'supabase/.temp/**',
    ],
  },

  ...compat.extends('next/core-web-vitals', 'next/typescript'),

  // next lint domyslnie ogranicza sie do katalogow typowych dla aplikacji
  // Next.js. Ten projekt trzyma rownolegly kod importu (ingest/) i skrypty
  // pomocnicze (scripts/) - D4 wymaga objecia ich tym samym lintem, bo to
  // wlasnie w kodzie tego rodzaju (a nie w komponencie) zdarzaja sie bledy
  // niewidoczne dla tsc.
  {
    files: [
      'src/**/*.{js,jsx,mjs,cjs,ts,tsx}',
      'ingest/**/*.{js,mjs,cjs,ts}',
      'scripts/**/*.{js,mjs,cjs}',
    ],
  },

  // console.log w ingest/ i scripts/ to jedyny interfejs tych skryptow -
  // uruchamiane sa recznie z terminala i z GitHub Actions, nie maja innego
  // sposobu zgłaszania postepu ani bledow. Wylaczone globalnie w konfiguracji
  // (CLAUDE.md D4), zeby nie rozsiewac eslint-disable po plikach.
  // (W praktyce zaden z uzytych presetow nie wlacza no-console domyslnie -
  // ten wpis dokumentuje decyzje na przyszlosc, gdyby ktos kiedys ja wlaczyl.)
  {
    files: ['ingest/**/*.{js,mjs,cjs,ts}', 'scripts/**/*.{js,mjs,cjs}'],
    rules: {
      'no-console': 'off',
    },
  },

  {
    rules: {
      // Zwykly <img> zamiast next/image - decyzja kosztowa, CLAUDE.md #6:
      // optymalizator next/image liczy kazdy obraz jako transformacje,
      // 499 poslow zjadloby darmowy limit w kilka dni. Nie zmieniac kodu.
      '@next/next/no-img-element': 'off',

      // react/no-unescaped-entities zglasza prosty cudzyslow " jako domykajacy
      // po otwierajacym cudzyslowie polskim „ (np. „Uchwalono"). To nie
      // literowka w pojedynczym miejscu, tylko konsekwentna konwencja pisowni
      // tego projektu - wystepuje tak samo w docs/decyzje.md (setki razy) i we
      // wszystkich komponentach serwerowych (sprawdzone: 83 wystapienia w
      // src/, w 9 plikach). Przepisywanie tekstu widocznego dla czytelnika,
      // zeby uciszyc linter, byloby zmiana tresci bez decyzji Pawla.
      'react/no-unescaped-entities': 'off',
    },
  },
];

export default eslintConfig;
