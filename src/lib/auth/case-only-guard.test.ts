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
// - `allowCaseOnly: true` solo nei file di `CASE_ONLY_SURFACES`, e ognuno lo dichiara: l'elenco resta esatto.
// - Le 9 azioni aperte sono quelle (le 7 di chi costruisce, la conferma della CLI, «Scollega»); le 4 di chi approva no.
// - `esterno_caso` mai tra i ruoli che un invito da Persone dà, né negli inviti dell'organizzazione.
// - Le letture dirette di `getWorkspaceAccessForUser` solo nei file riletti uno per uno, ognuno con un elenco.
// - Ogni pagina del workspace passa da una porta; ogni rotta del workspace pure (o è un vecchio indirizzo senza dati).

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

test("U4: `allowCaseOnly: true` solo nelle porte di CASE_ONLY_SURFACES, e ognuna lo dichiara", () => {
  const declared = sources()
    .filter((file) => rel(file) !== "src/lib/auth/case-only.ts" && /\ballowCaseOnly:\s*true\b/.test(code(readFileSync(file, "utf8"))))
    .map(rel)
    .sort();
  assert.deepEqual(declared, [...CASE_ONLY_SURFACES].sort());
});

test("U4: le azioni aperte a «Solo questo use case» sono 9: le 7 di chi costruisce, la conferma della CLI e «Scollega»", () => {
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
  // Nessun'altra azione apre: la regola di sopra lo dice per i file; qui per le azioni dei file aperti.
  for (const file of walk(join(root, "src/lib/actions"))) {
    const name = rel(file);
    if (["src/lib/actions/use-case-factory.ts", "src/lib/actions/cli-login.ts", "src/lib/actions/cli-tokens.ts"].includes(name)) continue;
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
  assert.ok(pages.length > 60, `${pages.length} pagine`);
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
    `${WORKSPACE_PAGES}/casi-duso/[caseId]/progetto/page.tsx`,
    `${WORKSPACE_PAGES}/use-cases/[useCaseId]/progetto/page.tsx`,
  ]);
});

test("ogni rotta del workspace passa da una porta, o è un vecchio indirizzo senza database", () => {
  const dirs = [WORKSPACE_PAGES, "src/app/api/workspaces/[workspaceId]", "src/app/api/context/[workspaceId]"];
  const routes = dirs.flatMap((dir) => walk(join(root, dir))).filter((file) => /route\.tsx?$/.test(file));
  assert.ok(routes.length > 30, `${routes.length} rotte`);
  const DOORS = /\b(?:requireWorkspaceAccess|getCollaboratorAccess|openFileRoute|openReferentFileRoute|boardRequest|contextActorFromSession)\(/;
  const open: string[] = [];
  for (const file of routes) {
    const text = code(readFileSync(file, "utf8"));
    if (DOORS.test(text)) continue;
    if (/legacyCaseRouteFromPath\(/.test(text) && !/@\/lib\/db/.test(text)) continue;
    open.push(rel(file));
  }
  assert.deepEqual(open, []);
});

test("la CLI e l'MCP del caso: una porta sola (`openCli`), poi il predicato per ogni caso; mai le altre porte del workspace", () => {
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
