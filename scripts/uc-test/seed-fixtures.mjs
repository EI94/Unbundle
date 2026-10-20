// Synthetic fixtures for the Casi d'uso harness (PIANO §9.2, step 6).
//
//   UC_TEST_ROOT=/private/tmp/<dir> node --no-warnings scripts/uc-test/seed-fixtures.mjs [--workspace-name-from-seed <private seed.json>]
//
// Creates emulator accounts with verified emails and matching `users` rows, two
// organizations/workspaces and workspace memberships, only on the isolated database
// (127.0.0.1:55449) and the Auth emulator (127.0.0.1:59109). Then the synthetic example
// case of workspace «a» («caso d'esempio», DESIGN §8.1 c): the invented template
// templates/uc/esempio.minimo is loaded and published, ls-lead creates the case and gives
// every other account of «a» its case role, ls-sviluppatore included (ls_sviluppatore).
// The manifest with the synthetic passwords and the example case is written outside Git,
// mode 0600. Customer names never appear in this file: the workspace name can be read at
// run time from the private seed.
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  UC_TEST_AUTH_PORT,
  UC_TEST_AUTH_PROJECT,
  UC_TEST_DATABASE_URL,
  UC_TEST_DB,
  UC_TEST_HOST,
  UC_TEST_LS_DOMAIN,
  UC_TEST_PORT,
  UC_TEST_USER,
  ucTestRoot,
} from "./config.mjs";

const requireFromApp = createRequire(resolve("package.json"));
const { Client } = requireFromApp("pg");
const root = ucTestRoot();
const outputDirectory = join(root, "uc-fixtures");
const auth = `http://${UC_TEST_HOST}:${UC_TEST_AUTH_PORT}`;
const PASSWORD = "Synthetic-only-uc-4862";

function workspaceNameFromSeed() {
  const index = process.argv.indexOf("--workspace-name-from-seed");
  if (index === -1) return "Cliente Esempio";
  const seed = JSON.parse(readFileSync(resolve(process.argv[index + 1]), "utf8"));
  if (typeof seed.workspace_hint !== "string" || !seed.workspace_hint.trim()) throw new Error("The seed has no workspace_hint");
  // Same rule as the seed lookup (PIANO §8.1): the part in parentheses is not part of the name.
  return seed.workspace_hint.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
}

// name → [email domain, workspace letter, workspace role]
const ACCOUNTS = {
  "ls-lead": [UC_TEST_LS_DOMAIN, "a", "transformation_lead"],
  "ls-analista": [UC_TEST_LS_DOMAIN, "a", "analyst"],
  // Lateral Space developer: reads the validated catalog (case role ls_sviluppatore).
  "ls-sviluppatore": [UC_TEST_LS_DOMAIN, "a", "contributor"],
  "owner-cliente": ["cliente.test", "a", "contributor"],
  "approvatore-privacy": ["cliente.test", "a", "contributor"],
  osservatore: ["cliente.test", "a", "contributor"],
  // A client user with a portfolio role: must never become ls_lead.
  "function-lead": ["cliente.test", "a", "function_lead"],
  estraneo: ["altro.test", "b", "contributor"],
};

const client = new Client({ host: UC_TEST_HOST, port: UC_TEST_PORT, user: UC_TEST_USER, database: UC_TEST_DB });
await client.connect();
try {
  const existing = await client.query("SELECT 1 FROM organizations WHERE slug IN ('uc-test-a', 'uc-test-b')");
  if (existing.rowCount) throw new Error("Synthetic uc fixtures already exist: reuse the manifest in UC_TEST_ROOT/uc-fixtures or start from a new cluster");

  const workspaces = {};
  const names = { a: workspaceNameFromSeed(), b: "Workspace di prova B" };
  for (const letter of ["a", "b"]) {
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    await client.query("INSERT INTO organizations (id, name, slug) VALUES ($1, $2, $3)", [organizationId, `Organizzazione di prova ${letter.toUpperCase()}`, `uc-test-${letter}`]);
    await client.query("INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, $3)", [workspaceId, organizationId, names[letter]]);
    workspaces[letter] = { organizationId, workspaceId, name: names[letter] };
  }

  const accounts = {};
  for (const [name, [domain, letter, role]] of Object.entries(ACCOUNTS)) {
    const email = `${name}@${domain}`;
    const signUp = await fetch(`${auth}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=local-only`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
    });
    const body = await signUp.json();
    if (!signUp.ok || !body.localId) throw new Error(`Emulator signup failed for ${name}`);
    // Mark the email verified in the emulator too (admin endpoint of the emulator only).
    await fetch(`${auth}/identitytoolkit.googleapis.com/v1/projects/${UC_TEST_AUTH_PROJECT}/accounts:update`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer owner" },
      body: JSON.stringify({ localId: body.localId, emailVerified: true }),
    }).catch(() => undefined);
    const id = randomUUID();
    await client.query("INSERT INTO users (id, firebase_uid, email, name, email_verified) VALUES ($1, $2, $3, $4, now())", [id, body.localId, email, `Prova ${name}`]);
    await client.query("INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, $3)", [workspaces[letter].workspaceId, id, role]);
    accounts[name] = { id, firebaseUid: body.localId, email, password: PASSWORD, workspace: letter, workspaceRole: role };
  }

  mkdirSync(outputDirectory, { recursive: true });
  const manifestPath = join(outputDirectory, "synthetic-fixtures.json");
  const writeManifest = (extra = {}) =>
    writeFileSync(manifestPath, JSON.stringify({ accounts, workspaces, lsDomain: UC_TEST_LS_DOMAIN, ...extra }, null, 2), { mode: 0o600 });
  // Accounts first: the login helper works even if the example case below fails.
  writeManifest();
  console.log(`Created ${Object.keys(accounts).length} synthetic accounts and 2 workspaces. Manifest: ${manifestPath}`);

  const exampleCase = await createExampleCase(accounts, workspaces.a.workspaceId);
  writeManifest({ exampleCase });
  console.log(`Created the example case ${exampleCase.code} (${exampleCase.caseId}) in workspace a, with ${exampleCase.members.length + 1} case roles.`);
} finally {
  await client.end();
}

