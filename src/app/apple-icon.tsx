import { ImageResponse } from "next/og";
import { BRAND } from "@/lib/seo/site-config";

/**
 * Apple touch icon 180×180. Stessa identità del favicon, scalata.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
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
          fontSize: 130,
          fontWeight: 600,
          letterSpacing: -6,
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        U
      </div>
    ),
    { ...size }
  );
}
