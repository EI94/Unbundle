// Steps 1, 2, 5, 6, 7, 9, 10 and 11.isolation of acceptance.mjs (DESIGN §8.3 WP13,
// docs/casi-duso/PIANO.md §9.2 «Percorso E2E»), on the harness app.
//
// One throw-away synthetic workspace («Cliente Esempio», its own organization, an approved
// use case to build, the example schema templates/uc/esempio.minimo restricted to it) carries
// the steps in order; the synthetic accounts of seed-fixtures.mjs get a membership there for
// the run only, so the example case of workspace «a» is never touched. Everything is removed at
// the end (`cleanup`). It talks only to 127.0.0.1: the app on 53110 (HTTP with the session of
// the login helper on 53112, headless Chrome where a person clicks) and the isolated database
// on 55449. No real email: the harness has no RESEND_API_KEY. Screens go to
// $UC_TEST_ROOT/uc-evidence/screens/acceptance-collaudo/, never to Git.
//
//   1 · «Avvia la realizzazione» in the browser as ls-lead, from the use case: the dossier opens,
//       in draft, with the schema's items, ls-lead as its lead and «In breve» from the use case;
//   2 · referents, assignment by role, send: the email stays queued («Le email non partono
//       ancora…» on Persone), «Copia link» gives a new link that opens, and revoking a request
//       puts its questions back to «da chiedere» and closes its link;
//   5 · four eyes: who entered an answer (ls-lead) cannot validate it, not even after the
//       referent confirmed it from the link («Chiedi conferma», «È così»); ls-analista can;
//   6 · scheda A.8: Lateral Space registers it on a clean file uploaded through the app, the
//       privacy approver signs it on /firme in the browser, the blocked items unlock by themselves;
//   7 · a CSV with the header «visita medica» and a PDF with the same words, uploaded through
//       the app: refused, deleted, with the event and without the content;
//   9 · a referent answers a personal question from the link with a unique made-up value
//       (stored encrypted); the via allo sviluppo signed (G1 ready through the commands, as in
//       step 8), then the catalog v1 in JSON, Markdown and Excel for Lateral Space, Excel only
//       for the client, none of them with the personal value;
//  10 · the dossier MCP with a read token of the case: only validated or not-applicable items
//       of v1, never the personal value, an event for the read; a token of another case gets
//       404, no token 401;
//  11 · isolation: a user of another workspace gets 404 on the dossier, its pages and its
//       export; a revoked link and an expired one show the generic card.
import { createRequire } from "node:module";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { UC_TEST_APP_PORT, UC_TEST_DATABASE_URL, UC_TEST_HOST, UC_TEST_LOGIN_PORT, UC_TEST_LS_DOMAIN, ucTestRoot } from "./config.mjs";

