import type { MetadataRoute } from "next";
import { SITE_URL, absoluteUrl } from "@/lib/seo/site-config";

/**
 * robots.txt — consenti tutto il sito pubblico, nega aree gated/API.
 * Esposto a /robots.txt da Next, riferisce la sitemap.xml generata.
 *
 * Nota: i percorsi disabilitati qui sono comunque protetti dal middleware,
 * questo è solo per crawler educati (Google, Bing, ecc.).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/"],
        disallow: [
          "/api/",
          "/dashboard/",
          "/install/",
          "/login",
          "/register",
        ],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: SITE_URL,
  };
}
