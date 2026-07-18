import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  reactCompiler: true,
  // pdf-parse -> pdfjs-dist -> @napi-rs/canvas is loaded via a dynamic
  // require() (module.createRequire), not a static import, so the default
  // bundler can't see it. Marking these external keeps them as real
  // node_modules requires at runtime instead of being bundled, which is
  // what lets Vercel's output-file-tracing pick up @napi-rs/canvas's
  // native .node binary for the deployed function.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "@napi-rs/canvas"],
};

export default nextConfig;
