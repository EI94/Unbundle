/**
 * `use-case-admin factory-import` (rilascio 8.0a, docs/rilascio-8/RILASCIO-8.0-PIANO.md §2): porta in Unbundle
 * l'impostazione di un caso fatta a mano nella settimana zero, dal repository della famiglia
 * (`casi/<id>/progetto/PROGETTO.md`, `progetto/decisioni.md`, `unbundle/`): il progetto approvato come versione
 * 1, le sue decisioni, e il pacchetto fatto a mano come k1 («importato»).
 *
 * - Solo uno use case senza progetto e senza pacchetto: se ce n'è già uno, il comando non scrive niente.
 * - Tutto in una transazione; nessun nome di persona: chi ha deciso è il suo ruolo («responsabile del caso»,
 *   «Lateral Space»), come nei file.
 * - Le righe di `PROGETTO.md` che non si leggono fermano il comando: mai un progetto a metà.
 *
 * Modulo puro (letture, piano e istruzioni); il comando sta in `scripts/use-case-admin/factory-import.ts`.
 */
import {
  FACTORY_FRAMEWORKS,
  FACTORY_LIMITS,
  PACKAGE_FILES,
  SETUP_TOPICS,
  SETUP_TOPIC_LABELS,
  type FactoryFramework,
  type PackageFile,
  type ProjectNewTool,
  type ProjectTopics,
  type SetupTopic,
} from "../../db/use-case-hub-factory-ddl.ts";
import { givenNames, nameTokens, packageFilesHash, redact } from "../factory/package.ts";
import { AdminStop, type AdminOptionSpec } from "./cli.ts";

export const FACTORY_IMPORT_OPTIONS: AdminOptionSpec = { values: ["use-case", "from"] };

export const FACTORY_IMPORT_SCHEMA_SQL = `SELECT (to_regclass('public.use_case_projects') IS NOT NULL AND to_regclass('public.use_case_packages') IS NOT NULL AND to_regclass('public.use_case_decisions') IS NOT NULL) AS ok`;
export const FACTORY_IMPORT_SCHEMA_MESSAGE = "Manca la 0030 (Agent Factory): arriva con il deploy della 8.0a, che la applica da sé.";

export interface ParsedProject {
  approvedOn: string;
  aiBoardOn: string | null;
  aiBoardNote: string | null;
  standardVersion: string | null;
  catalogVersion: string | null;
  topics: ProjectTopics;
  framework: FactoryFramework | null;
  newTools: ProjectNewTool[];
  estimateHours: number | null;
  monthlyCostEur: number | null;
}

export interface ParsedDecision {
  decidedOn: string;
  topicKey: SetupTopic | null;
  topic: string;
  choice: string;
  reason: string | null;
  rejected: string | null;
  authorRole: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const dash = (text: string | undefined) => {
  const t = (text ?? "").trim();
  return !t || t === "—" || t === "-" ? null : t;
};

function frontmatter(text: string): Record<string, string> {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!m) throw new AdminStop("progetto", "PROGETTO.md senza intestazione (---).");
  const out: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line.trim());
    if (kv) out[kv[1]] = kv[2].replace(/^"(.*)"$/, "$1").trim();
  }
  return out;
}

