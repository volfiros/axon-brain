import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["falkordb"],
  // AGENTS.md is the team's single instruction file; stop `next dev` from appending its own block.
  agentRules: false,
};

export default nextConfig;
