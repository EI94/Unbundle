/**
 * Skill «segnala-caso-uso» e plugin del connettore (prompt WP9, pacchetto K9): controlli e
 * costruzione dei tre pacchetti. Lo usano `scripts/connector-package.mjs` e i test.
 *
 * Cosa c'è nel repository (nessun valore del cliente):
 *  - `skills/segnala-caso-uso/SKILL.md`: la skill, generica. Rubrica, aree, agenti e regole
 *    dell'organizzazione arrivano a runtime da `get_intake_guide`;
 *  - `plugins/unbundle-organizzazione/`: il plugin modello, con il manifest
 *    (`.claude-plugin/plugin.json`) e la stessa skill, senza `.mcp.json` (fase 1).
 *
 * Cosa nasce solo nei pacchetti, fuori da git: il nome del plugin del cliente (per esempio
 * `unbundle-<cliente>`), il nome visualizzato e lo slug del connettore, da un file di
 * configurazione `*.private.json` (forma in `packageConfigSchema`); e la variante di prova
 * con `.mcp.json`, generato qui dall'indirizzo pubblico del connettore.
 *
 * Formato del manifest e dello zip verificato il 19/10/2026 sulla documentazione di Claude
 * (code.claude.com/docs/en/plugins-reference, claude.com/docs/plugins/build,
 * claude.com/docs/skills/how-to, agentskills.io/specification): vedi
 * `docs/connettore/README.md`, «Skill e plugin».
 *
 * Modulo puro (zod e moduli puri del connettore), nessun accesso ai file.
 */
import { z } from "zod";
import { CONNECTOR_ERROR_CODES, CONNECTOR_TOOL_NAMES, GUIDE_OUTDATED_MESSAGE, type ConnectorWarningCode } from "../contract.ts";
import { CONNECTOR_SLUG_PATTERN } from "../config.ts";
import { findSensitiveKinds, HEALTH_WARNING_OPENING, hasProperNameHint, NAMES_WARNING_OPENING } from "../sensitive-content.ts";
import { connectorPublicUrl } from "../settings-view.ts";

export const SKILL_NAME = "segnala-caso-uso";
/** Cartella della skill nel repository (e al primo livello dello zip della skill). */
export const SKILL_SOURCE_PATH = `skills/${SKILL_NAME}/SKILL.md`;
/** Plugin modello nel repository: nome neutro, il nome del cliente nasce solo nel pacchetto. */
export const PLUGIN_TEMPLATE_DIR = "plugins/unbundle-organizzazione";
export const PLUGIN_MANIFEST_PATH = ".claude-plugin/plugin.json";
export const PLUGIN_SKILL_PATH = `skills/${SKILL_NAME}/SKILL.md`;
export const PLUGIN_MCP_PATH = ".mcp.json";
/** Nome del server nel `.mcp.json` della variante di prova: lo stesso nome del connettore. */
export const CONNECTOR_SERVER_NAME = "Unbundle";
/** I tool come li cita la skill: nome completo con il prefisso del connettore. */
export const SKILL_TOOL_REFERENCES = CONNECTOR_TOOL_NAMES.map((name) => `${CONNECTOR_SERVER_NAME}:${name}`);

/** Limiti delle skill (Agent Skills e Claude): nome 64, descrizione 1.024, file sotto 500 righe. */
export const SKILL_LIMITS = Object.freeze({ nameMax: 64, descriptionMax: 1024, linesMax: 499 });

/** Frasi d'innesco della descrizione (contratto, `distribuzione_skill`). */
export const SKILL_TRIGGER_PHRASES = [
  "voglio proporre un caso d'uso",
  "ho un'idea per usare l'AI",
  "segnala questa idea",
  "ho una best practice",
  "questa cosa la potrebbero usare anche i colleghi",
  "si potrebbe automatizzare",
  "a che punto è la mia proposta",
  "non nomina l'AI",
] as const;

/** Parole della skill di partenza che la skill nuova non deve più avere (prompt WP9). */
export const SKILL_REMOVED_TERMS = ["Notion", "Benefit Unit", "Solution"] as const;