/** «1.200» è milleduecento, «1,5» uno e mezzo. Un numero che non si legge è null. */
export function italianNumber(text: string): number | null {
  const n = Number(text.replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

const LABEL_TO_TOPIC = new Map<string, SetupTopic>(SETUP_TOPICS.map((t) => [SETUP_TOPIC_LABELS[t].toLowerCase(), t]));

/** Il progetto approvato da `PROGETTO.md`: l'intestazione, la tabella dei 10 argomenti, stima e strumenti nuovi. */
export function parseProjectMarkdown(text: string): ParsedProject {
  const fm = frontmatter(text);
  if (fm.stato !== "approvato") throw new AdminStop("progetto", `Il progetto non è approvato (stato: ${fm.stato ?? "assente"}): si importa solo un progetto approvato.`);
  const approvedOn = fm.approvato_il ?? "";
  if (!DAY.test(approvedOn)) throw new AdminStop("progetto", "Manca approvato_il (AAAA-MM-GG) nell'intestazione.");
  const topics: ProjectTopics = {};
  const rows = text.split("\n").filter((line) => /^\|\s*\d+\s*\|/.test(line));
  for (const row of rows) {
    const cells = row.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 5) throw new AdminStop("progetto", `Una riga della tabella non ha 5 colonne: ${clip(row, 60)}`);
    const topic = LABEL_TO_TOPIC.get(cells[1].toLowerCase());
    if (!topic) throw new AdminStop("progetto", `Argomento sconosciuto nella tabella: ${clip(cells[1], 40)}`);
    if (!cells[2]) throw new AdminStop("progetto", `${SETUP_TOPIC_LABELS[topic]}: manca la scelta.`);
    topics[topic] = { scelta: clip(cells[2], FACTORY_LIMITS.choice), perche: dash(cells[3]) ? clip(cells[3], FACTORY_LIMITS.reason) : null, alternativa: dash(cells[4]) ? clip(cells[4], FACTORY_LIMITS.rejected) : null };
  }
  const missing = SETUP_TOPICS.filter((t) => !topics[t]);
  if (missing.length) throw new AdminStop("progetto", `Mancano argomenti nella tabella: ${missing.map((t) => SETUP_TOPIC_LABELS[t]).join(", ")}.`);
  const fwText = (topics.framework?.scelta ?? "").toLowerCase();
  const framework = FACTORY_FRAMEWORKS.find((f) => fwText.startsWith(f.replace("_", " ")) || fwText.startsWith(f)) ?? null;
  const hours = /\*\*Costruzione:\*\*\s*circa\s*([\d.,]+)\s*ore/i.exec(text);
  const cost = /\*\*Esercizio al mese:\*\*\s*circa\s*([\d.,]+)\s*€/i.exec(text);
  // Gli strumenti nuovi: i nomi tra parentesi in `ai_board` («approvato (Neon, Langfuse) …»), con il perché dalla
  // sezione «Strumenti nuovi per il cliente» («Neon Postgres in UE (database del caso)»).
  // Solo con «ai_board: approvato (…)»: «non serve (…)» o altro non porta strumenti nuovi.
  const approvedTools = /^approvato\b/i.test(fm.ai_board ?? "");
  const names = approvedTools ? (/\(([^)]+)\)/.exec(fm.ai_board ?? "")?.[1].split(",").map((n) => n.trim()).filter(Boolean) ?? []) : [];
  const section = /## Strumenti nuovi per il cliente\n([\s\S]*?)(\n## |$)/.exec(text)?.[1] ?? "";
  const newTools = names.slice(0, FACTORY_LIMITS.newToolsMax).map((nome) => {
    const why = new RegExp(`${nome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^()]*\\(([^)]+)\\)`).exec(section)?.[1] ?? null;
    return { nome: clip(nome, 80), perche: why ? clip(why.trim(), 300) : null };
  });
  const aiBoardOn = DAY.test(fm.ai_board_il ?? "") ? fm.ai_board_il : null;
  if (newTools.length && !aiBoardOn) throw new AdminStop("progetto", "Ci sono strumenti nuovi ma manca ai_board_il: senza l'ok dell'AI Board il progetto non risulta approvato.");
  return {
    approvedOn,
    aiBoardOn,
    aiBoardNote: newTools.length && fm.ai_board ? clip(`Dal progetto: ai_board «${fm.ai_board}», il ${aiBoardOn}.`, FACTORY_LIMITS.aiBoardNote) : null,
    standardVersion: /^[0-9][0-9a-z.]{0,9}$/.test(fm.standard ?? "") ? fm.standard : null,
    catalogVersion: /^[0-9][0-9a-z.]{0,9}$/.test(fm.catalogo ?? "") ? fm.catalogo : null,
    topics,
    framework,
    newTools,
    estimateHours: hours ? italianNumber(hours[1]) : null,
    monthlyCostEur: cost ? italianNumber(cost[1]) : null,
  };
}

