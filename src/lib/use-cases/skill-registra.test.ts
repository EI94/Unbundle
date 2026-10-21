import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONNECTOR_TOOL_NAMES } from "../connector/contract.ts";
import { DEFAULT_TOKEN_PREFIXES } from "../connector/http-hygiene.ts";
import { findSensitiveKinds, hasProperNameHint } from "../connector/sensitive-content.ts";

// Skill «registra-ai-lab» (docs/use-case/DESIGN.md §8.2 e §9.4; PIANO-LAVORI H5b): frontmatter,
// righe, nomi completi dei tool del MCP del team, i passi di §8.2, nessun dato di un cliente.
// I controlli stanno qui, puri: la skill si carica in Claude così com'è nel repository.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SKILL_NAME = "registra-ai-lab";
const SKILL_SOURCE_PATH = `skills/${SKILL_NAME}/SKILL.md`;
const skill = readFileSync(join(ROOT, SKILL_SOURCE_PATH), "utf8");

/** Nome del connettore del MCP del team in Claude: il prefisso dei tool nella skill. */
const TEAM_MCP_SERVER_NAME = "Unbundle Use case";
/** I 6 tool del MCP del team (DESIGN §9.4). */
const TEAM_MCP_TOOL_NAMES = ["search_use_cases", "get_use_case", "create_use_cases", "update_use_case", "decide_use_case", "set_priority"] as const;
/** I soli tool che la skill usa: cerca i doppioni e crea. Non modifica e non decide. */
const SKILL_TOOL_NAMES = ["search_use_cases", "create_use_cases"] as const;
/** I tool come li cita la skill. */
const SKILL_TOOL_REFERENCES = SKILL_TOOL_NAMES.map((name) => `${TEAM_MCP_SERVER_NAME}:${name}`);
/** Codici d'errore del MCP del team (DESIGN §9.4 «Errori»): la skill dice cosa fare per ognuno. */
const TEAM_MCP_ERROR_CODES = [
  "invalid_payload",
  "not_found",
  "permesso_mancante",
  "version_conflict",
  "transizione_non_ammessa",
  "riprova",
  "area_spenta",
  "rate_limited",
  "idempotency_conflict",
  "idempotency_in_progress",
  "internal_error",
] as const;

/** Limiti delle skill di Claude: nome 64, descrizione 1.024, file sotto 500 righe. */
const SKILL_LIMITS = Object.freeze({ nameMax: 64, descriptionMax: 1024, linesMax: 499 });

/** Frasi d'innesco nella descrizione. */
const SKILL_TRIGGER_PHRASES = [
  "registra le idee dell'AI Lab",
  "ecco gli appunti dell'AI Lab",
  "crea le schede dell'AI Lab",
  "carica in Unbundle le idee emerse",
] as const;

/** Passi di DESIGN §8.2 e regole del MCP del team che la skill deve dire. */
const SKILL_REQUIRED_MARKERS = [
  "Confermi la creazione di queste N schede?",
  "`confirmedByUser`: true",
  "`idempotencyKey`",
  "riusa la stessa chiave",
  "nascoste ai colleghi",
  "Apri in Unbundle",
  "`origin`: \"transformation\" su ogni voce",
  "NON ANCORA REGISTRATE",
] as const;

// ─── Frontmatter ────────────────────────────────────────────────────────────

interface SkillDocument {
  name: string;
  description: string;
  /** Righe del file intero, frontmatter compreso. */
  lineCount: number;
  body: string;
}

