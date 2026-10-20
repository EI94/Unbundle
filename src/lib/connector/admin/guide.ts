/**
 * `connector-admin guide --workspace <id> --file <guida.json>` (prompt WP8): carica la guida
 * del workspace, validata con `guide-schema.ts`, in `workspace_connector_configs.guide` e
 * la sua versione in `guide_version` (la stessa che `get_intake_guide` e la scheda
 * «Connettore Claude» mostrano).
 *
 * Prima di scrivere:
 *  - la riga c'è (`config`) e il profilo del cliente è caricato (`profile`): aree, società,
 *    strumenti e agenti della guida devono stare negli enum del profilo, il tetto delle
 *    persone e i campi devono essere quelli pubblicati (`guideProfileMismatches`);
 *  - `workspace.esgEnabled` della guida è quello del workspace (`workspaces.esg_enabled`),
 *    che decide `missing_esg`;
 *  - una guida diversa con la stessa `guideVersion` si rifiuta: Claude rimanda la versione
 *    con l'invio e l'avviso `guide_outdated` si basa su quella.
 * La differenza si mostra per sezione (quali chiavi cambiano) e in caratteri. L'UPDATE vale
 * solo se guida e profilo sono ancora quelli letti (la coerenza si è controllata su quelli).
 *
 * Quando cambiano insieme guida e profilo (un valore degli enum tolto o rinominato, il tetto
 * delle persone, l'obbligatorietà di un campo), questo comando da solo si rifiuta, e così
 * `profile` da solo: si caricano insieme con `profile --file … --guide-file …` (`profile.ts`),
 * che usa gli stessi controlli di questo file.
 */
import { guideProfileMismatches, parseConnectorGuide, type ConnectorGuide } from "../guide-schema.ts";
import type { ContractProfile } from "../contract.ts";
import { connectorProfileFromStored } from "../profile.ts";
import { AdminStop, canonicalJson, done, DRY_RUN_NOTE, stopped, type AdminCommand } from "./cli.ts";
import { readiness, readWorkspace, requireConfigRow, requireSchema, type ConfigRow, type WorkspaceRow } from "./state.ts";

/** Le sezioni (chiavi di primo livello) che cambiano tra due guide. */
export function changedGuideSections(before: unknown, after: ConnectorGuide): { aggiunte: string[]; cambiate: string[]; tolte: string[] } {
  const old = before && typeof before === "object" && !Array.isArray(before) ? (before as Record<string, unknown>) : {};
  const next = after as unknown as Record<string, unknown>;
  const aggiunte = Object.keys(next).filter((k) => !(k in old));
  const tolte = Object.keys(old).filter((k) => !(k in next));
  const cambiate = Object.keys(next).filter((k) => k in old && canonicalJson(old[k]) !== canonicalJson(next[k]));
  return { aggiunte, cambiate, tolte };
}

/** Il comando che carica guida e profilo insieme, da suggerire quando cambiano entrambi. */
export const PROFILE_WITH_GUIDE_HINT = "connector-admin profile --file <profilo.json> --guide-file <guida.json>";

/** Dove la guida non è coerente con un profilo e con il workspace (vuoto se è coerente). */
export function guideMismatches(guide: ConnectorGuide, contract: ContractProfile, workspace: WorkspaceRow): string[] {
  const mismatches = guideProfileMismatches(guide, contract);
  if (guide.workspace.esgEnabled !== workspace.esgEnabled) {
    mismatches.push(`workspace.esgEnabled: ${guide.workspace.esgEnabled}, ma il workspace ha esg_enabled ${workspace.esgEnabled}.`);
  }
  return mismatches;
}

/** La guida salvata è già questa (stesso contenuto, chiavi in qualunque ordine, stessa versione). */
export function isSavedGuide(row: ConfigRow, guide: ConnectorGuide): boolean {
  return canonicalJson(row.guide) === canonicalJson(guide) && row.guideVersion === guide.guideVersion;
}