/** Segni della modalità senza connettore (prompt WP9). */
export const NO_CONNECTOR_MARKERS = [
  "## Modalità senza connettore",
  "connector_disabled",
  "submit_failed",
  "internal_error",
  "NON ANCORA INVIATA",
  "referente Lateral Space",
  "Customize > Connectors",
] as const;

/**
 * Prime parole dei tre avvisi di `submit_contribution`, come la skill le cita nel Passo 8:
 * `warnings` è un elenco di frasi, senza codici.
 */
export const SUBMIT_WARNING_OPENINGS = [
  GUIDE_OUTDATED_MESSAGE.slice(0, GUIDE_OUTDATED_MESSAGE.indexOf(":")),
  HEALTH_WARNING_OPENING,
  NAMES_WARNING_OPENING,
] as const;

/** Codici degli avvisi: restano nel server, la skill non deve cercarli. */
const SUBMIT_WARNING_CODES: readonly ConnectorWarningCode[] = ["guide_outdated", "health_terms", "proper_names"];

/** Cosa deve dire la correzione dopo un avviso su dati sanitari o nomi (contratto, `submit_contribution`). */
export const WARNING_CORRECTION_MARKERS = ["nuovo sì", "chiave nuova", "`relatedCode` = il codice appena ricevuto", "`relationType` = `integra`"] as const;

/** Problemi della gestione di `warnings` nel Passo 8. */
export function warningsHandlingProblems(body: string): string[] {
  const problems: string[] = [];
  const bullet = /^- `warnings` non vuoto[\s\S]*?(?=\n\n|(?![\s\S]))/m.exec(body)?.[0];
  if (!bullet) return ["Passo 8: manca la gestione di `warnings`."];
  for (const opening of SUBMIT_WARNING_OPENINGS) {
    if (!bullet.includes(`«${opening}…»`)) problems.push(`Passo 8: manca l'avviso «${opening}…».`);
  }
  for (const marker of WARNING_CORRECTION_MARKERS) {
    if (!bullet.includes(marker)) problems.push(`Passo 8: la correzione dopo un avviso deve dire ${marker}.`);
  }
  for (const code of SUBMIT_WARNING_CODES) {
    if (body.includes(code)) problems.push(`Passo 8: gli avvisi arrivano come frasi, senza il codice ${code}.`);
  }
  return problems;
}

// ─── Frontmatter della skill ────────────────────────────────────────────────

export interface SkillDocument {
  name: string;
  description: string;
  /** Righe del file intero (frontmatter compreso). */
  lineCount: number;
  body: string;
}

