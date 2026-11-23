import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { CASE_ONLY_ROLE, CASE_ONLY_SURFACES } from "./case-only.ts";
import { INVITABLE_ROLES } from "../workspace-roles.ts";

// Le prove di guardia della 8.0d-1 «Porte» (RILASCIO-8.0d-ESTERNI-FASE-2.md §2.5, §2.6, §2.10 U4, §4.10): le porte del
// workspace sono chiuse per default e aperte per elenco, e restano così. Non provano un comportamento: provano la REGOLA
// sui sorgenti, così una porta nuova (pagina, rotta, azione) dimenticata fa fallire la prova invece di aprire il workspace
// di un cliente a una persona di un'altra azienda.
// - Nessun confronto con "learner" fuori dai moduli dei ruoli; nel SQL nessun `<> 'learner'` (un elenco che esclude).
// - Nel SQL `'esterno_caso'` solo con `::text`: prima della 0043 `'esterno_caso'::member_role` è un errore, non un «no».
// - `allowCaseOnly` (anche senza `true`) solo nei file di `CASE_ONLY_SURFACES`, che scrivono `true` da sé, e nei tre
//   moduli delle porte, che non lo scrivono mai; nessuna opzione delle porte esportata. L'elenco resta esatto.
// - Le 9 azioni aperte sono quelle (le 7 di chi costruisce, la conferma della CLI, «Scollega»); le 4 di chi approva no.
// - `esterno_caso` mai tra i ruoli che un invito da Persone dà, né negli inviti dell'organizzazione.
// - Le letture dirette di `getWorkspaceAccessForUser` solo nei file riletti uno per uno, ognuno con un elenco.
// - Ogni pagina del workspace passa da una porta. Ogni rotta dell'app ha una classe e il suo controllo; quelle del
//   workspace con la porta in ogni gestore. Ogni rotta della CLI chiede il caso con `resolveCliCase`, tranne sei.

const root = fileURLToPath(new URL("../../../", import.meta.url));
const rel = (path: string) => relative(root, path).split("\\").join("/");
const read = (file: string) => readFileSync(join(root, file), "utf8");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.(ts|tsx|mjs)$/.test(name) && !/\.test\.(ts|tsx|mjs)$/.test(name)) out.push(path);
  }
  return out;
}

