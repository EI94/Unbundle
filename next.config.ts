import type { NextConfig } from "next";

/**
 * - Canonical host: www.theunbundle.com, allineato al dominio primario
 *   configurato su Vercel. L'apex theunbundle.com viene rediretto a www con
 *   308 (permanent), preservando il path.
 *
 *   Eccezione: /api/slack/* NON viene rediretto, perché Slack richiede che
 *   l'host del `redirect_uri` usato in `/api/slack/install` combaci con quello
 *   in `/api/slack/oauth`. Se un workspace ha già installato Slack quando il
 *   redirect_uri puntava a un host diverso, un 308 sull'OAuth callback romperebbe
 *   l'install. `slackOAuthRedirectUri()` calcola comunque la URI dall'origin
 *   della request, quindi finché non viene riconfigurato il Slack App il
 *   bypass è prudente.
 *
 * - Security headers globali: HSTS, X-Content-Type-Options, Referrer-Policy,
 *   X-Frame-Options, Permissions-Policy. CSP non impostata qui: Firebase +
 *   Slack + Vercel Blob richiederebbero un'allowlist articolata, meglio
 *   introdurla in PR dedicata con testing approfondito.
 *
 * - poweredByHeader off: rimuove `X-Powered-By: Next.js`.
 */

const SECURITY_HEADERS: { key: string; value: string }[] = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), browsing-topics=(), interest-cohort=()",
  },
  { key: "X-DNS-Prefetch-Control", value: "on" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,

  async redirects() {
    return [
      {
        source: "/:path((?!api/slack/).*)",
        has: [{ type: "host", value: "theunbundle.com" }],
        destination: "https://www.theunbundle.com/:path",
        permanent: true,
      },
    ];
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
