import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits .next/standalone: a self-contained server with only the traced runtime
  // dependencies, so the Docker runtime image carries neither the build toolchain nor
  // devDependencies. Harmless outside Docker — `next dev` and `next start` ignore it.
  output: "standalone",
};

export default nextConfig;
