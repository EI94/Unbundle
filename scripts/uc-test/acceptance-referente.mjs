// Steps 3 and 4 of acceptance.mjs (DESIGN §8.3 WP8): the referent's link on the harness app.
//
// Each run works on a throw-away synthetic workspace («Cliente Esempio», its own
// organization, Lateral Space user, case from templates/uc/esempio.minimo, one referent),
// so the example case of seed-fixtures.mjs is never touched, and removes it at the end.
// It talks only to 127.0.0.1: the app on 53110 (HTTP and headless Chrome) and the
// isolated database on 55449. No real email is sent: the harness has no RESEND_API_KEY.
//
//   step 3 · link at 400 px: noindex (header and meta), no-store and no-referrer, light
//            theme even with a dark browser; then, after the notice, every screen (home, each
//            step of each topic, each «Controlla e invia», «Chiedi a un collega»): no
//            horizontal scroll, no field under 16 px, at most one filled button, copy-guard
//            for the client;
//   step 4 · through the public API, as the page does: the two-level notice, a batch of
//            typed answers (number, time interval, rule «È così», a table pasted from
//            Excel), «Non lo so», «Non si applica», the confirmation of a value declared
//            in a call, an attachment (CSV) used as a «file» answer, a delegation to a
//            colleague whose own link opens.
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { UC_TEST_APP_PORT, UC_TEST_DATABASE_URL, UC_TEST_HOST, UC_TEST_LS_DOMAIN } from "./config.mjs";

const app = `http://${UC_TEST_HOST}:${UC_TEST_APP_PORT}`;
const ORIGIN = app;

function check(condition, message) {
  if (!condition) throw new Error(message);
}

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
    ...(await load("src/lib/uc/public-view.ts")),
    ...(await load("src/lib/uc/answers/normalize.ts")),
    copyGuard: await load("src/lib/uc/views/copy-guard.ts"),
    plan: await load("src/lib/uc/views/referente-plan.ts"),
  };
}

const ok = (r, what) => {
  if (!r || !r.ok) throw new Error(`${what}: ${r ? `${r.code} ${r.message}` : "no result"}`);
  return r.value;
};

/**
 * A synthetic case with one referent who answers every question of the example schema,
 * a value declared in a call, and a sent request with its link. Returns the context and a
 * `cleanup` that removes everything.
 */
export async function referentFixture(db) {
  const m = await appModules();
  const exec = m.ucExecutorForUrl(UC_TEST_DATABASE_URL);
  const lsDomains = [UC_TEST_LS_DOMAIN];
  const ids = { org: randomUUID(), ws: randomUUID(), lead: randomUUID() };
  const tag = ids.ws.slice(0, 8);
  const cleanup = async () => {
    await db.query("DELETE FROM workspaces WHERE id = $1", [ids.ws]);
    await db.query("DELETE FROM organizations WHERE id = $1", [ids.org]);
    await db.query("DELETE FROM users WHERE id = $1", [ids.lead]);
  };
  try {
    await db.query("INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova referente', $2)", [ids.org, `uc-acc-ref-${tag}`]);
    await db.query("INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Cliente Esempio')", [ids.ws, ids.org]);
    await db.query("INSERT INTO users (id, email, email_verified, name) VALUES ($1, $2, now(), 'Prova accettazione LS')", [ids.lead, `acc-ref-${tag}@${UC_TEST_LS_DOMAIN}`]);
    await db.query("INSERT INTO memberships (user_id, organization_id, role) VALUES ($1, $2, 'transformation_lead')", [ids.lead, ids.org]);
    const template = JSON.parse(readFileSync(resolve("templates/uc/esempio.minimo/1.0.0.json"), "utf8"));
    template.key = `prova.accettazione_${tag}`;
    const plan = m.planTemplateLoad(JSON.stringify(template), { restrictToWorkspaceId: ids.ws });
    check(plan.ok, "example schema");
    const loaded = ok(await m.applyTemplateLoad(exec, plan.plan, { actorUserId: ids.lead, publish: true }), "schema load");
    const lead = await m.loadUserContext(exec, ids.lead, lsDomains);
    const created = ok(await m.createCase(exec, { workspaceId: ids.ws, user: lead, canReviewWorkspacePortfolio: true, input: { templateId: loaded.templateId, code: `ACC-${tag.toUpperCase()}`, title: "Smistamento richieste" } }), "case");
    const caseId = created.caseId;
    const items = new Map((await db.query("SELECT id, key FROM uc_items WHERE case_id = $1", [caseId])).rows.map((r) => [r.key, r.id]));
    const ctx = ok(await m.commandContextFor(exec, { workspaceId: ids.ws, caseId, userId: ids.lead, lsDomains }), "context");
    const contact = ok(await m.createContact(exec, ctx, { displayName: "Marco Bianchi", templateRoleKey: "resp_servizio", email: `marco-${tag}@cliente.test` }), "referent").contactId;
    for (const roleKey of ["resp_servizio", "controllo_gestione", "referente_sistemi"]) ok(await m.assignItems(exec, ctx, { mode: "ruolo", roleKey, contactId: contact }), `assign ${roleKey}`);
    // A typed value declared in a call: the referent confirms it with «È così».
    const declared = m.normalizeAnswer("percentuale", { value: "18", base: "delle richieste" }, { base: "delle richieste" }, m.answerContext(new Date(), true));
    check(declared.ok, "declared value");
    const declaredId = randomUUID();
    await db.query(
      "INSERT INTO uc_answers (id, case_id, item_id, version, kind, value, value_normalized, source_kind, source_ref) VALUES ($1, $2, $3, 1, 'valore', $4::jsonb, $5::jsonb, 'dichiarato_in_call', 'F001')",
      [declaredId, caseId, items.get("q.costi.02"), JSON.stringify(declared.value), JSON.stringify(declared.normalized)],
    );
    await db.query("UPDATE uc_items SET current_answer_id = $1 WHERE id = $2", [declaredId, items.get("q.costi.02")]);
    const sent = ok(await m.sendRequests(exec, ctx, { contactIds: [contact] }), "send");
    const requestId = sent.requests[0].requestId;
    const token = ok(await m.issueRequestToken(exec, { workspaceId: ids.ws, caseId, requestId, issuedFor: "invio" }), "link").token;
    return { db, m, ids, caseId, items, contact, requestId, token, declaredId, tag, cleanup };
  } catch (error) {
    await cleanup().catch(() => undefined);
    throw error;
  }
}

