import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Expose auth env vars to Edge middleware runtime
  env: {
    TERMINALX_AUTH_MODE: process.env.TERMINALX_AUTH_MODE || "none",
    TERMINALX_JWT_SECRET: process.env.TERMINALX_JWT_SECRET || "",
  },
};

export default nextConfig;
