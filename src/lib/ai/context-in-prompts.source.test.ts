import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { PROMPT_PROFILES, type PromptProfile } from "../context/work/prompt-block.ts";

// (Rilascio 9b, docs/contesto/RILASCIO-9b-COSTRUZIONE.md §2.12, §5.5, D7) Il blocco «Contesto» nei prompt, sul sorgente:
// gli 11 punti della tabella chiamano `loadPromptContext` con il loro profilo, sempre dopo il controllo di chi chiama (la
// sessione e il permesso; per il cron, il segreto), con l'ok della richiesta (i segnali settimanali lo rileggono ora), e
// mettono il blocco nel prompt. La classificazione ha due porte: il pulsante e «Completa la mappatura». Nessun altro
// chiama `loadPromptContext`, e nessuno gli passa chi guarda: il blocco ha solo fatti «Per tutti», per tutti. Che cosa
// entra nel prompt e dove: context-in-prompts.test.ts; le letture: src/lib/context/work/work-source.test.ts.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
/** Il sorgente senza i commenti: un commento non è una chiamata. */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
/** I sorgenti .ts e .tsx sotto src/, senza i test. */
const CODE = (readdirSync(new URL("src/", ROOT), { recursive: true }) as string[])
  .map((file) => `src/${file.split("\\").join("/")}`)
  .filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.tsx?$/.test(file) && !file.endsWith("-test-kit.ts"))
  .sort();
const codeCache = new Map<string, string>();
/** Il codice di un file di CODE, senza i commenti (letto una volta). */
function codeOf(file: string): string {
  if (!codeCache.has(file)) codeCache.set(file, code(read(file)));
  return codeCache.get(file)!;
}

/** Il corpo di una funzione di primo livello, dalla firma alla graffa che la chiude. */
function topLevelFunction(text: string, signature: string): string {
  const start = text.indexOf(signature);
  assert.notEqual(start, -1, `manca: ${signature}`);
  const end = text.indexOf("\n}\n", start);
  assert.notEqual(end, -1, `fine non trovata: ${signature}`);
  return text.slice(start, end + 2);
}

interface Site {
  file: string;
  /** La firma della funzione che chiama. */
  fn: string;
  profile: PromptProfile;
  /** La chiamata, com'è scritta. */
  call: string;
  /** Che cosa viene prima della chiamata, nella stessa funzione: chi chiama e i suoi permessi, poi le altre uscite. */
  gates: readonly string[];
  /** Che cosa viene dopo: il blocco nel prompt. */
  then: readonly string[];
}

const CONSENT_REQUEST = 'consent: "request" })';
const SESSION = ["const session = await requireSession();", "const access = await getCollaboratorAccess(session.user.id, workspaceId);", 'if (!access) throw new Error("Workspace non trovato");', "if (!canReviewWorkspacePortfolio(access.role)) {"];

