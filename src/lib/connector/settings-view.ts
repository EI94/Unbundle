/**
 * Scheda «Connettore Claude» in Impostazioni › Integrazioni (pacchetto K7r del piano,
 * prompt WP7 ridotto): chi la vede, cosa mostra e come si validano gli input delle
 * azioni. Modulo puro: lo usano la scheda (componente server), le azioni
 * (`src/lib/actions/connector-settings.ts`) e i test con `node --test`.
 *
 * - La vedono solo i gestori delle integrazioni: membri dell'**organizzazione** con un
 *   ruolo che gestisce il workspace, la stessa regola di Slack e della card «Claude per
 *   Unbundle». Lo stato «esposto» dei token resta così a chi gestisce il workspace.
 * - Le date escono già scritte in italiano, nel fuso di Roma: il componente client non
 *   le riformatta (niente differenze fra server e browser).
 * - Nessun dato per persona: la scheda non conta né elenca chi propone.
 */
import { z } from "zod";
import { canManageWorkspaceSettings } from "../workspace-permissions.ts";
import { CONNECTOR_PUBLIC_ORIGIN, connectorTokenExpiry } from "./auth.ts";
import { resolveConnectorLimits, type ConnectorLimits } from "./config.ts";
import { normalizeAllowedOrigins } from "./http-hygiene.ts";
import { validateInstructionsTemplate } from "./instructions.ts";
import { connectorProfileFromStored } from "./profile.ts";
import { USE_CASE_CODE_MAX_SEQ, formatUseCaseCode } from "../portfolio/use-case-code.ts";

/** Chi accede al workspace, come lo descrive `getCollaboratorAccess`. */
export interface ConnectorSettingsAccess {
  source: "organization" | "workspace";
  role: string;
}

/**
 * Vero solo per chi gestisce le integrazioni: membro dell'organizzazione con un ruolo
 * che gestisce il workspace. Chi è invitato a un solo workspace non vede la scheda.
 */
export function canManageConnectorSettings(access: ConnectorSettingsAccess | null | undefined): boolean {
  return access?.source === "organization" && canManageWorkspaceSettings(access.role);
}

/** Indirizzo pubblico del connettore, sempre con www (prompt §3). */
export function connectorPublicUrl(slug: string, origin: string = CONNECTOR_PUBLIC_ORIGIN): string {
  return `${origin.replace(/\/+$/, "")}/api/mcp/connettore/${encodeURIComponent(slug)}`;
}

const ITALIAN_DAY = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Rome" });

/** Giorno in italiano nel fuso di Roma («12 gen 2027»); null senza data. */
export function formatItalianDay(value: Date | null | undefined): string | null {
  if (!value || Number.isNaN(value.getTime())) return null;
  return ITALIAN_DAY.format(value);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const ROME_DATE = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "numeric", day: "numeric", timeZone: "Europe/Rome" });

/** Numero del giorno di calendario a Roma (giorni dall'epoca), per contare i giorni come li legge una persona. */
function romeDayNumber(value: Date): number {
  const parts = Object.fromEntries(ROME_DATE.formatToParts(value).map((p) => [p.type, p.value]));
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) / DAY_MS;
}

/**
 * Giorni di calendario a Roma da `now` a `target`: 0 se cadono nello stesso giorno,
 * 1 se `target` è domani. Lo stesso giorno di `formatItalianDay`, anche nei cambi d'ora.
 */
export function romeCalendarDaysBetween(now: Date, target: Date): number {
  return romeDayNumber(target) - romeDayNumber(now);
}

/** «oggi», «domani», «tra N giorni». */
export function inDaysText(days: number): string {
  if (days <= 0) return "oggi";
  return days === 1 ? "domani" : `tra ${days} giorni`;
}

// ── Token ────────────────────────────────────────────────────────────

/** Riga di `getConnectorIntegrationTokens`. */
export interface ConnectorTokenRow {
  id: string;
  label: string;
  tokenPrefix: string;
  createdAt: Date;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  exposedAt: Date | null;
}

/** «attivo», «in_scadenza» (da 14 giorni prima), «scaduto», «revocato». */
export type ConnectorTokenState = "attivo" | "in_scadenza" | "scaduto" | "revocato";

export interface ConnectorTokenView {
  id: string;
  label: string;
  tokenPrefix: string;
  state: ConnectorTokenState;
  /** Usabile dal connettore: né revocato né scaduto. */
  active: boolean;
  /**
   * Giorni di calendario a Roma fino al giorno della scadenza (0 = scade oggi); null se
   * revocato, scaduto o senza scadenza. La soglia dell'avviso resta quella di
   * `connectorTokenExpiry` (14 giorni da 24 ore).
   */
  daysLeft: number | null;
  /** «oggi», «domani», «tra N giorni», coerente con `expiresOn`; null come `daysLeft`. */
  expiresIn: string | null;
  /** Arrivato dentro un indirizzo: «esposto, da revocare» finché è attivo. */
  exposed: boolean;
  createdOn: string;
  expiresOn: string | null;
  lastUsedOn: string | null;
  revokedOn: string | null;
  exposedOn: string | null;
}

