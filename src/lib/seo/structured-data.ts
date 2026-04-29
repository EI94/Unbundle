/**
 * Builder per JSON-LD secondo schema.org.
 * Renderizzati nelle pagine come:
 *   <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(...) }} />
 *
 * Riferimenti:
 * - https://schema.org/Organization
 * - https://schema.org/WebSite
 * - https://schema.org/SoftwareApplication
 * - https://schema.org/FAQPage
 * - https://schema.org/BreadcrumbList
 */

import {
  SITE_CONTACTS,
  SITE_DESCRIPTION,
  SITE_DESCRIPTION_LONG,
  SITE_NAME,
  SITE_PUBLISHER,
  SITE_URL,
  absoluteUrl,
} from "./site-config";

type JsonLd = Record<string, unknown>;

/** Organization — emessa una sola volta, idealmente nel layout root. */
export function organizationJsonLd(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    name: SITE_NAME,
    legalName: SITE_PUBLISHER,
    url: SITE_URL,
    logo: {
      "@type": "ImageObject",
      url: absoluteUrl("/icon"),
      width: 512,
      height: 512,
    },
    contactPoint: [
      {
        "@type": "ContactPoint",
        contactType: "customer support",
        email: SITE_CONTACTS.support,
        availableLanguage: ["Italian", "English"],
      },
      {
        "@type": "ContactPoint",
        contactType: "privacy",
        email: SITE_CONTACTS.privacy,
        availableLanguage: ["Italian", "English"],
      },
    ],
    description: SITE_DESCRIPTION,
  };
}

/** WebSite — abilita Sitelinks Search Box (se in futuro aggiungiamo /search). */
export function websiteJsonLd(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    url: SITE_URL,
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    inLanguage: "it-IT",
    publisher: { "@id": `${SITE_URL}/#organization` },
  };
}

/** SoftwareApplication — descrive il prodotto SaaS sulla home. */
export function softwareApplicationJsonLd(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": `${SITE_URL}/#software`,
    name: SITE_NAME,
    applicationCategory: "BusinessApplication",
    applicationSubCategory: "AI Transformation Platform",
    operatingSystem: "Web",
    url: SITE_URL,
    description: SITE_DESCRIPTION_LONG,
    inLanguage: "it-IT",
    publisher: { "@id": `${SITE_URL}/#organization` },
    featureList: [
      "Discovery AI con la leadership (web search inclusa)",
      "Activity mapping per dipartimento",
      "Classificazione automatica Automate / Differentiate / Innovate",
      "Matching O*NET e stima AI exposure",
      "Generazione use case con scoring Impatto, Fattibilità, ESG",
      "KPI personalizzabili per workspace",
      "Bot Slack per contributi bottom-up (best practice e use case)",
      "Blueprint di agenti AI",
      "Simulazioni di scenario e roadmap",
      "Value map alla Wardley",
      "Report executive automatici",
      "Notifiche multi-canale (in-app, Slack, WhatsApp)",
    ],
    offers: {
      "@type": "Offer",
      priceCurrency: "EUR",
      price: "0",
      priceValidUntil: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365)
        .toISOString()
        .slice(0, 10),
      availability: "https://schema.org/InStock",
      description:
        "Pricing custom per organizzazione. Contatta il team per una demo.",
    },
  };
}

/** FAQPage — sulla home, ottimo per rich result e per LLM. */
export function faqJsonLd(faqs: Array<{ q: string; a: string }>): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: f.a,
      },
    })),
  };
}

/** BreadcrumbList — utile per pagine legal. */
export function breadcrumbJsonLd(
  items: Array<{ name: string; url: string }>
): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: it.url.startsWith("http") ? it.url : absoluteUrl(it.url),
    })),
  };
}

/** Helper per renderizzare uno o più JSON-LD in un Server Component. */
export function jsonLdScriptProps(data: JsonLd | JsonLd[]) {
  return {
    type: "application/ld+json" as const,
    dangerouslySetInnerHTML: { __html: JSON.stringify(data) },
  };
}
