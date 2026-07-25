import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Supabase Realtime channels don't tolerate StrictMode's dev double-mount
  // (subscribe → teardown → resubscribe on the same topic breaks presence).
  reactStrictMode: false,
};

export default nextConfig;
