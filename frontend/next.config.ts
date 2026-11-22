import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";
const backend = process.env.DRAFTBOARD_API ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = isDev
  ? {
      async rewrites() {
        return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
      },
    }
  : {
      output: "export",
    };

export default nextConfig;
