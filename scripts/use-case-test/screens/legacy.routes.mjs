// Pages of the «Una voce» integration for the hub screen driver (docs/use-case/PIANO-LAVORI.md
// H4i, §5.7; docs/use-case/DESIGN.md §2.1, §2.3, §2.5, §13, §14.3). Workspace «a» has the area on,
// «b» has it off.
//
//   node scripts/use-case-test/screens-hub.mjs --routes scripts/use-case-test/screens/legacy.routes.mjs \
//     --as ls-lead,function-lead,osservatore,sponsor-cliente --widths 1440,400 --label h4i
//
// - The sidebar with the area on: one «Use case» entry, none of «Raccolta & ranking», «Use cases»,
//   «Casi d'uso», «Piano» (Overview, Settings, Intelligence and the pages the old addresses
//   land on; at 400 px the bar is a closed sheet, so 1440 px is the check); with the area off,
//   today's entries (Overview).
// - The old addresses opened in the browser: the 307 lands on the area, query included (?joined=
//   shows the welcome), and the area's copy guard applies to where they land.
// - Settings › Valutazione (H3d) and Settings › Integrazioni with the WhatsApp webhook: only for
//   who manages the workspace (ls-lead, sponsor-cliente), only with the area on.
// - Intelligence: the card signals (with their names) reach reviewers only; never a raw key.
// - /use-cases/nuovo with the area off: the area's «Use case non trovato», no form.
// The bell's links are checked by src/lib/use-cases/una-voce.integration.test.ts (the menu opens
// only on a click); the 307 statuses and Locations by scripts/use-case-test/redirects.mjs.

const REVIEWERS = ["ls-lead", "function-lead", "sponsor-cliente"];
const MANAGERS = ["ls-lead", "sponsor-cliente"];
const NOT_MANAGERS = ["function-lead", "osservatore"];
const CONTRIBUTOR = ["osservatore"];

/**
 * The entries that leave the sidebar with the area on. «Raccolta & Ranking» with a capital R is
 * not here: the «Claude per Unbundle» card in Settings still says it until H6i (DESIGN §14.5).
 */
const OLD_ENTRIES = ["Raccolta & ranking", "Use cases", "Casi d'uso", "Piano"];
/** What only who manages the workspace sees in Settings with the area on. */
const MANAGER_SETTINGS = ["Nome del team che valuta", "Codici degli use case", "Fasce del costo", "Modello di valutazione", "Webhook WhatsApp del team"];
/** The card signals' keys: Intelligence names them («Nuovo use case», «Use case», «Roadmap»). */
const RAW_SIGNAL_KEYS = ["new_portfolio_item", "use_case_digest", "use_case_quarter"];

const routes = [
  // Overview: the «Use case» step and one «Use case» tool (§2.5); the sidebar of the area.
  { name: "overview", path: "/dashboard/{ws:a}", present: ["Use case", "Percorso"], absent: OLD_ENTRIES },
  { name: "overview", path: "/dashboard/{ws:b}", as: ["ls-lead", "osservatore"], present: ["Raccolta & ranking", "Use cases", "Piano"] },

  // Settings with the area on: «Valutazione» and WhatsApp in «Integrazioni» for managers only.
  // The screenshot is the whole page: «Integrazioni» with the webhook, then «Valutazione».
  { name: "impostazioni", path: "/dashboard/{ws:a}/settings", as: MANAGERS, present: ["Integrazioni", "WhatsApp", "Valutazione", "Criteri ESG", ...MANAGER_SETTINGS], absent: OLD_ENTRIES },
  { name: "impostazioni", path: "/dashboard/{ws:a}/settings", as: NOT_MANAGERS, present: ["Criteri ESG"], absent: [...MANAGER_SETTINGS, ...OLD_ENTRIES] },
  // Area off: today's Settings, also for who manages the workspace.
  { name: "impostazioni", path: "/dashboard/{ws:b}/settings", as: ["ls-lead"], present: ["Criteri ESG"], absent: MANAGER_SETTINGS },

  // Intelligence: card signals only for reviewers (D4), with their names.
  { name: "intelligence", path: "/dashboard/{ws:a}/intelligence", as: REVIEWERS, absent: [...RAW_SIGNAL_KEYS, ...OLD_ENTRIES] },
  { name: "intelligence", path: "/dashboard/{ws:a}/intelligence", as: CONTRIBUTOR, absent: [...RAW_SIGNAL_KEYS, ...OLD_ENTRIES, "Nuovo use case", "da decidere", "Nuovo trimestre"] },

  // The old addresses, followed by the browser: they land on the area (copy guard of the area).
  { name: "da-portfolio", path: "/dashboard/{ws:a}/portfolio?joined=1", copyGuard: "area", present: ["Benvenuto in"], absent: OLD_ENTRIES },
  { name: "da-plan", path: "/dashboard/{ws:a}/plan", copyGuard: "area", present: ["Prossimi"], absent: OLD_ENTRIES },
  { name: "da-submit", path: "/dashboard/{ws:a}/portfolio/submit", copyGuard: "area", present: ["Nuovo use case"], absent: OLD_ENTRIES },
  { name: "da-review", path: "/dashboard/{ws:a}/portfolio/review/{uc:r06}", as: REVIEWERS, copyGuard: "area", present: ["{code:r06}"], absent: OLD_ENTRIES },

  // /use-cases/nuovo with the area off: the area's not-found page, never the form.
  { name: "nuovo-area-spenta", path: "/dashboard/{ws:b}/use-cases/nuovo", as: ["ls-lead", "osservatore"], absent: ["Che cosa proponi?", "Invia lo use case"] },
];

export default routes;