const app = `http://${UC_TEST_HOST}:${UC_TEST_APP_PORT}`;
const login = `http://${UC_TEST_HOST}:${UC_TEST_LOGIN_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const ok = (r, what) => {
  if (!r || !r.ok) throw new Error(`${what}: ${r ? `${r.code} ${r.message}` : "no result"}`);
  return r.value;
};

/** App commands on the isolated database only (the Neon HTTP driver goes through local-neon.cjs). */
async function appModules() {
  process.env.UC_TEST_DATABASE_URL = UC_TEST_DATABASE_URL;
  createRequire(import.meta.url)("./local-neon.cjs");
  const load = (p) => import(new URL(`../../${p}`, import.meta.url).href);
  return {
    ...(await load("src/lib/db/uc-executor.ts")),
    ...(await load("src/lib/db/queries/uc-templates.ts")),
    ...(await load("src/lib/uc/template/load.ts")),
    ...(await load("src/lib/db/queries/uc-cases.ts")),
    ...(await load("src/lib/db/queries/uc-requests.ts")),
    ...(await load("src/lib/db/queries/uc-items.ts")),
    ...(await load("src/lib/db/queries/uc-gates.ts")),
    ...(await load("src/lib/db/queries/uc-approvals.ts")),
    ...(await load("src/lib/uc/mcp-access.ts")),
    ...(await load("src/lib/uc/files/fixtures.ts")),
    people: await load("src/lib/uc/views/people.ts"),
    publicView: await load("src/lib/uc/public-view.ts"),
    copyGuard: await load("src/lib/uc/views/copy-guard.ts"),
  };
}

/** Session cookie of a synthetic account, from the login helper (never printed). */
async function sessionCookie(account, workspaceId) {
  const res = await fetch(`${login}/as/${encodeURIComponent(account)}?to=${encodeURIComponent(`/dashboard/${workspaceId}`)}`, { redirect: "manual" });
  const cookie = res.headers.get("set-cookie");
  const m = cookie ? /(?:^|,\s*)(__session=[^;]+)/.exec(cookie) : null;
  if (res.status !== 302 || !m) throw new Error(`login as ${account} failed (${res.status}): is browser-login.mjs running?`);
  return m[1];
}

async function get(path, cookie, headers = {}) {
  const res = await fetch(`${app}${path}`, { headers: { ...(cookie ? { cookie } : {}), ...headers }, redirect: "manual", cache: "no-store" });
  const bytes = Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, bytes, text: () => bytes.toString("utf8") };
}

/**
 * The HTML a person sees, without the scripts: the RSC payload of every page also carries
 * the not-found and error boundaries of its segments (the generic card of /r, «non trovato»),
 * even when they are not shown.
 */
function markup(r) {
  return r.text().replace(/<script\b[\s\S]*?<\/script>/gi, "");
}

/** The page's own 404 (not-found.tsx under a loading.tsx answers 200 with a noindex meta). */
function isNotFound(r) {
  const html = markup(r);
  return r.status === 404 || (/<meta name="robots" content="noindex/.test(html) && /non trovat/i.test(html));
}

/** The generic card of /r: «Questo link non è più valido.» on the page, not only in the payload. */
function showsInvalidCard(r, f) {
  return r.status === 200 && markup(r).includes(f.m.publicView.INVALID_LINK_MESSAGE.split(". ")[0]);
}

/** Answers through the referent's link, as its page does (same origin, JSON). */
async function referentApi(path, route, body) {
  const token = path.replace(/^\/r\//, "");
  const res = await fetch(`${app}/api/r/${token}/${route}`, {
    method: "POST",
    headers: { origin: app, accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
    redirect: "manual",
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

/** Upload through the dossier's route, as the upload panel does (same origin, session cookie). */
async function upload(cookie, workspaceId, caseId, { name, bytes, type, itemId }) {
  const form = new FormData();
  form.set("file", new Blob([bytes], { type }), name);
  form.set("declaration", "true");
  if (itemId) form.set("itemId", itemId);
  const res = await fetch(`${app}/dashboard/${workspaceId}/casi-duso/${caseId}/files/upload`, { method: "POST", headers: { cookie, origin: app }, body: form, redirect: "manual" });
  return { status: res.status, json: await res.json().catch(() => null) };
}

/**
 * The throw-away workspace of the steps: organization, workspace, memberships of the
 * synthetic accounts, the example schema restricted to it and an approved use case to build.
 */
export async function collaudoFixture(db, fixtures) {
  check(fixtures, "synthetic fixtures (seed-fixtures.mjs)");
  const account = (name) => {
    const a = fixtures.accounts[name];
    check(a, `account ${name} in the fixtures`);
    return a;
  };
  const accounts = Object.fromEntries(["ls-lead", "ls-analista", "owner-cliente", "approvatore-privacy", "osservatore", "estraneo"].map((n) => [n, account(n)]));
  const m = await appModules();
  const exec = m.ucExecutorForUrl(UC_TEST_DATABASE_URL);
  const lsDomains = [UC_TEST_LS_DOMAIN];
  const ids = { org: randomUUID(), ws: randomUUID(), useCase: randomUUID() };
  const tag = ids.ws.slice(0, 8);
  const cleanup = async () => {
    await db.query("DELETE FROM workspaces WHERE id = $1", [ids.ws]);
    await db.query("DELETE FROM organizations WHERE id = $1", [ids.org]);
  };
  try {
    await db.query("INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova collaudo', $2)", [ids.org, `uc-acc-collaudo-${tag}`]);
    await db.query("INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Cliente Esempio')", [ids.ws, ids.org]);
    const roles = { "ls-lead": "transformation_lead", "ls-analista": "analyst", "owner-cliente": "contributor", "approvatore-privacy": "contributor", osservatore: "contributor" };
    for (const [name, role] of Object.entries(roles)) {
      await db.query("INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, $3)", [ids.ws, accounts[name].id, role]);
    }
    const template = JSON.parse(readFileSync(resolve("templates/uc/esempio.minimo/1.0.0.json"), "utf8"));
    template.key = `prova.collaudo_${tag}`;
    const plan = m.planTemplateLoad(JSON.stringify(template), { restrictToWorkspaceId: ids.ws });
    check(plan.ok, "example schema");
    const loaded = ok(await m.applyTemplateLoad(exec, plan.plan, { actorUserId: accounts["ls-lead"].id, publish: true }), "schema load");
    await db.query(
      "INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_kind) VALUES ($1, $2, 'Smistamento richieste', 'Instradare ogni richiesta alla persona giusta, con i dati che servono.', 'accepted', 'use_case_ai')",
      [ids.useCase, ids.ws],
    );
    const cookies = new Map();
    const f = {
      db,
      m,
      exec,
      lsDomains,
      ids,
      tag,
      accounts,
      templateId: loaded.templateId,
      itemCount: plan.plan.definition.items.length,
      caseId: null,
      items: new Map(),
      shots: join(ucTestRoot(), "uc-evidence", "screens", "acceptance-collaudo"),
      cleanup,
      /** Command context of a synthetic account on the dossier (roles from the database). */
      ctx: async (name) => ok(await m.commandContextFor(exec, { workspaceId: ids.ws, caseId: f.caseId, userId: accounts[name].id, lsDomains }), `${name} context`),
      cookie: async (name) => {
        if (!cookies.has(name)) cookies.set(name, await sessionCookie(name, accounts[name].workspace === "b" ? fixtures.workspaces.b.workspaceId : ids.ws));
        return cookies.get(name);
      },
      base: () => `/dashboard/${ids.ws}/casi-duso/${f.caseId}`,
      item: (key) => {
        const id = f.items.get(key);
        check(id, `item ${key}`);
        return id;
      },
      statusOf: async (key) => (await db.query("SELECT status FROM uc_items WHERE case_id = $1 AND key = $2", [f.caseId, key])).rows[0]?.status ?? null,
    };
    return f;
  } catch (error) {
    await cleanup().catch(() => undefined);
    throw error;
  }
}

function needsCase(f) {
  check(f?.caseId, "needs the dossier of step 1");
}

/** Clicks the visible button whose text is exactly `label`. */
function clickButton(label) {
  const button = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === label && b.getBoundingClientRect().width > 0);
  if (!button || button.disabled) return false;
  button.click();
  return true;
}

async function waitFor(probe, timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await probe();
    if (value) return value;
    await sleep(250);
  }
  return null;
}

/** Step 1: «Avvia la realizzazione» from the use case, in the browser, as ls-lead. */
export async function step1(f) {
  const { launchBrowser, newPage, loginAs, navigate, evaluate, pageReport, screenshot, closePage } = await import("./cdp.mjs");
  const browser = await launchBrowser({ colorScheme: "dark" });
  try {
    const page = await newPage(browser, { width: 1440 });
    await loginAs(page, "ls-lead", { to: `/dashboard/${f.ids.ws}` });
    const start = `${app}/dashboard/${f.ids.ws}/casi-duso/nuovo?useCaseId=${f.ids.useCase}`;
    const nav = await navigate(page, start);
    check(nav.status === 200, `start page ${nav.status}`);
    const form = await pageReport(page);
    await screenshot(page, join(f.shots, "1-avvia-1440.png"));
    check(form.h1.includes("Avvia la realizzazione"), `start page title: ${form.h1.join(" / ")}`);
    check(form.text.includes("Smistamento richieste"), "the use case on the form");
    check(await evaluate(page, clickButton, "Avvia la realizzazione"), "«Avvia la realizzazione» clickable");
    // The dossier is created by the action; the page then opens its Panoramica.
    const row = await waitFor(async () => (await f.db.query("SELECT id FROM uc_cases WHERE portfolio_use_case_id = $1 AND setup_completed_at IS NOT NULL", [f.ids.useCase])).rows[0] ?? null);
    check(row, "dossier created within 20 s");
    f.caseId = row.id;
    const opened = await waitFor(async () => {
      const href = await evaluate(page, "location.pathname");
      return href === f.base() ? href : null;
    }, 15_000);
    check(opened, "the start page opens the dossier's Panoramica within 15 s");
    await screenshot(page, join(f.shots, "1-panoramica-1440.png"));
    await closePage(page);
  } finally {
    await browser.close();
  }
  const c = (await f.db.query("SELECT status, code, title, ls_lead_user_id, description, template_id FROM uc_cases WHERE id = $1", [f.caseId])).rows[0];
  check(c.status === "bozza", `status ${c.status}`);
  check(c.template_id === f.templateId, "the chosen schema");
  check(c.ls_lead_user_id === f.accounts["ls-lead"].id, "ls-lead leads the dossier");
  check(typeof c.description?.in_breve === "string" && c.description.in_breve.includes("Instradare ogni richiesta"), "«In breve» from the use case");
  const members = (await f.db.query("SELECT user_id, role FROM uc_case_members WHERE case_id = $1", [f.caseId])).rows;
  check(members.length === 1 && members[0].role === "ls_lead", `members ${JSON.stringify(members.map((r) => r.role))}`);
  const items = (await f.db.query("SELECT id, key FROM uc_items WHERE case_id = $1 AND deleted_at IS NULL", [f.caseId])).rows;
  check(items.length > 0 && items.length === f.itemCount, `items ${items.length} of ${f.itemCount}`);
  for (const r of items) f.items.set(r.key, r.id);
  const page = await get(f.base(), await f.cookie("ls-lead"));
  check(page.status === 200 && page.text().includes(c.title), `Panoramica ${page.status}`);
  // The other people of the dossier, for the next steps.
  const lead = await f.ctx("ls-lead");
  for (const [name, role] of [
    ["ls-analista", "ls_analista"],
    ["owner-cliente", "owner_cliente"],
    ["approvatore-privacy", "approvatore_privacy"],
    ["osservatore", "osservatore"],
  ]) {
    ok(await f.m.addCaseMember(f.exec, lead, { userId: f.accounts[name].id, role }), `${name} as ${role}`);
  }
  return `dossier ${c.code} avviato dal browser, Panoramica aperta: bozza, ${items.length} voci dello schema, ls-lead responsabile, «In breve» dallo use case`;
}

/** Step 2: referents, assignment by role, queued send, «Copia link», revoke. */
export async function step2(f) {
  needsCase(f);
  const lead = await f.ctx("ls-lead");
  const marco = ok(await f.m.createContact(f.exec, lead, { displayName: "Marco Bianchi", templateRoleKey: "resp_servizio", email: `marco-${f.tag}@cliente.test` }), "referent 1").contactId;
  const sara = ok(await f.m.createContact(f.exec, lead, { displayName: "Sara Neri", templateRoleKey: "controllo_gestione", email: `sara-${f.tag}@cliente.test` }), "referent 2").contactId;
  const byRole = ok(await f.m.assignItems(f.exec, lead, { mode: "ruolo", roleKey: "resp_servizio", contactId: marco }), "assign resp_servizio");
  ok(await f.m.assignItems(f.exec, lead, { mode: "ruolo", roleKey: "controllo_gestione", contactId: sara }), "assign controllo_gestione");
  check(byRole.assigned > 0, "questions assigned by role");
  const sent = ok(await f.m.sendRequests(f.exec, lead, { contactIds: [marco, sara] }), "send");
  check(sent.requests.length === 2, `${sent.requests.length} requests`);
  const queued = (await f.db.query("SELECT status FROM uc_notifications WHERE case_id = $1 AND channel = 'email' AND request_id = ANY($2)", [f.caseId, sent.requests.map((r) => r.requestId)])).rows;
  check(queued.length === 2 && queued.every((n) => n.status === "in_coda"), `emails ${JSON.stringify(queued.map((n) => n.status))}`);
  const people = await get(`${f.base()}/persone`, await f.cookie("ls-lead"));
  check(people.status === 200, `Persone ${people.status}`);
  check(people.text().includes(f.m.people.EMAIL_OFF_TEXT), "Persone says the emails do not leave yet");

  const marcoRequest = sent.requests.find((r) => r.contactId === marco).requestId;
  const saraRequest = sent.requests.find((r) => r.contactId === sara).requestId;
  const first = ok(await f.m.copyRequestLink(f.exec, lead, { requestId: marcoRequest }), "copy link");
  const second = ok(await f.m.copyRequestLink(f.exec, lead, { requestId: marcoRequest }), "copy link again");
  check(first.path !== second.path, "every «Copia link» gives a new link");
  const open = await get(second.path);
  check(open.status === 200 && !showsInvalidCard(open, f), `copied link ${open.status}`);

  const saraLink = ok(await f.m.copyRequestLink(f.exec, lead, { requestId: saraRequest }), "copy Sara's link").path;
  const asked = (await f.db.query("SELECT count(*)::int AS n FROM uc_items WHERE case_id = $1 AND assignee_contact_id = $2 AND status = 'chiesta'", [f.caseId, sara])).rows[0].n;
  check(asked > 0, "Sara's questions are asked");
  const revoked = ok(await f.m.revokeRequest(f.exec, lead, { requestId: saraRequest }), "revoke");
  check(revoked.reopened === asked, `${revoked.reopened} of ${asked} questions back`);
  const back = (await f.db.query("SELECT status, count(*)::int AS n FROM uc_items WHERE case_id = $1 AND assignee_contact_id = $2 GROUP BY 1", [f.caseId, sara])).rows;
  check(back.every((r) => r.status !== "chiesta") && back.some((r) => r.status === "da_chiedere"), `after the revoke: ${JSON.stringify(back)}`);
  const closed = await get(saraLink);
  check(showsInvalidCard(closed, f), "the revoked link shows the generic card");
  f.marcoLink = second.path;
  f.saraLink = saraLink;
  f.requests = { marco: marcoRequest, sara: saraRequest };
  return `2 referenti, ${byRole.assigned} domande per ruolo, invio con le email in coda («${f.m.people.EMAIL_OFF_TEXT}» su Persone), «Copia link» con un link nuovo che si apre, revoca: ${revoked.reopened} domande di nuovo da chiedere e link chiuso`;
}

/**
 * Step 5: who entered an answer does not validate it, not even after the referent confirmed
 * it; another Lateral Space person does. The answer entered by Lateral Space goes back to the
 * owner's referent («Chiedi conferma»), who confirms it from the link with «È così». The lead
 * enters it and copies the link (only the lead sends links), the analyst validates.
 */
export async function step5(f) {
  needsCase(f);
  const key = "q.servizio.05";
  const lead = await f.ctx("ls-lead");
  const analyst = await f.ctx("ls-analista");
  const entered = ok(await f.m.recordLsAnswer(f.exec, lead, { itemId: f.item(key), value: "90 min", sourceKind: "documento", sourceRef: "Procedura interna, pagina 2" }), "the lead's answer");
  check((await f.statusOf(key)) === "in_verifica", `after the answer: ${await f.statusOf(key)}`);
  const self = await f.m.validateItem(f.exec, lead, { itemId: f.item(key) });
  check(!self.ok && self.code === "stessa_persona", `who answered cannot validate (${self.ok ? "ok" : self.code})`);
  const unconfirmed = await f.m.validateItem(f.exec, analyst, { itemId: f.item(key) });
  check(!unconfirmed.ok && unconfirmed.code === "conferma_titolare_mancante", `a value nobody of the client confirmed (${unconfirmed.ok ? "ok" : unconfirmed.code})`);

  const asked = ok(await f.m.requestConfirmation(f.exec, lead, { itemIds: [f.item(key)] }), "«Chiedi conferma»");
  check(asked.requests.length === 1, `${asked.requests.length} confirmation requests`);
  const requestId = asked.requests[0].requestId;
  const link = ok(await f.m.copyRequestLink(f.exec, lead, { requestId }), "the referent's link").path;
  if (requestId === f.requests?.marco) f.marcoLink = link;
  // The referent reads the privacy notice first («Ho letto, iniziamo»), as on the link's first screen.
  const ack = await referentApi(link, "privacy-ack", { version: f.m.publicView.REFERENT_PRIVACY_NOTICE.version });
  check(ack.status === 200 && ack.json?.ok, `privacy notice ${ack.status} ${JSON.stringify(ack.json)}`);
  const confirm = await referentApi(link, "answers", { answers: [{ item_id: f.item(key), kind: "conferma", supersedes_answer_id: entered.answerId }] });
  check(confirm.status === 200 && confirm.json?.ok && confirm.json.data.results.every((r) => r.ok), `«È così» from the link ${confirm.status} ${JSON.stringify(confirm.json?.data?.results ?? confirm.json)}`);
  check((await f.statusOf(key)) === "in_verifica", `after the confirmation: ${await f.statusOf(key)}`);

  const again = await f.m.validateItem(f.exec, lead, { itemId: f.item(key) });
  check(!again.ok && again.code === "stessa_persona", `who answered still cannot validate (${again.ok ? "ok" : again.code})`);
  const queue = await get(`${f.base()}/domande/verifica`, await f.cookie("ls-analista"));
  check(queue.status === 200, `the analyst's review page ${queue.status}`);
  ok(await f.m.validateItem(f.exec, analyst, { itemId: f.item(key) }), "validation by ls-analista");
  check((await f.statusOf(key)) === "validata", `after the validation: ${await f.statusOf(key)}`);
  const v = (await f.db.query("SELECT by_user_id, kind FROM uc_validations WHERE item_id = $1 AND kind = 'umana'", [f.item(key)])).rows;
  check(v.length === 1 && v[0].by_user_id === f.accounts["ls-analista"].id, "the human check is the analyst's");
  return `${key}: inserita da ls-lead, che non la valida (stessa_persona), nemmeno dopo la conferma del referente dal link («Chiedi conferma», «È così»); senza conferma del cliente non si valida; la valida ls-analista`;
}