const SITES: readonly Site[] = [
  {
    file: "src/app/api/ai/chat/route.ts",
    fn: "export async function POST(req: Request) {",
    profile: "chat",
    call: `contextBlock += await loadPromptContext(workspaceId, { profile: "chat", query: lastUserContent, ${CONSENT_REQUEST};`,
    gates: [
      "const session = await auth();",
      'if (!session?.user?.id) {\n    return new Response("Unauthorized", { status: 401 });',
      "const access = await getCollaboratorAccess(session.user.id, workspaceId);",
      'if (!access) {\n    return new Response("Workspace not found", { status: 404 });',
      'return new Response("Department not found", { status: 404 });',
      'if (!(await contextAiConsent(workspaceId))) {\n    return Response.json({ error: "ok_fornitori_mancante"',
      'if (messages[messages.length - 1]?.role !== "user") {\n    return new Response("Missing required fields", { status: 400 });',
      'const lastUserContent = messages[messages.length - 1]?.content ?? "";',
      // Dopo il perimetro (§2.12), prima della memoria e dei documenti.
      "contextBlock += `\\n--- CONTESTO: SYSTEM BOUNDARY ---",
    ],
    then: ["let ragChunks", "systemPrompt = DISCOVERY_SYSTEM_PROMPT + contextBlock;", "let mappingContext = contextBlock + "],
  },
  {
    file: "src/lib/actions/reports.ts",
    fn: "export async function generateReportAction(",
    profile: "report",
    call: `loadPromptContext(workspaceId, { profile: "report", ${CONSENT_REQUEST},`,
    gates: [...SESSION, 'throw new Error("Non hai i permessi per generare report.");'],
    then: ["const reportContent = await generateReport(", "    contesto,\n  );"],
  },
  {
    file: "src/lib/actions/classify.ts",
    fn: "export async function runClassificationAction(",
    profile: "classify",
    call: `const contesto = await loadPromptContext(workspaceId, { profile: "classify", ${CONSENT_REQUEST};`,
    gates: [...SESSION, 'throw new Error("Non hai i permessi per classificare le attivita.");', "if (unclassified.length === 0) {"],
    then: ["const results = await classifyActivitiesBatch(unclassified, {", "    contesto,\n  });"],
  },
  {
    // La seconda porta della classificazione: la funzione la chiama dopo aver trovato l'unità (le uscite qui sotto); chi
    // chiama il completamento ha già controllato la sessione (il test qui sotto).
    file: "src/lib/mappatura/complete.ts",
    fn: "export function appCompleteDeps(executor: UcExecutor): CompleteDeps {",
    profile: "classify",
    call: "const contesto = await classifyContext(scope.workspaceId);",
    gates: [
      "if (!UUID.test(scope.workspaceId) || !UUID.test(scope.departmentId)) return null;",
      "if (unit.length === 0 || probe[0]?.ready !== true) return null;",
      "await adoptUnit(executor, scope);",
      "if (units.length === 0) return null;",
    ],
    then: ["goals: goals.map(goalFromRow), contesto };"],
  },
  {
    file: "src/lib/use-cases/create-flow.ts",
    fn: "export async function proposeFromActivityMapping(",
    profile: "useCases",
    call: `loadPromptContext(ctx.workspaceId, { profile: "useCases", ${CONSENT_REQUEST},`,
    gates: [
      'const access = ctx.actor.kind === "persona" && userId ? await getCollaboratorAccess(userId, ctx.workspaceId) : null;',
      'if (!access || !canReviewWorkspacePortfolio(access.role)) {\n    return { ok: false, error: "permesso_mancante"',
      'return { ok: false, error: "da_classificare", message: ACTIVITY_MAPPING_TEXT.classifyFirst };',
      'return { ok: false, error: "da_classificare", message: NO_CLASSIFIED_ACTIVITIES_ERROR };',
    ],
    then: ["generated = await deps.generate(classified, { companyValueThesis: thesis, goals, contesto }, includeEsg);"],
  },
  {
    file: "src/lib/actions/blueprints.ts",
    fn: "export async function generateBlueprintsAction(",
    profile: "blueprints",
    call: `const contesto = await loadPromptContext(workspaceId, { profile: "blueprints", ${CONSENT_REQUEST};`,
    gates: ["const { access } = await requireWorkspaceAccess(workspaceId);", "if (!canReviewWorkspacePortfolio(access.role)) {", 'throw new Error("Il tuo ruolo non può generare i blueprint.");', 'throw new Error("Nessun use case disponibile. Genera prima i use case.");'],
    then: ["const result = await generateAgentBlueprints(useCases, activities, contesto);"],
  },
  {
    file: "src/lib/actions/simulation.ts",
    fn: "export async function generateSimulationAction(",
    profile: "simulation",
    call: `loadPromptContext(workspaceId, { profile: "simulation", ${CONSENT_REQUEST},`,
    gates: [...SESSION, 'throw new Error("Non hai i permessi per generare simulazioni.");'],
    then: ["const result = await generateSimulation(", "    contesto,\n  );"],
  },
  {
    file: "src/lib/actions/value-map.ts",
    fn: "export async function generateValueMapAction(",
    profile: "valueMap",
    call: `const contesto = await loadPromptContext(workspaceId, { profile: "valueMap", ${CONSENT_REQUEST};`,
    gates: [...SESSION, 'throw new Error("Non hai i permessi per generare la value map.");', 'throw new Error("Nessuna attività classificata.");'],
    then: ["(usala per capire cosa è davvero strategico): ${JSON.stringify(thesis ?? {})}${contesto}`,"],
  },
  {
    file: "src/lib/actions/strategy.ts",
    fn: "export async function suggestOKRsAction(",
    profile: "okr",
    call: `const contesto = await loadPromptContext(workspaceId, { profile: "okr", ${CONSENT_REQUEST};`,
    gates: [...SESSION, 'throw new Error("Non hai i permessi per suggerire OKR.");', '"Completa prima la Discovery per avere la Value Thesis."'],
    then: ["content: `Value Thesis dell'azienda:\\n${JSON.stringify(thesis, null, 2)}${contesto}`,"],
  },
  {
    file: "src/lib/actions/intelligence.ts",
    fn: "export async function generateCompetitiveAnalysis(",
    profile: "intelligence",
    call: `const contesto = await loadPromptContext(workspaceId, { profile: "intelligence", ${CONSENT_REQUEST};`,
    gates: ["const { access } = await requireWorkspaceAccess(workspaceId);", "if (!canReviewWorkspacePortfolio(access.role)) {", "throw new Error(\"Il tuo ruolo non può generare l'analisi competitiva.\");"],
    then: ['  .join("\\n")}\n${contesto}\nGenera:\n'],
  },
  {
    file: "src/lib/actions/pre-generate-activities.ts",
    fn: "export async function preGenerateActivitiesFromDocuments(",
    profile: "activities",
    call: `const contesto = await loadPromptContext(workspaceId, { profile: "activities", ${CONSENT_REQUEST};`,
    gates: [
      "const { session, access } = await requireWorkspaceAccess(workspaceId);",
      "await requireDepartmentInWorkspace(workspaceId, departmentId);",
      "if (!(await contextAiConsent(workspaceId))) {\n    return { activities: [], consentMissing: true };",
      "if (docs.length === 0) {\n    return { activities: [] };",
    ],
    then: ["## DOCUMENTI\n${documentContent}\n${contesto}\n## COSA FARE"],
  },
  {
    file: "src/app/api/cron/weekly-pulse/route.ts",
    fn: "export async function GET(req: Request) {",
    profile: "weeklySignals",
    call: 'const contesto = await loadPromptContext(workspace.id, { profile: "weeklySignals", consent: "now" });',
    gates: ['if (checkCronAuthorization(req.headers.get("authorization"), process.env.CRON_SECRET) !== "ok") {\n    return new Response("Unauthorized", { status: 401 });', "for (const workspace of activeWorkspaces) {"],
    then: ["- Status workspace: ${workspace.status}\n${contesto}\nGenera 2-5 segnali rilevanti"],
  },
];

