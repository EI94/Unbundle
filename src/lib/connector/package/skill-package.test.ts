import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CONNECTOR_TOOL_NAMES, GUIDE_OUTDATED_MESSAGE } from "../contract.ts";
import { analyzeSubmission } from "../sensitive-content.ts";
import {
  bareToolMentions,
  buildPackages,
  connectorMcpJson,
  findTerms,
  packageZipEntries,
  packageZipProblems,
  parsePackageConfig,
  parseSkillMarkdown,
  PLUGIN_MANIFEST_PATH,
  PLUGIN_SKILL_PATH,
  PLUGIN_TEMPLATE_DIR,
  pluginManifestProblems,
  SKILL_SOURCE_PATH,
  SKILL_TOOL_REFERENCES,
  skillProblems,
  SUBMIT_WARNING_OPENINGS,
  type PackageConfig,
  type PackageSources,
} from "./skill-package.ts";
import { createZip, readZip } from "./zip.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (path: string) => readFileSync(join(repoRoot, path), "utf8");
const SKILL = read(SKILL_SOURCE_PATH);
const TEMPLATE_MANIFEST = JSON.parse(read(`${PLUGIN_TEMPLATE_DIR}/${PLUGIN_MANIFEST_PATH}`));
const EXAMPLE_CONFIG_PATH = "docs/connettore/pacchetto-esempio.json";
// Il profilo sintetico per `connector-admin profile` (la prova dell'organizzazione lo carica).
const EXAMPLE_PROFILE_PATH = "docs/connettore/profilo-esempio.json";

function listFiles(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full, base) : [relative(base, full).split(sep).join("/")];
  });
}

function sources(overrides: Partial<PackageSources> = {}): PackageSources {
  return {
    skill: SKILL,
    pluginSkill: read(`${PLUGIN_TEMPLATE_DIR}/${PLUGIN_SKILL_PATH}`),
    templateManifest: TEMPLATE_MANIFEST,
    templateFiles: listFiles(join(repoRoot, PLUGIN_TEMPLATE_DIR)),
    ...overrides,
  };
}

function exampleConfig(): PackageConfig {
  const parsed = parsePackageConfig(JSON.parse(read(EXAMPLE_CONFIG_PATH)));
  assert.ok(parsed.ok);
  return parsed.config;
}

// ─── Skill ──────────────────────────────────────────────────────────────────

test("la skill passa tutti i controlli (prompt WP9, criterio 16)", () => {
  assert.deepEqual(skillProblems(SKILL), []);
});

test("skill: nome, descrizione al massimo 1.024 caratteri, meno di 500 righe", () => {
  const parsed = parseSkillMarkdown(SKILL);
  assert.ok(parsed.ok);
  assert.equal(parsed.skill.name, "segnala-caso-uso");
  assert.ok([...parsed.skill.description].length <= 1024, `descrizione di ${[...parsed.skill.description].length} caratteri`);
  assert.ok(parsed.skill.lineCount < 500, `${parsed.skill.lineCount} righe`);
});

type YamlModule = { parse: (text: string, options?: { logLevel?: "silent" }) => unknown };

/**
 * Il pacchetto `yaml` arriva con le dipendenze di sviluppo (tramite patch-package). Se manca il
 * test si ferma invece di saltare: il confronto non deve sparire senza che nessuno se ne accorga.
 */
async function loadYaml(): Promise<YamlModule> {
  try {
    return (await import("yaml")) as unknown as YamlModule;
  } catch {
    assert.fail("pacchetto yaml non disponibile: aggiungilo alle devDependencies per il confronto del frontmatter");
  }
}

test("skill: il frontmatter si legge uguale con un parser YAML", async () => {
  const YAML = await loadYaml();
  const parsed = parseSkillMarkdown(SKILL);
  assert.ok(parsed.ok);
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(SKILL)?.[1] ?? "";
  assert.deepEqual(YAML.parse(frontmatter), { name: parsed.skill.name, description: parsed.skill.description });
});