export type SkillParseResult = { ok: true; skill: SkillDocument } | { ok: false; problems: string[] };

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Valore YAML semplice su una riga: niente virgolette, blocchi, ancore, commenti, «: » o «:» finale. */
const PLAIN_SCALAR = /^(?![\s'"{}[\]&*!|>%@`#,?:-])(?!.*(?::\s|:$|\s#|\s$)).+$/;
/**
 * Valori che un parser YAML (1.1 o 1.2) legge come null, booleano, numero o data invece che
 * come testo.
 */
const NON_STRING_SCALAR =
  /^(?:~|null|true|false|yes|no|on|off|y|n|[-+]?(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:e[-+]?\d+)?|[-+]?\.(?:inf|nan)|0x[\da-f_]+|0o?[0-7_]+|0b[01_]+|\d{4}-\d\d?-\d\d?(?:[Tt\s].*)?|[-+]?\d[\d_]*(?::[0-5]?\d)+(?:\.\d*)?)$/i;

/**
 * Legge il frontmatter in modo stretto: solo `name` e `description`, una riga ciascuno,
 * valori YAML semplici (così ogni parser YAML li legge allo stesso modo).
 */
export function parseSkillMarkdown(text: string): SkillParseResult {
  const problems: string[] = [];
  const normalized = text.replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n/.exec(normalized);
  if (!match) return { ok: false, problems: ["Il file deve iniziare con il frontmatter tra due righe ---."] };
  const values = new Map<string, string>();
  for (const line of match[1].split("\n")) {
    const kv = /^([a-z-]+): (.*)$/.exec(line);
    if (!kv) {
      problems.push("Frontmatter: ogni riga deve essere «chiave: valore».");
      continue;
    }
    const [, key, value] = kv;
    if (key !== "name" && key !== "description") problems.push(`Frontmatter: chiave non prevista (${key}).`);
    else if (values.has(key)) problems.push(`Frontmatter: chiave ripetuta (${key}).`);
    else if (!PLAIN_SCALAR.test(value)) problems.push(`Frontmatter: ${key} deve essere un testo semplice su una riga, senza «: », «:» finale, « #» né virgolette iniziali.`);
    else if (NON_STRING_SCALAR.test(value)) problems.push(`Frontmatter: ${key} deve essere un testo semplice, non un numero, un booleano, una data o null.`);
    values.set(key, value);
  }
  const name = values.get("name") ?? "";
  const description = values.get("description") ?? "";
  if (!name) problems.push("Frontmatter: manca name.");
  if (!description) problems.push("Frontmatter: manca description.");
  if (problems.length) return { ok: false, problems };
  const lines = normalized.endsWith("\n") ? normalized.slice(0, -1).split("\n") : normalized.split("\n");
  return { ok: true, skill: { name, description, lineCount: lines.length, body: normalized.slice(match[0].length) } };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Occorrenze di un nome di tool senza il prefisso `Unbundle:` davanti. */
export function bareToolMentions(text: string): string[] {
  const found: string[] = [];
  for (const name of CONNECTOR_TOOL_NAMES) {
    const re = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(name)}(?![A-Za-z0-9_])`, "g");
    for (const m of text.matchAll(re)) {
      const before = text.slice(Math.max(0, m.index - CONNECTOR_SERVER_NAME.length - 1), m.index);
      if (before !== `${CONNECTOR_SERVER_NAME}:`) found.push(name);
    }
  }
  return found;
}

/**
 * Nomi propri comuni (italiani e inglesi), come controllo leggero che la skill e il plugin
 * non citino persone: un elenco generico, senza persone reali di nessun cliente. Esclusi i
 * nomi che sono anche parole comuni (Chiara, Serena, Vera, Rosa, Bianca, Stella...).
 */
export const COMMON_FIRST_NAMES = [
  "Alessandro", "Alessandra", "Alberto", "Alice", "Andrea", "Angela", "Anna", "Antonio", "Barbara", "Beatrice",
  "Carlo", "Caterina", "Claudio", "Claudia", "Cristina", "Daniele", "Daniela", "Davide", "Elena", "Elisa",
  "Emanuele", "Enrico", "Fabio", "Federico", "Federica", "Francesco", "Francesca", "Gabriele", "Giacomo", "Giorgio",
  "Giovanni", "Giulia", "Giuseppe", "Laura", "Leonardo", "Lorenzo", "Luca", "Lucia", "Luigi",
  "Marco", "Maria", "Mario", "Martina", "Massimo", "Matteo", "Michele", "Monica", "Nicola", "Paola",
  "Paolo", "Pietro", "Riccardo", "Roberto", "Roberta", "Salvatore", "Sara", "Silvia", "Simone", "Stefano",
  "Valentina", "Valeria", "Vincenzo", "John", "Mary", "James", "Michael", "David", "Thomas", "Sarah",
] as const;

/** Termini trovati come parole intere (maiuscole e minuscole contano solo se `caseSensitive`). */
export function findTerms(text: string, terms: readonly string[], opts: { caseSensitive?: boolean } = {}): string[] {
  const flags = opts.caseSensitive ? "u" : "iu";
  return terms.filter((term) => term && new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(term)}(?![\\p{L}\\p{N}_])`, flags).test(text));
}

/** Problemi di un testo distribuito (skill, manifest): nomi di persone, dati personali. */
export function distributedTextProblems(text: string, label: string): string[] {
  const problems: string[] = [];
  if (findTerms(text, COMMON_FIRST_NAMES, { caseSensitive: true }).length) problems.push(`${label}: contiene un nome di persona.`);
  if (hasProperNameHint(text)) problems.push(`${label}: contiene un titolo o un ruolo seguito da un nome.`);
  if (findSensitiveKinds(text).length) problems.push(`${label}: contiene un identificativo o un dato personale.`);
  return problems;
}

/** Tutti i controlli della skill (prompt WP9 e criterio 16). Elenco vuoto: va bene. */
export function skillProblems(text: string): string[] {
  const parsed = parseSkillMarkdown(text);
  if (!parsed.ok) return parsed.problems;
  const { name, description, lineCount, body } = parsed.skill;
  const problems: string[] = [];
  if (name !== SKILL_NAME) problems.push(`name deve essere ${SKILL_NAME}.`);
  if (!SKILL_NAME_PATTERN.test(name) || name.length > SKILL_LIMITS.nameMax) problems.push("name: minuscole, cifre e trattini, al massimo 64 caratteri.");
  if ([...description].length > SKILL_LIMITS.descriptionMax) problems.push(`description: al massimo ${SKILL_LIMITS.descriptionMax} caratteri.`);
  if (/[<>]/.test(description) || /[<>]/.test(name)) problems.push("Frontmatter: niente tag XML in name e description.");
  if (/\b(?:anthropic|claude)\b/i.test(name)) problems.push("name: niente parole riservate.");
  for (const phrase of SKILL_TRIGGER_PHRASES) {
    if (!description.includes(phrase)) problems.push(`description: manca la frase d'innesco «${phrase}».`);
  }
  if (lineCount > SKILL_LIMITS.linesMax) problems.push(`Il file deve restare sotto le 500 righe (oggi ${lineCount}).`);
  for (const reference of SKILL_TOOL_REFERENCES) {
    if (!body.includes(reference)) problems.push(`Manca il tool ${reference}.`);
  }
  const bare = bareToolMentions(text);
  if (bare.length) problems.push(`Tool citati senza il prefisso ${CONNECTOR_SERVER_NAME}: ${[...new Set(bare)].join(", ")}.`);
  for (const marker of NO_CONNECTOR_MARKERS) {
    if (!body.includes(marker)) problems.push(`Modalità senza connettore: manca «${marker}».`);
  }
  for (const code of CONNECTOR_ERROR_CODES) {
    if (!body.includes(`\`${code}\``)) problems.push(`Errori del server: manca ${code}.`);
  }
  problems.push(...warningsHandlingProblems(body));
  for (const term of findTerms(text, SKILL_REMOVED_TERMS, { caseSensitive: true })) problems.push(`Parola della skill di partenza da togliere: ${term}.`);
  if (/[–—]/.test(text)) problems.push("Niente trattini lunghi.");
  if (/\p{Extended_Pictographic}/u.test(text)) problems.push("Niente emoji.");
  problems.push(...distributedTextProblems(text, "Skill"));
  return problems;
}

// ─── Manifest del plugin ────────────────────────────────────────────────────

/** Campi di primo livello di `plugin.json` documentati (code.claude.com/docs/en/plugins-reference). */
export const PLUGIN_MANIFEST_FIELDS = [
  "$schema", "name", "displayName", "version", "description", "author", "homepage", "repository", "license",
  "keywords", "metadata", "icon", "documentationUrl", "supportUrl", "privacyPolicyUrl", "termsOfServiceUrl",
  "defaultEnabled", "dependencies", "settings", "userConfig", "types", "channels", "skills", "commands", "agents",
  "hooks", "mcpServers", "lspServers", "outputStyles", "workflows", "experimental",
] as const;

/** Campi che il plugin di questo pacchetto usa: solo metadati, nessun componente dichiarato. */
const OUR_MANIFEST_FIELDS = new Set(["name", "displayName", "version", "description", "author", "keywords"]);

const PLUGIN_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Regole del nome (documentazione): kebab-case, niente nomi che sembrano di Anthropic. */
export function pluginNameProblems(name: string): string[] {
  const problems: string[] = [];
  if (!PLUGIN_NAME_PATTERN.test(name) || name.length > 64) problems.push("name: kebab-case (minuscole, cifre, trattini), al massimo 64 caratteri.");
  const words = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const joined = words.join("-");
  if (/^(?:claude|anthropic|anthropics|cc-plugin)-/.test(joined) || ["claude", "anthropic", "anthropics", "claude-code", "claude-mods"].includes(joined)) {
    problems.push("name: riservato, sembra un plugin di Anthropic.");
  } else if (words.some((w) => w === "claude" || w === "anthropic" || w === "anthropics")) {
    problems.push("name: contiene una parola che lo fa sembrare un plugin di Anthropic.");
  }
  return problems;
}

const manifestSchema = z
  .object({
    name: z.string().min(1),
    displayName: z.string().trim().min(1).max(80),
    version: z.string().regex(/^\d+\.\d+\.\d+$/, "versione nella forma 1.2.3"),
    description: z.string().trim().min(20).max(500),
    author: z.object({ name: z.string().trim().min(1).max(80), email: z.email().optional(), url: z.url().optional() }).strict(),
    keywords: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  })
  .strict();

export interface PluginManifest {
  name: string;
  displayName: string;
  version: string;
  description: string;
  author: { name: string; email?: string; url?: string };
  keywords?: string[];
}

/**
 * Problemi del manifest: campi documentati con i tipi documentati, più le regole di questo
 * pacchetto (solo metadati: niente componenti, niente server MCP nel manifest).
 */
export function pluginManifestProblems(manifest: unknown): string[] {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return ["Il manifest deve essere un oggetto JSON."];
  const problems: string[] = [];
  for (const key of Object.keys(manifest)) {
    if (!(PLUGIN_MANIFEST_FIELDS as readonly string[]).includes(key)) problems.push(`Campo non documentato nel manifest: ${key}.`);
    else if (!OUR_MANIFEST_FIELDS.has(key)) problems.push(`Campo non usato da questo plugin: ${key}.`);
  }
  const parsed = manifestSchema.safeParse(manifest);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      if (issue.code === "unrecognized_keys") continue;
      problems.push(`Manifest: ${issue.path.map(String).join(".") || "manifest"} non valido.`);
    }
  } else {
    problems.push(...pluginNameProblems(parsed.data.name));
  }
  problems.push(...distributedTextProblems(JSON.stringify(manifest), "Manifest"));
  return problems;
}