test("gli 11 punti della tabella: un profilo ciascuno, tutti i profili di PROMPT_PROFILES; la classificazione ha due porte", () => {
  assert.equal(SITES.length, 12);
  const profiles = [...new Set(SITES.map((site) => site.profile))].sort();
  assert.equal(profiles.length, 11);
  assert.deepEqual(profiles, Object.keys(PROMPT_PROFILES).sort());
  assert.deepEqual(
    SITES.filter((site) => site.profile === "classify").map((site) => site.file),
    ["src/lib/actions/classify.ts", "src/lib/mappatura/complete.ts"],
  );
});

test("ogni punto chiama loadPromptContext una volta, con il suo profilo, dopo il controllo di chi chiama, e mette il blocco nel prompt", () => {
  for (const site of SITES) {
    const source = read(site.file);
    const body = topLevelFunction(source, site.fn);
    const call = body.indexOf(site.call);
    assert.ok(call > 0, `${site.file}: ${site.call}`);
    assert.equal(body.split(site.call).length - 1, 1, `${site.file}: una chiamata`);
    for (const gate of site.gates) {
      const at = body.indexOf(gate);
      assert.ok(at > 0, `${site.file}: manca «${gate}»`);
      assert.ok(at < call, `${site.file}: «${gate}» viene prima della lettura del contesto`);
    }
    for (const next of site.then) {
      const at = body.indexOf(next, call);
      assert.ok(at > call, `${site.file}: «${next}» dopo la lettura del contesto`);
    }
    // Fuori dalla funzione nessun'altra chiamata: nel file c'è solo questa (per il completamento, dentro classifyContext).
    assert.equal(code(source).split("loadPromptContext(").length - 1, 1, `${site.file}: una sola chiamata nel file`);
  }
});