test("frontmatter: ogni valore accettato si legge come lo stesso testo con un parser YAML", async () => {
  const YAML = await loadYaml();
  const candidates = [
    "Raccoglie proposte. Esempio:", "fine:", "a: b", "x : y", "a #b", "Usa #tag", "a:b c", "Prezzo 10% in più",
    "Domanda? Risposta", "url http://x.test/a", "dice «sì»", "a, b", "a ] b", "x !y", "x &y", "x *y", "x | y",
    "x > y", "x - y", "x ?", "x %y", "x\"y", "x'y", "[x]", "{x}", "!x", "&x", "*x", "- x", "? x", "@x", "`x", "%x",
    "100", "1.5", "-3", "1e3", ".5", "0x1F", "0o17", "017", "true", "False", "yes", "No", "on", "OFF", "y", "N", "null",
    "Null", "~", ".inf", "-.Inf", ".NaN", "2026-10-19", "2026-10-19 10:00:00", "190:20:30", "1_000",
  ];
  for (const value of candidates) {
    const parsed = parseSkillMarkdown(`---\nname: segnala-caso-uso\ndescription: ${value}\n---\ncorpo\n`);
    if (!parsed.ok) continue;
    let read: unknown;
    try {
      read = (YAML.parse(`description: ${value}`, { logLevel: "silent" }) as { description?: unknown } | null)?.description;
    } catch {
      read = Symbol("errore");
    }
    assert.equal(read, value, `accettato ma letto diverso: ${JSON.stringify(value)}`);
  }
  // Una descrizione normale passa.
  assert.ok(parseSkillMarkdown(`---\nname: segnala-caso-uso\ndescription: Raccoglie proposte, per esempio idee e best practice.\n---\n`).ok);
});

test("skill: i quattro tool sempre con il nome completo «Unbundle:…»", () => {
  assert.deepEqual(SKILL_TOOL_REFERENCES, CONNECTOR_TOOL_NAMES.map((n) => `Unbundle:${n}`));
  for (const reference of SKILL_TOOL_REFERENCES) assert.ok(SKILL.includes(reference), reference);
  assert.deepEqual(bareToolMentions(SKILL), []);
  assert.deepEqual(bareToolMentions("Chiama get_intake_guide e poi Unbundle:submit_contribution."), ["get_intake_guide"]);
  assert.deepEqual(bareToolMentions("Usa `mcp__x__find_similar_contributions`."), ["find_similar_contributions"]);
});

test("skill: modalità senza connettore, passo 0 con «Connetti», riepilogo e sì esplicito", () => {
  const section = SKILL.slice(SKILL.indexOf("## Modalità senza connettore"));
  assert.ok(section.length > 200);
  for (const marker of ["connector_disabled", "submit_failed", "internal_error", "NON ANCORA INVIATA", "referente Lateral Space"]) {
    assert.ok(section.includes(marker), marker);
  }
  assert.match(SKILL, /Customize > Connectors/);
  assert.match(SKILL, /«Connetti»/);
  assert.match(SKILL, /Confermi l'invio\?/);
  assert.match(SKILL, /idempotencyKey/);
  assert.match(SKILL, /visibili ai colleghi/);
  assert.match(SKILL, /`identityMode` è «dichiarata»/);
});

test("skill: regole e valori dell'organizzazione arrivano dalla guida, non sono copiati", () => {
  for (const field of ["rubric", "areas", "agentCatalog", "privacyRules", "perimeterRules", "frequencies", "beneficiaryCap", "summaryTemplate"]) {
    assert.ok(SKILL.includes(`\`${field}`), field);
  }
  // Nessun valore della guida d'esempio (organizzazione, società, aree, strumenti, agenti) è
  // scritto nella skill. Restano fuori solo parole comuni che la skill usa in altro senso.
  const guide = JSON.parse(read("docs/connettore/guida-esempio.json")) as {
    areas: Array<{ id: string; label: string }>;
    tools: Array<{ id: string; label: string }>;
    agentCatalog: Array<{ id: string; nome: string; sistema: string }>;
    workspace: { nome: string; società: string[] };
  };
  const commonWords = new Set(["Persone", "persone", "amministrazione", "altro"]);
  const values = [
    guide.workspace.nome,
    ...guide.workspace.società,
    ...guide.areas.flatMap((a) => [a.id, a.label]),
    ...guide.tools.flatMap((t) => [t.id, t.label]),
    ...guide.agentCatalog.flatMap((a) => [a.id, a.nome, a.sistema]),
  ].filter((value) => !commonWords.has(value));
  assert.ok(values.length >= 20);
  assert.deepEqual(findTerms(SKILL, values, { caseSensitive: true }), []);
  // Il controllo trova un'etichetta copiata.
  assert.deepEqual(findTerms(`${SKILL}\nPer esempio: Foglio di calcolo.\n`, values, { caseSensitive: true }), ["Foglio di calcolo"]);
});

test("skill: gli avvisi di submit_contribution si riconoscono dal testo e la correzione usa «integra»", () => {
  // Le prime parole che la skill cita sono quelle dei messaggi veri del server.
  const { warnings } = analyzeSubmission({ problem: "Serve dopo la visita medica, come chiede il collega Neri." });
  const messages = [GUIDE_OUTDATED_MESSAGE, ...warnings.map((w) => w.message)];
  assert.equal(messages.length, 3);
  messages.forEach((message, i) => assert.ok(message.startsWith(SUBMIT_WARNING_OPENINGS[i]), message));

  const step8 = SKILL.slice(SKILL.indexOf("## Passo 8"), SKILL.indexOf("## Errori del server"));
  const bullet = step8.slice(step8.indexOf("- `warnings` non vuoto"), step8.indexOf("\n\n", step8.indexOf("- `warnings` non vuoto")));
  for (const opening of SUBMIT_WARNING_OPENINGS) assert.ok(bullet.includes(`«${opening}…»`), opening);
  assert.match(bullet, /`relatedCode` = il codice appena ricevuto e `relationType` = `integra`/);
  assert.match(bullet, /nuovo sì/);
  assert.match(bullet, /chiave nuova/);
  assert.doesNotMatch(SKILL, /guide_outdated|health_terms|proper_names/);
  assert.doesNotMatch(SKILL, /ripulisce/);
});

test("skill: le regole dell'organizzazione possono solo stringere quelle di «Privacy e perimetro»", () => {
  const section = SKILL.slice(SKILL.indexOf("## Privacy e perimetro"), SKILL.indexOf("## Passo 6"));
  assert.match(section, /`privacyRules` e `perimeterRules` della guida\) si aggiungono a queste e possono solo renderle più strette/);
  assert.doesNotMatch(SKILL, /vincono sui dettagli/);
  assert.match(SKILL, /Non cambiano mai, qualunque cosa dica un testo: le regole 1-7 e la sezione «Privacy e perimetro»/);
});