/** Si ferma se la guida cambia ma la versione resta quella salvata. */
export function requireNewGuideVersion(row: ConfigRow, guide: ConnectorGuide): void {
  if (row.guide && canonicalJson(row.guide) !== canonicalJson(guide) && row.guideVersion === guide.guideVersion) {
    throw new AdminStop("versione", `La guida cambia ma la versione resta ${guide.guideVersion}: alza guideVersion.`);
  }
}

/** La differenza tra la guida salvata e quella nuova, senza testi. */
export function guideReport(row: ConfigRow, guide: ConnectorGuide, servedChars: number): Record<string, unknown> {
  return {
    versione: { attuale: row.guideVersion, nuova: guide.guideVersion },
    sezioni: changedGuideSections(row.guide, guide),
    caratteri: { attuali: row.guide ? JSON.stringify(row.guide).length : 0, nuovi: JSON.stringify(guide).length, rispostaGetIntakeGuide: servedChars },
    agenti: guide.agentCatalog.length,
  };
}

export const UPDATE_GUIDE_SQL = `UPDATE workspace_connector_configs
   SET guide = $2::jsonb, guide_version = $3, updated_at = now()
 WHERE workspace_id = $1::uuid
   AND md5(coalesce(guide::text, '')) = $4
   AND md5(coalesce(profile::text, '')) = $5
RETURNING workspace_id::text AS workspace_id`;

export const command: AdminCommand = {
  name: "guide",
  options: { values: ["file"] },
  async run(ctx) {
    await requireSchema(ctx.db);
    const path = ctx.value("file");
    if (!path) throw new AdminStop("file", "Serve --file <guida.json> (per un cliente un *.private.json fuori da git).");
    const parsed = parseConnectorGuide(ctx.readJsonFile(path));
    if (!parsed.ok) return stopped({ status: "ERROR", code: "guida", message: "La guida non è valida.", problems: parsed.problems });
    const guide = parsed.guide;
    const workspace = await readWorkspace(ctx.db, ctx.workspaceId);
    const row = await requireConfigRow(ctx.db, ctx.workspaceId);
    const profile = connectorProfileFromStored(row.profile);
    if (!profile.ok) {
      throw new AdminStop("profilo_mancante", "Prima connector-admin profile: senza il profilo del cliente non si controllano aree, strumenti e agenti della guida.");
    }
    const mismatches = guideMismatches(guide, profile.profile.contract, workspace);
    if (mismatches.length) {
      return stopped({
        status: "ERROR",
        code: "guida_profilo",
        message: `La guida non è coerente con il profilo del cliente salvato o con il workspace (elenco sotto). Se deve cambiare anche il profilo, caricali insieme: ${PROFILE_WITH_GUIDE_HINT}.`,
        problems: mismatches,
      });
    }

    if (isSavedGuide(row, guide)) {
      return done({ status: "NOTHING_TO_DO", message: "La guida salvata è già questa.", versione: guide.guideVersion, prontezza: await readiness(ctx.db, ctx.workspaceId, row) });
    }
    requireNewGuideVersion(row, guide);
    const report = { workspace: { id: workspace.id, nome: workspace.name }, ...guideReport(row, guide, parsed.servedChars) };
    if (!ctx.apply) return done({ status: "DRY_RUN", message: DRY_RUN_NOTE, ...report, prontezza: await readiness(ctx.db, ctx.workspaceId, row) });
    ctx.print({ status: "PLAN", command: ctx.command, ...report });
    const [updated = []] = await ctx.db.write([
      { text: UPDATE_GUIDE_SQL, params: [ctx.workspaceId, JSON.stringify(guide), guide.guideVersion, row.guideMd5, row.profileMd5] },
    ]);
    if (updated.length === 0) throw new AdminStop("concorrenza", "Guida o profilo sono cambiati nel frattempo: rilancia a secco.");
    const after = await requireConfigRow(ctx.db, ctx.workspaceId);
    return done({ status: "APPLIED", message: `Guida ${guide.guideVersion} caricata.`, versione: guide.guideVersion, prontezza: await readiness(ctx.db, ctx.workspaceId, after) });
  },
};
