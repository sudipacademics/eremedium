/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output keeps the runtime image small: it bundles only the traced dependencies.
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