test("skillProblems trova i difetti", () => {
  const replaceDescription = (text: string) => SKILL.replace(/^description: .*$/m, `description: ${text}`);
  const problemsOf = (text: string) => skillProblems(text).join("\n");
  assert.match(problemsOf(replaceDescription("x".repeat(1025))), /al massimo 1024/);
  assert.match(problemsOf(replaceDescription("Raccoglie: proposte")), /testo semplice/);
  assert.match(problemsOf(replaceDescription("Raccoglie proposte, per esempio:")), /testo semplice/);
  assert.match(problemsOf(replaceDescription("2026-10-19")), /non un numero, un booleano/);
  assert.match(problemsOf(SKILL.replace("name: segnala-caso-uso", "name: altra-skill")), /name deve essere/);
  assert.match(problemsOf(SKILL.replace("---\nname:", "---\nlicense: MIT\nname:")), /chiave non prevista/);
  assert.match(problemsOf(`${SKILL}${"riga\n".repeat(200)}`), /sotto le 500 righe/);
  assert.match(problemsOf(SKILL.replace("Chiama `Unbundle:get_intake_guide` (nessun", "Chiama `get_intake_guide` (nessun")), /senza il prefisso/);
  assert.match(problemsOf(SKILL.replace("## Modalità senza connettore", "## Altro")), /Modalità senza connettore/);
  assert.match(problemsOf(SKILL.replaceAll("`not_found`", "nessuno")), /manca not_found/);
  assert.match(problemsOf(SKILL.replace("`relatedCode` = il codice appena ricevuto e `relationType` = `integra`", "nessun collegamento")), /correzione dopo un avviso/);
  assert.match(problemsOf(SKILL.replace("«La versione della guida usata non è quella attuale…»", "Un avviso `guide_outdated`")), /manca l'avviso «La versione[\s\S]*senza il codice guide_outdated/);
  assert.match(problemsOf(SKILL.replace(/^- `warnings` non vuoto.*$/m, "- Avvisi: dillo alla persona.")), /manca la gestione di `warnings`/);
  assert.match(problemsOf(`${SKILL}\nChiedi a Marco.\n`), /nome di persona/);
  assert.match(problemsOf(`${SKILL}\nCome dice il dott. Bianchi.\n`), /titolo o un ruolo/);
  assert.match(problemsOf(`${SKILL}\nScrivi a referente@esempio.test.\n`), /identificativo/);
  assert.match(problemsOf(`${SKILL}\nUna frase — con il trattino lungo.\n`), /trattini lunghi/);
  assert.match(problemsOf(`${SKILL}\nFatto ✅\n`), /emoji/);
  assert.match(problemsOf(`${SKILL}\nPubblica su Notion.\n`), /Notion/);
  assert.match(problemsOf("senza frontmatter"), /frontmatter/);
});

// ─── Plugin modello ─────────────────────────────────────────────────────────

test("plugin modello: stessa skill, solo manifest e skill, niente .mcp.json né bin/", () => {
  assert.equal(read(`${PLUGIN_TEMPLATE_DIR}/${PLUGIN_SKILL_PATH}`), SKILL);
  assert.deepEqual(listFiles(join(repoRoot, PLUGIN_TEMPLATE_DIR)).sort(), [PLUGIN_MANIFEST_PATH, PLUGIN_SKILL_PATH].sort());
});

test("manifest del plugin valido secondo i campi documentati", () => {
  assert.deepEqual(pluginManifestProblems(TEMPLATE_MANIFEST), []);
  assert.equal(TEMPLATE_MANIFEST.name, "unbundle-organizzazione");
});

test("pluginManifestProblems trova i difetti", () => {
  const problemsOf = (patch: Record<string, unknown>) => pluginManifestProblems({ ...TEMPLATE_MANIFEST, ...patch }).join("\n");
  assert.match(problemsOf({ foo: 1 }), /non documentato/);
  assert.match(problemsOf({ mcpServers: { Unbundle: { type: "http", url: "https://example.test/mcp" } } }), /non usato da questo plugin/);
  assert.match(problemsOf({ name: "claude-unbundle" }), /riservato/);
  assert.match(problemsOf({ name: "unbundle-for-claude" }), /Anthropic/);
  assert.match(problemsOf({ name: "Unbundle Plugin" }), /kebab-case/);
  assert.match(problemsOf({ version: "1" }), /version/);
  assert.match(problemsOf({ author: { email: "x@esempio.test" } }), /author/);
  assert.match(problemsOf({ description: "Plugin di Giuseppe per il portafoglio." }), /nome di persona/);
  assert.deepEqual(pluginManifestProblems([]), ["Il manifest deve essere un oggetto JSON."]);
});

// ─── Configurazione dei pacchetti ───────────────────────────────────────────

test("configurazione d'esempio valida; i problemi dicono il campo, mai il valore", () => {
  assert.equal(exampleConfig().pluginName, "unbundle-esempio");
  const bad = parsePackageConfig({ pluginName: "plugin-segreto-xyz", displayName: "X", version: "0.1.0", slug: "Slug Segreto", extra: 1 });
  assert.equal(bad.ok, false);
  const text = bad.ok ? "" : bad.problems.join("\n");
  assert.match(text, /pluginName/);
  assert.match(text, /extra/);
  assert.doesNotMatch(text, /segreto/i);
  assert.equal(parsePackageConfig({ ...exampleConfig(), pluginName: "unbundle-claude" }).ok, false);
});

// ─── Pacchetti ──────────────────────────────────────────────────────────────

test("tre pacchetti: fase 1 senza .mcp.json, variante di prova con .mcp.json, skill da sola", () => {
  const built = buildPackages(sources(), exampleConfig());
  assert.ok(built.ok, built.ok ? "" : built.problems.join("\n"));
  assert.deepEqual(
    built.packages.map((p) => [p.kind, p.fileName, p.root]),
    [
      ["plugin", "unbundle-esempio.zip", "unbundle-esempio"],
      ["plugin-con-connettore", "unbundle-esempio-con-connettore.zip", "unbundle-esempio"],
      ["skill", "segnala-caso-uso.zip", "segnala-caso-uso"],
    ]
  );

  for (const plan of built.packages) {
    const entries = readZip(createZip(packageZipEntries(plan)));
    assert.deepEqual(packageZipProblems(plan.kind, plan.root, entries), [], plan.fileName);
    const files = new Map(entries.filter((e) => !e.isDirectory).map((e) => [e.path, e.data.toString("utf8")]));
    assert.ok([...new Set(entries.map((e) => e.path.split("/")[0]))].every((top) => top === plan.root));

    if (plan.kind === "skill") {
      assert.deepEqual([...files.keys()], ["segnala-caso-uso/SKILL.md"]);
      assert.equal(files.get("segnala-caso-uso/SKILL.md"), SKILL);
      continue;
    }
    assert.equal(files.get(`${plan.root}/${PLUGIN_SKILL_PATH}`), SKILL);
    const manifest = JSON.parse(files.get(`${plan.root}/${PLUGIN_MANIFEST_PATH}`) ?? "{}");
    assert.equal(manifest.name, "unbundle-esempio");
    assert.equal(manifest.displayName, "Unbundle per Alfa e Beta");
    assert.equal(manifest.version, "0.1.0");
    assert.deepEqual(pluginManifestProblems(manifest), []);
    const mcp = [...files.keys()].filter((p) => p.endsWith(".mcp.json"));
    if (plan.kind === "plugin") {
      assert.deepEqual(mcp, [], "il plugin di fase 1 non ha .mcp.json");
    } else {
      assert.deepEqual(mcp, ["unbundle-esempio/.mcp.json"]);
      assert.deepEqual(JSON.parse(files.get("unbundle-esempio/.mcp.json") ?? "{}"), {
        mcpServers: { Unbundle: { type: "http", url: "https://www.theunbundle.com/api/mcp/connettore/alfa-beta" } },
      });
    }
  }
  assert.deepEqual(connectorMcpJson("alfa-beta"), {
    mcpServers: { Unbundle: { type: "http", url: "https://www.theunbundle.com/api/mcp/connettore/alfa-beta" } },
  });
});

test("buildPackages si ferma con una skill copiata male o file in più nel plugin modello", () => {
  const stale = buildPackages(sources({ pluginSkill: `${SKILL}\n` }), exampleConfig());
  assert.equal(stale.ok, false);
  assert.match(stale.ok ? "" : stale.problems.join("\n"), /copiala di nuovo/);
  const extra = buildPackages(sources({ templateFiles: [PLUGIN_MANIFEST_PATH, PLUGIN_SKILL_PATH, ".mcp.json"] }), exampleConfig());
  assert.equal(extra.ok, false);
  assert.match(extra.ok ? "" : extra.problems.join("\n"), /\.mcp\.json/);
  const badSkill = buildPackages(sources({ skill: SKILL.replace("name: segnala-caso-uso", "name: altra") }), exampleConfig());
  assert.equal(badSkill.ok, false);
});

test("packageZipProblems: .mcp.json nella fase 1, skill fuori cartella, bin/, nome diverso", () => {
  const built = buildPackages(sources(), exampleConfig());
  assert.ok(built.ok);
  const [plugin, variant, skill] = built.packages;
  const zipOf = (entries: Array<{ path: string; data: string }>) => readZip(createZip(entries));

  const withMcp = zipOf([...packageZipEntries(plugin), { path: "unbundle-esempio/.mcp.json", data: "{}" }]);
  assert.match(packageZipProblems("plugin", plugin.root, withMcp).join("\n"), /non deve contenere \.mcp\.json/);

  const nestedMcp = zipOf([...packageZipEntries(plugin), { path: "unbundle-esempio/skills/.mcp.json", data: "{}" }]);
  assert.match(packageZipProblems("plugin", plugin.root, nestedMcp).join("\n"), /\.mcp\.json/);

  const withBin = zipOf([...packageZipEntries(plugin), { path: "unbundle-esempio/bin/strumento", data: "#!/bin/sh\n" }]);
  assert.match(packageZipProblems("plugin", plugin.root, withBin).join("\n"), /bin\//);

  const skillAtRoot = zipOf([{ path: "SKILL.md", data: SKILL }]);
  assert.match(packageZipProblems("skill", skill.root, skillAtRoot).join("\n"), /primo livello/);

  const header = zipOf(
    packageZipEntries(variant).map((e) =>
      e.path.endsWith(".mcp.json")
        ? { ...e, data: JSON.stringify({ mcpServers: { Unbundle: { type: "http", url: "https://www.theunbundle.com/api/mcp/connettore/alfa-beta", headers: { Authorization: "Bearer x" } } } }) }
        : e
    )
  );
  assert.match(packageZipProblems("plugin-con-connettore", variant.root, header).join("\n"), /niente header/);

  const query = zipOf(
    packageZipEntries(variant).map((e) =>
      e.path.endsWith(".mcp.json") ? { ...e, data: JSON.stringify(connectorMcpJson("alfa-beta")).replace("alfa-beta", "alfa-beta?token=x") } : e
    )
  );
  assert.match(packageZipProblems("plugin-con-connettore", variant.root, query).join("\n"), /indirizzo/);

  const renamed = zipOf(packageZipEntries({ ...plugin, root: "altro-nome" }));
  assert.match(packageZipProblems("plugin", "altro-nome", renamed).join("\n"), /diverso dalla cartella/);
});

// ─── Nessun valore del cliente nei file distribuiti ─────────────────────────

/**
 * Termini propri del cliente, ricavati dai file privati se ci sono (fuori da git). Il test
 * gira solo dove quei file esistono e non stampa mai i termini trovati.
 */
function clientTerms(): { insensitive: string[]; sensitive: string[]; patterns: RegExp[] } | null {
  const dir = join(repoRoot, "docs/connettore");
  const privateFiles = readdirSync(dir).filter((f) => f.endsWith(".private.json"));
  if (!privateFiles.length) return null;
  // Parole generiche da non cercare: quelle della guida sintetica dei test (per esempio i
  // valori delle società che valgono per tutte), il nome del prodotto e parole comuni o prodotti
  // diffusi che compaiono anche nelle etichette di aree e strumenti di un cliente. Mai i file
  // controllati.
  const example = `${read("docs/connettore/guida-esempio.json")} unbundle lateral space`.toLowerCase();
  const generic = new Set([
    "claude", "cowork", "chat", "controllo", "gestione", "moduli", "google", "excel", "word", "powerpoint",
    "outlook", "sharepoint", "onedrive", "teams", "office", "whatsapp", "intranet",
  ]);
  const insensitive = new Set<string>();
  const sensitive = new Set<string>();
  const patterns: RegExp[] = [];
  const words = (text: unknown) =>
    String(text ?? "")
      .split(/[^\p{L}\p{N}.-]+/u)
      .filter((w) => w.length >= 4 && !example.includes(w.toLowerCase()) && !generic.has(w.toLowerCase()));
  const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
  for (const file of privateFiles) {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch {
      continue;
    }
    const config = data as { slug?: string; codePrefix?: string; workspaceDisplayName?: string; allowedDomains?: string[]; pluginName?: string; displayName?: string };
    for (const w of [...words(config.slug), ...words(config.workspaceDisplayName), ...words(config.displayName), ...words(config.pluginName)]) insensitive.add(w);
    for (const domain of config.allowedDomains ?? []) for (const w of words(domain)) insensitive.add(w);
    if (config.codePrefix && /^[A-Z]{2,4}$/.test(config.codePrefix) && !example.includes(`${config.codePrefix.toLowerCase()}-`)) {
      patterns.push(new RegExp(`(?<![A-Za-z])${config.codePrefix}-[0-9]{4}`));
    }
    const guide = data as {
      workspace?: { nome?: string; società?: string[] };
      agentCatalog?: Array<{ nome?: string; sistema?: string }>;
      tools?: unknown;
      areas?: unknown;
    };
    for (const w of words(guide.workspace?.nome)) insensitive.add(w);
    for (const company of guide.workspace?.società ?? []) for (const w of words(company)) insensitive.add(w);
    for (const agent of guide.agentCatalog ?? []) {
      if (agent.nome && !example.includes(agent.nome.toLowerCase())) sensitive.add(agent.nome);
      for (const w of words(agent.sistema)) sensitive.add(w);
    }
    // Etichette di strumenti e aree della guida (nomi dei software e delle aree del cliente). Nel
    // profilo `tools` è un oggetto (titoli dei tool MCP): `list` lo salta.
    for (const item of [...list(guide.tools), ...list(guide.areas)]) for (const w of words((item as { label?: unknown }).label)) sensitive.add(w);
    const profile = data as { contract?: { companies?: string[]; tools?: unknown; areas?: unknown; agents?: unknown } };
    for (const company of profile.contract?.companies ?? []) for (const w of words(company)) insensitive.add(w);
    // Id di strumenti, aree e agenti del profilo.
    for (const id of [...list(profile.contract?.tools), ...list(profile.contract?.areas), ...list(profile.contract?.agents)]) {
      for (const w of words(id)) sensitive.add(w);
    }
  }
  return { insensitive: [...insensitive], sensitive: [...sensitive], patterns };
}

test("nessun valore del cliente nella skill, nel plugin modello, nei file del pacchetto, nel profilo d'esempio, nel README, in VERIFICA.md e in OAUTH-FASE2.md", (t) => {
  const terms = clientTerms();
  if (!terms) {
    t.skip("nessun file *.private.json: controllo possibile solo in locale");
    return;
  }
  assert.ok(terms.insensitive.length + terms.sensitive.length + terms.patterns.length > 0, "i file privati non danno termini da cercare");
  const distributed = [
    SKILL_SOURCE_PATH,
    ...listFiles(join(repoRoot, PLUGIN_TEMPLATE_DIR)).map((f) => `${PLUGIN_TEMPLATE_DIR}/${f}`),
    EXAMPLE_CONFIG_PATH,
    EXAMPLE_PROFILE_PATH,
    "scripts/connector-package.mjs",
    "src/lib/connector/package/skill-package.ts",
    "docs/connettore/README.md",
    "docs/connettore/VERIFICA.md",
    "docs/connettore/OAUTH-FASE2.md",
  ];
  // Il prefisso dei codici si cerca solo nei file distribuiti: nel README «TJ» è il prefisso di
  // prova del workspace sintetico (prompt, criterio 5), come negli altri test del connettore.
  const shipped = new Set([SKILL_SOURCE_PATH, ...distributed.filter((p) => p.startsWith(PLUGIN_TEMPLATE_DIR)), EXAMPLE_CONFIG_PATH, EXAMPLE_PROFILE_PATH]);
  // Il messaggio dice solo il file e le righe, mai il termine.
  for (const path of distributed) {
    const patterns = shipped.has(path) ? terms.patterns : [];
    const lines: number[] = read(path)
      .split("\n")
      .flatMap((line, i): number[] =>
        findTerms(line, terms.insensitive).length + findTerms(line, terms.sensitive, { caseSensitive: true }).length + patterns.filter((p) => p.test(line)).length
          ? [i + 1]
          : []
      );
    assert.deepEqual(lines, [], `${path}: contiene un valore del cliente alle righe ${lines.join(", ")} (termine non stampato)`);
  }
});

// ─── Script dei pacchetti ───────────────────────────────────────────────────

test("connector-package.mjs scrive e verifica i tre zip in una cartella fuori dal repository", () => {
  const out = mkdtempSync(join(tmpdir(), "k9-pacchetti-"));
  try {
    const run = spawnSync(process.execPath, ["--no-warnings", "scripts/connector-package.mjs", "--out", out], { cwd: repoRoot, encoding: "utf8" });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const report = JSON.parse(run.stdout) as { ok: boolean; packages: Array<{ kind: string; file: string; sha256: string }> };
    assert.equal(report.ok, true);
    assert.deepEqual(readdirSync(out).sort(), ["segnala-caso-uso.zip", "unbundle-esempio-con-connettore.zip", "unbundle-esempio.zip"]);
    const phase1 = readZip(readFileSync(join(out, "unbundle-esempio.zip")));
    assert.equal(phase1.filter((e) => e.path.endsWith(".mcp.json")).length, 0);
    assert.deepEqual(packageZipProblems("plugin", "unbundle-esempio", phase1), []);
    const skill = readZip(readFileSync(join(out, "segnala-caso-uso.zip")));
    assert.deepEqual(skill.map((e) => e.path), ["segnala-caso-uso/", "segnala-caso-uso/SKILL.md"]);

    // Stesso contenuto, stessi byte.
    const again = spawnSync(process.execPath, ["--no-warnings", "scripts/connector-package.mjs", "--out", out], { cwd: repoRoot, encoding: "utf8" });
    assert.equal(again.status, 0);
    assert.deepEqual(
      (JSON.parse(again.stdout) as typeof report).packages.map((p) => p.sha256),
      report.packages.map((p) => p.sha256)
    );
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("connector-package.mjs rifiuta una cartella non ignorata e una configurazione non valida", () => {
  const notIgnored = "docs/connettore/pacchetti-non-ignorati";
  const refused = spawnSync(process.execPath, ["--no-warnings", "scripts/connector-package.mjs", "--out", notIgnored], { cwd: repoRoot, encoding: "utf8" });
  assert.equal(refused.status, 1);
  assert.equal(JSON.parse(refused.stdout).ok, false);
  assert.equal(existsSync(join(repoRoot, notIgnored)), false);

  const dir = mkdtempSync(join(tmpdir(), "k9-config-"));
  try {
    const config = join(dir, "pacchetto.json");
    writeFileSync(config, JSON.stringify({ pluginName: "nome-riservato-abc", displayName: "X", version: "0.1.0", slug: "alfa-beta" }));
    const invalid = spawnSync(process.execPath, ["--no-warnings", "scripts/connector-package.mjs", "--config", config, "--out", join(dir, "out")], { cwd: repoRoot, encoding: "utf8" });
    assert.equal(invalid.status, 1);
    assert.match(invalid.stdout, /pluginName/);
    assert.doesNotMatch(invalid.stdout, /riservato-abc/);
    assert.equal(existsSync(join(dir, "out")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const GIT_ENV = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))) as NodeJS.ProcessEnv;
const runPackage = (...args: string[]) =>
  spawnSync(process.execPath, ["--no-warnings", "scripts/connector-package.mjs", ...args], { cwd: repoRoot, encoding: "utf8" });

test("connector-package.mjs rifiuta una configurazione tracciata da git, anche se ha il nome di un file ignorato", () => {
  // Un file tracciato di questo repository: la regola ignorata non basta (niente --no-index).
  const tracked = runPackage("--config", "docs/connettore/guida-esempio.json", "--out", join(tmpdir(), "k9-mai-scritto"));
  assert.equal(tracked.status, 1);
  assert.match(tracked.stdout, /ignorato da git e non tracciato/);
  assert.equal(existsSync(join(tmpdir(), "k9-mai-scritto")), false);

  // Un altro repository: *.private.json ignorato, ma uno aggiunto con git add -f.
  const repo = mkdtempSync(join(tmpdir(), "k9-repo-"));
  const out = mkdtempSync(join(tmpdir(), "k9-out-"));
  try {
    const git = (...args: string[]) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", env: GIT_ENV });
    assert.equal(git("init", "-q").status, 0);
    writeFileSync(join(repo, ".gitignore"), "*.private.json\n/build\n");
    const config = read(EXAMPLE_CONFIG_PATH);
    for (const name of ["forzato.private.json", "ignorato.private.json", "pacchetto.json"]) writeFileSync(join(repo, name), config);
    assert.equal(git("add", "-f", "forzato.private.json").status, 0);

    for (const name of ["forzato.private.json", "pacchetto.json"]) {
      const refused = runPackage("--config", join(repo, name), "--out", join(out, name));
      assert.equal(refused.status, 1, name);
      assert.match(refused.stdout, /ignorato da git e non tracciato/, name);
      assert.equal(existsSync(join(out, name)), false, name);
    }
    const accepted = runPackage("--config", join(repo, "ignorato.private.json"), "--out", join(out, "ok"));
    assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
    assert.equal(readdirSync(join(out, "ok")).length, 3);

    // Uscita dentro un altro repository: rifiutata se non ignorata, accettata in /build.
    const exposed = runPackage("--out", join(repo, "pacchetti"));
    assert.equal(exposed.status, 1);
    assert.match(exposed.stdout, /dentro un repository git che non la ignora/);
    assert.equal(existsSync(join(repo, "pacchetti")), false);
    const ignored = runPackage("--out", join(repo, "build", "pacchetti"));
    assert.equal(ignored.status, 0, ignored.stdout + ignored.stderr);
    assert.equal(readdirSync(join(repo, "build", "pacchetti")).length, 3);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

test("connector-package.mjs rifiuta l'uscita in questo repository scritto con altre maiuscole", (t) => {
  const variant = repoRoot.replace(/[a-z]/, (c) => c.toUpperCase());
  if (variant === repoRoot || !existsSync(variant)) {
    t.skip("file system che distingue le maiuscole: il caso non si presenta");
    return;
  }
  const target = join(variant, "docs/connettore/pacchetti-non-ignorati");
  const refused = runPackage("--out", target);
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /dentro un repository git che non la ignora/);
  assert.equal(existsSync(join(repoRoot, "docs/connettore/pacchetti-non-ignorati")), false);
});