export function connectorTokenView(row: ConnectorTokenRow, now: Date = new Date()): ConnectorTokenView {
  const expiry = connectorTokenExpiry(row.expiresAt, now);
  const state: ConnectorTokenState = row.revokedAt
    ? "revocato"
    : expiry.expired
      ? "scaduto"
      : expiry.expiringSoon
        ? "in_scadenza"
        : "attivo";
  const active = state === "attivo" || state === "in_scadenza";
  const daysLeft = active && row.expiresAt ? Math.max(0, romeCalendarDaysBetween(now, row.expiresAt)) : null;
  return {
    id: row.id,
    label: row.label,
    tokenPrefix: row.tokenPrefix,
    state,
    active,
    daysLeft,
    expiresIn: daysLeft === null ? null : inDaysText(daysLeft),
    exposed: row.exposedAt != null,
    createdOn: formatItalianDay(row.createdAt) ?? "",
    expiresOn: formatItalianDay(row.expiresAt),
    lastUsedOn: formatItalianDay(row.lastUsedAt),
    revokedOn: formatItalianDay(row.revokedAt),
    exposedOn: formatItalianDay(row.exposedAt),
  };
}

// ── Configurazione ───────────────────────────────────────────────────

/**
 * Riga di `getConnectorSettings` (`workspace_connector_configs`, senza la guida, il profilo e il
 * modello delle istruzioni: di questi la scheda sa solo se ci sono e sono validi).
 */
export interface ConnectorSettingsRow {
  slug: string;
  enabled: boolean;
  codePrefix: string;
  /** Ultimo numero assegnato (`next_code_seq`): il prossimo codice usa il seguente. */
  codeSeq: number;
  identityMode: string;
  authMode: string;
  workspaceDisplayName: string | null;
  /** Colonna `guide_version`. */
  guideVersion: string | null;
  /** `guideVersion` dentro la guida, se è una stringa: vale quando la colonna è vuota. */
  guideJsonVersion: string | null;
  /** La guida è un oggetto JSON (il contenuto non serve alla scheda). */
  hasGuide: boolean;
  /**
   * Profilo del cliente e modello delle istruzioni validi (`isConnectorProfileReady`): senza,
   * la rotta risponde 500 a ogni richiesta autenticata (K8).
   */
  profileReady: boolean;
  allowedDomains: unknown;
  allowedOrigins: unknown;
  limits: unknown;
}

export interface ConnectorConfigView {
  slug: string;
  url: string;
  enabled: boolean;
  codePrefix: string;
  /** Il codice che riceverà la prossima segnalazione («XX-0043»); null a numeri finiti. */
  nextCode: string | null;
  displayName: string | null;
  /** La versione che Claude riceve da `get_intake_guide`: la colonna, altrimenti quella della guida. */
  guideVersion: string | null;
  hasGuide: boolean;
  /** Profilo del cliente e modello delle istruzioni validi. */
  profileReady: boolean;
  /** Si può accendere e ricevere token nuovi: guida, profilo e modello ci sono (`canActivateConnector`). */
  canActivate: boolean;
  identityMode: "dichiarata" | "verificata";
  authMode: "header" | "oauth";
  allowedDomains: string[];
  allowedOrigins: string[];
  limits: ConnectorLimits;
}

/**
 * - `non_configurato`: nessuna riga in `workspace_connector_configs`, oppure una riga
 *   spenta e senza guida, come quella che ogni workspace riceve per i codici
 *   (docs/use-case/DESIGN.md §10.6, D6): il connettore lo prepara lo script operatore
 *   (configurazione e guida), non la scheda;
 * - `sospeso`: interruttore del workspace spento (ogni tool risponde «sospeso»);
 * - `senza_token`: acceso, ma nessun token attivo (Claude riceve 401);
 * - `attivo`: acceso, con almeno un token attivo.
 */
export type ConnectorCardStatus = "non_configurato" | "sospeso" | "senza_token" | "attivo";

export interface ConnectorSettingsView {
  status: ConnectorCardStatus;
  /** Null quando il connettore non è configurato: niente indirizzo, interruttore o token nuovi. */
  config: ConnectorConfigView | null;
  /** Attivi prima (il più recente in alto), poi revocati e scaduti. */
  tokens: ConnectorTokenView[];
}

const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Domini email ammessi (fase 2): minuscole, senza «@» davanti, validi, senza doppioni. */
export function normalizeAllowedDomains(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const entry of list) {
    if (typeof entry !== "string") continue;
    const domain = entry.trim().toLowerCase().replace(/^@/, "");
    if (DOMAIN.test(domain) && !out.includes(domain)) out.push(domain);
  }
  return out;
}

/**
 * Il connettore è stato preparato per questo workspace: ha la guida (caricata dallo
 * script operatore) oppure è acceso. Una riga spenta e senza guida (D6) non lo è.
 */