/** Step 6: the A.8 sheet with two signatures, the second on /firme in the browser; the blocked items unlock. */
export async function step6(f) {
  needsCase(f);
  const key = "q.sistemi.05";
  check((await f.statusOf(key)) === "bloccata", `${key} blocked by the A.8 sheet at the start (${await f.statusOf(key)})`);
  const evidenceUpload = await upload(await f.cookie("ls-lead"), f.ids.ws, f.caseId, {
    name: "scheda-privacy.csv",
    type: "text/csv",
    bytes: Buffer.from("codice_richiesta;canale;data_apertura\nR-001;portale;2026-03-01\nR-002;sportello;2026-03-02\n", "utf8"),
  });
  check(evidenceUpload.status === 200 && evidenceUpload.json?.ok && evidenceUpload.json.data.status === "pulito", `evidence upload ${evidenceUpload.status} ${JSON.stringify(evidenceUpload.json)}`);
  const fileId = evidenceUpload.json.data.fileId;
  const a8 = (await f.db.query("SELECT id FROM uc_blockers WHERE case_id = $1 AND key = 'a8'", [f.caseId])).rows[0];
  const lead = await f.ctx("ls-lead");
  const evidence = {
    documento: "Scheda privacy",
    versione: "1.0",
    data: new Date().toISOString().slice(0, 10),
    approvatori_per_ruolo: ["approvatore_privacy"],
    file_id: fileId,
    titolo_art_15_2: true,
    regione_dati_verificata: true,
    accesso_zona_personale: [],
  };
  const first = ok(await f.m.resolveBlocker(f.exec, lead, { blockerId: a8.id, evidence }), "Lateral Space registers the sheet");
  check(first.complete === false, "one signature is not enough");
  check((await f.statusOf(key)) === "bloccata", "still blocked after one signature");

  const { launchBrowser, newPage, loginAs, navigate, evaluate, pageReport, screenshot, closePage } = await import("./cdp.mjs");
  const browser = await launchBrowser({ colorScheme: "dark" });
  const failures = [];
  try {
    const page = await newPage(browser, { width: 400 });
    await loginAs(page, "approvatore-privacy", { to: `/dashboard/${f.ids.ws}` });
    const nav = await navigate(page, `${app}${f.base()}/firme`);
    check(nav.status === 200, `/firme ${nav.status}`);
    const audit = async (name) => {
      const report = await pageReport(page);
      await screenshot(page, join(f.shots, `${name}.png`));
      if (report.horizontalOverflow) failures.push(`${name}: horizontal scroll`);
      if (report.applicationError) failures.push(`${name}: Application error`);
      if (report.filledButtons > 1) failures.push(`${name}: ${report.filledButtons} filled buttons`);
      const guard = f.m.copyGuard.findForbidden(report.text, "cliente");
      if (guard.length > 0) failures.push(`${name}: copy-guard ${guard.map((g) => g.match).join(", ")}`);
    };
    check(await waitFor(() => evaluate(page, () => document.body.innerText.includes("Ci serve la tua firma su una decisione."))), "the decision in the list");
    await audit("6-firme-elenco-400");
    check(await evaluate(page, clickButton, "Inizia"), "«Inizia»");
    check(await waitFor(() => evaluate(page, () => document.body.innerText.includes("1 di 1"))), "«1 di 1»");
    await audit("6-firme-a8-400");
    check(await evaluate(page, clickButton, "Ho letto e approvo"), "«Ho letto e approvo»");
    check(await waitFor(() => evaluate(page, () => document.body.innerText.includes("Firmato."))), "the outcome on the page");
    await audit("6-firme-firmato-400");
    await closePage(page);
  } finally {
    await browser.close();
  }
  check(failures.length === 0, failures.join("; "));
  const blocker = (await f.db.query("SELECT status, approvals FROM uc_blockers WHERE id = $1", [a8.id])).rows[0];
  check(blocker.status === "sciolto", `A.8 ${blocker.status}`);
  check(blocker.approvals.some((a) => a.ruolo === "approvatore_privacy" && a.metodo === "account"), "the privacy approver's account signature");
  check((await f.statusOf(key)) === "da_chiedere", `${key} after the sheet: ${await f.statusOf(key)}`);
  const stillLocked = (
    await f.db.query(
      `SELECT count(*)::int AS n FROM uc_items i WHERE i.case_id = $1 AND i.status = 'bloccata'
         AND NOT EXISTS (SELECT 1 FROM uc_item_blockers ib JOIN uc_blockers b ON b.id = ib.blocker_id WHERE ib.item_id = i.id AND b.status IN ('attivo', 'permanente'))`,
      [f.caseId],
    )
  ).rows[0].n;
  check(stillLocked === 0, `${stillLocked} items blocked without an active blocker`);
  return `scheda A.8 su un file caricato dall'app: firma di Lateral Space, poi dell'approvatore privacy su /firme a 400 px; ${key} sbloccata da sola`;
}

