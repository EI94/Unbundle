/**
 * Le cinque schede delle Impostazioni (rilascio 10, ondata 6b, docs/ui-10/PROPOSTA-10.md §3.10, §2.4; audit §5.6): chi
 * vede quale, l'indirizzo di ogni scheda (`?scheda=`) e dove portano le ancore di prima, che restano tutte.
 *
 * | Ancora di prima | Porta a |
 * |---|---|
 * | `#persone` | Team |
 * | `#integrazioni`, `#connettore-claude`, `#claude-per-il-team` | Collegamenti |
 * | `#valutazione`, `#valutazione-use-case` | Valutazione |
 * | `#sub-responsabili` | Privacy |
 * | `#zona-pericolosa` | Zona pericolosa |
 * | `#cli`, `#granola` | «Il tuo account» (le apre il foglio, `src/lib/shell/account.ts`) |
 * | `#granola-regole` | Contesto › Fonti, le regole delle call del cliente |
 *
 * Modulo puro: import relativi `.ts`.
 */
import { OLD_GRANOLA_RULES_ANCHOR, granolaRulesHref } from "../../lib/shell/account.ts";
import { USE_CASE_VALUATION_ANCHOR } from "../../lib/use-cases/settings.ts";

export const SETTINGS_TABS = Object.freeze(["team", "collegamenti", "valutazione", "privacy", "zona-pericolosa"] as const);
export type SettingsTab = (typeof SETTINGS_TABS)[number];

/** Il parametro della scheda nell'indirizzo. */
export const SETTINGS_TAB_PARAM = "scheda";

/** Le ancore di prima e la scheda che le ha prese. */
export const SETTINGS_ANCHOR_TAB: Readonly<Record<string, SettingsTab>> = Object.freeze({
  persone: "team",
  integrazioni: "collegamenti",
  "connettore-claude": "collegamenti",
  "claude-per-il-team": "collegamenti",
  valutazione: "valutazione",
  [USE_CASE_VALUATION_ANCHOR]: "valutazione",
  "sub-responsabili": "privacy",
  "zona-pericolosa": "zona-pericolosa",
});

/** Le ancore che apre il foglio «Il tuo account»: qui non si toccano. */
export const ACCOUNT_ANCHORS: readonly string[] = Object.freeze(["cli", "granola"]);

/** `#granola-regole` (le regole delle call, prima in Impostazioni): ora in Contesto › Fonti, sotto Granola. */
export const GRANOLA_RULES_OLD_ANCHOR = OLD_GRANOLA_RULES_ANCHOR;

/** Che cosa può fare chi guarda, per le schede. */
export interface SettingsAbilities {
  /** Gestisce il workspace (`canManageWorkspaceSettings`): Valutazione. */
  manages: boolean;
  /** Ha almeno un collegamento da usare o gestire. */
  links: boolean;
  /** Vede i fornitori dei dati, o gestisce i link condivisi. */
  privacy: boolean;
  /** Può eliminare il workspace. */
  canDelete: boolean;
}

/** Le schede di chi guarda, nell'ordine. Team c'è sempre: chi ha accesso lo vede ognuno, chi gestisce invita. */
export function visibleSettingsTabs(a: SettingsAbilities): SettingsTab[] {
  return SETTINGS_TABS.filter((tab) => {
    if (tab === "collegamenti") return a.links;
    if (tab === "valutazione") return a.manages;
    if (tab === "privacy") return a.privacy;
    if (tab === "zona-pericolosa") return a.canDelete;
    return true;
  });
}

/**
 * La scheda aperta: quella dell'indirizzo, se chi guarda la vede; altrimenti Collegamenti al ritorno da Slack
 * (`?slack=…`, `?slack_error=…`), poi la prima.
 */
export function settingsTabOf(raw: string | null | undefined, visible: readonly SettingsTab[], o: { slackReturn?: boolean } = {}): SettingsTab {
  const asked = (SETTINGS_TABS as readonly string[]).includes(raw ?? "") ? (raw as SettingsTab) : null;
  if (asked && visible.includes(asked)) return asked;
  if (o.slackReturn && visible.includes("collegamenti")) return "collegamenti";
  return visible[0] ?? "team";
}

/** L'indirizzo di una scheda; Team (la prima) è l'indirizzo senza parametro. */
export function settingsTabHref(workspaceId: string, tab: SettingsTab): string {
  const base = `/dashboard/${workspaceId}/settings`;
  return tab === "team" ? base : `${base}?${SETTINGS_TAB_PARAM}=${tab}`;
}

/**
 * Dove porta un'ancora all'arrivo: la scheda che la contiene (se non è già quella aperta), oppure un'altra pagina
 * (`#granola-regole`); null se l'ancora sta già nella scheda aperta, è del foglio «Il tuo account», o non si conosce.
 */
export function settingsAnchorTarget(i: { hash: string; current: SettingsTab; visible: readonly SettingsTab[]; workspaceId: string }): string | null {
  const anchor = decodeHash(i.hash);
  if (!anchor || ACCOUNT_ANCHORS.includes(anchor)) return null;
  if (anchor === GRANOLA_RULES_OLD_ANCHOR) return granolaRulesHref(i.workspaceId);
  const tab = Object.hasOwn(SETTINGS_ANCHOR_TAB, anchor) ? SETTINGS_ANCHOR_TAB[anchor] : null;
  if (!tab || tab === i.current || !i.visible.includes(tab)) return null;
  const href = settingsTabHref(i.workspaceId, tab);
  return `${href}#${anchor}`;
}

function decodeHash(hash: string): string {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
