import type { MetadataRoute } from "next";
import {
  BRAND,
  SITE_DESCRIPTION,
  SITE_LANG,
  SITE_NAME,
} from "@/lib/seo/site-config";

/**
 * Web App Manifest. Esposto a /manifest.webmanifest.
 * Le icone puntano alle file convention dinamiche (icon, apple-icon).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: BRAND.bg,
    theme_color: BRAND.fg,
    lang: SITE_LANG,
    dir: "ltr",
    categories: ["business", "productivity"],
    icons: [
      // Le file convention `icon.tsx` / `apple-icon.tsx` esportano size diversi:
      // 32 (icon), 180 (apple-icon). Aggiungiamo riferimenti a entrambi più
      // un fallback a /favicon.ico per i browser legacy.
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
      },
      {
        src: "/icon",
        sizes: "32x32",
        type: "image/png",
      },
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
