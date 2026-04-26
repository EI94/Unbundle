import { ImageResponse } from "next/og";
import { BRAND, SITE_NAME, SITE_TAGLINE, SITE_URL } from "./site-config";

/**
 * Renderer condiviso per OG image e Twitter card (entrambe 1200×630, stesso layout).
 * Niente font/asset esterni → static-friendly, build-time cacheable.
 */
export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_ALT = "Unbundle — AI-Powered Work Redesign" as const;
export const OG_CONTENT_TYPE = "image/png" as const;

export function renderOgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px",
          background: BRAND.bg,
          color: BRAND.fg,
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            fontSize: 22,
            letterSpacing: -0.2,
            color: BRAND.fg,
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              background: BRAND.fg,
              color: BRAND.bg,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 24,
              fontWeight: 600,
              letterSpacing: -1,
            }}
          >
            U
          </div>
          <span style={{ fontWeight: 500 }}>{SITE_NAME}</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div
            style={{
              fontSize: 26,
              color: BRAND.muted,
              letterSpacing: 0.2,
            }}
          >
            L&apos;AI sta cambiando le condizioni in cui opera la tua
            organizzazione.
          </div>
          <div
            style={{
              fontSize: 84,
              fontWeight: 500,
              lineHeight: 1.05,
              letterSpacing: -2,
              maxWidth: 1000,
              display: "flex",
              flexWrap: "wrap",
            }}
          >
            <span>Capiremo dove si sposta il valore</span>
            <span style={{ color: BRAND.muted }}>
              &nbsp;e cosa significa per te.
            </span>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 20,
            color: BRAND.muted,
          }}
        >
          <span>{SITE_TAGLINE}</span>
          <span>{SITE_URL.replace("https://", "")}</span>
        </div>
      </div>
    ),
    { ...OG_SIZE }
  );
}
