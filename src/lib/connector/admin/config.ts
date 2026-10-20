/**
 * `connector-admin config --workspace <id> --file <config.json> [--overwrite]` (prompt WP8):
 * la riga di `workspace_connector_configs` del workspace. Il file (per un cliente un
 * `*.private.json`, fuori da git; `docs/connettore/config-esempio.json` è l'esempio
 * sintetico) dice slug, prefisso dei codici, nome visualizzato e, se servono, modalità,
 * domini email ammessi (fase 2), origini HTTP ammesse e limiti.
 *
 * Regole (PIANO-LAVORI §3.5, riga K8: `config` non sovrascrive le righe create da
 * `use-case-admin configs`, e viceversa):
 *  - senza riga la crea, sempre spenta (`enabled = false`, contatore dei codici a 0);
 *  - con la riga: un campo uguale resta; un campo vuoto (nome assente, elenco vuoto, limiti
 *    predefiniti) si riempie; un valore già scritto e diverso si cambia solo con
 *    `--overwrite`, dopo averlo visto nella prova a secco;
 *  - non tocca mai l'interruttore (`enabled`, della scheda «Connettore Claude»), il
 *    contatore dei codici, la guida, il profilo né `updated_by`;
 *  - fase 1: identità «dichiarata» e accesso con header; la fase 2 (OAuth) non c'è ancora;
 *  - un prefisso nuovo vale per i codici futuri: quelli già assegnati non cambiano. Il
 *    prefisso si decide prima di `backfill-codes`.
 */
import { z } from "zod";
import { CONNECTOR_DEFAULT_LIMITS, type ConnectorLimits } from "../../db/connector-ddl.ts";
import { USE_CASE_CODE_PREFIX_PATTERN } from "../../portfolio/use-case-code.ts";
import { CONNECTOR_SLUG_PATTERN, resolveConnectorLimits } from "../config.ts";
import { normalizeAllowedOrigins, normalizeOrigin } from "../http-hygiene.ts";
import { normalizeAllowedDomains } from "../settings-view.ts";
import { AdminStop, canonicalJson, done, DRY_RUN_NOTE, stopped, type AdminCommand, type AdminStatement } from "./cli.ts";
import { readConfigRow, readiness, readWorkspace, requireSchema, type ConfigRow } from "./state.ts";

const LIMIT_MAX = 1_000_000;
const limit = () => z.number().int().min(0).max(LIMIT_MAX);

/** Il file della configurazione. Solo i primi tre campi sono obbligatori. */
export const connectorConfigFileSchema = z
  .object({
    slug: z.string().regex(CONNECTOR_SLUG_PATTERN, "Slug: da 3 a 40 caratteri tra minuscole, cifre e trattino."),
    codePrefix: z.string().regex(USE_CASE_CODE_PREFIX_PATTERN, "Prefisso: da 2 a 4 lettere maiuscole."),
    workspaceDisplayName: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .refine((name) => !/[\p{Cc}\p{Cf}{}]/u.test(name), "Nome su una riga, senza parentesi graffe."),
    identityMode: z.literal("dichiarata", { error: "Fase 1: identityMode «dichiarata» (la fase 2 non c'è ancora)." }).optional(),
    authMode: z.literal("header", { error: "Fase 1: authMode «header» (gli endpoint OAuth non ci sono ancora)." }).optional(),
    allowedDomains: z
      .array(z.string())
      .max(20)
      .refine((list) => normalizeAllowedDomains(list).length === list.length, "Domini email: validi e senza doppioni (es. esempio.it).")
      .optional(),
    allowedOrigins: z
      .array(z.string())
      .max(20)
      .refine((list) => list.every((o) => normalizeOrigin(o) !== null) && normalizeAllowedOrigins(list).length === list.length, "Origini: scheme://host[:porta], senza doppioni.")
      .optional(),
    limits: z
      .object({ submitsPerHour: limit(), readsPerHour: limit(), submitsPerDayWorkspace: limit(), submitsPerHourPerUser: limit() })
      .partial()
      .strict()
      .optional(),
  })
  .strict();

export type ConnectorConfigFile = z.infer<typeof connectorConfigFileSchema>;

/** I campi che `config` gestisce, con la colonna e il valore desiderato. */
interface DesiredField {
  field: string;
  column: string;
  value: unknown;
  /** Il cast SQL del parametro. */
  cast: "" | "::jsonb";
}

export type FieldChange = { campo: string; attuale: unknown; nuovo: unknown; tipo: "nuovo" | "riempie" | "cambia" };

export interface ConfigPlan {
  create: boolean;
  changes: FieldChange[];
  unchanged: string[];
  warnings: string[];
  fields: DesiredField[];
}