/** Step 7: «visita medica» in a CSV header and in a PDF, through the upload route. */
export async function step7(f) {
  needsCase(f);
  const cookie = await f.cookie("ls-analista");
  const before = (await f.db.query("SELECT count(*)::int AS n FROM uc_events WHERE case_id = $1 AND event_type = 'file.rifiutato'", [f.caseId])).rows[0].n;
  const csv = await upload(cookie, f.ids.ws, f.caseId, { name: "turni.csv", type: "text/csv", bytes: Buffer.from("codice_turno;visita medica\nT-1;si\n", "utf8") });
  check(csv.status === 200 && csv.json?.ok && csv.json.data.status === "rifiutato", `CSV ${csv.status} ${JSON.stringify(csv.json)}`);
  const lines = Array.from({ length: 6 }, (_, i) => `Regola ${i + 1}: la richiesta va alla persona giusta entro il turno, con i dati del portale`);
  const pdf = f.m.buildPdf([{ content: f.m.pdfTextContent([...lines, "Ogni operatore deve presentare la visita medica una volta all'anno"]) }]);
  const inPdf = await upload(cookie, f.ids.ws, f.caseId, { name: "procedura.pdf", type: "application/pdf", bytes: Buffer.from(pdf), itemId: f.item("doc.procedura_assistenza") });
  check(inPdf.status === 200 && inPdf.json?.ok && inPdf.json.data.status === "rifiutato", `PDF ${inPdf.status} ${JSON.stringify(inPdf.json)}`);
  for (const id of [csv.json.data.fileId, inPdf.json.data.fileId]) {
    const row = (await f.db.query("SELECT scan_status, deleted_at, deletion_reason, blob_path, quarantine_path, preview FROM uc_files WHERE id = $1", [id])).rows[0];
    check(row.scan_status === "rifiutato" && row.deleted_at && row.deletion_reason === "contenuto_sanitario", `file row ${JSON.stringify(row)}`);
    check(row.blob_path === null && row.quarantine_path === null && row.preview === null, "nothing of the file is kept");
  }
  const events = (await f.db.query("SELECT payload::text AS p FROM uc_events WHERE case_id = $1 AND event_type = 'file.rifiutato' ORDER BY created_at", [f.caseId])).rows;
  check(events.length === before + 2, `${events.length - before} events`);
  check(events.every((e) => !/turni|T-1|operatore/.test(e.p)), "the events carry no content");
  return "CSV con «visita medica» nell'intestazione e PDF con lo stesso testo, caricati dalla route dell'app: rifiutati, cancellati, con l'evento «file.rifiutato» senza contenuto";
}