// ─── Configurazione del pacchetto (file privato del cliente) ────────────────

export const packageConfigSchema = z
  .object({
    /** Nome del plugin del cliente, per esempio `unbundle-<cliente>`; dà anche il nome degli zip. */
    pluginName: z.string().regex(/^unbundle-[a-z0-9]+(?:-[a-z0-9]+)*$/, "nome nella forma unbundle-<nome>").max(64),
    displayName: z.string().trim().min(1).max(80),
    description: z.string().trim().min(20).max(500).optional(),
    version: z.string().regex(/^\d+\.\d+\.\d+$/, "versione nella forma 1.2.3"),
    /** Slug del connettore (`workspace_connector_configs.slug`): solo per l'indirizzo del `.mcp.json` di prova. */
    slug: z.string().regex(CONNECTOR_SLUG_PATTERN, "slug come quello della configurazione del connettore"),
  })
  .strict();

export type PackageConfig = z.infer<typeof packageConfigSchema>;

export type PackageConfigParse = { ok: true; config: PackageConfig } | { ok: false; problems: string[] };

/** Valida il file di configurazione; i problemi dicono il campo, mai il valore. */
export function parsePackageConfig(input: unknown): PackageConfigParse {
  const parsed = packageConfigSchema.safeParse(input);
  if (parsed.success) {
    const nameProblems = pluginNameProblems(parsed.data.pluginName);
    return nameProblems.length ? { ok: false, problems: nameProblems } : { ok: true, config: parsed.data };
  }
  return {
    ok: false,
    problems: parsed.error.issues.map((issue) =>
      issue.code === "unrecognized_keys" ? `Campi non previsti: ${issue.keys.join(", ")}.` : `${issue.path.map(String).join(".") || "configurazione"}: ${issue.message}`
    ),
  };
}