function desiredFields(file: ConnectorConfigFile, current: ConfigRow | null): DesiredField[] {
  const fields: DesiredField[] = [
    { field: "slug", column: "slug", value: file.slug, cast: "" },
    { field: "codePrefix", column: "code_prefix", value: file.codePrefix, cast: "" },
    { field: "workspaceDisplayName", column: "workspace_display_name", value: file.workspaceDisplayName.replace(/\s+/g, " "), cast: "" },
  ];
  // Un campo facoltativo assente dal file non si tocca; nella riga nuova vale il predefinito della 0019.
  if (file.identityMode !== undefined || !current) fields.push({ field: "identityMode", column: "identity_mode", value: file.identityMode ?? "dichiarata", cast: "" });
  if (file.authMode !== undefined || !current) fields.push({ field: "authMode", column: "auth_mode", value: file.authMode ?? "header", cast: "" });
  if (file.allowedDomains !== undefined || !current) {
    fields.push({ field: "allowedDomains", column: "allowed_domains", value: normalizeAllowedDomains(file.allowedDomains ?? []), cast: "::jsonb" });
  }
  if (file.allowedOrigins !== undefined || !current) {
    fields.push({ field: "allowedOrigins", column: "allowed_origins", value: normalizeAllowedOrigins(file.allowedOrigins ?? []), cast: "::jsonb" });
  }
  if (file.limits !== undefined || !current) {
    const base: ConnectorLimits = current ? resolveConnectorLimits(current.limits) : { ...CONNECTOR_DEFAULT_LIMITS };
    fields.push({ field: "limits", column: "limits", value: { ...base, ...(file.limits ?? {}) }, cast: "::jsonb" });
  }
  return fields;
}

function currentValue(row: ConfigRow, field: string): unknown {
  switch (field) {
    case "slug":
      return row.slug;
    case "codePrefix":
      return row.codePrefix;
    case "workspaceDisplayName":
      return row.workspaceDisplayName;
    case "identityMode":
      return row.identityMode;
    case "authMode":
      return row.authMode;
    case "allowedDomains":
      return Array.isArray(row.allowedDomains) ? row.allowedDomains : [];
    case "allowedOrigins":
      return Array.isArray(row.allowedOrigins) ? row.allowedOrigins : [];
    case "limits":
      return row.limits;
    default:
      return undefined;
  }
}

/** Un valore «vuoto», che `config` può riempire senza `--overwrite`. */
function isEmpty(field: string, value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  if (field === "limits") return canonicalJson(resolveConnectorLimits(value)) === canonicalJson(CONNECTOR_DEFAULT_LIMITS);
  return false;
}

/** Il piano: riga nuova o differenze campo per campo. Modulo puro. */
export function planConfig(file: ConnectorConfigFile, current: ConfigRow | null): ConfigPlan {
  const fields = desiredFields(file, current);
  if (!current) {
    return {
      create: true,
      changes: fields.map((f) => ({ campo: f.field, attuale: null, nuovo: f.value, tipo: "nuovo" as const })),
      unchanged: [],
      warnings: [],
      fields,
    };
  }
  const changes: FieldChange[] = [];
  const unchanged: string[] = [];
  const toWrite: DesiredField[] = [];
  for (const f of fields) {
    const before = currentValue(current, f.field);
    const comparableBefore = f.field === "limits" ? resolveConnectorLimits(before) : before;
    if (canonicalJson(comparableBefore) === canonicalJson(f.value)) {
      unchanged.push(f.field);
      continue;
    }
    changes.push({ campo: f.field, attuale: before ?? null, nuovo: f.value, tipo: isEmpty(f.field, before) ? "riempie" : "cambia" });
    toWrite.push(f);
  }
  const warnings: string[] = [];
  if (changes.some((c) => c.campo === "codePrefix") && current.nextCodeSeq > 0) {
    warnings.push(`Il prefisso cambia dopo ${current.nextCodeSeq} codici: quelli già assegnati non cambiano, i nuovi useranno il nuovo prefisso (chi usa Claude vedrà due prefissi).`);
  }
  if (changes.some((c) => c.campo === "slug")) {
    warnings.push("Lo slug cambia l'indirizzo del connettore: l'Owner deve rimuovere e riaggiungere il connettore in Claude.");
  }
  return { create: false, changes, unchanged, warnings, fields: toWrite };
}

export const INSERT_CONFIG_SQL = `INSERT INTO workspace_connector_configs
  (workspace_id, slug, code_prefix, workspace_display_name, identity_mode, auth_mode, allowed_domains, allowed_origins, limits, enabled, next_code_seq)
VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, false, 0)
ON CONFLICT (workspace_id) DO NOTHING
RETURNING workspace_id::text AS workspace_id`;