type SkillParseResult = { ok: true; skill: SkillDocument } | { ok: false; problems: string[] };

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Valore YAML semplice su una riga: niente virgolette, blocchi, ancore, commenti, «: » o «:» finale. */
const PLAIN_SCALAR = /^(?![\s'"{}[\]&*!|>%@`#,?:-])(?!.*(?::\s|:$|\s#|\s$)).+$/;
/** Valori che un parser YAML legge come null, booleano, numero o data invece che come testo. */
const NON_STRING_SCALAR = /^(?:~|null|true|false|yes|no|on|off|y|n|[-+]?\d[\d_.]*(?:e[-+]?\d+)?|\d{4}-\d\d?-\d\d?.*)$/i;

/** Frontmatter stretto: solo `name` e `description`, una riga ciascuno, valori YAML semplici. */
function parseSkillMarkdown(text: string): SkillParseResult {
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
    else if (NON_STRING_SCALAR.test(value)) problems.push(`Frontmatter: ${key} deve essere un testo, non un numero, un booleano, una data o null.`);
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

// ─── Tool ───────────────────────────────────────────────────────────────────

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentions(text: string, name: string): Array<{ index: number; prefixed: boolean }> {
  const re = new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(name)}(?![A-Za-z0-9_])`, "g");
  const prefix = `${TEAM_MCP_SERVER_NAME}:`;
  return [...text.matchAll(re)].map((m) => ({ index: m.index, prefixed: text.slice(Math.max(0, m.index - prefix.length), m.index) === prefix }));
}

/** I tool del MCP del team citati senza il prefisso `Unbundle Use case:`. */
function bareToolMentions(text: string): string[] {
  return TEAM_MCP_TOOL_NAMES.filter((name) => mentions(text, name).some((m) => !m.prefixed));
}

/** I tool del MCP del team che la skill cita (con o senza prefisso). */
function mentionedTools(text: string): string[] {
  return TEAM_MCP_TOOL_NAMES.filter((name) => mentions(text, name).length > 0);
}

// ─── Nessun dato di un cliente ──────────────────────────────────────────────

/**
 * Nomi propri comuni (italiani e inglesi), come controllo leggero che la skill non citi
 * persone: un elenco generico, senza persone di nessun cliente. Esclusi i nomi che sono
 * anche parole comuni (Chiara, Serena, Vera, Rosa, Bianca, Stella...).
 */
const COMMON_FIRST_NAMES = [
  "Alessandro", "Alessandra", "Alberto", "Alice", "Andrea", "Angela", "Anna", "Antonio", "Barbara", "Beatrice",
  "Carlo", "Caterina", "Claudio", "Claudia", "Cristina", "Daniele", "Daniela", "Davide", "Elena", "Elisa",
  "Emanuele", "Enrico", "Fabio", "Federico", "Federica", "Francesco", "Francesca", "Gabriele", "Giacomo", "Giorgio",
  "Giovanni", "Giulia", "Giuseppe", "Laura", "Leonardo", "Lorenzo", "Luca", "Lucia", "Luigi",
  "Marco", "Maria", "Mario", "Martina", "Massimo", "Matteo", "Michele", "Monica", "Nicola", "Paola",
  "Paolo", "Pietro", "Riccardo", "Roberto", "Roberta", "Salvatore", "Sara", "Silvia", "Simone", "Stefano",
  "Valentina", "Valeria", "Vincenzo", "John", "Mary", "James", "Michael", "David", "Thomas", "Sarah",
] as const;

/** Termini trovati come parole intere, rispettando maiuscole e minuscole. */
function findTerms(text: string, terms: readonly string[]): string[] {
  return terms.filter((term) => new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(term)}(?![\\p{L}\\p{N}_])`, "u").test(text));
}

/** Il solo prefisso dei codici negli esempi: XX, inventato (PIANO-LAVORI, «Riservatezza»). */
const EXAMPLE_CODE_PREFIX = "XX";
const USE_CASE_CODE = /(?<![A-Za-z0-9])([A-Z]{2,4})-\d{4}(?![0-9])/g;
const URL_PATTERN = /https?:\/\/[^\s)>»"'`]+/g;

/**
 * Dati che un testo distribuito non deve avere: nomi di persone, identificativi e dati
 * personali, codici di schede veri (solo l'esempio XX-0012), indirizzi web, token.
 */
