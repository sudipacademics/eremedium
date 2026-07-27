import type { NextConfig } from 'next';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function workspaceGoogleMapsKey() {
  const envFile = fileURLToPath(new URL('../../.env.local', import.meta.url));
  if (!existsSync(envFile)) return undefined;

  const matchedLine = readFileSync(envFile, 'utf8')
    .split(/\r?\n/)
    .find((line) => line.trim().startsWith('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY='));
  if (!matchedLine) return undefined;

  const value = matchedLine.slice(matchedLine.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '');
  return value || undefined;
}

const googleMapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? workspaceGoogleMapsKey();

const nextConfig: NextConfig = {
  output: 'export',
  transpilePackages: ['@rfms/ui', '@rfms/utils'],
  env: googleMapsKey ? { NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: googleMapsKey } : undefined,
};

export default nextConfig;
