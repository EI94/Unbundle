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
 *   X-Frame-Options, Permissions-Policy. CSP globale non impostata qui:
 *   Firebase + Slack + Vercel Blob richiederebbero un'allowlist articolata,
 *   meglio introdurla in PR dedicata con testing approfondito. I soli link
 *   personali dei Casi d'uso (`/r/*`, `/api/r/*`) hanno la loro CSP, sotto.
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

/**
 * Link personali dei referenti dei Casi d'uso (`/r/<token>`) e le loro API
 * (`/api/r/<token>/…`): mai indicizzati, mai in cache, e nessun `Referer`
 * verso altri siti, perché il token sta nell'indirizzo (PIANO §5.6). Vengono
 * dopo le intestazioni globali, così `Referrer-Policy` sostituisce quella di
 * default. Le API ripetono le stesse intestazioni su ogni risposta.
 */
/**
 * CSP dei link personali (DESIGN §7.1 P0-7): niente iframe, niente `<base>` né
 * plugin, form solo verso l'app, connessioni solo verso l'app e Vercel Blob
 * (il caricamento diretto dei file dal browser), immagini dall'app o generate
 * nella pagina. Script e stili restano quelli di Next: senza nonce una
 * `script-src` stretta romperebbe gli script inline di Next (guida
 * `content-security-policy.md`). Vale sulla pagina `/r/<token>` e sulle API
 * `/api/r/<token>/…`.
 */
const PUBLIC_LINK_CSP = [
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "form-action 'self'",
  "connect-src 'self' https://vercel.com https://*.blob.vercel-storage.com",
  "img-src 'self' data: blob:",
].join("; ");

const PUBLIC_LINK_HEADERS: { key: string; value: string }[] = [
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
  { key: "Cache-Control", value: "no-store" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Content-Security-Policy", value: PUBLIC_LINK_CSP },
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
      { source: "/r/:path*", headers: PUBLIC_LINK_HEADERS },
      { source: "/api/r/:path*", headers: PUBLIC_LINK_HEADERS },
    ];
  },
};

export default nextConfig;