/** L'UPDATE dei soli campi che cambiano, se la riga è ancora quella letta (nessuna scrittura nel frattempo). */
export function updateConfigStatement(workspaceId: string, current: ConfigRow, fields: readonly DesiredField[]): AdminStatement {
  const params: unknown[] = [workspaceId];
  const sets: string[] = [];
  const guards: string[] = [];
  for (const f of fields) {
    params.push(f.cast ? JSON.stringify(f.value) : f.value);
    sets.push(`${f.column} = $${params.length}${f.cast}`);
    const before = currentValue(current, f.field);
    params.push(f.cast ? JSON.stringify(f.field === "limits" ? current.limits : before) : before);
    guards.push(`${f.column} IS NOT DISTINCT FROM $${params.length}${f.cast}`);
  }
  return {
    text: `UPDATE workspace_connector_configs SET ${sets.join(", ")}, updated_at = now()
 WHERE workspace_id = $1::uuid AND ${guards.join(" AND ")}
RETURNING workspace_id::text AS workspace_id`,
    params,
  };
}

export const SLUG_OWNER_SQL = `SELECT workspace_id::text AS workspace_id FROM workspace_connector_configs WHERE slug = $1 AND workspace_id <> $2::uuid`;

export const command: AdminCommand = {
  name: "config",
  options: { values: ["file"], flags: ["overwrite"] },
  async run(ctx) {
    await requireSchema(ctx.db);
    const path = ctx.value("file");
    if (!path) throw new AdminStop("file", "Serve --file <config.json> (per un cliente un *.private.json fuori da git).");
    const parsed = connectorConfigFileSchema.safeParse(ctx.readJsonFile(path));
    if (!parsed.success) {
      const problems = parsed.error.issues.slice(0, 20).map((i) => `${i.path.map(String).join(".") || "file"}: ${i.code === "custom" || i.code === "invalid_format" || i.code === "invalid_value" ? i.message : "valore non valido."}`);
      return stopped({ status: "ERROR", code: "file", message: "Il file della configurazione non è valido.", problems });
    }
    const file = parsed.data;
    const workspace = await readWorkspace(ctx.db, ctx.workspaceId);
    const owner = await ctx.db.read(SLUG_OWNER_SQL, [file.slug, ctx.workspaceId]);
    if (owner.length) throw new AdminStop("slug", `Lo slug «${file.slug}» è già di un altro workspace.`, { altroWorkspace: String(owner[0].workspace_id) });
    const current = await readConfigRow(ctx.db, ctx.workspaceId);
    const plan = planConfig(file, current);
    const report = {
      workspace: { id: workspace.id, nome: workspace.name },
      riga: plan.create ? "nuova (spenta)" : "esistente",
      differenze: plan.changes,
      invariati: plan.unchanged,
      avvisi: plan.warnings,
    };
    const changesNeedingOverwrite = plan.changes.filter((c) => c.tipo === "cambia").map((c) => c.campo);
    if (!plan.create && plan.changes.length === 0) {
      return done({ status: "NOTHING_TO_DO", message: "La riga ha già questi valori.", ...report, prontezza: await readiness(ctx.db, ctx.workspaceId, current!) });
    }
    if (!ctx.apply) {
      const overwriteNote = changesNeedingOverwrite.length
        ? ` Per cambiare valori già scritti (${changesNeedingOverwrite.join(", ")}) serve anche --overwrite.`
        : "";
      return done({ status: "DRY_RUN", message: `${DRY_RUN_NOTE}${overwriteNote}`, ...report, ...(current ? { prontezza: await readiness(ctx.db, ctx.workspaceId, current) } : {}) });
    }
    if (changesNeedingOverwrite.length && !ctx.flag("overwrite")) {
      throw new AdminStop("overwrite", `Valori già scritti e diversi (${changesNeedingOverwrite.join(", ")}): rivedi la prova a secco e aggiungi --overwrite per cambiarli.`, { campi: changesNeedingOverwrite });
    }
    ctx.print({ status: "PLAN", command: ctx.command, ...report });
    if (plan.create) {
      const v = Object.fromEntries(plan.fields.map((f) => [f.field, f.value]));
      const [inserted = []] = await ctx.db.write([
        {
          text: INSERT_CONFIG_SQL,
          params: [
            ctx.workspaceId,
            v.slug,
            v.codePrefix,
            v.workspaceDisplayName,
            v.identityMode,
            v.authMode,
            JSON.stringify(v.allowedDomains),
            JSON.stringify(v.allowedOrigins),
            JSON.stringify(v.limits),
          ],
        },
      ]);
      if (inserted.length === 0) throw new AdminStop("concorrenza", "La riga è nata nel frattempo: rilancia a secco.");
    } else {
      const [updated = []] = await ctx.db.write([updateConfigStatement(ctx.workspaceId, current!, plan.fields)]);
      if (updated.length === 0) throw new AdminStop("concorrenza", "La riga è cambiata nel frattempo: rilancia a secco.");
    }
    const after = await readConfigRow(ctx.db, ctx.workspaceId);
    return done({
      status: "APPLIED",
      message: plan.create ? "Riga creata, spenta: si accende dalla scheda «Connettore Claude» quando guida, profilo e token sono pronti." : `${plan.changes.length} campi aggiornati.`,
      differenze: plan.changes,
      ...(after ? { prontezza: await readiness(ctx.db, ctx.workspaceId, after) } : {}),
    });
  },
};