async function api(token, path, { method = "POST", body, form } = {}) {
  const headers = { origin: ORIGIN, accept: "application/json" };
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${app}/api/r/${token}${path ? `/${path}` : ""}`, { method, headers, body: payload, redirect: "manual" });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

/** Fields of the page (not checkboxes, radios or the hidden file input) under 16 px: iOS zooms on them. */
function smallFields() {
  return [...document.querySelectorAll("input:not([type=checkbox]):not([type=radio]):not([type=file]), textarea, select")]
    .filter((el) => el.getBoundingClientRect().width > 1 && !el.closest(".sr-only") && parseFloat(getComputedStyle(el).fontSize) < 16)
    .map((el) => el.id || el.getAttribute("aria-label") || el.tagName);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Waits until the client has rendered the screen of the hash (title of the tab). */
async function waitForTitle(page, evaluate, prefix, timeoutMs = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const title = await evaluate(page, "document.title");
    if (typeof title === "string" && title.startsWith(prefix)) return true;
    await sleep(150);
  }
  return false;
}

/** Step 3: the link at 400 px, the notice first, then every screen of the referent. */
export async function step3(f) {
  const res = await fetch(`${app}/r/${f.token}`, { redirect: "manual" });
  check(res.status === 200, `status ${res.status}`);
  check(/noindex/.test(res.headers.get("x-robots-tag") ?? ""), "X-Robots-Tag noindex");
  check((res.headers.get("referrer-policy") ?? "") === "no-referrer", "Referrer-Policy no-referrer");
  // `next start` answers no-store; `next dev` rewrites it to no-cache: neither is reused without asking.
  check(/no-store|no-cache/.test(res.headers.get("cache-control") ?? ""), "Cache-Control no-store or no-cache");
  const html = await res.text();
  check(/<meta name="robots" content="noindex/.test(html), "meta robots noindex");
  check(html.includes("survey-light"), "light theme rendered by the server");

  const { launchBrowser, newPage, navigate, pageReport, evaluate, closePage } = await import("./cdp.mjs");
  // A dark browser: the link stays light anyway.
  const browser = await launchBrowser({ colorScheme: "dark" });
  const failures = [];
  let screens = 0;
  let seq = 0;
  try {
    const page = await newPage(browser, { width: 400, colorScheme: "dark" });
    /** Opens a screen with a real navigation (the query changes, so the load event fires) and checks it. */
    const visit = async (name, hash, titlePrefix) => {
      const nav = await navigate(page, `${app}/r/${f.token}?p=${++seq}${hash}`);
      if (nav.status !== 200) {
        failures.push(`${name}: status ${nav.status}`);
        return null;
      }
      if (titlePrefix && !(await waitForTitle(page, evaluate, titlePrefix))) failures.push(`${name}: the screen did not open (${await evaluate(page, "document.title")})`);
      const report = await pageReport(page);
      if (report.horizontalOverflow) failures.push(`${name}: horizontal scroll ${report.scrollWidth} > ${report.innerWidth}`);
      if (report.applicationError) failures.push(`${name}: Application error`);
      if (report.filledButtons > 1) failures.push(`${name}: ${report.filledButtons} filled buttons (${report.filledButtonLabels.join(" | ")})`);
      const guard = f.m.copyGuard.findForbidden(report.text, "cliente");
      if (guard.length > 0) failures.push(`${name}: copy-guard ${guard.map((g) => g.match).join(", ")}`);
      const small = await evaluate(page, smallFields);
      if (small.length > 0) failures.push(`${name}: fields under 16 px (${small.join(", ")})`);
      screens++;
      return report;
    };

    // R0 before «Ho letto, iniziamo»: light theme with a dark browser.
    const first = await visit("prima di iniziare", "", null);
    check(first?.h1.includes("Prima di iniziare"), `first screen: ${first?.h1.join(" / ")}`);
    // The browser paints the computed background on a canvas and reads it back in sRGB: the
    // check does not depend on how the CSS writes the colour (oklch() in dev, lab() after the
    // production build, rgb()).
    const look = await evaluate(page, () => {
      const root = document.getElementById("survey-root");
      const bg = root ? getComputedStyle(root).backgroundColor : "";
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext("2d");
      let rgb = null;
      if (ctx && bg) {
        ctx.fillStyle = "#000";
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, 1, 1);
        rgb = [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)];
      }
      return { bg, rgb, light: root?.classList.contains("survey-light") ?? false };
    });
    check(look.light, "survey-light root");
    check(Array.isArray(look.rgb) && look.rgb.every((c) => c > 200), `light background (${look.bg} → rgb ${look.rgb?.join(",")})`);

    // The notice through the API, as the button does; then every screen of the link.
    const ack = await api(f.token, "privacy-ack", { body: { version: f.m.REFERENT_PRIVACY_NOTICE.version } });
    check(ack.status === 200 && ack.json?.ok, `privacy ack ${ack.status}`);
    const view = await api(f.token, "", { method: "GET" });
    check(view.status === 200 && view.json?.ok, `view ${view.status}`);
    const modules = view.json.data.modules;
    await visit("home", "#/", "Unbundle");
    for (const mod of modules) {
      const topic = f.m.plan.topicId(mod);
      const steps = f.m.plan.topicSteps(mod);
      for (let k = 1; k <= steps.length; k++) await visit(`${topic} ${k}/${steps.length}`, `#/a/${encodeURIComponent(topic)}/${k}`, `Domanda ${k} di ${steps.length}`);
      if (steps.length > 0) await visit(`${topic} controlla e invia`, `#/a/${encodeURIComponent(topic)}/invia`, "Controlla e invia");
    }
    const delegable = modules.flatMap((m) => m.items).find((i) => i.can.delegate);
    check(delegable, "a question that can go to a colleague");
    await visit("chiedi a un collega", `#/collega/${delegable.id}`, "Chiedi a un collega");
    await closePage(page);
  } finally {
    await browser.close();
  }
  check(failures.length === 0, failures.join("; "));
  return `200, noindex, senza cache, no-referrer, chiaro anche con il browser scuro; ${screens} schermate a 400 px (informativa, Home, ogni passo, ogni «Controlla e invia», delega): senza scorrimento, campi a 16 px, un solo pulsante pieno, copy-guard`;
}

