// Step 8 of acceptance.mjs (DESIGN §8.3 WP9): the via allo sviluppo signed by the client's
// owner on the dossier's Firme page, on the harness app.
//
// Each run works on a throw-away synthetic workspace with its own organization and a case
// from templates/uc/esempio.minimo; the synthetic accounts ls-lead, owner-cliente and
// ls-analista of seed-fixtures.mjs get a membership there for the run only, so the example
// case of workspace «a» is never touched. Everything is removed at the end. It talks only to
// 127.0.0.1: the app on 53110 (headless Chrome, login helper on 53112) and the isolated
// database on 55449. Screens go to $UC_TEST_ROOT/uc-evidence/screens/acceptance-8/.
//
//   G1 not ready → through the commands, every indispensable question still missing becomes
//   «non si applica» with both signatures (Lateral Space proposes and signs, the client's owner
//   signs with the /firme command) → ready → Lateral Space proposes the via → /firme as
//   owner-cliente at 400 px: the list, «Inizia», the decision «1 di 1», «Ho letto e approvo» →
//   catalog v1 and «Pronto per lo sviluppo». An @ls.test address with the client's role never
//   signs as the client: /firme is not for it, and the command refuses it even when the role is
//   forced. The validation of answers by someone else (four eyes) is step 5, not this one.
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { UC_TEST_APP_PORT, UC_TEST_DATABASE_URL, UC_TEST_HOST, UC_TEST_LS_DOMAIN, ucTestRoot } from "./config.mjs";

const app = `http://${UC_TEST_HOST}:${UC_TEST_APP_PORT}`;

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
    ...(await load("src/lib/db/queries/uc-gates.ts")),
    ...(await load("src/lib/db/queries/uc-items.ts")),
    ...(await load("src/lib/db/queries/uc-approvals.ts")),
    copyGuard: await load("src/lib/uc/views/copy-guard.ts"),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForText(page, evaluate, text, timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await evaluate(page, (t) => document.body.innerText.includes(t), text)) return true;
    await sleep(200);
  }
  return false;
}

/** Clicks the visible button whose text is exactly `label`. */
function clickButton(label) {
  const button = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === label && b.getBoundingClientRect().width > 0);
  if (!button || button.disabled) return false;
  button.click();
  return true;
}