// ─── Pacchetti ──────────────────────────────────────────────────────────────

/** Il `.mcp.json` della variante di prova, nel formato documentato per un server remoto. */
export function connectorMcpJson(slug: string): { mcpServers: Record<string, { type: "http"; url: string }> } {
  return { mcpServers: { [CONNECTOR_SERVER_NAME]: { type: "http", url: connectorPublicUrl(slug) } } };
}

export type PackageKind = "plugin" | "plugin-con-connettore" | "skill";

export interface PackageFile {
  path: string;
  data: string;
}

export interface PackagePlan {
  kind: PackageKind;
  fileName: string;
  /** Cartella al primo livello dello zip. */
  root: string;
  files: PackageFile[];
}

export interface PackageSources {
  /** `skills/segnala-caso-uso/SKILL.md`. */
  skill: string;
  /** La copia nel plugin modello: deve essere identica. */
  pluginSkill: string;
  /** `plugins/unbundle-organizzazione/.claude-plugin/plugin.json`, già letto come JSON. */
  templateManifest: unknown;
  /** Elenco dei file del plugin modello (percorsi relativi alla sua cartella). */
  templateFiles: readonly string[];
}

export type PackageBuild = { ok: true; packages: PackagePlan[]; manifest: PluginManifest } | { ok: false; problems: string[] };

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** File che il plugin modello può contenere: manifest e skill, nient'altro (niente `.mcp.json`, niente `bin/`). */
export const PLUGIN_TEMPLATE_FILES = [PLUGIN_MANIFEST_PATH, PLUGIN_SKILL_PATH] as const;

