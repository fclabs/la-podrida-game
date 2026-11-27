import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Stop `next dev` from writing an untracked AGENTS.md into the repo root.
  agentRules: false,
  // Dev only: hosts (e.g. a LAN IP) allowed to load `/_next/` dev resources, comma-separated in
  // DEV_ALLOWED_ORIGINS. Next 16 blocks cross-origin dev requests by default. No effect on builds.
  allowedDevOrigins: process.env.DEV_ALLOWED_ORIGINS?.split(',').filter(Boolean) ?? [],
};

export default nextConfig;