test("solo l'ok della richiesta, tranne il cron dei segnali che lo rilegge ora; mai chi guarda nel blocco", () => {
  for (const site of SITES) {
    const source = read(site.file);
    const expected = site.profile === "weeklySignals" ? 'consent: "now"' : 'consent: "request"';
    const calls = [...code(source).matchAll(/loadPromptContext\(([^,]+), \{ ([^}]*) \}\)/g)];
    assert.equal(calls.length, 1, site.file);
    const [, workspace, options] = calls[0];
    assert.ok(options.endsWith(expected), `${site.file}: ${options}`);
    // Solo il workspace e il profilo (la chat anche l'ultima domanda): nessun attore, nessun «Lateral Space».
    assert.match(options, site.profile === "chat" ? /^profile: "chat", query: lastUserContent, consent: "request"$/ : new RegExp(`^profile: "${site.profile}", consent: "(request|now)"$`), site.file);
    assert.match(workspace, /^(workspaceId|ctx\.workspaceId|workspace\.id)$/, site.file);
  }
});

test("l'import: dal modulo di F; il completamento della mappatura lo carica quando serve, come la tesi", () => {
  for (const site of SITES) {
    const source = read(site.file);
    if (site.file === "src/lib/mappatura/complete.ts") {
      assert.doesNotMatch(source, /^import .*context-work/m, "nessun import in cima: il modulo si carica senza database");
      assert.match(
        source,
        /async function classifyContext\(workspaceId: string\): Promise<string> \{\n {2}const \{ loadPromptContext \} = await import\("@\/lib\/db\/queries\/context-work"\);\n {2}return loadPromptContext\(workspaceId, \{ profile: "classify", consent: "request" \}\);\n\}/,
      );
      assert.equal(code(source).split("classifyContext(").length - 1, 2, "la definizione e una chiamata, in loadUnit");
    } else {
      assert.match(source, /^import \{ loadPromptContext \} from "@\/lib\/db\/queries\/context-work";$/m, site.file);
    }
  }
});

