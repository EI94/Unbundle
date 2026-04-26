/**
 * Single source of truth per metadata SEO + GEO (LLM-readable) del sito pubblico.
 * Riferito da: layout root, sitemap, robots, manifest, OG image, llms.txt, JSON-LD.
 *
 * Convenzione canonica: dominio apex (https://theunbundle.com).
 * `www.theunbundle.com` viene rediretto via next.config.ts (308).
 */

export const SITE_URL = "https://theunbundle.com" as const;
export const SITE_NAME = "Unbundle" as const;
export const SITE_LOCALE = "it_IT" as const;
export const SITE_LANG = "it" as const;

/** Brevi (titoli, link, OG) */
export const SITE_TAGLINE =
  "AI-Powered Work Redesign per le organizzazioni che vogliono trasformarsi.";

/** Descrizione standard ~155 char per meta description (Google snippet) */
export const SITE_DESCRIPTION =
  "Unbundle scompone il lavoro della tua organizzazione, mappa dove l'AI sposta il valore e costruisce il piano per arrivarci. Discovery, mapping, use case, simulazioni.";

/** Descrizione lunga per OG / about pages / LLM */
export const SITE_DESCRIPTION_LONG =
  "Unbundle è la piattaforma di AI Transformation per aziende mid e large. Conduce un'intervista AI con la leadership, mappa attività dipartimento per dipartimento, classifica ogni attività in Automate, Differentiate o Innovate, genera use case prioritizzati su Impatto e Fattibilità (con KPI personalizzabili) e raccoglie contributi bottom-up tramite un bot Slack. Output: portfolio, blueprint di agenti AI, simulazioni di scenario, value map e report executive.";

/** Keyword (Google le ignora, alcuni LLM le leggono) */
export const SITE_KEYWORDS = [
  "AI Transformation",
  "AI Strategy",
  "Work Redesign",
  "Generative AI Enterprise",
  "AI Use Cases",
  "AI Adoption",
  "AI Operating Model",
  "Operating Model AI",
  "Automate Differentiate Innovate",
  "Wardley Map AI",
  "AI Portfolio",
  "Slack AI bot",
  "Discovery AI leadership",
  "Activity mapping AI",
  "Anthropic Economic Index",
  "O*NET AI exposure",
] as const;

/** Email pubbliche (anche nei JSON-LD ContactPoint) */
export const SITE_CONTACTS = {
  support: "support@theunbundle.com",
  privacy: "privacy@theunbundle.com",
} as const;

/** Founder / publisher */
export const SITE_PUBLISHER = "Unbundle" as const;

/** Categoria per metadata (serve a Apple News, Google) */
export const SITE_CATEGORY = "Business Software";

/** Social handles (vuoti = non emettere il tag) */
export const SITE_SOCIAL = {
  twitterSite: "", // es. "@theunbundle"
  twitterCreator: "",
  linkedin: "",
  github: "",
} as const;

/** Pagine pubbliche indicizzabili. Aggiornare quando se ne creano di nuove. */
export const PUBLIC_ROUTES = [
  { path: "/", changeFrequency: "monthly" as const, priority: 1.0 },
  { path: "/legal/privacy", changeFrequency: "yearly" as const, priority: 0.3 },
  { path: "/legal/terms", changeFrequency: "yearly" as const, priority: 0.3 },
  { path: "/legal/support", changeFrequency: "yearly" as const, priority: 0.4 },
] as const;

/** Pagine NON da indicizzare (login, dashboard, install, api) */
export const PRIVATE_PATHS = [
  "/dashboard",
  "/login",
  "/register",
  "/install",
  "/api",
] as const;

/** URL assoluto da una path */
export function absoluteUrl(path: string): string {
  if (path.startsWith("http")) return path;
  const slash = path.startsWith("/") ? path : `/${path}`;
  return `${SITE_URL}${slash}`;
}

/** Brand colors (per manifest + OG image) */
export const BRAND = {
  bg: "#ffffff",
  fg: "#0a0a0a",
  muted: "#737373",
  accent: "#0a0a0a",
} as const;