/**
 * G1 to ready through the commands (as step 8: every indispensable question still missing
 * becomes «non si applica» with both signatures), then the via proposed and signed by the
 * client's owner: catalog v1.
 */
async function freezeV1(f) {
  if (f.frozen) return;
  const lead = await f.ctx("ls-lead");
  const owner = await f.ctx("owner-cliente");
  const before = await f.m.loadCaseReadiness(f.exec, f.ids.ws, f.caseId);
  check(before, "readiness");
  const pending = async (roles, kind, targetId) => (await f.m.loadCaseApprovals(f.exec, { workspaceId: f.ids.ws, caseId: f.caseId, roles }))?.approvals.find((a) => a.kind === kind && a.targetId === targetId);
  const sign = (a) => ({ kind: a.kind, target_id: a.targetId, decision: "approvo", read: true, text_hash: a.textHash });
  for (const { itemId } of before.g1.missing) {
    ok(await f.m.proposeNa(f.exec, lead, { itemId, reason: "Non serve per avviare questo sviluppo" }), "«non si applica» proposed");
    const forLs = await pending(["ls_lead"], "na", itemId);
    check(forLs, "«non si applica» waits for Lateral Space");
    ok(await f.m.decideCaseApproval(f.exec, lead, sign(forLs)), "Lateral Space's signature");
    const forClient = await pending(["owner_cliente"], "na", itemId);
    check(forClient, "«non si applica» waits for the client's owner");
    ok(await f.m.decideCaseApproval(f.exec, owner, sign(forClient)), "the client's signature");
  }
  await f.db.query("UPDATE uc_cases SET status = 'raccolta', status_changed_at = now() WHERE id = $1 AND status = 'bozza'", [f.caseId]);
  const ready = await f.m.loadCaseReadiness(f.exec, f.ids.ws, f.caseId);
  check(ready?.g1.ready === true, `G1 ready (${JSON.stringify(ready?.g1.conditions.filter((c) => !c.ok))})`);
  const proposed = ok(await f.m.proposeGate(f.exec, lead, {}), "via proposed");
  const gate = await pending(["owner_cliente"], "gate", proposed.reviewId);
  check(gate, "the via waits for the client's owner");
  ok(await f.m.decideCaseApproval(f.exec, owner, sign(gate)), "the via signed by the client's owner");
  await f.m.refreshReadinessCache(f.exec, f.ids.ws, f.caseId);
  const c = (await f.db.query("SELECT status, catalog_version FROM uc_cases WHERE id = $1", [f.caseId])).rows[0];
  check(c.status === "pronto_sviluppo" && c.catalog_version === 1, `case ${c.status} v${c.catalog_version}`);
  f.frozen = { na: before.g1.missing.length };
}

