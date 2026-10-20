/**
 * Regole pure dell'export del catalogo (PIANO §5.9, WP12b) per la route
 * `GET …/casi-duso/[caseId]/export?format=json|md|xlsx&version=N|bozza`:
 * lettura dei parametri, chi può scaricare cosa, nome e tipo del file, link.
 *
 * Gli export si scaricano solo con link nativi `<a download>` (mai `<Link>` di
 * Next: un prefetch non deve generare un export né un evento di audit).
 *
 * Modulo puro: import relativi `.ts`, nessun accesso al DB.
 */
import { can } from "../permissions.ts";
import { fail, ok, type Result } from "../types.ts";
import { LS_CASE_ROLES, type CaseRole } from "../vocab.ts";

// ── Export: parametri ─────────────────────────────────────────────────

export const EXPORT_FORMATS = ["json", "md", "xlsx"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** Versione chiesta: l'ultima congelata (default), un numero preciso o la bozza (Lateral Space; il responsabile del cliente prima del via). */
export type ExportVersion = { kind: "ultima" } | { kind: "numero"; version: number } | { kind: "bozza" };

export interface ExportQuery {
  format: ExportFormat;
  version: ExportVersion;
}

const VERSION_NUMBER = /^[1-9][0-9]{0,5}$/;

/** `format` (default `json`) e `version` (assente = ultima congelata, `bozza`, oppure un intero da 1). */
export function parseExportQuery(params: { get(name: string): string | null }): Result<ExportQuery> {
  const rawFormat = (params.get("format") ?? "").trim().toLowerCase();
  const format = rawFormat === "" ? "json" : rawFormat;
  if (!(EXPORT_FORMATS as readonly string[]).includes(format)) {
    return fail("formato_non_valido", "Formato non disponibile: scegli JSON, Markdown o Excel.");
  }
  const rawVersion = (params.get("version") ?? "").trim().toLowerCase();
  let version: ExportVersion;
  if (rawVersion === "" || rawVersion === "ultima") version = { kind: "ultima" };
  else if (rawVersion === "bozza") version = { kind: "bozza" };
  else if (VERSION_NUMBER.test(rawVersion)) version = { kind: "numero", version: Number(rawVersion) };
  else return fail("versione_non_valida", "Versione non valida: indica il numero di una versione congelata oppure «bozza».");
  return ok({ format: format as ExportFormat, version });
}

// ── Export: chi può scaricare ─────────────────────────────────────────

const LS_ROLES = new Set<CaseRole>(LS_CASE_ROLES);

/** Il responsabile del cliente chiede la bozza dopo il via. */
export const DRAFT_AFTER_VIA_MESSAGE = "Dopo il via allo sviluppo si scarica il catalogo validato.";

/**
 * Matrice del PIANO §3.3 e §5.9, con Esporta per ruolo (DESIGN §3.13.1): le
 * versioni congelate le scaricano ls_lead, ls_analista, ls_sviluppatore e
 * owner_cliente (`export_validato`); la bozza di lavoro ls_lead e ls_analista
 * (`export` e ruolo Lateral Space) sempre, il responsabile del cliente
 * (`owner_cliente`, `export`) solo prima del via allo sviluppo, cioè finché il
 * caso non ha una versione congelata (`latestVersion` = `uc_cases.catalog_version`
 * = 0). Senza `latestVersion` la bozza resta solo di Lateral Space. I ruoli
 * sono già ricalcolati (`resolveCaseAccess`): un ruolo che ora non vale non conta.
 */
export function exportAllowed(roles: readonly CaseRole[], version: ExportVersion, latestVersion?: number): Result<void> {
  if (version.kind === "bozza") {
    if (roles.some((r) => LS_ROLES.has(r) && can([r], "export"))) return ok(undefined);
    const clientLead = roles.includes("owner_cliente") && can(["owner_cliente"], "export");
    if (clientLead && latestVersion === 0) return ok(undefined);
    if (clientLead && latestVersion !== undefined && latestVersion > 0) {
      return fail("bozza_non_ammessa", DRAFT_AFTER_VIA_MESSAGE);
    }
    return fail("bozza_non_ammessa", "Il tuo ruolo non scarica la bozza del catalogo.");
  }
  return can(roles, "export_validato") ? ok(undefined) : fail("export_non_ammesso", "Il tuo ruolo non può scaricare il catalogo.");
}

/**
 * La bozza la chiede un ruolo che la scarica solo prima del via (il
 * responsabile del cliente): la route la legge con `requireBeforeVia`, che
 * controlla `uc_cases.catalog_version` nello stesso giro delle voci.
 */
export function clientDraftBeforeVia(roles: readonly CaseRole[], version: ExportVersion): boolean {
  return version.kind === "bozza" && !roles.some((r) => LS_ROLES.has(r) && can([r], "export")) && roles.includes("owner_cliente");
}

/**
 * Formati per chi guarda: Lateral Space tutti, il cliente solo Excel (DESIGN
 * §3.13.1; il suo foglio è `client-catalog.ts`, senza autore, data o
 * provenienza delle risposte).
 */
export function exportFormatAllowed(roles: readonly CaseRole[], format: ExportFormat): Result<void> {
  if (format === "xlsx" || roles.some((r) => LS_ROLES.has(r))) return ok(undefined);
  return fail("formato_non_ammesso", "Il catalogo si scarica in Excel.");
}

/** Cosa mostrare nell'interfaccia: export della versione congelata (se esiste) e della bozza. */
export function exportChoices(roles: readonly CaseRole[], latestVersion: number): { validated: boolean; draft: boolean } {
  return {
    validated: latestVersion > 0 && exportAllowed(roles, { kind: "ultima" }).ok,
    draft: exportAllowed(roles, { kind: "bozza" }, latestVersion).ok,
  };
}

// ── Export: file ──────────────────────────────────────────────────────

export const EXPORT_CONTENT_TYPES: Readonly<Record<ExportFormat, string>> = {
  json: "application/json; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export const EXPORT_FORMAT_LABELS: Readonly<Record<ExportFormat, string>> = {
  json: "JSON",
  md: "Markdown",
  xlsx: "Excel",
};

/** «es-uc-01-catalogo-v2.xlsx», «es-uc-01-catalogo-bozza.md»: solo ASCII, mai testi liberi. */
export function exportFileName(code: string, version: number | "bozza", format: ExportFormat): string {
  const slug =
    code
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "caso";
  const label = version === "bozza" ? "bozza" : `v${Math.max(0, Math.trunc(version))}`;
  return `${slug}-catalogo-${label}.${format}`;
}

/** `Content-Disposition` per un nome già ripulito (`exportFileName`). */
export function attachmentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "catalogo";
  return `attachment; filename="${ascii}"`;
}

// ── Link ──────────────────────────────────────────────────────────────

/** `/dashboard/<ws>/casi-duso/<case>`, con gli identificativi codificati. */
export function caseBasePath(workspaceId: string, caseId: string): string {
  return `/dashboard/${encodeURIComponent(workspaceId)}/casi-duso/${encodeURIComponent(caseId)}`;
}

/** Link dell'export, da usare solo in un `<a href … download>` nativo. Senza `version`: l'ultima congelata. */
export function catalogExportHref(workspaceId: string, caseId: string, o: { format: ExportFormat; version?: number | "bozza" }): string {
  const params = new URLSearchParams({ format: o.format });
  if (o.version !== undefined) params.set("version", String(o.version));
  return `${caseBasePath(workspaceId, caseId)}/export?${params.toString()}`;
}
