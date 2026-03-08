import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  output: "standalone",
  async redirects() {
    return [
      { source: "/dogs/:id/feeding", destination: "/dogs/:id/food", permanent: true },
      { source: "/dogs/:id/food-scorecard", destination: "/dogs/:id/food", permanent: true },
    ]
  },
  async headers() {
    return [
      {
        source: "/products-small/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
      {
        source: "/products-large/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
    ]
  },
}

export default nextConfig