/**
 * A personal value with a unique made-up text, answered from the referent's link as its page
 * does (one answer, the personal zone open after the A.8 sheet of step 6): the exports and the
 * MCP must never carry it. Once per run.
 */
async function personalSentinel(f) {
  if (f.personalSentinel) return f.personalSentinel;
  const key = "q.sistemi.05";
  const lead = await f.ctx("ls-lead");
  const contactId = ok(await f.m.createContact(f.exec, lead, { displayName: "Luca Verdi", templateRoleKey: "referente_sistemi", email: `luca-${f.tag}@cliente.test` }), "referent of the personal question").contactId;
  ok(await f.m.assignItems(f.exec, lead, { mode: "voci", itemIds: [f.item(key)], contactId }), "assign the personal question");
  const sent = ok(await f.m.sendRequests(f.exec, lead, { itemIds: [f.item(key)] }), "send the personal question");
  check(sent.requests.length === 1, `${sent.requests.length} requests for the personal question`);
  const link = ok(await f.m.copyRequestLink(f.exec, lead, { requestId: sent.requests[0].requestId }), "the referent's link").path;
  const ack = await referentApi(link, "privacy-ack", { version: f.m.publicView.REFERENT_PRIVACY_NOTICE.version });
  check(ack.status === 200 && ack.json?.ok, `privacy notice ${ack.status} ${JSON.stringify(ack.json)}`);
  const sentinel = `Turno inventato ${f.tag} ${randomBytes(6).toString("hex")}`;
  const answered = await referentApi(link, `items/${f.item(key)}/answer`, { payload: sentinel });
  check(answered.status === 200 && answered.json?.ok, `the personal answer from the link ${answered.status} ${JSON.stringify(answered.json)}`);
  const row = (await f.db.query("SELECT value, value_encrypted IS NOT NULL AS encrypted FROM uc_answers WHERE item_id = $1 ORDER BY version DESC LIMIT 1", [f.item(key)])).rows[0];
  check(row && row.value === null && row.encrypted, "the personal value is stored encrypted only");
  f.personalSentinel = sentinel;
  return sentinel;
}