/**
 * The synthetic example case, through the same commands the app uses (template load,
 * createCase, addCaseMember), on the isolated database only: the Neon HTTP driver goes
 * through scripts/uc-test/local-neon.cjs, which refuses any other database.
 */
async function createExampleCase(accounts, workspaceId) {
  process.env.UC_TEST_DATABASE_URL = UC_TEST_DATABASE_URL;
  createRequire(import.meta.url)("./local-neon.cjs");
  const { ucExecutorForUrl } = await import(new URL("../../src/lib/db/uc-executor.ts", import.meta.url).href);
  const { applyTemplateLoad } = await import(new URL("../../src/lib/db/queries/uc-templates.ts", import.meta.url).href);
  const { planTemplateLoad } = await import(new URL("../../src/lib/uc/template/load.ts", import.meta.url).href);
  const { addCaseMember, commandContextFor, createCase, loadUserContext } = await import(new URL("../../src/lib/db/queries/uc-cases.ts", import.meta.url).href);
  const exec = ucExecutorForUrl(UC_TEST_DATABASE_URL);
  const lsDomains = [UC_TEST_LS_DOMAIN];
  const lead = accounts["ls-lead"].id;

  const templateFile = "templates/uc/esempio.minimo/1.0.0.json";
  const plan = planTemplateLoad(readFileSync(resolve(templateFile), "utf8"), { filePath: templateFile });
  if (!plan.ok) throw new Error(`Example template not valid: ${plan.message ?? plan.code}`);
  const loaded = await applyTemplateLoad(exec, plan.plan, { actorUserId: lead, publish: true });
  if (!loaded.ok) throw new Error(`Example template not loaded: ${loaded.message}`);

  const user = await loadUserContext(exec, lead, lsDomains);
  const created = await createCase(exec, {
    workspaceId,
    user,
    canReviewWorkspacePortfolio: true,
    input: {
      templateId: loaded.value.templateId,
      code: "ES-0001",
      title: "Smistamento richieste",
      oneLiner: "Instrada ogni richiesta alla persona giusta, con i dati che servono.",
      levers: ["tempo", "qualita"],
    },
  });
  if (!created.ok) throw new Error(`Example case not created: ${created.message}`);
  const caseId = created.value.caseId;

  const context = await commandContextFor(exec, { workspaceId, caseId, userId: lead, lsDomains });
  if (!context.ok) throw new Error(`No command context for ls-lead: ${context.message}`);
  const members = [
    ["ls-analista", "ls_analista"],
    ["ls-sviluppatore", "ls_sviluppatore"],
    ["owner-cliente", "owner_cliente"],
    ["approvatore-privacy", "approvatore_privacy"],
    ["osservatore", "osservatore"],
  ];
  for (const [name, role] of members) {
    const added = await addCaseMember(exec, context.value, { userId: accounts[name].id, role });
    if (!added.ok) throw new Error(`${name} not added as ${role}: ${added.message}`);
  }
  return {
    caseId,
    code: created.value.code,
    workspace: "a",
    templateKey: plan.plan.key,
    roles: { "ls-lead": "ls_lead", ...Object.fromEntries(members) },
    members: members.map(([name]) => name),
  };
}
