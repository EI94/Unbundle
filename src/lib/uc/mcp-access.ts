/**
 * Accesso MCP in sola lettura ai casi d'uso (PIANO §5.8).
 *
 * - Scope dei token `workspace_integration_tokens`: `cases:read` (elenco, voci
 *   aperte, dizionario dati, gate) e `cases:read_validated` (catalogo validato).
 *   Gli altri scope `cases:*` e `datasets:*` sono riservati: nessuno strumento
 *   nell'MVP, quindi non si concedono.
 * - Ogni token con uno scope di caso porta **un solo** marcatore
 *   `uc:case:<uuid>` (uuid minuscolo, come `caseTokenScope` di `sql/transitions.ts`):
 *   il token legge solo quel caso, e «Revoca tutti i link» o la chiusura del caso
 *   lo revocano.
 * - Parametri delle rotte, etichette dei ruoli, fotografia salvata e comando di
 *   installazione per Claude Code.
 *
 * Modulo puro e usabile anche nei componenti client: importa solo i vocabolari
 * e i tipi (niente `node:*`, niente SQL).
 */
import type { Json, Result } from "./types.ts";
import type { CatalogSnapshot } from "./snapshot.ts";
import { ITEM_KINDS, isVocab, type ItemKind } from "./vocab.ts";
import { isUuid } from "./ids.ts";

// ── Scope ─────────────────────────────────────────────────────────────

export const CASES_READ_SCOPE = "cases:read" as const;
export const CASES_READ_VALIDATED_SCOPE = "cases:read_validated" as const;
/** Riservati per la fase «dopo» (strumenti in scrittura e dataset): non si concedono nell'MVP. */
export const CASES_PROPOSE_SCOPE = "cases:propose" as const;
export const CASES_MEASURE_SCOPE = "cases:measure" as const;
export const DATASETS_READ_META_SCOPE = "datasets:read_meta" as const;
export const DATASETS_READ_ROWS_SCOPE = "datasets:read_rows" as const;

/** Prefisso del marcatore che limita un token a un solo caso. */
export const UC_CASE_SCOPE_PREFIX = "uc:case:" as const;

export const GRANTABLE_CASE_SCOPES = [CASES_READ_SCOPE, CASES_READ_VALIDATED_SCOPE] as const;
export type GrantableCaseScope = (typeof GRANTABLE_CASE_SCOPES)[number];

export const RESERVED_CASE_SCOPES = [CASES_PROPOSE_SCOPE, CASES_MEASURE_SCOPE, DATASETS_READ_META_SCOPE, DATASETS_READ_ROWS_SCOPE] as const;

/** Scope che fanno di un token un «token di caso»: richiedono il marcatore `uc:case:`. */
export const CASE_SCOPES: readonly string[] = [...GRANTABLE_CASE_SCOPES, ...RESERVED_CASE_SCOPES];

/** Scadenza dei token di caso, come i token Claude del workspace. */
export const CASE_TOKEN_TTL_DAYS = 180;

/** Nomi brevi per l'interfaccia. */
export const CASE_SCOPE_LABELS: Readonly<Record<GrantableCaseScope, string>> = {
  [CASES_READ_VALIDATED_SCOPE]: "Catalogo validato",
  [CASES_READ_SCOPE]: "Stato del caso",
};

export const CASE_SCOPE_HINTS: Readonly<Record<GrantableCaseScope, string>> = {
  [CASES_READ_VALIDATED_SCOPE]: "Solo le voci verdi o blu della versione congelata.",
  [CASES_READ_SCOPE]: "Elenco del caso, voci che mancano al gate, dizionario dati e stato del gate.",
};

// ── Strumenti ─────────────────────────────────────────────────────────

/**
 * Strumenti del server `unbundle-casi`. `list_cases` elenca dossier, non use
 * case (si confondeva con `search_use_cases` del MCP del team). Il nome di
 * prima, `list_use_cases`, resta per una release solo come alias del server
 * stdio (`mcp/unbundle-casi-server.mjs`), che chiama la stessa rotta
 * (DESIGN §2.1 punto 7, WP11).
 */