export function isConnectorSetUp(row: Pick<ConnectorSettingsRow, "enabled" | "hasGuide"> | null | undefined): boolean {
  return row != null && (row.hasGuide === true || row.enabled === true);
}

/**
 * Profilo del cliente e modello delle istruzioni della riga sono validi, con le stesse regole
 * della rotta (`toConnectorRuntimeConfig`): senza, ogni richiesta autenticata riceve 500.
 * Li carica lo script operatore (`connector-admin profile`).
 */
export function isConnectorProfileReady(profile: unknown, instructionsTemplate: unknown): boolean {
  return connectorProfileFromStored(profile).ok && validateInstructionsTemplate(instructionsTemplate).ok;
}

/**
 * Riaccendere il connettore o creargli un token ha senso solo con la guida caricata e con
 * profilo e modello delle istruzioni validi: senza la guida Claude non riceve aree, rubrica
 * né regole; senza profilo o modello la rotta risponde 500. Spegnerlo si può sempre.
 */
export function canActivateConnector(row: Pick<ConnectorSettingsRow, "hasGuide" | "profileReady"> | null | undefined): boolean {
  return row?.hasGuide === true && row.profileReady === true;
}

function nextUseCaseCode(prefix: string, seq: number): string | null {
  const next = (Number.isInteger(seq) && seq >= 0 ? seq : 0) + 1;
  if (next > USE_CASE_CODE_MAX_SEQ) return null;
  try {
    return formatUseCaseCode(prefix, next);
  } catch {
    return null;
  }
}

export function connectorConfigView(row: ConnectorSettingsRow): ConnectorConfigView {
  return {
    slug: row.slug,
    url: connectorPublicUrl(row.slug),
    enabled: row.enabled === true,
    codePrefix: row.codePrefix,
    nextCode: nextUseCaseCode(row.codePrefix, Number(row.codeSeq)),
    displayName: row.workspaceDisplayName?.trim() || null,
    // Stessa regola di `intakeGuideOutput` (tools.ts): prima la colonna, poi la guida.
    guideVersion: row.guideVersion?.trim() || row.guideJsonVersion?.trim() || null,
    hasGuide: row.hasGuide === true,
    profileReady: row.profileReady === true,
    canActivate: canActivateConnector(row),
    identityMode: row.identityMode === "verificata" ? "verificata" : "dichiarata",
    authMode: row.authMode === "oauth" ? "oauth" : "header",
    allowedDomains: normalizeAllowedDomains(row.allowedDomains),
    allowedOrigins: normalizeAllowedOrigins(row.allowedOrigins),
    limits: resolveConnectorLimits(row.limits),
  };
}

export function connectorSettingsView(
  row: ConnectorSettingsRow | null,
  tokens: readonly ConnectorTokenRow[],
  now: Date = new Date()
): ConnectorSettingsView {
  const views = tokens.map((token) => ({ token, view: connectorTokenView(token, now) }));
  views.sort((a, b) => Number(b.view.active) - Number(a.view.active) || b.token.createdAt.getTime() - a.token.createdAt.getTime());
  const sorted = views.map((v) => v.view);
  const config = row && isConnectorSetUp(row) ? connectorConfigView(row) : null;
  const status: ConnectorCardStatus = !config
    ? "non_configurato"
    : !config.enabled
      ? "sospeso"
      : sorted.some((t) => t.active)
        ? "attivo"
        : "senza_token";
  return { status, config, tokens: sorted };
}

/**
 * La scheda compare solo dove il connettore è configurato, oppure dove restano token
 * attivi da revocare. Negli altri workspace non c'è: nessun testo su un servizio che
 * non usano.
 */
export function shouldShowConnectorCard(view: ConnectorSettingsView): boolean {
  return view.status !== "non_configurato" || view.tokens.some((t) => t.active);
}

// ── Input delle azioni ───────────────────────────────────────────────

/** Nome proposto per un token nuovo. */
export const CONNECTOR_TOKEN_DEFAULT_LABEL = "Connettore Claude";

const workspaceId = z.uuid({ error: "Workspace non valido." });

/** Interruttore di sospensione del workspace. */
export const connectorEnabledInput = z.object({ workspaceId, enabled: z.boolean({ error: "Valore non valido." }) }).strict();

/** Token nuovo: solo il nome, da 2 a 80 caratteri (come i token della card v1). */
export const connectorTokenCreateInput = z
  .object({
    workspaceId,
    label: z
      .string({ error: "Dai un nome al token." })
      .trim()
      .min(2, "Dai un nome al token.")
      .max(80, "Nome troppo lungo: al massimo 80 caratteri."),
  })
  .strict();

/** Revoca: l'id del token, che deve essere un token del connettore di questo workspace. */
export const connectorTokenRevokeInput = z.object({ workspaceId, tokenId: z.uuid({ error: "Token non valido." }) }).strict();

/** Primo messaggio per campo, senza ripetere i valori ricevuti. */
export function connectorFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "_";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