/** Step 4: the answers through the public API, as the page sends them. */
export async function step4(f) {
  const it = (k) => f.items.get(k);
  const ack = await api(f.token, "privacy-ack", { body: { version: f.m.REFERENT_PRIVACY_NOTICE.version } });
  check(ack.status === 200 && ack.json?.ok, `privacy ack ${ack.status}`);
  check(f.m.REFERENT_PRIVACY_NOTICE.version === "uc-2026-10-2", "notice version");
  const view = await api(f.token, "", { method: "GET" });
  const item = (k) => view.json.data.modules.flatMap((m) => m.items).find((i) => i.key === k);
  const declared = item("q.costi.02");
  check(declared?.toConfirm?.canConfirm && declared.toConfirm.sourceLabel === "In una call con Lateral Space", "declared value shown to confirm, no fact code");

  // Attachment: a CSV export uploaded from the link, then the answer of a «file» question.
  const form = new FormData();
  // Column names like «email» or «telefono» would read as personal data: the export uses neutral ones.
  form.set("file", new Blob(["canale;quota\nposta;60\nsportello;30\naltro;10\n"], { type: "text/csv" }), "export-di-prova.csv");
  form.set("itemId", it("q.sistemi.03"));
  form.set("declaration", "true");
  const upload = await api(f.token, "upload", { form });
  check(upload.status === 200 && upload.json?.ok, `upload ${upload.status} ${upload.json?.error ?? ""}`);
  const file = upload.json.data;
  check(file.usable, `uploaded file not usable (${file.status})`);

  const answers = [
    { item_id: it("q.servizio.02"), kind: "valore", payload: { value: "1200" }, estimate: true, source_basis: "stima_a_memoria" },
    { item_id: it("q.servizio.04"), kind: "valore", payload: { from: "08:30", to: "18:00", kind: "ora" } },
    { item_id: it("q.servizio.03"), kind: "valore", payload: { choice: "confermo", exceptions: "nessuna segnalata" } },
    { item_id: it("q.servizio.01"), kind: "valore", payload: "Canale\tSu 100\nemail\t60\ntelefono\t30\nchat\t10" },
    { item_id: it("q.servizio.05"), kind: "non_so", who_might_know: "il responsabile dei turni" },
    { item_id: it("q.costi.04"), kind: "proposta_na", reason: "Il costo orario non cambia durante l'anno." },
    { item_id: it("q.costi.02"), kind: "conferma", supersedes_answer_id: f.declaredId },
    { item_id: it("q.sistemi.03"), kind: "valore", payload: { file_ids: [file.fileId] }, file_ids: [file.fileId] },
  ];
  const batch = await api(f.token, "answers", { body: { answers } });
  check(batch.status === 200 && batch.json?.ok, `batch ${batch.status} ${batch.json?.message ?? ""}`);
  const outcomes = batch.json.data.results;
  const bad = outcomes.filter((r) => !r.ok);
  check(bad.length === 0, `refused: ${bad.map((r) => `${r.code} ${r.message}`).join("; ")}`);
  const rows = await f.db.query("SELECT i.key, i.status, a.kind FROM uc_items i LEFT JOIN uc_answers a ON a.id = i.current_answer_id WHERE i.case_id = $1 AND i.key = ANY($2)", [
    f.caseId,
    ["q.servizio.01", "q.servizio.02", "q.servizio.03", "q.servizio.04", "q.servizio.05", "q.costi.02", "q.costi.04", "q.sistemi.03"],
  ]);
  const byKey = Object.fromEntries(rows.rows.map((r) => [r.key, `${r.status}/${r.kind}`]));
  check(byKey["q.servizio.05"] === "mancante/non_so", `«Non lo so»: ${byKey["q.servizio.05"]}`);
  check(byKey["q.costi.04"] === "in_verifica/proposta_na", `«Non si applica»: ${byKey["q.costi.04"]}`);
  check(byKey["q.costi.02"] === "in_verifica/conferma", `conferma: ${byKey["q.costi.02"]}`);
  check(byKey["q.servizio.01"] === "in_verifica/valore", `tabella: ${byKey["q.servizio.01"]}`);
  check(byKey["q.sistemi.03"] === "in_verifica/valore", `allegato: ${byKey["q.sistemi.03"]}`);

  // Delegation to a colleague of the same company: the questions leave this link, the colleague's link opens.
  const delegate = await api(f.token, "delegate", { body: { nome: "Giulia Rossi", email: `giulia-${f.tag}@cliente.test`, voci: [it("q.sistemi.02"), it("q.sistemi.04")] } });
  check(delegate.status === 200 && delegate.json?.ok && delegate.json.data.status === "inviata", `delegation ${delegate.status} ${delegate.json?.message ?? ""}`);
  check(typeof delegate.json.data.link === "string", "without email the colleague's link comes back once");
  const colleague = await fetch(`${app}${delegate.json.data.link}`, { redirect: "manual" });
  check(colleague.status === 200, `colleague link ${colleague.status}`);
  const after = await api(f.token, "", { method: "GET" });
  const left = after.json.data.modules.flatMap((m) => m.items).map((i) => i.key);
  check(!left.includes("q.sistemi.02") && !left.includes("q.sistemi.04"), "delegated questions leave the link");
  check(after.json.data.progress.done >= answers.length, `progress ${after.json.data.progress.done}`);
  return `${answers.length} risposte in un invio a gruppi (numero, intervallo, regola, tabella da Excel, «Non lo so», «Non si applica», conferma, allegato), delega a un collega`;
}