function clientDataProblems(text: string, label: string): string[] {
  const problems: string[] = [];
  const names = findTerms(text, COMMON_FIRST_NAMES);
  if (names.length) problems.push(`${label}: contiene un nome di persona.`);
  if (hasProperNameHint(text)) problems.push(`${label}: contiene un titolo o un ruolo seguito da un nome.`);
  if (findSensitiveKinds(text).length) problems.push(`${label}: contiene un identificativo o un dato personale (email, telefono, IBAN, codice fiscale, carta).`);
  const prefixes = new Set([...text.matchAll(USE_CASE_CODE)].map((m) => m[1]));
  prefixes.delete(EXAMPLE_CODE_PREFIX);
  if (prefixes.size) problems.push(`${label}: codici di schede con un prefisso diverso dall'esempio ${EXAMPLE_CODE_PREFIX}.`);
  if ([...text.matchAll(URL_PATTERN)].length) problems.push(`${label}: niente indirizzi web (i link li dà il server).`);
  if (DEFAULT_TOKEN_PREFIXES.some((prefix) => text.toLowerCase().includes(prefix))) problems.push(`${label}: niente token né prefissi di token.`);
  return problems;
}

// ─── Tutti i controlli della skill ──────────────────────────────────────────

/** Problemi della skill: elenco vuoto, va bene. */
function skillProblems(text: string): string[] {
  const parsed = parseSkillMarkdown(text);
  if (!parsed.ok) return parsed.problems;
  const { name, description, lineCount, body } = parsed.skill;
  const problems: string[] = [];
  if (name !== SKILL_NAME) problems.push(`name deve essere ${SKILL_NAME}.`);
  if (!SKILL_NAME_PATTERN.test(name) || name.length > SKILL_LIMITS.nameMax) problems.push(`name: minuscole, cifre e trattini, al massimo ${SKILL_LIMITS.nameMax} caratteri.`);
  if (/\b(?:anthropic|claude)\b/i.test(name)) problems.push("name: niente parole riservate.");
  if ([...description].length > SKILL_LIMITS.descriptionMax) problems.push(`description: al massimo ${SKILL_LIMITS.descriptionMax} caratteri.`);
  if (/[<>]/.test(description) || /[<>]/.test(name)) problems.push("Frontmatter: niente tag XML in name e description.");
  for (const phrase of SKILL_TRIGGER_PHRASES) {
    if (!description.includes(phrase)) problems.push(`description: manca la frase d'innesco «${phrase}».`);
  }
  if (lineCount > SKILL_LIMITS.linesMax) problems.push(`Il file deve restare sotto le 500 righe (oggi ${lineCount}).`);

  for (const reference of SKILL_TOOL_REFERENCES) {
    if (!body.includes(reference)) problems.push(`Manca il tool ${reference}.`);
  }
  const bare = bareToolMentions(text);
  if (bare.length) problems.push(`Tool citati senza il prefisso ${TEAM_MCP_SERVER_NAME}: ${bare.join(", ")}.`);
  const extra = mentionedTools(text).filter((tool) => !(SKILL_TOOL_NAMES as readonly string[]).includes(tool));
  if (extra.length) problems.push(`La skill crea e basta: niente ${extra.join(", ")}.`);
  const connectorTools = CONNECTOR_TOOL_NAMES.filter((tool) => text.includes(tool));
  if (connectorTools.length || /\bUnbundle:[a-z_]/.test(text)) problems.push("Usa solo il MCP del team: niente tool del connettore del cliente.");

  for (const code of TEAM_MCP_ERROR_CODES) {
    if (!body.includes(`\`${code}\``)) problems.push(`Errori del server: manca ${code}.`);
  }
  for (const marker of SKILL_REQUIRED_MARKERS) {
    if (!body.includes(marker)) problems.push(`Manca «${marker}».`);
  }
  if (/[–—]/.test(text)) problems.push("Niente trattini lunghi.");
  if (/\p{Extended_Pictographic}/u.test(text)) problems.push("Niente emoji.");
  problems.push(...clientDataProblems(text, "Skill"));
  return problems;
}

function parsed() {
  const result = parseSkillMarkdown(skill);
  if (!result.ok) assert.fail(result.problems.join("\n"));
  return result.skill;
}

