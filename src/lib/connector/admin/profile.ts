/**
 * `connector-admin profile --workspace <id> --file <profilo.json> [--guide-file <guida.json>]`
 * (decisione 1 dell'arresto B, pacchetto K8): carica il profilo del cliente (enum e
 * descrizioni del contratto, titolo e descrizione dei 4 tool, riga «fuori Foundation») in
 * `workspace_connector_configs.profile` e il modello delle istruzioni del server in
 * `instructions_template`. Il file (`*.private.json`, fuori da git) è
 * `{ contract, tools, reviewNotes, instructionsTemplate }` (`parseConnectorProfileFile`).
 *
 * Prima di scrivere, se la guida è già caricata e segue lo schema, deve restare coerente
 * con il profilo nuovo (un valore tolto dal profilo che la guida usa ancora si rifiuta). La
 * differenza dice quali valori degli enum entrano ed escono, quali testi cambiano e di
 * quante righe cambia il modello delle istruzioni.
 *
 * Con `--guide-file` carica nello stesso UPDATE anche la guida, controllata contro il profilo
 * **nuovo** con le regole di `guide` (schema, enum, tetto delle persone, campi, ESG del
 * workspace, `guideVersion` da alzare se il contenuto cambia). Serve quando cambiano insieme
 * (un valore tolto o rinominato, `beneficiariesMax`, l'obbligatorietà di un campo): `guide` da
 * solo si confronta con il profilo salvato e `profile` da solo con la guida salvata, quindi
 * ognuno dei due rifiuterebbe. L'UPDATE vale solo se profilo, modello e guida sono ancora
 * quelli letti (tre md5).
 */
import { CONNECTOR_TOOL_NAMES, type ContractProfile } from "../contract.ts";
import { guideProfileMismatches, parseConnectorGuide, type GuideParseResult } from "../guide-schema.ts";
import { connectorProfileFromStored, parseConnectorProfileFile, storedConnectorProfile, type ConnectorProfile } from "../profile.ts";
import { AdminStop, canonicalJson, done, DRY_RUN_NOTE, stopped, type AdminCommand } from "./cli.ts";
import { guideMismatches, guideReport, isSavedGuide, PROFILE_WITH_GUIDE_HINT, requireNewGuideVersion } from "./guide.ts";
import { readiness, readWorkspace, requireConfigRow, requireSchema } from "./state.ts";

type ListKey = "areas" | "companies" | "tools" | "agents";

/** Le differenze tra il profilo salvato e quello nuovo (nessun testo, solo valori degli enum e nomi). */
export function profileDiff(
  before: ConnectorProfile | null,
  after: ConnectorProfile,
  templates: { before: string | null; after: string }
): Record<string, unknown> {
  const lists: Record<string, { entrano: string[]; escono: string[] }> = {};
  for (const key of ["areas", "companies", "tools", "agents"] as const satisfies readonly ListKey[]) {
    const old: readonly string[] = before?.contract[key] ?? [];
    const next: readonly string[] = after.contract[key];
    const entrano = next.filter((v) => !old.includes(v));
    const escono = old.filter((v) => !next.includes(v));
    if (entrano.length || escono.length) lists[key] = { entrano, escono };
  }
  const descriptions = (p: ContractProfile | undefined) => p?.descriptions ?? {};
  const oldDescriptions = descriptions(before?.contract) as Record<string, string>;
  const newDescriptions = descriptions(after.contract) as Record<string, string>;
  const descrizioniCambiate = [...new Set([...Object.keys(oldDescriptions), ...Object.keys(newDescriptions)])]
    .filter((key) => oldDescriptions[key] !== newDescriptions[key])
    .sort();
  const testiDeiTool = CONNECTOR_TOOL_NAMES.filter(
    (name) => !before || before.tools[name].title !== after.tools[name].title || before.tools[name].description !== after.tools[name].description
  );
  const oldLines = templates.before?.split("\n") ?? [];
  const newLines = templates.after.split("\n");
  return {
    enum: lists,
    beneficiariesMax: before?.contract.beneficiariesMax === after.contract.beneficiariesMax ? "invariato" : { attuale: before?.contract.beneficiariesMax ?? null, nuovo: after.contract.beneficiariesMax },
    descrizioniCambiate,
    testiDeiTool,
    rigaFuoriFoundation: before?.outsideFoundationNote === after.outsideFoundationNote ? "invariata" : before ? "cambia" : "nuova",
    istruzioni:
      templates.before === templates.after
        ? "invariate"
        : {
            righeNuove: newLines.filter((line) => !oldLines.includes(line)).length,
            righeTolte: oldLines.filter((line) => !newLines.includes(line)).length,
            caratteri: { attuali: templates.before?.length ?? 0, nuovi: templates.after.length },
          },
  };
}

/** Solo profilo e modello; vale se la guida, con cui si è controllata la coerenza, è ancora quella letta. */
export const UPDATE_PROFILE_SQL = `UPDATE workspace_connector_configs
   SET profile = $2::jsonb, instructions_template = $3, updated_at = now()
 WHERE workspace_id = $1::uuid
   AND md5(coalesce(profile::text, '')) = $4
   AND md5(coalesce(instructions_template, '')) = $5
   AND md5(coalesce(guide::text, '')) = $6
RETURNING workspace_id::text AS workspace_id`;

/** Profilo, modello e guida insieme (`--guide-file`), con le tre righe lette come condizione. */
export const UPDATE_PROFILE_AND_GUIDE_SQL = `UPDATE workspace_connector_configs
   SET profile = $2::jsonb, instructions_template = $3, guide = $4::jsonb, guide_version = $5, updated_at = now()
 WHERE workspace_id = $1::uuid
   AND md5(coalesce(profile::text, '')) = $6
   AND md5(coalesce(instructions_template, '')) = $7
   AND md5(coalesce(guide::text, '')) = $8
RETURNING workspace_id::text AS workspace_id`;

