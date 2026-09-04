import type { Metadata } from 'next';
import { publicEnv } from '@/lib/env';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(publicEnv.siteUrl),
  title: {
    default: 'Obywatel 2.0',
    template: '%s · Obywatel 2.0',
  },
  description:
    'Niezależna platforma obywatelska. Głosowania, obietnice i pieniądze publiczne — zawsze z linkiem do oficjalnego źródła.',
  robots: { index: false, follow: false }, // zdjac przed premiera (Sprint 5)
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
