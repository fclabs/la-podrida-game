import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Stop `next dev` from writing an untracked AGENTS.md into the repo root.
  agentRules: false,
};

export default nextConfig;