test("il completamento della mappatura passa il blocco al classificatore; lo chiamano solo la rotta dopo boardRequest e il tool della chat dopo i controlli", () => {
  const complete = read("src/lib/mappatura/complete.ts");
  assert.match(complete, /loadUnit\(scope: BoardScope\): Promise<\{ unitName: string; activities: Activity\[\]; companyValueThesis: unknown; goals: StrategicGoal\[\]; contesto\?: string \} \| null>;/);
  assert.match(
    topLevelFunction(complete, "export async function completeUnitMapping("),
    /await deps\.classify\(unclassified, \{ companyValueThesis: unit\.companyValueThesis, goals: unit\.goals, contesto: unit\.contesto \?\? "" \}, \{ abortSignal:/,
  );
  // La rotta: prima la sessione, il collaboratore e l'unità (boardRequest), poi il completamento.
  const route = read("src/app/api/workspaces/[workspaceId]/mapping/[deptId]/complete/route.ts");
  const entry = route.indexOf("const entry = await boardRequest(params);\n  if (entry instanceof Response) return entry;");
  assert.ok(entry > 0 && entry < route.indexOf("completeUnitMapping(appCompleteDeps(entry.executor)"));
  const access = read("src/lib/mappatura/board-access.ts");
  const request = topLevelFunction(access, "export async function boardRequest(");
  assert.ok(request.indexOf("const session = await auth();") < request.indexOf("const access = await getCollaboratorAccess(session.user.id, workspaceId);"));
  // La chat: i tool della mappatura si costruiscono dopo l'ok, nella rotta.
  const chat = topLevelFunction(read("src/app/api/ai/chat/route.ts"), "export async function POST(req: Request) {");
  assert.ok(chat.indexOf('error: "ok_fornitori_mancante"') < chat.indexOf("...getActivityMappingTools(workspaceId, unitId!,"));
  // Nessun'altra porta: `appCompleteDeps` (dove si legge il blocco) lo usano solo la rotta e i tool della mappatura, e i
  // tool li costruisce solo la rotta della chat.
  const users = (name: string, definedIn: string) => CODE.filter((file) => file !== definedIn && new RegExp(`\\b${name}\\b`).test(codeOf(file)));
  assert.deepEqual(users("appCompleteDeps", "src/lib/mappatura/complete.ts"), ["src/app/api/workspaces/[workspaceId]/mapping/[deptId]/complete/route.ts", "src/lib/ai/tools/activity-mapping-tools.ts"]);
  assert.deepEqual(users("getActivityMappingTools", "src/lib/ai/tools/activity-mapping-tools.ts"), ["src/app/api/ai/chat/route.ts"]);
});

test("nessun altro chiama loadPromptContext: i 12 file dei punti, e la funzione stessa", () => {
  assert.ok(CODE.length > 500, `${CODE.length} file`);
  const callers = CODE.filter((file) => codeOf(file).includes("loadPromptContext("));
  assert.deepEqual(callers, [...new Set([...SITES.map((site) => site.file), "src/lib/db/queries/context-work.ts"])].sort());
});

test("i generatori: il blocco è un parametro, vuoto per difetto, e sta tra i dati e le richieste (D7: nessun controllo nuovo dell'ok)", () => {
  const generators: ReadonlyArray<[file: string, signature: RegExp, place: string]> = [
    ["src/lib/ai/generate-report.ts", /\n {2}contesto = "",\n\): Promise<ReportContent> \{/, '.join("\\n")}\n${contesto}\n## Output richiesti'],
    ["src/lib/ai/generate-use-cases.ts", /\n {4}contesto\?: string;\n {2}\},\n {2}includeEsg: boolean = false\n\) \{/, "${goalsSummary}\n${strategicContext.contesto ?? \"\"}\n## Regole per la generazione"],
    ["src/lib/ai/classify.ts", /\n {4}contesto\?: string;\n {2}\},\n {2}abortSignal\?: AbortSignal\n\): Promise<ClassificationResult> \{/, '.join("\\n")}\n${strategicContext.contesto ?? ""}\n## I 3 STREAM'],
    ["src/lib/ai/generate-blueprints.ts", /\n {2}activities: Activity\[\],\n {2}contesto = ""\n\) \{/, '  .join("\\n")}\n${contesto}\nPer ogni blueprint specifica:'],
    ["src/lib/ai/generate-simulation.ts", /\n {2}contesto = "",\n\): Promise<SimulationResult> \{/, '.join("\\n")}\n${contesto}\nGenera 3 scenari:'],
  ];
  for (const [file, signature, place] of generators) {
    const source = read(file);
    assert.match(source, signature, `${file}: la firma`);
    assert.equal(source.split(place).length - 1, 1, `${file}: il posto del blocco`);
    // Nessun controllo dell'ok nei generatori (D7) e nessuna lettura: il blocco arriva da chi chiama.
    assert.doesNotMatch(code(source), /contextAiConsent|loadPromptContext\(|from "@\/lib\/db"|@\/lib\/db\/queries\//, file);
  }
  // La classificazione a lotti passa lo stesso contesto a ogni attività.
  const classify = read("src/lib/ai/classify.ts");
  assert.match(topLevelFunction(classify, "export async function classifyActivitiesBatch("), /\n {4}contesto\?: string;\n/);
  assert.match(classify, /batch\.map\(\(activity\) => classifyActivity\(activity, strategicContext, abortSignal\)\)/);
});