/** Le decisioni da `decisioni.md`: «- AAAA-MM-GG · argomento · scelta · perché · alternativa scartata · chi». */
export function parseDecisions(text: string): ParsedDecision[] {
  const out: ParsedDecision[] = [];
  for (const line of text.split("\n")) {
    const m = /^- (\d{4}-\d{2}-\d{2}) · (.+)$/.exec(line.trim());
    if (!m) continue;
    const parts = m[2].split(" · ").map((p) => p.trim());
    if (parts.length < 5) throw new AdminStop("decisioni", `Una decisione non ha i suoi campi: ${clip(line, 60)}`);
    const [topic, choice, reason, rejected, ...who] = parts;
    out.push({
      decidedOn: m[1],
      topicKey: LABEL_TO_TOPIC.get(topic.toLowerCase()) ?? null,
      topic: clip(topic, FACTORY_LIMITS.topic),
      choice: clip(choice, FACTORY_LIMITS.choice),
      reason: dash(reason) ? clip(reason, FACTORY_LIMITS.reason) : null,
      rejected: dash(rejected) ? clip(rejected, FACTORY_LIMITS.rejected) : null,
      authorRole: clip((who.join(" · ") || "Lateral Space").replace(/\s*\(bozza\)\s*$/, ""), FACTORY_LIMITS.authorRole),
    });
  }
  return out;
}

/** I tre file del pacchetto fatto a mano, come stringhe; si ferma se ne manca uno. */
export function packageFromFiles(read: (name: PackageFile) => string | null): Record<PackageFile, string> {
  const out = {} as Record<PackageFile, string>;
  for (const name of PACKAGE_FILES) {
    const text = read(name);
    if (text === null) throw new AdminStop("pacchetto", `Manca unbundle/${name}.`);
    out[name] = text;
  }
  if (Buffer.byteLength(JSON.stringify(out), "utf8") > FACTORY_LIMITS.packageBytesMax) throw new AdminStop("pacchetto", "Il pacchetto supera i 200 KB.");
  return out;
}

export interface FactoryImportStatement {
  text: string;
  params: readonly unknown[];
}

/** Le letture prima del piano: lo use case con il suo codice, e se ha già progetto o pacchetto. */
export function factoryImportReads(workspaceId: string, code: string) {
  return {
    useCase: { text: `SELECT id, title FROM use_cases WHERE workspace_id = $1::uuid AND code = $2`, params: [workspaceId, code] },
    names: {
      text: `SELECT DISTINCT x.name FROM (
  SELECT u.name FROM users u JOIN workspace_memberships wm ON wm.user_id = u.id WHERE wm.workspace_id = $1::uuid
  UNION SELECT u.name FROM users u JOIN memberships m ON m.user_id = u.id JOIN workspaces w ON w.organization_id = m.organization_id WHERE w.id = $1::uuid
  UNION SELECT c.display_name FROM uc_contacts c WHERE c.workspace_id = $1::uuid
  UNION SELECT ci.display_name FROM connector_identities ci WHERE ci.workspace_id = $1::uuid
) x WHERE x.name IS NOT NULL`,
      params: [workspaceId],
    },
    existing: (useCaseId: string) => ({
      text: `SELECT (SELECT count(*) FROM use_case_projects WHERE use_case_id = $1::uuid)::int AS projects, (SELECT count(*) FROM use_case_packages WHERE use_case_id = $1::uuid)::int AS packages, (SELECT count(*) FROM use_case_decisions WHERE use_case_id = $1::uuid)::int AS decisions`,
      params: [useCaseId],
    }),
  };
}

/**
 * Il piano: il pacchetto k1 importato, il progetto v1 approvato (con il giorno dell'approvazione, a mezzogiorno di
 * Roma, e l'ok dell'AI Board se ci sono strumenti nuovi), le decisioni. Una transazione; ogni INSERT controlla che
 * lo use case sia ancora senza progetto e senza pacchetto.
 */
