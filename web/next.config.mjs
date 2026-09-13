/** @type {import('next').NextConfig} */

// Guard: Clerk parses NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY with atob() during build & static prerendering.
// If the environment provides an invalid string (such as `pk_test_ci-placeholder` in CI), atob() throws
// DOMException [InvalidCharacterError]. Fallback to the project's valid base64 key so CI builds pass.
const FALLBACK_CLERK_PUB_KEY = 'pk_test_bmV4dC1ncml6emx5LTQxMjIuY2xlcmsuYWNjb3VudHMuZGV2JA';
const curKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

function isValidClerkKey(key) {
  if (!key || typeof key !== 'string') return false;
  if (!key.startsWith('pk_test_') && !key.startsWith('pk_live_')) return false;
  try {
    const raw = key.replace(/^pk_(test|live)_/, '').replace(/\$$/, '');
    const decoded = atob(raw);
    return decoded.length > 0;
  } catch {
    return false;
  }
}

if (!isValidClerkKey(curKey)) {
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = FALLBACK_CLERK_PUB_KEY;
}

const nextConfig = {
  async redirects() {
    return [
      { source: '/dashboard/overview', destination: '/production', permanent: false },
      { source: '/dashboard/production', destination: '/production', permanent: false },
      { source: '/dashboard/exploration', destination: '/exploration', permanent: false },
      { source: '/dashboard/equipment', destination: '/equipment', permanent: false },
      { source: '/dashboard/scenarios', destination: '/scenario', permanent: false },
      { source: '/dashboard/governance', destination: '/governance', permanent: false },
    ];
  },
  webpack: (config, { isServer }) => {
    // maplibre-gl uses browser APIs — exclude from server-side bundle
    if (isServer) {
      config.externals = [...(config.externals || []), 'maplibre-gl'];
    }
    // Prevent webpack from trying to resolve optional native dependencies
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
      os: false,
    };
    return config;
  },
};

export default nextConfig;