export const MCP_CASE_TOOLS = ["list_cases", "get_validated_catalog", "get_open_items", "get_data_dictionary", "get_gate_status"] as const;
export type McpCaseTool = (typeof MCP_CASE_TOOLS)[number];

/** Scope richiesto da ogni strumento. */
export const MCP_TOOL_SCOPE: Readonly<Record<McpCaseTool, GrantableCaseScope>> = {
  list_cases: CASES_READ_SCOPE,
  get_validated_catalog: CASES_READ_VALIDATED_SCOPE,
  get_open_items: CASES_READ_SCOPE,
  get_data_dictionary: CASES_READ_SCOPE,
  get_gate_status: CASES_READ_SCOPE,
};

// ── Errori ────────────────────────────────────────────────────────────

/** Messaggi in italiano semplice per i codici delle rotte MCP. */
export const MCP_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  non_trovato: "Risorsa non trovata.",
  non_autorizzato: "Token mancante, non valido, scaduto o revocato.",
  scope_mancante: "Il token non ha il permesso per questa lettura.",
  token_senza_caso: "Il token non è limitato a un solo caso: creane uno nuovo dal caso.",
  caso_non_trovato: "Caso non trovato, chiuso, oppure il token è per un altro caso.",
  parametro_non_valido: "Parametro non valido.",
  nessuna_versione_congelata: "Il catalogo non è ancora congelato: serve l'approvazione del gate G1.",
  versione_non_trovata: "Questa versione del catalogo non esiste.",
  non_disponibile: "Sezione non disponibile. Riprova tra poco.",
  registro_non_disponibile: "La lettura non si può registrare adesso: riprova tra poco.",
  errore: "Lettura non riuscita. Riprova tra poco.",
};

const ERROR_STATUS: Readonly<Record<string, number>> = {
  non_trovato: 404,
  non_autorizzato: 401,
  scope_mancante: 403,
  token_senza_caso: 403,
  caso_non_trovato: 404,
  parametro_non_valido: 422,
  nessuna_versione_congelata: 404,
  versione_non_trovata: 404,
  non_disponibile: 503,
  registro_non_disponibile: 503,
};

/** Stato HTTP di un codice d'errore (500 per i codici sconosciuti). */
export function mcpErrorStatus(code: string): number {
  return ERROR_STATUS[code] ?? 500;
}

function failure<T = never>(code: string, message?: string): Result<T> {
  return { ok: false, code, message: message ?? MCP_ERROR_MESSAGES[code] ?? MCP_ERROR_MESSAGES.errore };
}

// ── Marcatore del caso ────────────────────────────────────────────────

export function isUuidLike(value: unknown): value is string {
  return isUuid(value);
}

/** Marcatore `uc:case:<uuid minuscolo>` (stesso formato di `caseTokenScope`). */
export function caseScopeMarker(caseId: string): string {
  return `${UC_CASE_SCOPE_PREFIX}${caseId.toLowerCase()}`;
}

export interface CaseTokenScopes {
  /** Il solo caso che il token può leggere (uuid minuscolo). */
  caseId: string;
  /** Scope di lettura concessi (i riservati non danno accesso a niente). */
  scopes: GrantableCaseScope[];
}

/**
 * Scope di un token di caso. Rifiuta i token senza scope di caso
 * (`scope_mancante`) e quelli senza esattamente un marcatore valido
 * (`token_senza_caso`): un token di caso non legge mai tutto il workspace.
 */
export function parseCaseTokenScopes(scopes: unknown): Result<CaseTokenScopes> {
  const list = Array.isArray(scopes) ? scopes.filter((s): s is string => typeof s === "string") : [];
  if (!list.some((s) => CASE_SCOPES.includes(s))) return failure("scope_mancante");
  const markers = [...new Set(list.filter((s) => s.startsWith(UC_CASE_SCOPE_PREFIX)))];
  if (markers.length !== 1) return failure("token_senza_caso");
  const caseId = markers[0].slice(UC_CASE_SCOPE_PREFIX.length);
  if (!isUuid(caseId) || caseId !== caseId.toLowerCase()) return failure("token_senza_caso");
  const granted = GRANTABLE_CASE_SCOPES.filter((s) => list.includes(s));
  return { ok: true, value: { caseId, scopes: granted } };
}