/** Every text of an Excel workbook (cells of every sheet), to look for a value in it. */
function workbookText(bytes) {
  const XLSX = createRequire(import.meta.url)("xlsx");
  const book = XLSX.read(bytes, { type: "buffer" });
  return book.SheetNames.map((name) => XLSX.utils.sheet_to_csv(book.Sheets[name])).join("\n");
}

/** Step 9: the catalog v1 in JSON, Markdown and Excel through the export route. */
export async function step9(f) {
  needsCase(f);
  const sentinel = await personalSentinel(f);
  await freezeV1(f);
  const lsCookie = await f.cookie("ls-lead");
  const exportPath = (format, version) => `${f.base()}/export?format=${format}${version ? `&version=${version}` : ""}`;
  const json = await get(exportPath("json"), lsCookie);
  check(json.status === 200 && /application\/json/.test(json.headers.get("content-type") ?? ""), `JSON ${json.status} ${json.headers.get("content-type")}`);
  check(/attachment; filename/.test(json.headers.get("content-disposition") ?? ""), "JSON as a download");
  const catalog = JSON.parse(json.text());
  check(catalog.version === 1 && Array.isArray(catalog.items) && catalog.items.length > 0, `JSON catalog v${catalog.version}`);
  check(catalog.items.some((i) => i.key === "q.sistemi.05"), "the personal question is in the catalog");
  check(!json.text().includes(sentinel), "no personal value in the JSON export");
  const md = await get(exportPath("md", 1), lsCookie);
  check(md.status === 200 && /text\/markdown/.test(md.headers.get("content-type") ?? "") && md.text().startsWith("#"), `Markdown ${md.status} ${md.headers.get("content-type")}`);
  check(!md.text().includes(sentinel), "no personal value in the Markdown export");
  const xlsx = await get(exportPath("xlsx"), lsCookie);
  check(xlsx.status === 200 && /spreadsheetml/.test(xlsx.headers.get("content-type") ?? "") && xlsx.bytes.subarray(0, 2).toString("latin1") === "PK", `Excel ${xlsx.status}`);
  const lsSheets = workbookText(xlsx.bytes);
  check(lsSheets.includes("q.sistemi.05") || lsSheets.includes("turni degli operatori"), "the Excel export carries the catalog");
  check(!lsSheets.includes(sentinel), "no personal value in the Excel export");
  const ownerCookie = await f.cookie("owner-cliente");
  const clientExcel = await get(exportPath("xlsx"), ownerCookie);
  check(clientExcel.status === 200 && clientExcel.bytes.subarray(0, 2).toString("latin1") === "PK", `the client's Excel ${clientExcel.status}`);
  check(!workbookText(clientExcel.bytes).includes(sentinel), "no personal value in the client's Excel");
  const clientJson = await get(exportPath("json"), ownerCookie);
  check(clientJson.status === 403, `the client asks for JSON: ${clientJson.status}`);
  const prefetch = await get(exportPath("json"), lsCookie, { "next-router-prefetch": "1" });
  check(prefetch.status === 204, `a prefetch does not download (${prefetch.status})`);
  const events = (await f.db.query("SELECT payload ->> 'format' AS format FROM uc_events WHERE case_id = $1 AND event_type = 'catalogo.esportato' ORDER BY created_at", [f.caseId])).rows;
  check(events.map((e) => e.format).join(",") === "json,md,xlsx,xlsx", `export events ${events.map((e) => e.format).join(",")}`);
  return `risposta personale dal link, cifrata; via firmata dopo ${f.frozen.na} «non si applica» a due firme, catalogo v1; JSON (${catalog.items.length} voci), Markdown ed Excel per Lateral Space, Excel per il cliente (JSON 403), nessuno con il valore personale; un evento per download, nessuno per il prefetch`;
}

