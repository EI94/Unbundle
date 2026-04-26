import { ImageResponse } from "next/og";
import { BRAND } from "@/lib/seo/site-config";

/**
 * Favicon programmatico 32×32. Monogramma "U" su sfondo nero — coerente
 * con il branding minimalista (Geist, no logo immagine).
 *
 * Esposto a /icon (Next aggiunge il content-type e l'header sizes).
 */
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: BRAND.fg,
          color: BRAND.bg,
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: -1,
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        U
      </div>
    ),
    { ...size }
  );
}
