// Browser acceptance of the two 0025 bell rows, «Pronto da avviare» and «Autorizza i fornitori», on
// the hub's local harness (a production build, the Firebase Auth emulator and a throwaway clone).
// It uses scripts/uc-test/cdp.mjs as a library and signs in through scripts/uc-test/browser-login.mjs,
// like scripts/use-case-test/bell-acceptance.mjs.
//
//   export UC_TEST_ROOT=/private/tmp/<dir>/hub
//   export UC_TEST_PG_PORT=55479 UC_TEST_PG_DB=hub_<id>
//   export UC_TEST_APP_PORT=<app> UC_TEST_AUTH_PORT=<auth> UC_TEST_LOGIN_PORT=<login>
//   node scripts/uc-test/start-app.mjs --production --flag USE_CASE_HUB_WORKSPACES=<id of «a»> > app.log &
//   node scripts/uc-test/browser-login.mjs &
//   node scripts/use-case-test/case-alerts-acceptance.mjs [--widths 375,1440]
//
// On workspace «a» of the fixtures (scripts/uc-test/seed-fixtures.mjs, scripts/use-case-test/seed-hub.mjs)
// it seeds, with the app's own statements (`cardSyncStatements`, `subprocessorsWaitNoticeStatements`):
// a seeded use case approved for this quarter with nothing open from the client, made ready (one
// «Pronto da avviare» row for each Lateral Space reviewer, ls-lead included), and another seeded use
// case approved with a client question still to ask while the workspace has no «ok sui
// sub-responsabili» (one «Autorizza i fornitori» row for function-lead, who can give it). Then, for
// each width:
//  1. ls-lead sees «Pronto da avviare»; its click opens the use case at «Realizzazione»: the
//     «Realizzazione» fold of the guided card (release 3, in place of the chapter bar) open, in view
//     and with the focus inside it, and no «Capitoli» bar on the page;
//  2. function-lead sees «Autorizza i fornitori» and no «Pronto da avviare»; its click opens
//     Impostazioni with «Sub-responsabili» in view;
//  3. osservatore (contributor) sees neither row;
//  4. no horizontal scroll at any step (scrollWidth ≤ innerWidth).
// Last (the ok is append-only): the ok is given and, after a reload, function-lead's row is gone while
// ls-lead's row stays. Writes only to the throwaway harness database (127.0.0.1, uc_test, hub_<id>).
// Exit 1 on any failure.
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { closePage, evaluate, launchBrowser, loginAs, navigate, newPage } from "../uc-test/cdp.mjs";
import { cardSyncStatements, subprocessorsWaitNoticeStatements } from "../../src/lib/use-cases/case-alerts/sql.ts";
import { alertSchedule } from "../../src/lib/use-cases/referent/alerts.ts";
import { ROME_QUARTER_NOW_SQL } from "../../src/lib/db/use-case-hub-alerts-ddl.ts";
import { SUBPROCESSORS_VERSION } from "../../src/lib/uc/legal/subprocessors.ts";
import { UC_TEST_APP_PORT, UC_TEST_DB, UC_TEST_HOST, UC_TEST_LOGIN_PORT, UC_TEST_LS_DOMAIN, UC_TEST_PORT, UC_TEST_USER, ucTestRoot } from "../uc-test/config.mjs";

const args = process.argv.slice(2);
let widths = [375, 1440];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--widths" && args[i + 1]) {
    widths = args[++i].split(",").map((w) => Number(w.trim()));
    if (widths.some((w) => !Number.isInteger(w) || w < 320 || w > 2560)) throw new Error("--widths takes integers between 320 and 2560");
  } else throw new Error(`Unknown option ${args[i]} (only --widths)`);
}
if ([53100, 53110, 53130].includes(UC_TEST_APP_PORT) || [53102, 53112].includes(UC_TEST_LOGIN_PORT)) {
  throw new Error(`App ${UC_TEST_APP_PORT} / login ${UC_TEST_LOGIN_PORT} belong to another harness`);
}
if ([55439, 55449, 55469].includes(UC_TEST_PORT)) throw new Error(`Port ${UC_TEST_PORT} is not the hub's cluster`);
if (!/^hub_[a-z0-9][a-z0-9_]{0,39}$/.test(UC_TEST_DB)) throw new Error(`UC_TEST_PG_DB must be a package copy hub_<id>, not ${UC_TEST_DB}`);
if (UC_TEST_HOST !== "127.0.0.1") throw new Error("The harness database must be on 127.0.0.1");