/** Il codice senza commenti: le regole valgono per il codice, non per la prosa che lo spiega. */
const code = (text: string) =>
  text
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/([^:"'`])\/\/[^\n"'`]*$/gm, "$1");

const sources = () => [...walk(join(root, "src")), ...walk(join(root, "mcp"))];

/** I moduli dei ruoli: qui (e solo qui) si nomina `learner` per confrontarlo. */
const ROLE_MODULES = new Set(["src/lib/learning/learner-scope.ts", "src/lib/auth/case-only.ts"]);

test("U4: nessun confronto con \"learner\" fuori dai moduli dei ruoli; nel SQL nessun «tutti tranne learner»", () => {
  const files = sources();
  assert.ok(files.length > 500, `${files.length} file`);
  const compare = /(?:===|!==|==|!=)\s*(?:["'`]learner["'`]|LEARNER_ROLE\b)|(?:["'`]learner["'`]|\bLEARNER_ROLE)\s*(?:===|!==|==|!=)/;
  const sqlDeny = /(?:<>|!=)\s*'learner'|NOT\s+IN\s*\(\s*'learner'\s*\)/i;
  const bad: string[] = [];
  for (const file of files) {
    const name = rel(file);
    const text = code(readFileSync(file, "utf8"));
    if (!ROLE_MODULES.has(name) && compare.test(text)) bad.push(`${name}: confronto con "learner" (usa isLearnerOnly, isCollaboratorRole o workspaceDoor)`);
    if (sqlDeny.test(text)) bad.push(`${name}: «<> 'learner'» nel SQL (usa role::text IN (COLLABORATOR_ROLES_SQL))`);
  }
  assert.deepEqual(bad, []);
  // La prova delle due regole.
  assert.ok(compare.test(`if (role === "learner") x();`) && compare.test(`"learner" !== role`) && compare.test("role !== LEARNER_ROLE"));
  assert.ok(sqlDeny.test("WHERE wm.role::text <> 'learner'") && !sqlDeny.test("WHERE wm.role::text = 'learner'"));
});

test("U4: nel SQL `'esterno_caso'` si confronta solo come testo (`::text`)", () => {
  const offenders: string[] = [];
  for (const file of sources()) {
    const lines = code(readFileSync(file, "utf8")).split("\n");
    for (const line of lines) {
      if (line.includes("'esterno_caso'") && !line.includes("::text")) offenders.push(`${rel(file)}: ${line.trim().slice(0, 120)}`);
    }
  }
  assert.deepEqual(offenders, []);
  // Il valore dell'enum entra nel DDL solo dal modulo della 0043, mai scritto a mano in un'altra istruzione.
  const ddl = sources().filter((file) => /ADD VALUE IF NOT EXISTS/.test(readFileSync(file, "utf8"))).map(rel);
  assert.deepEqual(ddl, ["src/lib/db/use-case-hub-case-only-ddl.ts"]);
});

/** I moduli delle porte: definiscono l'opzione e la passano avanti, mai con `true` scritto. */
const DOOR_MODULES = new Set(["src/lib/auth/case-only.ts", "src/lib/workspace-access.ts", "src/lib/auth/require-workspace.ts"]);
/** Un'opzione delle porte esportata: `export const X = { allowCaseOnly… }`, o un oggetto con l'opzione esportato dopo. */
const EXPORTED_OPTION = /export\s+(?:const|let|var)\s+\w+[^;]*?\ballowCaseOnly\b|export\s+default\s+\{[^;]*?\ballowCaseOnly\b/;
const optionHolders = (text: string) => [...text.matchAll(/\b(?:const|let|var)\s+(\w+)\s*(?::[^=;]+)?=\s*\{[^;]*?\ballowCaseOnly\b/g)].map((m) => m[1]);

test("U4: `allowCaseOnly` solo nelle porte di CASE_ONLY_SURFACES (ognuna con `true` scritto) e nei moduli delle porte; mai un'opzione esportata", () => {
  const files = sources().map((file) => ({ name: rel(file), text: code(readFileSync(file, "utf8")) }));
  // Chi nomina l'opzione (scritta, in un oggetto, in una variabile, in un testo) è una porta dichiarata o un modulo delle porte.
  const naming = files.filter((f) => /\ballowCaseOnly\b/.test(f.text)).map((f) => f.name);
  assert.deepEqual(naming.filter((name) => !DOOR_MODULES.has(name)).sort(), [...CASE_ONLY_SURFACES].sort());
  const bad: string[] = [];
  for (const f of files) {
    if (CASE_ONLY_SURFACES.includes(f.name) && !/\ballowCaseOnly:\s*true\b/.test(f.text)) bad.push(`${f.name}: una porta dichiarata scrive \`allowCaseOnly: true\` da sé`);
    if (DOOR_MODULES.has(f.name) && /\ballowCaseOnly:\s*true\b/.test(f.text)) bad.push(`${f.name}: un modulo delle porte non apre da sé`);
    if (EXPORTED_OPTION.test(f.text)) bad.push(`${f.name}: un'opzione delle porte esportata`);
    for (const holder of optionHolders(f.text)) {
      if (new RegExp(`export\\s*\\{[^}]*\\b${holder}\\b|export\\s+default\\s+${holder}\\b`).test(f.text)) bad.push(`${f.name}: \`${holder}\` esportata`);
    }
  }
  assert.deepEqual(bad, []);
  // La prova delle regole.
  assert.ok(EXPORTED_OPTION.test("export const APRI = { allowCaseOnly: true } as const;"));
  assert.ok(EXPORTED_OPTION.test("export const APRI: WorkspaceDoorOptions = Object.freeze({ allowCaseOnly: true });"));
  assert.ok(!EXPORTED_OPTION.test("const APRI = { allowCaseOnly: true } as const;"));
  assert.deepEqual(optionHolders("const APRI = { allowCaseOnly: true } as const;\nexport { APRI };"), ["APRI"]);
});

test("U4: le azioni aperte a «Solo questo use case» sono 9 (le 7 di chi costruisce, la conferma della CLI, «Scollega»), più «Segna tutte come lette» della campanella", () => {
  const factory = code(read("src/lib/actions/use-case-factory.ts"));
  const opened: string[] = [];
  const closed: string[] = [];
  for (const part of factory.split(/\nexport async function /).slice(1)) {
    const name = part.slice(0, part.indexOf("("));
    if (/requireWorkspaceAccess\(workspaceId, CASE_ONLY_BUILDER\)/.test(part)) opened.push(name);
    else if (/requireWorkspaceAccess\(workspaceId\)/.test(part)) closed.push(name);
  }
  assert.deepEqual(opened.sort(), ["addDecisionAction", "decideTaskProposalAction", "generatePackageAction", "saveProjectDetailsAction", "saveProjectTopicAction", "startProjectAction", "submitProjectAction"]);
  assert.deepEqual(closed.sort(), ["approveProjectAction", "recordAiBoardOkAction", "reopenProjectAction", "requestProjectChangeAction"]);
  assert.match(factory, /const CASE_ONLY_BUILDER = \{ allowCaseOnly: true \} as const;/);
  assert.equal((factory.match(/CASE_ONLY_BUILDER\)/g) ?? []).length, 7);
  // La CLI: solo la conferma (non «Non l'ho chiesto io», che non ha workspace) e «Scollega».
  const login = code(read("src/lib/actions/cli-login.ts"));
  assert.equal((login.match(/allowCaseOnly: true/g) ?? []).length, 1);
  assert.match(login, /export async function confirmCliLoginAction[\s\S]*?requireWorkspaceAccess\(workspaceId, \{ allowCaseOnly: true \}\)/);
  const tokens = code(read("src/lib/actions/cli-tokens.ts"));
  assert.match(tokens, /export async function revokeOwnCliTokenAction[\s\S]*?requireWorkspaceAccess\(workspaceId, \{ allowCaseOnly: true \}\)/);
  // La campanella della barra in alto: solo «Segna tutte come lette», mai la scelta delle e-mail (il foglio dell'account).
  const bell = code(read("src/lib/actions/notifications.ts"));
  assert.equal((bell.match(/allowCaseOnly: true/g) ?? []).length, 1);
  assert.match(bell, /export async function markAllBellReadAction[\s\S]*?getCollaboratorAccess\(s\.userId, workspaceId, \{ allowCaseOnly: true \}\)/);
  // Nessun'altra azione apre: la regola di sopra lo dice per i file; qui per le azioni dei file aperti.
  for (const file of walk(join(root, "src/lib/actions"))) {
    const name = rel(file);
    if (["src/lib/actions/use-case-factory.ts", "src/lib/actions/cli-login.ts", "src/lib/actions/cli-tokens.ts", "src/lib/actions/notifications.ts"].includes(name)) continue;
    assert.doesNotMatch(code(readFileSync(file, "utf8")), /allowCaseOnly/, name);
  }
});

test("U4: esterno_caso mai tra i ruoli di un invito da Persone, né negli inviti o nelle membership dell'organizzazione", () => {
  assert.ok(!(INVITABLE_ROLES as readonly string[]).includes(CASE_ONLY_ROLE));
  // `WORKSPACE_COLLABORATOR_ROLES` (gli inviti e i cambi di ruolo da Persone), letto dal sorgente: il modulo legge il database.
  const collaboration = code(read("src/lib/db/queries/workspace-collaboration.ts"));
  const invitable = /export const WORKSPACE_COLLABORATOR_ROLES = \[([^\]]*)\] as const;/.exec(collaboration)?.[1] ?? "";
  assert.deepEqual(invitable.match(/"[a-z_]+"/g), ['"transformation_lead"', '"function_lead"', '"contributor"', '"analyst"']);
  // Gli inviti e le membership dell'organizzazione: il codice non scrive mai il ruolo lì.
  const org = code(read("src/lib/db/queries/organizations.ts"));
  assert.doesNotMatch(org, /esterno_caso|CASE_ONLY_ROLE/);
  for (const file of sources()) {
    const text = code(readFileSync(file, "utf8"));
    assert.doesNotMatch(text, /INSERT INTO (?:memberships|invitations)\b[\s\S]{0,400}esterno_caso/, rel(file));
  }
  // Un collaboratore non si cambia in «Solo questo use case» da Persone: il ruolo nuovo deve stare nell'elenco degli inviti.
  const actions = code(read("src/lib/actions/workspace-collaboration.ts"));
  assert.match(actions, /if \(!\(WORKSPACE_COLLABORATOR_ROLES as readonly string\[\]\)\.includes\(role\)\) \{\s*return errorState\("Ruolo non valido\."\);/);
  assert.match(actions, /if \(isCaseOnly\(membership\.role\)\) \{[\s\S]*?return errorState\(CASE_ONLY_ROLE_NOTE\);/);
  // «Crea un altro link» da Persone non rifà un invito «Solo questo use case» (che senza il suo caso non varrebbe).
  assert.match(actions, /if \(isCaseOnly\(previous\.role\)\) \{\s*return errorState\(/);
});

test("le tre porte usano la regola unica (`workspaceDoor`), senza altri confronti di ruolo", () => {
  const access = code(read("src/lib/workspace-access.ts"));
  assert.match(access, /return access && workspaceDoor\(access\.role, \{ allowCaseOnly: opts\.allowCaseOnly === true \}\) === "aperta" \? access : null;/);
  assert.match(access, /if \(organizationMembership && !isCaseOnly\(organizationMembership\.role\)\) \{/, "una riga dell'organizzazione con esterno_caso non vale");
  const require = code(read("src/lib/auth/require-workspace.ts"));
  assert.match(require, /if \(!access \|\| workspaceDoor\(access\.role, opts\) !== "aperta"\) \{\s*throw new Error/);
  assert.match(require, /const door = workspaceDoor\(access\.role, opts\);\s*if \(door === "formazione"\) redirect\(learnerHomePath\(workspaceId\)\);\s*if \(door === "solo_caso"\) redirect\(caseOnlyHomePath\(workspaceId\)\);\s*if \(door !== "aperta"\) notFound\(\);/);
  for (const text of [access, require]) assert.doesNotMatch(text, /\.role\s*(?:===|!==)/);
  // Il dossier: «Solo questo use case» passa solo con il predicato per quel caso.
  const uc = code(read("src/lib/db/queries/uc-access.ts"));
  assert.match(uc, /if \(!isCollaboratorRole\(input\.workspaceRole\) && !caseOnly\) return false;/);
  assert.match(uc, /if \(caseOnly && !\(await caseOnlyBuildsCase\(input\.caseId\.toLowerCase\(\), input\.userId\.toLowerCase\(\)\)\)\) return false;/);
});

/** I file che leggono `getWorkspaceAccessForUser` da sé, riletti uno per uno (§2.5), ognuno con un elenco di ruoli. */
const DIRECT_READS = new Map<string, RegExp>([
  ["src/lib/workspace-access.ts", /workspaceDoor\(/],
  ["src/lib/auth/require-workspace.ts", /workspaceDoor\(/],
  ["src/app/(dashboard)/dashboard/[workspaceId]/layout.tsx", /workspaceDoor\(access\.role, \{ allowLearner: true, allowCaseOnly: true \}\) !== "aperta"\) notFound\(\)/],
  ["src/app/invite/[token]/page.tsx", /keepsCurrentRole\(/],
  ["src/app/share/portfolio/[workspaceId]/[useCaseId]/page.tsx", /isCollaboratorRole\(access\.role\)/],
  ["src/app/api/learning/session/route.ts", /workspaceDoor\(access\.role, \{ allowLearner: true \}\) !== "aperta"/],
  ["src/lib/learning/server.ts", /workspaceDoor\(access\.role, \{ allowLearner: true \}\) !== "aperta"/],
  ["src/lib/learning/admin.ts", /workspaceDoor\(access\.role, \{ allowLearner: true \}\) !== "aperta"/],
  ["src/lib/learning/materials.ts", /workspaceDoor\(access\.role, \{ allowLearner: true \}\) !== "aperta"/],
  ["src/lib/learning/register.ts", /!isCollaboratorRole\(access\.role\)/],
]);

test("le letture dirette di getWorkspaceAccessForUser: solo nei file riletti, ognuno con un elenco di ruoli", () => {
  const readers = sources()
    .filter((file) => /\bgetWorkspaceAccessForUser\(/.test(code(readFileSync(file, "utf8"))))
    .map(rel)
    .sort();
  assert.deepEqual(readers, [...DIRECT_READS.keys()].sort(), "una lettura nuova va riletta e aggiunta qui, con il suo elenco");
  for (const [file, rule] of DIRECT_READS) assert.match(code(read(file)), rule, file);
});

const WORKSPACE_PAGES = "src/app/(dashboard)/dashboard/[workspaceId]";
/** Le pagine della Formazione passano dalla porta della Formazione (`requireWorkspace` e i suoi aiuti), chiusa per elenco. */
const LEARNING_DOOR = /\b(?:getLearning\w*|requireLearning\w*|requireRegisterAccess|ProgramOverview|getMyLearningIdea)\b/;

test("ogni pagina del workspace passa da una porta: requireWorkspacePage, la Formazione, o un rimando senza dati", () => {
  const pages = walk(join(root, WORKSPACE_PAGES)).filter((file) => file.endsWith("page.tsx"));
  // (Rilascio 10) Meno pagine: le schede tolte sono diventate rimandi 308 (rotte, sotto).
  assert.ok(pages.length > 50, `${pages.length} pagine`);
  const open: string[] = [];
  for (const file of pages) {
    const text = code(readFileSync(file, "utf8"));
    if (/\brequireWorkspacePage\(/.test(text)) continue;
    const name = rel(file);
    if (name.startsWith(`${WORKSPACE_PAGES}/learning/`) && LEARNING_DOOR.test(text)) continue;
    if (/\bredirect\(/.test(text) && !/@\/lib\/db|@\/lib\/learning\/server/.test(text)) continue;
    open.push(name);
  }
  assert.deepEqual(open, []);
  // Le pagine che dichiarano «Solo questo use case» sono quelle del perimetro: lo dice la prova di `allowCaseOnly`.
  const caseOnlyPages = pages.filter((file) => /\ballowCaseOnly:\s*true\b/.test(code(readFileSync(file, "utf8")))).map(rel).sort();
  assert.deepEqual(caseOnlyPages, [
    `${WORKSPACE_PAGES}/agent-factory/page.tsx`,
    `${WORKSPACE_PAGES}/casi-duso/[caseId]/costruzione/page.tsx`,
    `${WORKSPACE_PAGES}/use-cases/[useCaseId]/progetto/page.tsx`,
  ]);
});

/** I gestori esportati di una rotta (`export async function GET…`), ognuno con il suo corpo fino al prossimo export. */
function handlers(text: string): Array<{ method: string; body: string }> {
  const parts = text.split(/\nexport (?=(?:async )?function (?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b)/).slice(1);
  return parts.map((part) => ({ method: /function (\w+)/.exec(part)?.[1] ?? "?", body: part.split(/\nexport /)[0] }));
}

// (Rilascio 10) Anche `requireWorkspacePage` in una rotta (`firme`, il pannello delle firme dal vecchio indirizzo): la stessa
// porta chiusa delle pagine (`esterno_caso` all'Agent Factory, un ruolo sconosciuto 404).
const WORKSPACE_DOOR = /\b(?:requireWorkspaceAccess|requireWorkspacePage|getCollaboratorAccess|openFileRoute|openReferentFileRoute|boardRequest|contextActorFromSession)\(/;
/**
 * Ogni rotta dell'app ha una classe (la prima che le corrisponde, in quest'ordine): dove sta e il controllo con cui si
 * apre. Una rotta nuova fuori da ogni classe fa fallire la prova: va classificata, con una revisione delle porte. Le rotte
 * del workspace vogliono la porta in ogni gestore esportato, non in un punto qualunque del file.
 */
const ROUTE_CLASSES: ReadonlyArray<{ name: string; path: RegExp; check: RegExp; perHandler?: boolean; noDb?: boolean }> = [
  {
    // (Rilascio 10, ondata 5b) Anche `progetto`: «Progetto dell'agente» è la Costruzione, e il vecchio indirizzo un 308
    // che non legge niente (fuori dai layout: il perimetro e le porte li incontra la Costruzione). E le schede diventate
    // pannelli o sezioni: `domande/documenti`, `soluzione/regole`, `via` (la sezione `#via` della Panoramica).
    name: "vecchio indirizzo del dossier (308)",
    path: /^src\/app\/\(dashboard\)\/dashboard\/\[workspaceId\]\/casi-duso\/\[caseId\]\/(?:avanzamento|documenti|domande\/documenti|kpi|mappa|modello-dati|progetto|registro|registro\/csv|regole|roi|soluzione\/regole|verifica|via|voci|voci\/\[itemId\])\/route\.ts$/,
    check: /\b(?:legacyCaseRouteFromPath|viaRedirect)\(/,
    noDb: true,
  },
  {
    // (Rilascio 10, ondata 7a) «Avanzamento» di un corso è una sezione dei risultati: un 308 che non legge niente.
    name: "vecchio indirizzo della Formazione (308)",
    path: /^src\/app\/\(dashboard\)\/dashboard\/\[workspaceId\]\/learning\/\[programId\]\/progress\/route\.ts$/,
    check: /\bprogressTarget\(/,
    noDb: true,
  },
  {
    name: "porta del workspace",
    path: /^src\/app\/(?:\(dashboard\)\/dashboard\/\[workspaceId\]\/|api\/workspaces\/\[workspaceId\]\/|api\/context\/\[workspaceId\]\/|api\/ai\/chat\/|api\/documents\/upload\/|api\/ai-readiness\/assessments\/)/,
    check: WORKSPACE_DOOR,
    perHandler: true,
  },
  { name: "classificazione (l'azione con la sua porta)", path: /^src\/app\/api\/ai\/classify\/route\.ts$/, check: /\brunClassificationAction\(/ },
  { name: "CLI (prova a parte, sotto)", path: /^src\/app\/api\/cli\//, check: /\b(?:openCli|handleCaseMcpRequest|startCliLogin|deliverCliLogin|authenticateCli)\b/ },
  { name: "CI (la chiave di un repository)", path: /^src\/app\/api\/ci\//, check: /\bopenCi\(/ },
  { name: "MCP del team", path: /^src\/app\/api\/mcp\/use-case\/route\.ts$/, check: /\bhandleTeamMcpRequest\b/ },
  { name: "MCP dei dossier", path: /^src\/app\/api\/mcp\/casi\/cases\//, check: /\bhandleCaseRead\(/ },
  { name: "connettore", path: /^src\/app\/api\/mcp\/connettore\//, check: /\bhandleConnectorRequest\b/ },
  { name: "MCP del portafoglio", path: /^src\/app\/api\/mcp\/portfolio\/(?:submissions|requirements)\/route\.ts$/, check: /\b(?:handlePortfolioSubmissionPost|authenticateWorkspaceIntegrationToken)\(/ },
  { name: "file degli MCP", path: /^src\/app\/api\/mcp\/(?:casi|portfolio)\/(?:server|skill)\/route\.ts$/, check: /\breadFile\(/ },
  { name: "link del referente (dossier)", path: /^src\/app\/api\/r\/\[token\]\//, check: /\bhandlePublic\(/ },
  { name: "link del referente (use case)", path: /^src\/app\/api\/rispondi\/\[token\]\//, check: /\bhandleReferentPublic\(/ },
  { name: "link del rispondente", path: /^src\/app\/api\/ai-readiness\/respondents\/\[token\]\//, check: /\bgetRespondentPrivacyBundleByTokenHash\(/ },
  { name: "cron", path: /^src\/app\/api\/cron\//, check: /\b(?:checkCronAuthorization|handleUcCron)\(|\bCRON_SECRET\b/ },
  { name: "webhook di GitHub", path: /^src\/app\/api\/github\/webhook\/route\.ts$/, check: /\bverifyGithubSignature\(/ },
  { name: "Slack", path: /^src\/app\/(?:api\/slack\/|install\/slack\/)/, check: /\b(?:handleSlackWebhookPost|verifySlackRequestSignature|getUserMembership|userHasWorkspaceAccess)\(/ },
  { name: "sessione", path: /^src\/app\/api\/auth\/session\/route\.ts$/, check: /\bcreateSessionCookie\(/ },
  { name: "Granola", path: /^src\/app\/api\/granola\//, check: /\b(?:completeGranolaConnect|clientMetadataDocument)\(/ },
  { name: "Formazione (la sua porta, per elenco)", path: /^src\/app\/api\/learning\//, check: /\b(?:readLearningRequest|performLearningAdmin|readMaterialForDownload|requireFullProgramManager|requireRegisterAccess|workspaceDoor)\(/ },
  { name: "testo pubblico", path: /^src\/app\/llms(?:-full)?\.txt\/route\.ts$/, check: /\bexport (?:async )?function GET\b/, noDb: true },
];

test("ogni rotta dell'app ha una classe e il suo controllo; quelle del workspace con la porta in ogni gestore", () => {
  const routes = walk(join(root, "src/app")).filter((file) => /\/route\.tsx?$/.test(file));
  assert.ok(routes.length > 130, `${routes.length} rotte`);
  const bad: string[] = [];
  for (const file of routes) {
    const name = rel(file);
    const text = code(readFileSync(file, "utf8"));
    const klass = ROUTE_CLASSES.find((c) => c.path.test(name));
    if (!klass) {
      bad.push(`${name}: senza classe: classificala, con una revisione delle porte`);
      continue;
    }
    if (!klass.check.test(text)) bad.push(`${name}: la classe «${klass.name}» vuole il suo controllo`);
    if (klass.noDb && /@\/lib\/(?:db|learning\/server)/.test(text)) bad.push(`${name}: «${klass.name}» senza database`);
    if (klass.perHandler) {
      const found = handlers(text);
      if (found.length === 0) bad.push(`${name}: nessun gestore esportato come funzione`);
      for (const h of found) if (!klass.check.test(h.body)) bad.push(`${name} ${h.method}: senza la porta`);
    }
  }
  assert.deepEqual(bad, []);
});

/**
 * Le rotte della CLI che non leggono un caso, una per una, ognuna con il suo controllo. Tutte le altre, in ogni gestore,
 * aprono la CLI (`openCli`, aperta anche a `esterno_caso`) e chiedono il caso con il predicato (`resolveCliCase`).
 */
const CLI_WITHOUT_CASE = new Map<string, RegExp>([
  ["src/app/api/cli/login/route.ts", /\bstartCliLogin\(/],
  ["src/app/api/cli/login/token/route.ts", /\bdeliverCliLogin\(/],
  ["src/app/api/cli/logout/route.ts", /\bauthenticateCli\(/],
  ["src/app/api/cli/mcp/route.ts", /\bhandleCaseMcpRequest\b/],
  ["src/app/api/cli/nota/route.ts", /\bisCliLateralSpace\(/],
  ["src/app/api/cli/whoami/route.ts", /\bopenCli\(/],
]);

test("la CLI: ogni rotta chiede il caso con il predicato (`resolveCliCase`) in ogni gestore, tranne le sei senza caso", () => {
  const routes = walk(join(root, "src/app/api/cli")).filter((file) => /\/route\.tsx?$/.test(file));
  assert.ok(routes.length >= 18, `${routes.length} rotte della CLI`);
  const bad: string[] = [];
  for (const file of routes) {
    const name = rel(file);
    const text = code(readFileSync(file, "utf8"));
    const exception = CLI_WITHOUT_CASE.get(name);
    if (exception) {
      if (!exception.test(text)) bad.push(`${name}: senza il suo controllo`);
      continue;
    }
    const found = handlers(text);
    if (found.length === 0) bad.push(`${name}: nessun gestore esportato come funzione`);
    for (const h of found) {
      if (!/\bopenCli\(/.test(h.body)) bad.push(`${name} ${h.method}: senza openCli`);
      if (!/\bresolveCliCase\(/.test(h.body)) bad.push(`${name} ${h.method}: senza resolveCliCase (il caso con il predicato)`);
    }
  }
  assert.deepEqual(bad, []);
  // Le eccezioni dicono il vero: whoami legge solo il codice del caso del suo token; nota è solo di Lateral Space; l'MCP
  // del caso vuole il token di un caso, poi il predicato.
  const whoami = code(read("src/app/api/cli/whoami/route.ts"));
  assert.equal((whoami.match(/\b(?:use_cases|uc_cases)\b/g) ?? []).length, 1);
  assert.match(whoami, /SELECT code FROM use_cases WHERE id = \$\{cast\(principal\.caseUseCaseId, "uuid"\)\} AND workspace_id = /);
  assert.doesNotMatch(whoami, /\b(?:loadAgentContext|familyChoices|readFactory\w*|listTasks\w*)\b/);
  assert.match(code(read("src/app/api/cli/nota/route.ts")), /if \(!\(await isCliLateralSpace\(opened\.value\)\)\) return cliError\(403, "solo_lateral_space"/);
  const mcp = code(read("src/lib/use-cases/cli/mcp.ts"));
  assert.match(mcp, /if \(principal\.caseUseCaseId === null\) \{/);
  assert.match(mcp, /await resolveCliCase\(opened, principal\.caseUseCaseId\)/);
  const kit = code(read("src/lib/use-cases/cli/route-kit.ts"));
  assert.match(kit, /const access = await getCollaboratorAccess\(principal\.userId, principal\.workspaceId, \{ allowCaseOnly: true \}\);/);
  for (const file of walk(join(root, "src/app/api/cli"))) {
    const text = code(readFileSync(file, "utf8"));
    assert.doesNotMatch(text, /\b(?:requireWorkspaceAccess|getCollaboratorAccess|getWorkspaceAccessForUser)\(/, rel(file));
  }
  // Gli MCP del team, del portafoglio, dei dossier e del connettore non aprono mai a «Solo questo use case».
  for (const dir of ["src/app/api/mcp", "src/lib/use-cases/mcp", "src/lib/connector"]) {
    for (const file of walk(join(root, dir))) assert.doesNotMatch(code(readFileSync(file, "utf8")), /allowCaseOnly|esterno_caso|isCaseOnly/, rel(file));
  }
});

/**
 * (Rilascio 10) Le pagine del perimetro dopo le ondate 5a, 5b e 6b: che cosa «Solo questo use case» vede dentro le porte
 * che lo dichiarano. Il guscio del dossier ha solo la testata; la Costruzione («Progetto dell'agente») il caso con il
 * predicato e `CONTESTO.md` ridotto (D7); l'Agent Factory solo i suoi casi, senza i pannelli del manager.
 */
test("il perimetro dentro le porte: il guscio del dossier con la sola testata, la Costruzione, l'Agent Factory", () => {
  const shell = code(read(`${WORKSPACE_PAGES}/casi-duso/[caseId]/layout.tsx`));
  assert.match(shell, /const \{ session, access \} = await requireWorkspacePage\(workspaceId, \{ allowCaseOnly: true \}\);\s*const caseOnly = isCaseOnly\(access\.role\);/);
  // Niente schede, «⋯», passo, conferme di transizione, avvisi, avanzamento, firme né esportazioni.
  assert.match(shell, /const primary = !caseOnly && next && usable\(next\) \? next : null;/);
  assert.match(shell, /const transitionStep = caseOnly \? undefined : /);
  assert.match(shell, /const menu: CaseMenuEntry\[\] = caseOnly\s*\? \[\]/);
  assert.match(shell, /const alert = caseOnly\s*\? null/);
  assert.match(shell, /const tabs = caseOnly \? \[\] : caseTabsFor\(/);
  assert.match(shell, /const progress = caseOnly \? null : header\.progress;/);
  assert.match(shell, /\{caseOnly \? null : <CaseSignaturesPanel /);
  assert.match(shell, /canExport && !caseOnly/);
  // Il percorso torna all'Agent Factory, mai agli use case.
  assert.match(shell, /const trail = caseOnly\s*\? \(\{ kind: "lista", back: \{ label: SHELL_TEXT\.nav\.factory, href: caseOnlyHomePath\(workspaceId\) \} \} as const\)/);
  assert.doesNotMatch(shell, /header\.progress \?/, "l'avanzamento passa solo da `progress`");

  const build = code(read(`${WORKSPACE_PAGES}/casi-duso/[caseId]/costruzione/page.tsx`));
  assert.match(build, /const \{ session, access \} = await requireWorkspacePage\(workspaceId, \{ allowCaseOnly: true \}\);\s*const caseOnly = isCaseOnly\(access\.role\);\s*const \{ caseAccess, executor, header \} = await loadCaseHead\(/);
  assert.match(build, /if \(!canOpenShellPage\("costruzione", roles\)\) notFound\(\);/);
  assert.match(build, /const caseOnlyContext = caseOnly \|\| \(await hasCaseOnlyBuilder\(executor, target\)\);\s*const view = caseOnlyContext \? caseOnlyView\(read\.value\) : read\.value;/);
  assert.match(build, /const headerStep = !caseOnly && headerStepShownOn\(/);
  // Il contesto dell'azienda non si legge: la piega «Contesto» passa da `contextAbilities`, chiusa a chi non è collaboratore.
  assert.match(build, /readContextSection\(contextActorFor\(session\.user, access, workspaceId\), useCase\.useCaseId\)/);
  assert.match(code(read("src/lib/context/visibility.ts")), /if \(typeof role !== "string" \|\| !isCollaboratorRole\(role\)\) return NOTHING;/);
  // Gli accessi di Claude (i token dei dossier) e i link fuori dal perimetro restano a chi li apre.
  assert.match(build, /const claudeShown = ls && pastVia;/);
  assert.match(build, /const catalogHref = pastVia && canOpenPage\("voci", roles\)/);
  assert.match(build, /const backtestHref = details && canOpenPage\("modello_dati", roles\)/);

  const factory = code(read(`${WORKSPACE_PAGES}/agent-factory/page.tsx`));
  assert.match(factory, /const lsManager = !caseOnly && viewer\.isLateralSpace && canReviewWorkspacePortfolio\(access\.role\);/);
  assert.match(factory, /if \(caseOnly\) await joinCaseOnlyDossiers\(/);
  assert.match(factory, /seeAll: lsManager, canSeeNeeds: abilitiesForUseCase\(viewer\)\.canSeeNeeds, lsDomains, caseOnly \}\);/);
  // «Chi costruisce» e «Repository da aggiornare» solo al manager: per «Solo questo use case» non si leggono nemmeno.
  assert.match(factory, /lsManager \? listBuilders\(executor, workspaceId, lsDomains\) : Promise\.resolve\(null\)/);
  assert.match(factory, /manager: lsManager,\s*caseOnly,/);
});