/**
 * Il token può usare lo strumento su questo caso? Un caso diverso da quello del
 * marcatore risponde come un caso inesistente (`caso_non_trovato`, 404).
 */
export function checkMcpToolAccess(i: { scopes: unknown; tool: McpCaseTool; caseId?: string | null }): Result<{ caseId: string }> {
  const parsed = parseCaseTokenScopes(i.scopes);
  if (!parsed.ok) return parsed;
  if (!parsed.value.scopes.includes(MCP_TOOL_SCOPE[i.tool])) return failure("scope_mancante");
  if (i.caseId !== undefined && i.caseId !== null) {
    if (!isUuidLike(i.caseId) || i.caseId.toLowerCase() !== parsed.value.caseId) return failure("caso_non_trovato");
  }
  return { ok: true, value: { caseId: parsed.value.caseId } };
}

/**
 * Scope da salvare su un token nuovo: solo quelli di lettura dell'MVP, senza
 * doppioni, nell'ordine fisso, più il marcatore del caso.
 */
export function buildCaseTokenScopes(caseId: string, requested: unknown): Result<string[]> {
  if (!isUuidLike(caseId)) return failure("caso_non_trovato");
  if (!Array.isArray(requested) || requested.length === 0) return failure("scope_mancante", "Scegli almeno una lettura per Claude.");
  if (requested.some((s) => !isVocab(GRANTABLE_CASE_SCOPES, s))) {
    return failure("scope_non_ammesso", "Si possono dare solo letture: catalogo validato e stato del caso.");
  }
  const granted = GRANTABLE_CASE_SCOPES.filter((s) => requested.includes(s));
  return { ok: true, value: [...granted, caseScopeMarker(caseId)] };
}

/** Scope di lettura di un token, per mostrarli (senza marcatore e senza riservati). */
export function grantedCaseScopes(scopes: unknown): GrantableCaseScope[] {
  const list = Array.isArray(scopes) ? scopes : [];
  return GRANTABLE_CASE_SCOPES.filter((s) => list.includes(s));
}

// ── Parametri delle rotte ─────────────────────────────────────────────

/** `?version=N` (intero ≥ 1); assente o vuoto = ultima versione congelata. */
export function parseVersionParam(raw: string | null | undefined): Result<number | null> {
  const value = raw?.trim() ?? "";
  if (!value) return { ok: true, value: null };
  if (!/^[1-9][0-9]{0,8}$/.test(value)) return failure("parametro_non_valido", "La versione è un numero intero da 1 in su.");
  return { ok: true, value: Number(value) };
}