/**
 * I tre pacchetti (prompt WP9): plugin di fase 1 senza `.mcp.json`, variante di prova con
 * `.mcp.json`, skill da sola con la cartella `segnala-caso-uso/` al primo livello.
 */
export function buildPackages(sources: PackageSources, config: PackageConfig): PackageBuild {
  const problems = [...skillProblems(sources.skill)];
  if (sources.pluginSkill !== sources.skill) problems.push(`La skill del plugin modello è diversa da ${SKILL_SOURCE_PATH}: copiala di nuovo.`);
  const extra = sources.templateFiles.filter((f) => !(PLUGIN_TEMPLATE_FILES as readonly string[]).includes(f));
  if (extra.length) problems.push(`Il plugin modello contiene file non previsti: ${extra.join(", ")}.`);
  problems.push(...pluginManifestProblems(sources.templateManifest));
  if (problems.length) return { ok: false, problems };

  const template = sources.templateManifest as PluginManifest;
  const manifest: PluginManifest = {
    ...template,
    name: config.pluginName,
    displayName: config.displayName,
    version: config.version,
    description: config.description ?? template.description,
  };
  const manifestProblems = pluginManifestProblems(manifest);
  if (manifestProblems.length) return { ok: false, problems: manifestProblems };

  const pluginFiles: PackageFile[] = [
    { path: PLUGIN_MANIFEST_PATH, data: json(manifest) },
    { path: PLUGIN_SKILL_PATH, data: sources.skill },
  ];
  const packages: PackagePlan[] = [
    { kind: "plugin", fileName: `${config.pluginName}.zip`, root: config.pluginName, files: pluginFiles },
    {
      kind: "plugin-con-connettore",
      fileName: `${config.pluginName}-con-connettore.zip`,
      root: config.pluginName,
      files: [...pluginFiles, { path: PLUGIN_MCP_PATH, data: json(connectorMcpJson(config.slug)) }],
    },
    { kind: "skill", fileName: `${SKILL_NAME}.zip`, root: SKILL_NAME, files: [{ path: "SKILL.md", data: sources.skill }] },
  ];
  return { ok: true, packages, manifest };
}

/** Voci dello zip di un pacchetto: tutto sotto la sua cartella. */
export function packageZipEntries(plan: PackagePlan): Array<{ path: string; data: string }> {
  return plan.files.map((file) => ({ path: `${plan.root}/${file.path}`, data: file.data }));
}

/**
 * Controlla uno zip già scritto (rilette le voci): cartella giusta al primo livello,
 * manifest e skill dove servono, `.mcp.json` solo nella variante di prova, niente `bin/`.
 */