const manifestPath = join(ucTestRoot(), "uc-fixtures", "synthetic-fixtures.json");
if (!existsSync(manifestPath)) throw new Error(`No fixtures manifest at ${manifestPath}: run seed-fixtures.mjs and seed-hub.mjs first`);
const fixtures = JSON.parse(readFileSync(manifestPath, "utf8"));
const ws = fixtures.workspaces?.[fixtures.hub?.areaOn ?? "a"]?.workspaceId;
const lead = fixtures.accounts?.["function-lead"];
const lsLead = fixtures.accounts?.["ls-lead"];
const observer = fixtures.accounts?.osservatore;
const seeded = fixtures.hub?.useCases?.a ?? [];
if (!ws || !lead?.id || !lsLead?.id || !observer?.id || seeded.length < 4) {
  throw new Error("The manifest needs workspace «a», function-lead, ls-lead, osservatore and four seeded use cases (seed-hub.mjs)");
}
// Not the two cards of bell-acceptance.mjs (the first two).
const readyCard = seeded[2].id;
const waitingCard = seeded[3].id;
const app = `http://${UC_TEST_HOST}:${UC_TEST_APP_PORT}`;
const readyPath = `/dashboard/${ws}/use-cases/${readyCard}`;
const settingsPath = `/dashboard/${ws}/settings`;

const { Client } = createRequire(resolve("package.json"))("pg");

async function withClient(run) {
  const client = new Client({ host: UC_TEST_HOST, port: UC_TEST_PORT, user: UC_TEST_USER, database: UC_TEST_DB });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}
const exec = (client, statements) => statements.reduce((p, s) => p.then(() => client.query(s.text, [...s.params])), Promise.resolve());

/**
 * The two rows, through the app's own statements, in one transaction. The 0025 must be there (the app's
 * self-heal applies it on its first page): the script stops if it is not. A ready card first goes back
 * to «Più avanti» and is synced, so that becoming ready again is a real transition (the migration seed
 * marks the cards that are ready already).
 */
async function seed() {
  await withClient(async (client) => {
    const [{ ok }] = (await client.query(`SELECT to_regclass('public.use_case_ready_state') IS NOT NULL AS ok`)).rows;
    if (!ok) throw new Error("The 0025 is not applied on the harness database: open a page of the app first");
    const acks = await client.query(`SELECT 1 FROM uc_subprocessor_acks WHERE workspace_id = $1::uuid AND list_version = $2`, [ws, SUBPROCESSORS_VERSION]);
    if (acks.rowCount) throw new Error("Workspace «a» already has the ok on the sub-processors: start from a fresh clone");
    const dossiers = (await client.query(`SELECT 1 FROM uc_cases WHERE portfolio_use_case_id = ANY($1::uuid[]) AND setup_completed_at IS NOT NULL`, [[readyCard, waitingCard]])).rowCount;
    if (dossiers) throw new Error("The chosen seeded use cases have a dossier: the fixtures changed");
    const now = new Date();
    const context = { lsDomains: [UC_TEST_LS_DOMAIN], dossiers: true, schedule: alertSchedule(now), now };
    await client.query("BEGIN");
    try {
      await client.query(
        `UPDATE use_cases SET status = 'accepted', portfolio_review_status = 'scored', portfolio_kind = 'use_case_ai', target_quarter = NULL WHERE id = ANY($1::uuid[]) AND workspace_id = $2::uuid`,
        [[readyCard, waitingCard], ws],
      );
      // Nothing open from the client on the ready card; one question to ask on the other.
      await client.query(
        `UPDATE use_case_needs n SET status = 'non_applicabile', done_at = coalesce(n.done_at, now())
         FROM use_case_need_links l WHERE l.need_id = n.id AND l.use_case_id = $1::uuid AND n.type = 'requisito' AND n.status NOT IN ('validata', 'non_applicabile')`,
        [readyCard],
      );
      const need = await client.query(
        `INSERT INTO use_case_needs (workspace_id, type, kind, title, owner_side, status) VALUES ($1::uuid, 'requisito', 'dato', 'Quante fatture al mese?', 'cliente', 'da_chiedere') RETURNING id`,
        [ws],
      );
      await client.query(`INSERT INTO use_case_need_links (need_id, use_case_id) VALUES ($1::uuid, $2::uuid)`, [need.rows[0].id, waitingCard]);
      await exec(client, cardSyncStatements({ workspaceId: ws, useCaseIds: [readyCard], actorUserId: null, readiness: context, info: false }));
      await client.query(`UPDATE use_cases SET target_quarter = ${ROME_QUARTER_NOW_SQL} WHERE id = ANY($1::uuid[])`, [[readyCard, waitingCard]]);
      await exec(client, cardSyncStatements({ workspaceId: ws, useCaseIds: [readyCard], actorUserId: null, readiness: context, info: false }));
      await exec(client, subprocessorsWaitNoticeStatements({ workspaceId: ws, useCaseId: waitingCard, notice: context }));
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    }
  });
}