/** Step 10: the dossier MCP returns only validated or not-applicable items of v1. */
export async function step10(f) {
  needsCase(f);
  const sentinel = await personalSentinel(f);
  await freezeV1(f);
  const scopes = f.m.buildCaseTokenScopes(f.caseId, ["cases:read", "cases:read_validated"]);
  const other = f.m.buildCaseTokenScopes(randomUUID(), ["cases:read", "cases:read_validated"]);
  check(scopes.ok && other.ok, "token scopes");
  const token = `acc-${randomBytes(24).toString("base64url")}`;
  const otherToken = `acc-${randomBytes(24).toString("base64url")}`;
  for (const [secret, s] of [
    [token, scopes.value],
    [otherToken, other.value],
  ]) {
    await f.db.query(
      `INSERT INTO workspace_integration_tokens (workspace_id, label, provider, token_hash, token_prefix, scopes, created_by_user_id, expires_at)
       VALUES ($1, 'Collaudo MCP', 'claude_mcp', $2, $3, $4::jsonb, $5, now() + interval '1 day')`,
      [f.ids.ws, createHash("sha256").update(secret, "utf8").digest("hex"), `${secret.slice(0, 10)}...`, JSON.stringify(s), f.accounts["ls-lead"].id],
    );
  }
  const call = (path, secret) => fetch(`${app}${path}`, { headers: { authorization: `Bearer ${secret}` }, redirect: "manual", cache: "no-store" });
  const res = await call(`/api/mcp/casi/cases/${f.caseId}/catalog`, token);
  const body = await res.json().catch(() => null);
  check(res.status === 200 && body, `catalog ${res.status} ${JSON.stringify(body)?.slice(0, 200)}`);
  const catalog = body.data ?? body;
  check(catalog.version === 1, `version ${catalog.version}`);
  const items = catalog.items ?? [];
  check(items.length > 0, "items in v1");
  const statuses = [...new Set(items.map((i) => i.status))];
  check(statuses.every((s) => s === "validata" || s === "non_applicabile"), `statuses ${statuses.join(",")}`);
  check(items.some((i) => i.key === "q.servizio.05" && i.status === "validata"), "the validated answer of step 5");
  check(!JSON.stringify(body).includes(sentinel), "no personal value through the MCP");
  const v1 = (await f.db.query("SELECT snapshot FROM uc_catalog_versions WHERE case_id = $1 AND version = 1", [f.caseId])).rows[0].snapshot;
  const notOk = (v1.items ?? []).filter((i) => i.status !== "validata" && i.status !== "non_applicabile").map((i) => i.key);
  check(notOk.length === 0 || items.every((i) => !notOk.includes(i.key)), "nothing else of v1");
  const read = (await f.db.query("SELECT payload FROM uc_events WHERE case_id = $1 AND event_type = 'catalogo.letto_mcp' ORDER BY created_at DESC LIMIT 1", [f.caseId])).rows[0];
  check(read && read.payload.version === 1, "the MCP read is recorded");
  // A token of another dossier reads as a dossier that does not exist (mcp-access.ts, `caso_non_trovato`).
  const refused = await call(`/api/mcp/casi/cases/${f.caseId}/catalog`, otherToken);
  check(refused.status === 404, `a token of another case: ${refused.status}`);
  const anonymous = await fetch(`${app}/api/mcp/casi/cases/${f.caseId}/catalog`, { redirect: "manual" });
  check(anonymous.status === 401, `no token: ${anonymous.status}`);
  return `MCP con un token del dossier: ${items.length} voci della v1, solo ${statuses.join(" e ")}, mai il valore personale; lettura registrata; token di un altro dossier 404, senza token 401`;
}

/** Step 11: a user of another workspace gets 404; a revoked or expired link shows the generic card. */
export async function step11(f) {
  needsCase(f);
  const stranger = await f.cookie("estraneo");
  const paths = [f.base(), `${f.base()}/domande`, `${f.base()}/persone`, `${f.base()}/firme`, `${f.base()}/export?format=xlsx`];
  const seen = [];
  for (const path of paths) {
    const r = await get(path, stranger);
    seen.push(r.status);
    check(isNotFound(r) || r.status === 404, `${path.replace(f.base(), "<dossier>")} for a stranger: ${r.status}`);
    check(!r.text().includes("Smistamento richieste"), "no dossier content for a stranger");
  }
  const invalid = f.m.publicView.INVALID_LINK_MESSAGE.split(". ")[0];
  check(f.saraLink, "the revoked link of step 2");
  const revoked = await get(f.saraLink);
  check(showsInvalidCard(revoked, f), "revoked link: generic card");
  check(f.marcoLink, "the open link of step 2");
  const before = await get(f.marcoLink);
  check(before.status === 200 && !showsInvalidCard(before, f), "the link is valid before it expires");
  await f.db.query("UPDATE uc_requests SET expires_at = now() - interval '1 day' WHERE id = $1 AND case_id = $2", [f.requests.marco, f.caseId]);
  const expired = await get(f.marcoLink);
  check(showsInvalidCard(expired, f), "expired link: generic card");
  const html = expired.text();
  check(!html.includes("Marco") && !html.includes("Smistamento richieste"), "the generic card says nothing of the case");
  return `estraneo: 404 su dossier, Domande, Persone, Firme ed export (${seen.join("/")}); link revocato e link scaduto: «${invalid}.»`;
}