export const command: AdminCommand = {
  name: "profile",
  options: { values: ["file", "guide-file"] },
  async run(ctx) {
    await requireSchema(ctx.db);
    const path = ctx.value("file");
    if (!path) throw new AdminStop("file", "Serve --file <profilo.json> (un *.private.json fuori da git).");
    const file = parseConnectorProfileFile(ctx.readJsonFile(path));
    if (!file.ok) return stopped({ status: "ERROR", code: "profilo", message: "Il file del profilo non è valido.", campi: file.fieldErrors });
    const guidePath = ctx.value("guide-file");
    let newGuide: Extract<GuideParseResult, { ok: true }> | null = null;
    if (guidePath) {
      const parsed = parseConnectorGuide(ctx.readJsonFile(guidePath));
      if (!parsed.ok) return stopped({ status: "ERROR", code: "guida", message: "La guida di --guide-file non è valida.", problems: parsed.problems });
      newGuide = parsed;
    }
    const workspace = await readWorkspace(ctx.db, ctx.workspaceId);
    const row = await requireConfigRow(ctx.db, ctx.workspaceId);
    const stored = storedConnectorProfile(file.profile);
    const current = connectorProfileFromStored(row.profile);

    const warnings: string[] = [];
    if (newGuide) {
      // La guida nuova si controlla contro il profilo nuovo, come farebbe `guide` dopo.
      const mismatches = guideMismatches(newGuide.guide, file.profile.contract, workspace);
      if (mismatches.length) {
        return stopped({ status: "ERROR", code: "guida_profilo", message: "La guida di --guide-file non è coerente con il profilo nuovo o con il workspace (elenco sotto).", problems: mismatches });
      }
      requireNewGuideVersion(row, newGuide.guide);
    } else if (row.guide) {
      const saved = parseConnectorGuide(row.guide);
      if (saved.ok) {
        const mismatches = guideProfileMismatches(saved.guide, file.profile.contract);
        if (mismatches.length) {
          return stopped({
            status: "ERROR",
            code: "guida_profilo",
            message:
              `La guida salvata usa valori o limiti che il nuovo profilo toglie o cambia (elenco sotto), e da soli né profile né guide si possono caricare. ` +
              `Caricali insieme: ${PROFILE_WITH_GUIDE_HINT}, con una guida coerente con il profilo nuovo e una guideVersion nuova.`,
            problems: mismatches,
          });
        }
      } else {
        warnings.push("La guida salvata non segue lo schema della guida: ricaricala (connector-admin guide, oppure qui con --guide-file).");
      }
    }
    const sameProfile = canonicalJson(row.profile) === canonicalJson(stored) && row.instructionsTemplate === file.instructionsTemplate;
    const guideChanges = newGuide !== null && !isSavedGuide(row, newGuide.guide);
    if (sameProfile && !guideChanges) {
      const message = newGuide ? "Profilo, modello delle istruzioni e guida sono già questi." : "Profilo e modello delle istruzioni sono già questi.";
      return done({ status: "NOTHING_TO_DO", message, prontezza: await readiness(ctx.db, ctx.workspaceId, row) });
    }
    const report = {
      workspace: { id: workspace.id, nome: workspace.name },
      profilo: sameProfile ? "invariato" : current.ok ? "da aggiornare" : row.profile ? "da sostituire (quello salvato non è valido)" : "nuovo",
      differenze: profileDiff(current.ok ? current.profile : null, file.profile, { before: row.instructionsTemplate, after: file.instructionsTemplate }),
      ...(newGuide ? { guida: guideChanges ? guideReport(row, newGuide.guide, newGuide.servedChars) : "invariata" } : {}),
      avvisi: [
        ...warnings,
        "Claude e Cowork possono tenere in cache tools/list: titoli, descrizioni ed enum nuovi si vedono dalla connessione successiva.",
      ],
    };
    if (!ctx.apply) return done({ status: "DRY_RUN", message: DRY_RUN_NOTE, ...report, prontezza: await readiness(ctx.db, ctx.workspaceId, row) });
    ctx.print({ status: "PLAN", command: ctx.command, ...report });
    const statement =
      newGuide && guideChanges
        ? {
            text: UPDATE_PROFILE_AND_GUIDE_SQL,
            params: [
              ctx.workspaceId,
              JSON.stringify(stored),
              file.instructionsTemplate,
              JSON.stringify(newGuide.guide),
              newGuide.guide.guideVersion,
              row.profileMd5,
              row.templateMd5,
              row.guideMd5,
            ],
          }
        : { text: UPDATE_PROFILE_SQL, params: [ctx.workspaceId, JSON.stringify(stored), file.instructionsTemplate, row.profileMd5, row.templateMd5, row.guideMd5] };
    const [updated = []] = await ctx.db.write([statement]);
    if (updated.length === 0) throw new AdminStop("concorrenza", "Profilo, modello o guida sono cambiati nel frattempo: rilancia a secco.");
    const after = await requireConfigRow(ctx.db, ctx.workspaceId);
    const message =
      newGuide && guideChanges
        ? `Profilo del cliente, modello delle istruzioni e guida ${newGuide.guide.guideVersion} caricati insieme.`
        : "Profilo del cliente e modello delle istruzioni caricati.";
    return done({ status: "APPLIED", message, prontezza: await readiness(ctx.db, ctx.workspaceId, after) });
  },
};
