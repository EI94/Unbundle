import type { MetadataRoute } from "next";
import { PUBLIC_ROUTES, SITE_URL, absoluteUrl } from "@/lib/seo/site-config";

/**
 * Sitemap pubblica. Generata staticamente al build (nessuna API request-time).
 * Per ogni route pubblica indichiamo `lastModified` (build time), `changeFrequency`
 * e `priority`. La home dichiara anche l'alternate `it-IT` (anche se è singola
 * lingua) per essere espliciti con i crawler.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return PUBLIC_ROUTES.map((route) => ({
    url: absoluteUrl(route.path),
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
    alternates: {
      languages: {
        "it-IT": absoluteUrl(route.path),
        "x-default": absoluteUrl(route.path),
      },
    },
  })) satisfies MetadataRoute.Sitemap;
}

// Forza che il riferimento a SITE_URL non venga "tree-shaken" se mai serve in futuro:
void SITE_URL;
