/**
 * «Il tuo account» (rilascio 10, ondata 2a «Cornice», docs/ui-10/PROPOSTA-10.md §2.3, §3.10): un foglio dal menu sotto
 * il nome, con l'indirizzo `?account=` (`?account=claude` lo apre sulla parte giusta). Le preferenze e gli accessi
 * personali di chi guarda, in questo workspace: le notifiche via email (uscite dalla campanella, §3.1), Claude e
 * terminale, Granola (Lateral Space), il tema.
 *
 * Modulo puro: le regole dell'indirizzo, chi vede le email, la forma dei dati che il foglio riceve dalla rotta
 * `/api/workspaces/<ws>/account` (src/lib/shell/account-data.ts). Lo provano i test con `node --test`.
 */
import type { TeamMcpTokenView } from "../db/queries/team-mcp-tokens.ts";
import type { CliTokenView } from "../db/queries/use-case-cli-auth.ts";
import type { GranolaCardState } from "../context/granola/view.ts";

export const ACCOUNT_PARAM = "account";

/** Le parti del foglio, nell'ordine in cui compaiono. */
export const ACCOUNT_PARTS = Object.freeze(["email", "claude", "granola", "tema"] as const);
export type AccountPart = (typeof ACCOUNT_PARTS)[number];

/** Il valore di `?account=`: chiuso (null), aperto in cima («tutto»), o aperto su una parte. */
export function accountPartOf(value: string | null | undefined): AccountPart | "tutto" | null {
  if (value === null || value === undefined) return null;
  return (ACCOUNT_PARTS as readonly string[]).includes(value) ? (value as AccountPart) : "tutto";
}

/**
 * (§2.4) Le ancore personali delle Impostazioni portano al foglio, sulla parte giusta: `settings#cli` (i link della
 * CLI e dell'Agent Factory) su «Claude e terminale», `settings#granola` (il ritorno da Granola) su «Granola». Le altre
 * ancore restano della pagina.
 */
export function accountPartForSettingsHash(pathname: string, hash: string, workspaceId: string): AccountPart | null {
  const path = pathname.replace(/\/+$/, "");
  if (path !== `/dashboard/${workspaceId}/settings`) return null;
  if (hash === "#cli") return "claude";
  if (hash === "#granola") return "granola";
  return null;
}

/** L'`id` della sezione di una parte: il foglio ci porta il fuoco quando si apre su di lei. */
export const accountSectionId = (part: AccountPart) => `account-${part}`;

const ORIGIN = "http://unbundle.invalid";

/** L'indirizzo di adesso con il foglio aperto (su una parte, o in cima): il resto della query e l'ancora restano. */
export function withAccount(href: string, part?: AccountPart): string {
  const url = new URL(href, ORIGIN);
  url.searchParams.set(ACCOUNT_PARAM, part ?? "1");
  return `${url.pathname}${url.search}${url.hash}`;
}

/** L'indirizzo di adesso con il foglio chiuso. */
export function withoutAccount(href: string): string {
  const url = new URL(href, ORIGIN);
  url.searchParams.delete(ACCOUNT_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Chi vede «Avvisami per email sulle mie richieste al referente» (R11, spostata dalla campanella): con l'area «Use
 * case» accesa e «Chiedi al referente» acceso per il workspace, chi valuta e ha già chiesto almeno una volta. La stessa
 * regola di prima, ora in un posto solo per la campanella e per il foglio.
 */
export function referentEmailChoice(i: { useCaseHub: boolean; reviewer: boolean; askEnabled: boolean; hasRequested: boolean; on: boolean }): { shown: boolean; on: boolean } {
  return { shown: i.useCaseHub && i.reviewer && i.askEnabled && i.hasRequested, on: i.on };
}

/** Claude per chi valuta (il MCP del team): solo i token di chi guarda, mai l'hash, mai il conto degli altri. */
export interface AccountClaude {
  status: "pronta" | "errore";
  tokens: readonly TeamMcpTokenView[];
  /** `MCP_TEAM_ENABLED`: spento, l'accesso si crea e funzionerà quando lo si accende. */
  routeEnabled: boolean;
  ttlDays: number;
  defaultLabel: string;
  url: string;
  connectorName: string;
  claudeCodeName: string;
}

/** Quello che il foglio riceve: una parte è null quando chi guarda non la vede (lo zero non si vede). */
export interface AccountSheetData {
  email: { on: boolean } | null;
  claude: AccountClaude | null;
  /** I collegamenti della CLI di chi guarda in questo workspace (Lateral Space, chi costruisce da fuori, chi ne ha). */
  terminal: { links: readonly CliTokenView[] } | null;
  /** Solo Lateral Space. */
  granola: { state: GranolaCardState; accountEmail: string | null; plan: string | null } | null;
}

export type AccountSheetResponse = { ok: true; account: AccountSheetData } | { ok: false; code: string };

/** La rotta che il foglio legge quando si apre. */
export const accountApiPath = (workspaceId: string) => `/api/workspaces/${encodeURIComponent(workspaceId)}/account`;

/** Il comando per Claude Code, con il token appena creato (lo stesso della card «Claude per il team»). */
export function claudeCodeCommand(claude: Pick<AccountClaude, "claudeCodeName" | "url">, token: string): string {
  return `claude mcp add --transport http ${claude.claudeCodeName} ${claude.url} --header "Authorization: Bearer ${token}"`;
}

/** L'intestazione da mettere nel connettore personalizzato di claude.ai. */
export const claudeAiHeader = (token: string) => `Authorization: Bearer ${token}`;