export function packageZipProblems(kind: PackageKind, root: string, entries: ReadonlyArray<{ path: string; isDirectory: boolean; data: Buffer }>): string[] {
  const problems: string[] = [];
  const files = new Map(entries.filter((e) => !e.isDirectory).map((e) => [e.path, e.data.toString("utf8")]));
  const tops = new Set(entries.map((e) => e.path.split("/")[0]));
  if (tops.size !== 1 || !tops.has(root)) problems.push(`Al primo livello ci deve essere solo la cartella ${root}/.`);
  for (const path of files.keys()) {
    if (!path.startsWith(`${root}/`)) problems.push(`File fuori dalla cartella ${root}/: ${path}.`);
  }
  if (entries.some((e) => e.path === `${root}/bin/` || e.path.startsWith(`${root}/bin/`))) problems.push("Niente cartella bin/ (claude.ai e Cowork non installerebbero il plugin).");
  const mcpFiles = [...files.keys()].filter((p) => p.split("/").pop() === PLUGIN_MCP_PATH);

  if (kind === "skill") {
    const skill = files.get(`${root}/SKILL.md`);
    if (skill === undefined) problems.push(`Manca ${root}/SKILL.md.`);
    else problems.push(...skillProblems(skill));
    if (files.size !== 1) problems.push("Lo zip della skill contiene solo SKILL.md.");
    return problems;
  }

  const manifestText = files.get(`${root}/${PLUGIN_MANIFEST_PATH}`);
  if (manifestText === undefined) problems.push(`Manca ${root}/${PLUGIN_MANIFEST_PATH}.`);
  else {
    let manifest: unknown;
    try {
      manifest = JSON.parse(manifestText);
    } catch {
      problems.push("Il manifest non è JSON valido.");
    }
    if (manifest !== undefined) {
      problems.push(...pluginManifestProblems(manifest));
      if ((manifest as { name?: unknown }).name !== root) problems.push("Il nome nel manifest è diverso dalla cartella del plugin.");
    }
  }
  const skill = files.get(`${root}/${PLUGIN_SKILL_PATH}`);
  if (skill === undefined) problems.push(`Manca ${root}/${PLUGIN_SKILL_PATH}.`);
  else problems.push(...skillProblems(skill));

  if (kind === "plugin") {
    if (mcpFiles.length) problems.push("Il plugin di fase 1 non deve contenere .mcp.json.");
    if (files.size !== PLUGIN_TEMPLATE_FILES.length) problems.push("Il plugin di fase 1 contiene solo manifest e skill.");
  } else {
    if (mcpFiles.length !== 1 || mcpFiles[0] !== `${root}/${PLUGIN_MCP_PATH}`) problems.push(`La variante di prova ha un solo .mcp.json, in ${root}/${PLUGIN_MCP_PATH}.`);
    else problems.push(...mcpJsonProblems(files.get(mcpFiles[0]) ?? ""));
    if (files.size !== PLUGIN_TEMPLATE_FILES.length + 1) problems.push("La variante di prova contiene solo manifest, skill e .mcp.json.");
  }
  return problems;
}

/** Il `.mcp.json` di prova: un solo server «Unbundle», remoto, sull'indirizzo pubblico del connettore, senza header. */
export function mcpJsonProblems(text: string): string[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return [".mcp.json non è JSON valido."];
  }
  const schema = z
    .object({
      mcpServers: z
        .object({ [CONNECTOR_SERVER_NAME]: z.object({ type: z.literal("http"), url: z.url() }).strict() })
        .strict(),
    })
    .strict();
  const parsed = schema.safeParse(value);
  if (!parsed.success) return [".mcp.json: serve { mcpServers: { Unbundle: { type: \"http\", url } } }, senza altri campi (niente header né segreti)."];
  const url = parsed.data.mcpServers[CONNECTOR_SERVER_NAME].url;
  const slug = /^https:\/\/www\.theunbundle\.com\/api\/mcp\/connettore\/([a-z0-9-]{3,40})$/.exec(url)?.[1];
  if (!slug || connectorPublicUrl(slug) !== url) return [".mcp.json: l'indirizzo deve essere quello pubblico del connettore, con www e senza query."];
  return [];
}