export async function step8(db, fixtures) {
  check(fixtures, "synthetic fixtures (seed-fixtures.mjs)");
  const account = (name) => {
    const a = fixtures.accounts[name];
    check(a, `account ${name} in the fixtures`);
    return a;
  };
  const leadAccount = account("ls-lead");
  const ownerAccount = account("owner-cliente");
  const lsAsClient = account("ls-analista");
  const m = await appModules();
  const exec = m.ucExecutorForUrl(UC_TEST_DATABASE_URL);
  const lsDomains = [UC_TEST_LS_DOMAIN];
  const ids = { org: randomUUID(), ws: randomUUID() };
  const tag = ids.ws.slice(0, 8);
  const cleanup = async () => {
    await db.query("DELETE FROM workspaces WHERE id = $1", [ids.ws]);
    await db.query("DELETE FROM organizations WHERE id = $1", [ids.org]);
  };
  const shots = join(ucTestRoot(), "uc-evidence", "screens", "acceptance-8");
  const { launchBrowser, newPage, loginAs, navigate, pageReport, evaluate, screenshot, closePage } = await import("./cdp.mjs");
  try {
    await db.query("INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova firme', $2)", [ids.org, `uc-acc-firme-${tag}`]);
    await db.query("INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Cliente Esempio')", [ids.ws, ids.org]);
    await db.query("INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'transformation_lead'), ($1, $3, 'contributor'), ($1, $4, 'contributor')", [
      ids.ws,
      leadAccount.id,
      ownerAccount.id,
      lsAsClient.id,
    ]);
    const template = JSON.parse(readFileSync(resolve("templates/uc/esempio.minimo/1.0.0.json"), "utf8"));
    template.key = `prova.firme_${tag}`;
    const plan = m.planTemplateLoad(JSON.stringify(template), { restrictToWorkspaceId: ids.ws });
    check(plan.ok, "example schema");
    const loaded = ok(await m.applyTemplateLoad(exec, plan.plan, { actorUserId: leadAccount.id, publish: true }), "schema load");
    const leadUser = await m.loadUserContext(exec, leadAccount.id, lsDomains);
    const caseId = ok(
      await m.createCase(exec, { workspaceId: ids.ws, user: leadUser, canReviewWorkspacePortfolio: true, input: { templateId: loaded.templateId, code: `FIR-${tag.toUpperCase()}`, title: "Smistamento richieste" } }),
      "case",
    ).caseId;
    const lead = ok(await m.commandContextFor(exec, { workspaceId: ids.ws, caseId, userId: leadAccount.id, lsDomains }), "lead context");
    ok(await m.addCaseMember(exec, lead, { userId: ownerAccount.id, role: "owner_cliente" }), "owner-cliente as the client's owner");
    // An @ls.test address with the client's role: the command refuses it, so it is written directly.
    await db.query("INSERT INTO uc_case_members (case_id, user_id, role) VALUES ($1, $2, 'owner_cliente')", [caseId, lsAsClient.id]);

    // G1 from not ready to ready, through the commands: Lateral Space proposes «non si applica» for
    // every indispensable question still missing and signs it, the client's owner signs it with the
    // command of /firme. Then the case is collecting (the first send would move it there).
    const before = await m.loadCaseReadiness(exec, ids.ws, caseId);
    check(before && before.g1.ready === false && before.g1.missing.length > 0, "G1 not ready at the start");
    const owner = ok(await m.commandContextFor(exec, { workspaceId: ids.ws, caseId, userId: ownerAccount.id, lsDomains }), "owner context");
    const pendingNa = async (roles, itemId) => (await m.loadCaseApprovals(exec, { workspaceId: ids.ws, caseId, roles }))?.approvals.find((a) => a.kind === "na" && a.targetId === itemId);
    const sign = (a) => ({ kind: a.kind, target_id: a.targetId, decision: "approvo", read: true, text_hash: a.textHash });
    for (const { itemId } of before.g1.missing) {
      ok(await m.proposeNa(exec, lead, { itemId, reason: "Non serve per avviare questo sviluppo" }), "«non si applica» proposed");
      const forLs = await pendingNa(["ls_lead"], itemId);
      check(forLs, "«non si applica» waits for Lateral Space");
      ok(await m.decideCaseApproval(exec, lead, sign(forLs)), "Lateral Space's signature");
      const forClient = await pendingNa(["owner_cliente"], itemId);
      check(forClient, "«non si applica» waits for the client's owner");
      check(ok(await m.decideCaseApproval(exec, owner, sign(forClient)), "the client's signature").complete, "«non si applica» complete with both signatures");
    }
    await db.query("UPDATE uc_cases SET status = 'raccolta', status_changed_at = now() WHERE id = $1 AND status = 'bozza'", [caseId]);
    const ready = await m.loadCaseReadiness(exec, ids.ws, caseId);
    check(ready?.g1.ready === true, `G1 ready (${JSON.stringify(ready?.g1.conditions.filter((c) => !c.ok))})`);
    const proposed = ok(await m.proposeGate(exec, lead, {}), "proposal");
    await m.refreshReadinessCache(exec, ids.ws, caseId);

    // @ls.test never signs as the client.
    const lsCtx = ok(await m.commandContextFor(exec, { workspaceId: ids.ws, caseId, userId: lsAsClient.id, lsDomains }), "ls context");
    const forOwner = await m.loadCaseApprovals(exec, { workspaceId: ids.ws, caseId, roles: ["owner_cliente"] });
    const gate = forOwner?.approvals.find((a) => a.kind === "gate");
    check(gate && gate.textHash === proposed.summaryTextHash, "the client's owner has the via to sign, on the proposal's text");
    const body = { kind: "gate", target_id: gate.targetId, decision: "approvo", read: true, text_hash: gate.textHash };
    const lsTry = await m.decideCaseApproval(exec, lsCtx, body);
    check(!lsTry.ok && lsTry.code === "ruolo_non_ammesso", `@ls.test with the client's role: ${lsTry.ok ? "signed" : lsTry.code}`);
    const forced = await m.decideCaseApproval(exec, { ...lsCtx, actor: { type: "utente", userId: lsAsClient.id, roles: ["owner_cliente"] } }, body);
    check(!forced.ok && forced.code === "ruolo_solo_cliente", `@ls.test with the role forced: ${forced.ok ? "signed" : forced.code}`);

    const browser = await launchBrowser({ colorScheme: "dark" });
    const failures = [];
    try {
      const firme = `/dashboard/${ids.ws}/casi-duso/${caseId}/firme`;
      // The Lateral Space address does not even get the page.
      const lsPage = await newPage(browser, { width: 400 });
      await loginAs(lsPage, "ls-analista", { to: `/dashboard/${ids.ws}` });
      const lsNav = await navigate(lsPage, `${app}${firme}`);
      const lsReport = await pageReport(lsPage);
      check(lsNav.status === 404 || lsReport.notFound, `/firme for an @ls.test address with the client's role: ${lsNav.status}`);
      await closePage(lsPage);

      const page = await newPage(browser, { width: 400 });
      await loginAs(page, "owner-cliente", { to: `/dashboard/${ids.ws}` });
      const nav = await navigate(page, `${app}${firme}`);
      check(nav.status === 200, `/firme status ${nav.status}`);
      const audit = async (name) => {
        const report = await pageReport(page);
        await screenshot(page, join(shots, `${name}.png`));
        if (report.horizontalOverflow) failures.push(`${name}: horizontal scroll ${report.scrollWidth} > ${report.innerWidth}`);
        if (report.applicationError) failures.push(`${name}: Application error`);
        if (report.filledButtons > 1) failures.push(`${name}: ${report.filledButtons} filled buttons (${report.filledButtonLabels.join(" | ")})`);
        const guard = m.copyGuard.findForbidden(report.text, "cliente");
        if (guard.length > 0) failures.push(`${name}: copy-guard ${guard.map((g) => g.match).join(", ")}`);
        return report;
      };
      check(await waitForText(page, evaluate, "Ci serve la tua firma su una decisione."), "A1: «Ci serve la tua firma su una decisione.»");
      const list = await audit("a1-elenco-400");
      check(list.text.includes("Via allo sviluppo") && list.text.includes("Lateral Space può iniziare a costruire la soluzione."), "A1: the via in the list");
      check(await evaluate(page, clickButton, "Inizia"), "A1: «Inizia»");
      check(await waitForText(page, evaluate, "1 di 1"), "A2: «1 di 1»");
      const step = await audit("a2-via-400");
      check(step.text.includes("Lateral Space ha già firmato: manca solo la tua."), "A2: Lateral Space already signed");
      check(step.text.includes("Non approvo"), "A2: the via can be rejected");
      check(await evaluate(page, clickButton, "Ho letto e approvo"), "A2: «Ho letto e approvo»");
      check(await waitForText(page, evaluate, "Firmato. Con la tua firma la decisione è completa."), "A2: the outcome");
      await audit("a2-firmato-400");
      await closePage(page);
    } finally {
      await browser.close();
    }
    check(failures.length === 0, failures.join("; "));

    const review = await db.query("SELECT decision, catalog_version, approvals FROM uc_gate_reviews WHERE id = $1", [proposed.reviewId]);
    const r = review.rows[0];
    check(r?.decision === "approvato" && r.catalog_version === 1, `review ${r?.decision} v${r?.catalog_version}`);
    check(
      r.approvals.some((a) => a.ruolo === "owner_cliente" && a.metodo === "account" && a.user_id === ownerAccount.id),
      "the account signature of owner-cliente on the proposal",
    );
    const after = await db.query("SELECT status, catalog_version FROM uc_cases WHERE id = $1", [caseId]);
    check(after.rows[0].status === "pronto_sviluppo" && after.rows[0].catalog_version === 1, `case ${after.rows[0].status} v${after.rows[0].catalog_version}`);
    const version = await db.query("SELECT reason FROM uc_catalog_versions WHERE case_id = $1 AND version = 1", [caseId]);
    check(version.rows[0]?.reason === "gate", "catalog v1 frozen by the via");
    return `G1 da non pronto a pronto con i comandi (${before.g1.missing.length} domande mancanti «non si applica» a due firme, ${ready.g1.required} indispensabili), proposta, firma di owner-cliente su /firme a 400 px (elenco, «1 di 1», «Ho letto e approvo»), catalogo v1, «pronto_sviluppo»; @ls.test con il ruolo del cliente: 404 su /firme e rifiutato dal comando. Schermate: ${shots}`;
  } finally {
    await cleanup().catch(() => undefined);
  }
}
