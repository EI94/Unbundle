/**
 * Piano di caricamento di un template (PIANO §4.3): dal testo del file alla
 * definizione canonica, con impronta e controlli che non richiedono il database.
 *
 * - Il file si legge con il limite di dimensione e il controllo delle chiavi
 *   ripetute (`parseTemplateText`), poi passa dalla validazione stretta: un file
 *   grezzo non normalizzato viene rifiutato con l'elenco degli errori.
 * - La definizione canonica è l'uscita di zod (default compresi) **senza**
 *   `status`: lo stato del template vive solo nella colonna `uc_templates.status`
 *   (`--publish`), così cambiare lo stato scritto nel file non cambia l'impronta.
 * - `definition_hash = sha256(stableStringify(definizione canonica))`.
 * - Un template `confidential` si carica solo riservato a un workspace.
 *
 * Modulo puro: la lettura del file e il database stanno nello script e in
 * `src/lib/db/queries/uc-templates.ts`.
 */
import type { ItemKind } from "../vocab.ts";
import { definitionHash } from "./hash.ts";
import { parseTemplateText, validateTemplate, type TemplateDefinition, type TemplateIssue, type TemplateStats } from "./schema.ts";

/** Definizione salvata in `uc_templates.definition`. */
export type CanonicalDefinition = Omit<TemplateDefinition, "status">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Definizione canonica: uscita della validazione senza lo stato. */
export function canonicalDefinition(template: TemplateDefinition): CanonicalDefinition {
  const { status: _status, ...rest } = template;
  void _status;
  return rest;
}

/** Impronta di una definizione già validata. */
export function templateDefinitionHash(template: TemplateDefinition | CanonicalDefinition): string {
  return definitionHash("status" in template ? canonicalDefinition(template) : template);
}

export interface TemplateLoadPlan {
  key: string;
  version: string;
  language: string;
  name: string;
  archetype: string;
  industry: string | null;
  functionArea: string | null;
  confidential: boolean;
  /** Workspace a cui il template è riservato, oppure null (visibile a tutti). */
  restrictedToWorkspaceId: string | null;
  definition: CanonicalDefinition;
  hash: string;
  stats: TemplateStats;
  warnings: TemplateIssue[];
}

export type TemplateLoadPlanResult =
  | { ok: true; plan: TemplateLoadPlan }
  | { ok: false; code: string; message: string; errors: TemplateIssue[] };

function failure(code: string, message: string, errors: TemplateIssue[] = []): TemplateLoadPlanResult {
  return { ok: false, code, message, errors };
}

/**
 * Se il percorso è sotto `templates/uc/`, deve essere `templates/uc/<key>/<version>.json`.
 * Restituisce un messaggio d'errore, oppure null.
 */
export function checkTemplatePath(filePath: string, key: string, version: string): string | null {
  const normalized = filePath.replace(/\\/g, "/");
  const marker = "templates/uc/";
  const at = normalized.lastIndexOf(marker);
  if (at === -1) return null;
  const rest = normalized.slice(at + marker.length);
  if (rest !== `${key}/${version}.json`) {
    return `Il file sotto templates/uc/ deve chiamarsi «${key}/${version}.json» (chiave e versione del template).`;
  }
  return null;
}

/** Testo del file → piano di caricamento. Nessun accesso al database. */
export function planTemplateLoad(
  text: string,
  options: {
    restrictToWorkspaceId?: string | null;
    filePath?: string;
    /** `inspect`: solo validazione e impronta (normalizzatore), senza il controllo della riserva. */
    purpose?: "load" | "inspect";
  } = {},
): TemplateLoadPlanResult {
  const restricted = options.restrictToWorkspaceId ?? null;
  if (restricted !== null && !UUID.test(restricted)) {
    return failure("workspace_non_valido", "L'id del workspace riservato non è valido.");
  }
  const parsed = parseTemplateText(text);
  if (!parsed.ok) return failure(parsed.code, parsed.message);
  const validation = validateTemplate(parsed.value);
  if (!validation.ok) {
    return failure("template_non_valido", `Il template non è valido: ${validation.errors.length} errori.`, validation.errors);
  }
  const template = validation.template;
  if (options.filePath) {
    const pathError = checkTemplatePath(options.filePath, template.key, template.version);
    if (pathError) return failure("percorso_non_valido", pathError);
  }
  if (template.confidential && restricted === null && options.purpose !== "inspect") {
    return failure(
      "template_riservato",
      "Template con contenuti del cliente: indica il workspace con --restrict-workspace.",
    );
  }
  const definition = canonicalDefinition(template);
  return {
    ok: true,
    plan: {
      key: template.key,
      version: template.version,
      language: template.language,
      name: template.name,
      archetype: template.archetype,
      industry: template.industry ?? null,
      functionArea: template.function_area ?? null,
      confidential: template.confidential,
      restrictedToWorkspaceId: restricted,
      definition,
      hash: definitionHash(definition),
      stats: validation.stats,
      warnings: validation.warnings,
    },
  };
}

/** Riepilogo per il dry run: niente testi del template, solo chiavi e conteggi. */
export function planSummary(plan: TemplateLoadPlan): {
  key: string;
  version: string;
  language: string;
  hash: string;
  confidential: boolean;
  restricted_to_workspace_id: string | null;
  items: number;
  links: number;
  by_kind: Partial<Record<ItemKind, number>>;
  questions: number;
  must_questions: number;
  modules: number;
  blockers: number;
  gates: number;
  map_nodes: number;
  warnings: number;
  warning_codes: Record<string, number>;
} {
  const byKind = Object.fromEntries(Object.entries(plan.stats.byKind).filter(([, n]) => n > 0)) as Partial<Record<ItemKind, number>>;
  const warningCodes: Record<string, number> = {};
  for (const w of plan.warnings) warningCodes[w.code] = (warningCodes[w.code] ?? 0) + 1;
  return {
    key: plan.key,
    version: plan.version,
    language: plan.language,
    hash: plan.hash,
    confidential: plan.confidential,
    restricted_to_workspace_id: plan.restrictedToWorkspaceId,
    items: plan.stats.items,
    links: plan.stats.links,
    by_kind: byKind,
    questions: plan.stats.questions,
    must_questions: plan.stats.mustQuestions,
    modules: plan.stats.modules,
    blockers: plan.stats.blockers,
    gates: plan.stats.gates,
    map_nodes: plan.stats.mapNodes,
    warnings: plan.warnings.length,
    warning_codes: warningCodes,
  };
}
