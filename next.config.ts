import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // Zdjecia poslow trzymamy u siebie (Sprint 3) - hotlink do sejm.gov.pl
  // przy ruchu wiralowym byloby nieuprzejme wobec serwera Kancelarii.
  images: { remotePatterns: [] },
  eslint: { ignoreDuringBuilds: false },
  typescript: { ignoreBuildErrors: false },
};

export default config;