test("la skill passa tutti i controlli", () => {
  assert.deepEqual(skillProblems(skill), []);
});

test("frontmatter: solo name e description; name registra-ai-lab; descrizione sotto i 1.024 caratteri", () => {
  const { name, description, lineCount } = parsed();
  assert.equal(name, "registra-ai-lab");
  assert.equal(SKILL_NAME, name);
  assert.match(name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.ok(name.length <= SKILL_LIMITS.nameMax);
  const length = [...description].length;
  assert.ok(length <= 1024, `descrizione di ${length} caratteri`);
  assert.ok(length >= 200, "la descrizione dice cosa fa e quando usarla");
  assert.ok(lineCount < 500, `${lineCount} righe`);
  assert.match(description, /AI Lab/);
  assert.match(description, /Unbundle Use case/);
  assert.match(description, /sì esplicito/);

  // Il frontmatter è stretto: una chiave in più, una ripetuta o un valore che YAML legge
  // diversamente si vedono.
  const withExtra = skill.replace("---\nname:", "---\nlicense: MIT\nname:");
  assert.ok(skillProblems(withExtra).some((p) => p.includes("chiave non prevista")));
  const withColon = skill.replace(/^description: /m, "description: Nota: ");
  assert.ok(skillProblems(withColon).some((p) => p.startsWith("Frontmatter: description")));
  const tooLong = skill.replace(/^description: (.*)$/m, (_line, d: string) => `description: ${d}${" e ancora".repeat(120)}`);
  assert.ok(skillProblems(tooLong).some((p) => p.includes("al massimo 1024")));
  const otherName = skill.replace(/^name: .*$/m, "name: claude-ai-lab");
  assert.ok(skillProblems(otherName).some((p) => p.includes(`name deve essere ${SKILL_NAME}`)));
  assert.ok(skillProblems(otherName).some((p) => p.includes("parole riservate")));
});

test("tool: solo il MCP del team, sempre con il nome completo, e solo cerca e crea", () => {
  assert.equal(TEAM_MCP_SERVER_NAME, "Unbundle Use case");
  assert.deepEqual([...TEAM_MCP_TOOL_NAMES].sort(), ["create_use_cases", "decide_use_case", "get_use_case", "search_use_cases", "set_priority", "update_use_case"]);
  for (const reference of SKILL_TOOL_REFERENCES) assert.ok(skill.includes(reference), `manca ${reference}`);
  assert.deepEqual(SKILL_TOOL_REFERENCES, ["Unbundle Use case:search_use_cases", "Unbundle Use case:create_use_cases"]);
  assert.deepEqual(bareToolMentions(skill), [], "ogni tool con il prefisso «Unbundle Use case:»");
  assert.deepEqual(mentionedTools(skill), [...SKILL_TOOL_NAMES], "la skill non modifica, non decide e non legge per codice");
  for (const tool of CONNECTOR_TOOL_NAMES) assert.ok(!skill.includes(tool), `niente tool del connettore del cliente: ${tool}`);
  assert.doesNotMatch(skill, /\bUnbundle:[a-z_]/);

  // Un nome senza prefisso, un tool di scrittura in più o un tool del connettore si vedono.
  assert.deepEqual(bareToolMentions(`${skill}\nPoi chiama create_use_cases.`), ["create_use_cases"]);
  assert.ok(skillProblems(`${skill}\nSe serve, usa \`Unbundle Use case:decide_use_case\`.`).some((p) => p.includes("niente decide_use_case")));
  assert.ok(skillProblems(`${skill}\nOppure \`Unbundle:submit_contribution\`.`).some((p) => p.includes("solo il MCP del team")));
});

test("i passi di §8.2: appunti, elenco, conferma, creazione con conferma e chiave, codici e link", () => {
  const { body } = parsed();
  const steps = ["## Passo 1. Leggi gli appunti", "## Passo 2.", "## Passo 3. Proponi l'elenco e chiedi conferma", "## Passo 4. Crea", "## Passo 5. Chiudi"];
  let at = -1;
  for (const step of steps) {
    const next = body.indexOf(step);
    assert.ok(next > at, `${step} c'è, dopo il passo prima`);
    at = next;
  }
  // Elenco: titolo, problema in una riga, tipo, AI Lab; niente nomi nei titoli.
  for (const field of ["**Titolo**", "**Problema**", "**Tipo**", "**AI Lab**"]) assert.ok(body.includes(field), field);
  assert.match(body, /Titolo\*\*: 5-10 parole, dichiarativo, senza nomi/);
  assert.ok(body.includes("Confermi la creazione di queste N schede?"));
  // Creazione: solo dopo un sì, confirmedByUser e una chiave nuova, riusata dopo un errore.
  assert.match(body, /Solo dopo un sì esplicito/);
  assert.ok(body.includes("`confirmedByUser`: true"));
  assert.match(body, /`idempotencyKey`: \*\*nuova per ogni elenco/);
  assert.match(body, /riusa la stessa chiave/);
  // Le schede di un AI Lab nascono dall'alto e quindi nascoste ai colleghi (DESIGN §8.6):
  // la skill passa sempre origin "transformation", perché il server sceglie l'origine di chi
  // scrive e per chi non risulta di Lateral Space sarebbe AI Adoption, visibile.
  assert.ok(body.includes('`origin`: "transformation" su ogni voce, sempre.'));
  assert.doesNotMatch(body, /Non passare `origin`/);
  assert.match(body, /`items`: [^\n]*`origin`/, "origin tra i campi di ogni voce");
  assert.match(body, /nascoste ai colleghi/);
  // Chiusura: codici e «Apri in Unbundle».
  assert.match(body, /XX-0012 · <titolo> · \[Apri in Unbundle\]\(<link>\)/);
  // Ogni errore del MCP del team ha la sua riga.
  for (const code of TEAM_MCP_ERROR_CODES) assert.ok(body.includes(`\`${code}\``), code);
  // Su create_use_cases `permesso_mancante` vuol dire un token «Solo lettura» (chi non è
  // revisore riceve 401 prima): la riga dice di creare un token senza «Solo lettura».
  const readOnlyRow = body.split("\n").find((line) => line.startsWith("| `permesso_mancante` |"));
  assert.ok(readOnlyRow, "riga di permesso_mancante");
  assert.match(readOnlyRow, /sola lettura/);
  assert.match(readOnlyRow, /un token senza «Solo lettura»/);
  assert.match(readOnlyRow, /Impostazioni › Integrazioni › Claude per il team/);
  assert.doesNotMatch(readOnlyRow, /ruolo/, "il ruolo e l'appartenenza sono il 401, non questo errore");
  // Frasi brevi, niente emoji, niente trattini lunghi.
  assert.doesNotMatch(skill, /[–—]/);
  assert.doesNotMatch(skill, /\p{Extended_Pictographic}/u);
});

test("nessun dato di un cliente: niente nomi, identificativi, codici veri, indirizzi o token", () => {
  assert.deepEqual(clientDataProblems(skill, "Skill"), []);
  // Il controllo li vede davvero.
  const cases: Array<[string, RegExp]> = [
    [`Chiedi a ${COMMON_FIRST_NAMES[0]} gli appunti.`, /nome di persona/],
    ["Il dott. Bruni conduce l'AI Lab.", /titolo o un ruolo seguito da un nome/],
    ["Scrivi a referente@cliente.test per gli appunti.", /identificativo o un dato personale/],
    ["Simile a AB-0007.", /prefisso diverso dall'esempio XX/],
    ["Apri https://example.test/lab per gli appunti.", /indirizzi web/],
    ...DEFAULT_TOKEN_PREFIXES.map((prefix): [string, RegExp] => [`Il token inizia con ${prefix} e va nell'header.`, /token/]),
  ];
  for (const [text, problem] of cases) {
    assert.ok(clientDataProblems(text, "Prova").some((p) => problem.test(p)), text);
  }
  // L'esempio XX resta ammesso.
  assert.deepEqual(clientDataProblems("Somiglia a XX-0012.", "Prova"), []);
});
