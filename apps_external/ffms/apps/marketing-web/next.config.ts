import type { NextConfig } from 'next';

// Set when the app is served under a path (e.g. /franchise) instead of its own host.
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '');

const nextConfig: NextConfig = {
  output: 'export',
  transpilePackages: ['@rfms/utils'],
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
};

export default nextConfig;