export function factoryImportPlan(i: {
  workspaceId: string;
  useCaseId: string;
  project: ParsedProject;
  decisions: readonly ParsedDecision[];
  files: Record<PackageFile, string>;
  /** I nomi che Unbundle conosce nel workspace: si coprono anche nei testi importati, come nel pacchetto generato. */
  namesToHide?: readonly string[];
}) {
  const tokens = nameTokens(i.namesToHide ?? []);
  const given = givenNames(i.namesToHide ?? []);
  const cover = (text: string | null) => (text === null ? null : redact(text, tokens, given));
  const p: ParsedProject = {
    ...i.project,
    topics: Object.fromEntries(
      Object.entries(i.project.topics).map(([k, v]) => [k, v ? { scelta: cover(v.scelta)!, perche: cover(v.perche), alternativa: cover(v.alternativa) } : v]),
    ) as ProjectTopics,
    newTools: i.project.newTools.map((t) => ({ nome: t.nome, perche: cover(t.perche) })),
    aiBoardNote: cover(i.project.aiBoardNote),
  };
  const decisions = i.decisions.map((d) => ({ ...d, topic: cover(d.topic)!, choice: cover(d.choice)!, reason: cover(d.reason), rejected: cover(d.rejected), authorRole: cover(d.authorRole)! }));
  const files = Object.fromEntries(PACKAGE_FILES.map((name) => [name, cover(i.files[name])!])) as Record<PackageFile, string>;
  const noon = (day: string) => `${day}T11:00:00Z`;
  const empty = `NOT EXISTS (SELECT 1 FROM use_case_projects WHERE use_case_id = $1::uuid) AND NOT EXISTS (SELECT 1 FROM use_case_packages WHERE use_case_id = $1::uuid)`;
  const statements: FactoryImportStatement[] = [
    // Tutto o niente: se nel frattempo lo use case ha avuto un progetto, un pacchetto o una decisione, la transazione
    // si annulla qui (`uc_require`, la funzione dei dossier) e non scrive niente.
    {
      text: `SELECT uc_require(NOT EXISTS (SELECT 1 FROM use_case_projects WHERE use_case_id = $1::uuid) AND NOT EXISTS (SELECT 1 FROM use_case_packages WHERE use_case_id = $1::uuid) AND NOT EXISTS (SELECT 1 FROM use_case_decisions WHERE use_case_id = $1::uuid), 'gia_impostato') AS ok`,
      params: [i.useCaseId],
    },
    {
      text: `INSERT INTO use_case_projects (use_case_id, workspace_id, version, status, topics, framework, new_tools, estimate_hours, monthly_cost_eur, standard_version, catalog_version, package_version, submitted_at, approved_at, ai_board_ok_at, ai_board_note, created_at, updated_at)
SELECT $1::uuid, $2::uuid, 1, 'approvato', $3::jsonb, $4, $5::jsonb, $6::numeric, $7::numeric, $8, $9, 1, $10::timestamptz, $10::timestamptz, $11::timestamptz, $12, $10::timestamptz, now()
WHERE EXISTS (SELECT 1 FROM use_cases WHERE id = $1::uuid AND workspace_id = $2::uuid) AND ${empty}`,
      params: [
        i.useCaseId,
        i.workspaceId,
        JSON.stringify(p.topics),
        p.framework,
        JSON.stringify(p.newTools),
        p.estimateHours,
        p.monthlyCostEur,
        p.standardVersion,
        p.catalogVersion,
        noon(p.approvedOn),
        p.aiBoardOn ? noon(p.aiBoardOn) : null,
        p.aiBoardNote,
      ],
    },
    {
      text: `INSERT INTO use_case_packages (use_case_id, workspace_id, version, content_hash, files, source)
SELECT $1::uuid, $2::uuid, 1, $3, $4::jsonb, 'importato'
WHERE NOT EXISTS (SELECT 1 FROM use_case_packages WHERE use_case_id = $1::uuid)`,
      params: [i.useCaseId, i.workspaceId, packageFilesHash(files), JSON.stringify(files)],
    },
    ...decisions.map((d) => ({
      text: `INSERT INTO use_case_decisions (use_case_id, workspace_id, decided_on, topic_key, topic, choice, reason, rejected, source, project_version, author_role)
VALUES ($1::uuid, $2::uuid, $3::date, $4, $5, $6, $7, $8, 'importata', 1, $9)`,
      params: [i.useCaseId, i.workspaceId, d.decidedOn, d.topicKey, d.topic, d.choice, d.reason, d.rejected, d.authorRole],
    })),
  ];
  const report = {
    progetto: { versione: 1, stato: "approvato", approvatoIl: p.approvedOn, framework: p.framework, strumentiNuovi: p.newTools.map((t) => t.nome), okAiBoardIl: p.aiBoardOn, ore: p.estimateHours, euroAlMese: p.monthlyCostEur },
    argomenti: SETUP_TOPICS.filter((t) => p.topics[t]).length,
    decisioni: decisions.length,
    pacchetto: { versione: 1, fonte: "importato", byte: Buffer.byteLength(JSON.stringify(files), "utf8") },
  };
  return { statements, report };
}