/** The ok on the sub-processors, as function-lead would give it in Impostazioni (append-only: last). */
async function giveOk() {
  await withClient((client) =>
    client.query(
      `INSERT INTO uc_subprocessor_acks (workspace_id, list_version, statement_text, declared_by_user_id, declared_by_role) VALUES ($1::uuid, $2, 'Autorizzazione di prova (harness)', $3::uuid, 'function_lead')`,
      [ws, SUBPROCESSORS_VERSION, lead.id],
    ),
  );
}

const results = [];
function record(name, failures) {
  results.push({ name, failures });
  console.log(`${failures.length ? "FAIL" : "ok  "} ${name}${failures.length ? `: ${failures.join("; ")}` : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The bell and the page as they are now. */
function state(page) {
  return evaluate(page, () => {
    const menu = document.querySelector("[data-slot=dropdown-menu-content]");
    const open = Boolean(menu && getComputedStyle(menu).display !== "none" && menu.getBoundingClientRect().height > 0);
    const rows = open ? [...menu.querySelectorAll("[role=menuitem]")].filter((el) => el.querySelector(".line-clamp-2")) : [];
    const inView = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.bottom > 0 && r.top < window.innerHeight;
    };
    // The «Realizzazione» fold of the guided card (`<details id="realizzazione" data-slot="fold">`):
    // `?capitolo=realizzazione` opens it from the server, brings it to the top and focuses its summary.
    const fold = document.getElementById("realizzazione");
    const active = document.activeElement;
    const isFold = fold instanceof HTMLDetailsElement && fold.dataset.slot === "fold";
    return {
      open,
      rows: rows.map((el) => ({ href: el.getAttribute("href"), text: el.textContent.replace(/\s+/g, " ").trim() })),
      overflow: document.documentElement.scrollWidth > window.innerWidth,
      url: location.pathname + location.search + location.hash,
      chapterBar: Boolean(document.querySelector("[data-slot=chapter-nav]")),
      realizationFold: isFold,
      realizationOpen: isFold && fold.open,
      realizationFocus: Boolean(fold && active && active !== document.body && fold.contains(active)),
      focused: active && active !== document.body ? `${active.tagName.toLowerCase()}${active.dataset?.slot ? `[${active.dataset.slot}]` : ""}${active.id ? `#${active.id}` : ""}` : "body",
      realizationInView: inView(fold),
      subprocessorsInView: inView(document.getElementById("sub-responsabili")),
    };
  });
}

async function clickAt(page, selector) {
  const box = await evaluate(page, (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
  if (!box) throw new Error(`Nothing to click: ${selector}`);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
    await page.send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
  }
}
async function openBell(page) {
  await clickAt(page, "[data-slot=notifications-bell]");
  for (let i = 0; i < 40; i++) {
    const s = await state(page);
    if (s.open) {
      await sleep(800);
      return state(page);
    }
    await sleep(100);
  }
  return state(page);
}
async function waitFor(page, predicate, timeoutMs = 15_000) {
  const start = Date.now();
  let s = await state(page);
  while (!predicate(s) && Date.now() - start < timeoutMs) {
    await sleep(150);
    s = await state(page);
  }
  return s;
}

const READY = "Pronto da avviare";
const SUPPLIERS = "Autorizza i fornitori";
const readyRow = (s) => s.rows.find((r) => r.href?.endsWith(`${readyPath}?capitolo=realizzazione`) && r.text.includes(READY));
const suppliersRow = (s) => s.rows.find((r) => r.href?.endsWith(`${settingsPath}#sub-responsabili`) && r.text.includes(SUPPLIERS));

const browser = await launchBrowser({ colorScheme: "dark" });
try {
  let seededOnce = false;
  for (const width of widths) {
    const page = await newPage(browser, { width });
    const tag = `${width}px`;
    try {
      await loginAs(page, "ls-lead", { to: `/dashboard/${ws}/use-cases` });
      // The first page of the app applies the 0025 (self-heal); then the rows.
      if (!seededOnce) {
        await seed();
        seededOnce = true;
        await navigate(page, `${app}/dashboard/${ws}/use-cases`);
      }
      let s = await openBell(page);
      const ready = readyRow(s);
      record(`${tag} ls-lead sees «${READY}»`, [...(ready ? [] : [`rows: ${JSON.stringify(s.rows.map((r) => r.text.slice(0, 60)))}`]), ...(suppliersRow(s) ? [`«${SUPPLIERS}» reached Lateral Space`] : []), ...(s.overflow ? ["horizontal scroll"] : [])]);
      if (ready) {
        await clickAt(page, `[data-slot=dropdown-menu-content] a[href$="${readyPath}?capitolo=realizzazione"]`);
        s = await waitFor(page, (x) => x.url.startsWith(`${readyPath}?capitolo=realizzazione`) && !x.open && x.realizationOpen && x.realizationFocus && x.realizationInView);
        // The state a second later: nothing (the closing menu, a late render) takes the focus back.
        await sleep(1000);
        s = await state(page);
        record(`${tag} its click opens the use case at «Realizzazione»`, [
          ...(s.url.startsWith(`${readyPath}?capitolo=realizzazione`) ? [] : [`url ${s.url}`]),
          ...(s.open ? ["menu still open"] : []),
          ...(s.realizationFold ? [] : ["«Realizzazione» is not a fold of the card"]),
          ...(s.realizationFold && !s.realizationOpen ? ["the «Realizzazione» fold is closed"] : []),
          ...(s.realizationFocus ? [] : [`focus not in «Realizzazione» (on ${s.focused})`]),
          ...(s.realizationInView ? [] : ["«Realizzazione» not in view"]),
          ...(s.chapterBar ? ["the old «Capitoli» bar is on the page"] : []),
          ...(s.overflow ? ["horizontal scroll"] : []),
        ]);
      }

      await loginAs(page, "function-lead", { to: `/dashboard/${ws}/use-cases` });
      s = await openBell(page);
      const suppliers = suppliersRow(s);
      record(`${tag} function-lead sees «${SUPPLIERS}» and no «${READY}»`, [
        ...(suppliers ? [] : [`rows: ${JSON.stringify(s.rows.map((r) => r.text.slice(0, 60)))}`]),
        ...(readyRow(s) ? [`«${READY}» reached the client`] : []),
        ...(s.overflow ? ["horizontal scroll"] : []),
      ]);
      if (suppliers) {
        await clickAt(page, `[data-slot=dropdown-menu-content] a[href$="${settingsPath}#sub-responsabili"]`);
        s = await waitFor(page, (x) => x.url.startsWith(settingsPath) && !x.open && x.subprocessorsInView);
        record(`${tag} its click opens Impostazioni › Sub-responsabili`, [
          ...(s.url.startsWith(settingsPath) ? [] : [`url ${s.url}`]),
          ...(s.open ? ["menu still open"] : []),
          ...(s.subprocessorsInView ? [] : ["«Sub-responsabili» not in view"]),
          ...(s.overflow ? ["horizontal scroll"] : []),
        ]);
      }

      await loginAs(page, "osservatore", { to: `/dashboard/${ws}/use-cases` });
      s = await openBell(page);
      record(`${tag} osservatore (contributor) sees neither row`, [
        ...(readyRow(s) || suppliersRow(s) ? ["a 0025 row reached a contributor"] : []),
        ...(s.rows.some((r) => r.text.includes(READY) || r.text.includes(SUPPLIERS)) ? ["a 0025 title in the bell"] : []),
        ...(s.overflow ? ["horizontal scroll"] : []),
      ]);
    } finally {
      await closePage(page);
    }
  }

  // Last: the ok (append-only). function-lead's row leaves the bell; ls-lead's stays.
  await giveOk();
  const page = await newPage(browser, { width: widths[widths.length - 1] });
  try {
    await loginAs(page, "function-lead", { to: `/dashboard/${ws}/use-cases` });
    let s = await openBell(page);
    record("after the ok and a reload, «Autorizza i fornitori» is gone", [...(suppliersRow(s) || s.rows.some((r) => r.text.includes(SUPPLIERS)) ? ["row still there"] : []), ...(s.overflow ? ["horizontal scroll"] : [])]);
    await loginAs(page, "ls-lead", { to: `/dashboard/${ws}/use-cases` });
    s = await openBell(page);
    record("ls-lead still sees «Pronto da avviare» (it does not depend on the ok)", readyRow(s) ? [] : ["row missing"]);
  } finally {
    await closePage(page);
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => r.failures.length);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