/** `?kinds=campo,regola` (tipi di voce); assente o vuoto = tutti. */
export function parseKindsParam(raw: string | null | undefined): Result<ItemKind[] | null> {
  const parts = (raw ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return { ok: true, value: null };
  if (parts.length > ITEM_KINDS.length) return failure("parametro_non_valido", "Troppi tipi di voce.");
  const unknown = parts.find((p) => !isVocab(ITEM_KINDS, p));
  if (unknown !== undefined) return failure("parametro_non_valido", "Tipo di voce sconosciuto.");
  return { ok: true, value: ITEM_KINDS.filter((k) => parts.includes(k)) };
}

// ── Caso ──────────────────────────────────────────────────────────────

/** `settings.client_text`: true salvo un `false` esplicito (PIANO §5.8). */
export function clientTextFromSettings(settings: Record<string, Json> | null | undefined): boolean {
  return settings?.client_text !== false;
}

/**
 * Etichette dei ruoli del template (`definition.roles`), sostituite da quelle del
 * caso (`settings.role_labels`, senza nomi di persone).
 */
export function roleLabelsFrom(templateRoles: unknown, settings: Record<string, Json> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(templateRoles)) {
    for (const r of templateRoles) {
      if (r && typeof r === "object" && !Array.isArray(r) && typeof (r as Record<string, unknown>).key === "string") {
        const role = r as Record<string, unknown>;
        const key = String(role.key);
        out[key] = typeof role.label === "string" && role.label.trim() ? role.label.trim() : key;
      }
    }
  }
  const fromCase = settings?.role_labels;
  if (fromCase && typeof fromCase === "object" && !Array.isArray(fromCase)) {
    for (const [k, v] of Object.entries(fromCase)) if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return out;
}

/** Schema delle fotografie (`CATALOG_SNAPSHOT_SCHEMA` di `snapshot.ts`, ripetuto per restare puro). */
export const STORED_SNAPSHOT_SCHEMA = "unbundle.uc-catalog/1" as const;

/**
 * Fotografia letta da `uc_catalog_versions.snapshot`: solo se è una versione
 * congelata dello stesso caso, con la forma attesa. Altrimenti null.
 */
export function parseStoredSnapshot(value: unknown, caseId: string): CatalogSnapshot | null {
  let v = value;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const s = v as Record<string, unknown>;
  const kase = s.case as Record<string, unknown> | undefined;
  const template = s.template as Record<string, unknown> | undefined;
  if (s.schema !== STORED_SNAPSHOT_SCHEMA) return null;
  if (typeof s.version !== "number" || !Number.isInteger(s.version) || s.version < 1) return null;
  if (typeof s.frozen_at !== "string") return null;
  if (!kase || typeof kase !== "object" || typeof kase.id !== "string" || kase.id.toLowerCase() !== caseId.toLowerCase()) return null;
  if (typeof kase.code !== "string") return null;
  if (!template || typeof template !== "object" || typeof template.key !== "string" || typeof template.version !== "string") return null;
  if (!Array.isArray(s.items) || !Array.isArray(s.links)) return null;
  return v as CatalogSnapshot;
}

// ── Installazione in Claude Code ──────────────────────────────────────

/** URL di base dell'app, senza barra finale; con schema `https` se manca. */
export function normalizeApiBaseUrl(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  const withScheme = value.startsWith("http://") || value.startsWith("https://") ? value : `https://${value}`;
  return withScheme.replace(/\/+$/, "");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** Nome del server MCP in Claude Code: uno per caso, perché ogni token legge un solo caso. */
export function casiServerName(caseCode: string): string {
  const slug = caseCode
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug ? `unbundle-casi-${slug}` : "unbundle-casi";
}

/**
 * Comando da incollare nel Terminale: scarica il server e lo SKILL dei casi,
 * installa le dipendenze e registra il server in Claude Code con il token.
 */
export function buildCasiInstallCommand(i: { apiUrl: string; token: string; caseCode: string }): string {
  const baseUrl = normalizeApiBaseUrl(i.apiUrl) ?? i.apiUrl;
  const dir = '"$HOME/.unbundle/claude-casi"';
  return [
    `mkdir -p ${dir}`,
    `curl -fsSL ${shellQuote(`${baseUrl}/api/mcp/casi/server`)} -o "$HOME/.unbundle/claude-casi/unbundle-casi-server.mjs"`,
    `curl -fsSL ${shellQuote(`${baseUrl}/api/mcp/casi/skill`)} -o "$HOME/.unbundle/claude-casi/SKILL.md"`,
    `npm install --silent --prefix ${dir} @modelcontextprotocol/sdk@^1.29.0 zod@^4.3.6`,
    [
      "claude mcp add",
      "--transport stdio",
      "--env",
      `UNBUNDLE_API_URL=${shellQuote(baseUrl)}`,
      "--env",
      `UNBUNDLE_MCP_TOKEN=${shellQuote(i.token)}`,
      casiServerName(i.caseCode),
      "--",
      "node",
      '"$HOME/.unbundle/claude-casi/unbundle-casi-server.mjs"',
    ].join(" "),
  ].join(" && \\\n");
}

/** Prima richiesta da scrivere a Claude dopo l'installazione. */
export function buildCasiStarterPrompt(caseCode: string): string {
  return [
    `Leggi da Unbundle il catalogo validato del caso ${caseCode} e dimmi su quale versione stai lavorando.`,
    "Usa solo le voci validate: per quelle escluse o nascoste non inventare valori, elencale come domande per Lateral Space.",
  ].join(" ");
}
