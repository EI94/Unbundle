// Browser acceptance of the two 0025 bell rows, «Pronto da avviare» and «Autorizza i fornitori», and
// of where «Nessuna risposta» lands on the guided card (release 3), on the hub's local harness (a
// production build, the Firebase Auth emulator and a throwaway clone).
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
// sub-responsabili» (one «Autorizza i fornitori» row for function-lead, who can give it); on a third
// seeded use case a request to a synthetic referent sent 31 days ago and expired now, with the app's
// own statements too (`needTransitionSql`, `referentEventSql`, then the cron's `expireStatements`,
// which writes the «Nessuna risposta» rows of the workspace's reviewers). Then, for each width:
//  1. ls-lead sees «Pronto da avviare»; its click opens the use case (`?capitolo=realizzazione`, the
//     address of the e-mails already sent too) at the «Prossimo passo» box of the guided card, which
//     on a ready card holds «Avvia la realizzazione» (the «Realizzazione» fold no longer repeats it):
//     the box in view with the focus inside it (its heading) and «Avvia la realizzazione» whole in
//     the window, the «Realizzazione» fold closed, still so a second later (the closing menu does not
//     take the focus back to the bell), and no «Capitoli» bar on the page;
//  1b. on that address (it keeps `?capitolo=realizzazione` for the whole visit) ls-lead clicks «Più
//     avanti» in «Quando»: the page reloads its data, the card goes from G9 to G3, and the arrival
//     does not run again: the focus stays on the clicked choice, the choice stays in the window where
//     it was (no scroll jump), the «Realizzazione» fold stays closed; ls-lead opens the fold, clicks
//     «Questo trimestre», the card is G9 again, and the focus, the window and the open fold stay as
//     they were (before the fix the fold opened and closed by itself and the page jumped to it and
//     back to the box, the focus with it);
//  2. function-lead sees «Autorizza i fornitori» and no «Pronto da avviare»; its click opens
//     Impostazioni with «Sub-responsabili» in view;
//  3. function-lead sees «Nessuna risposta»; its click (`?capitolo=richieste`) opens the card with
//     «Richieste inviate» of «Cosa serve» open, the focus on its summary and «Chiedi di nuovo» of the
//     expired request whole in the window, still so a second later;
//  3b. the two bell addresses of that card and the browser's Back and Forward between them:
//     function-lead loads it at `?capitolo=cosa-serve` (the address of «Risposte arrivate»), clicks
//     «Nessuna risposta» in the bell (`?capitolo=richieste`, «Richieste inviate» open), then Back
//     (real history traversal) lands on «Cosa serve» with the focus on its heading and «Richieste
//     inviate» closed, and Forward on «Richieste inviate» open with the focus on its summary, each
//     still so a second later (before the fix Back kept «Richieste inviate» open with the focus on
//     it, and Forward closed it and put the focus on the heading of «Cosa serve»);
//  4. osservatore (contributor) sees none of the three rows;
//  5. no horizontal scroll at any step (scrollWidth ≤ innerWidth).
// Last (the ok is append-only): the ok is given and, after a reload, function-lead's row is gone while
// ls-lead's row stays. Writes only to the throwaway harness database (127.0.0.1, uc_test, hub_<id>).
// Exit 1 on any failure.
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { closePage, evaluate, launchBrowser, loginAs, navigate, newPage } from "../uc-test/cdp.mjs";
import { cardSyncStatements, subprocessorsWaitNoticeStatements } from "../../src/lib/use-cases/case-alerts/sql.ts";
import { alertSchedule } from "../../src/lib/use-cases/referent/alerts.ts";
import { expireStatements, needTransitionSql, referentEventSql } from "../../src/lib/use-cases/referent/sql.ts";
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
if (!ws || !lead?.id || !lsLead?.id || !observer?.id || seeded.length < 5) {
  throw new Error("The manifest needs workspace «a», function-lead, ls-lead, osservatore and five seeded use cases (seed-hub.mjs)");
}
// Not the two cards of bell-acceptance.mjs (the first two).
const readyCard = seeded[2].id;
const waitingCard = seeded[3].id;
const silentCard = seeded[4].id;
const app = `http://${UC_TEST_HOST}:${UC_TEST_APP_PORT}`;
const readyPath = `/dashboard/${ws}/use-cases/${readyCard}`;
const silentPath = `/dashboard/${ws}/use-cases/${silentCard}`;
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
    const asked = (await client.query(`SELECT 1 FROM use_case_referent_requests WHERE use_case_id = $1::uuid`, [silentCard])).rowCount;
    if (asked) throw new Error("The third seeded use case already has a request to a referent: start from a fresh clone");
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
      // «Nessuna risposta»: one question to a synthetic referent, sent 31 days ago, its link expired a
      // minute ago; the send's need transition and Story row, then the expiry as the cron runs it.
      const question = "Quanti contratti attivi ci sono?";
      const silentNeed = await client.query(
        `INSERT INTO use_case_needs (workspace_id, type, kind, title, owner_side, status) VALUES ($1::uuid, 'requisito', 'dato', $2, 'cliente', 'da_chiedere') RETURNING id`,
        [ws, question],
      );
      const needId = silentNeed.rows[0].id;
      await client.query(`INSERT INTO use_case_need_links (need_id, use_case_id) VALUES ($1::uuid, $2::uuid)`, [needId, silentCard]);
      const contact = await client.query(
        `INSERT INTO uc_contacts (workspace_id, display_name, email, created_by_user_id) VALUES ($1::uuid, 'Referente di prova', 'referente-di-prova@cliente.test', $2::uuid) RETURNING id`,
        [ws, lead.id],
      );
      const requestId = randomUUID();
      await client.query(
        `INSERT INTO use_case_referent_requests (id, workspace_id, use_case_id, contact_id, requested_by_user_id, requester_name, created_at, sent_at, last_email_at, expires_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 'Prova function-lead', now() - interval '31 days', now() - interval '31 days', now() - interval '31 days', now() - interval '1 minute')`,
        [requestId, ws, silentCard, contact.rows[0].id, lead.id],
      );
      await client.query(`INSERT INTO use_case_referent_request_items (request_id, need_id, workspace_id, position, question) VALUES ($1::uuid, $2::uuid, $3::uuid, 1, $4)`, [requestId, needId, ws, question]);
      const asker = { kind: "persona", userId: lead.id };
      await exec(client, [
        needTransitionSql({ workspaceId: ws, needIds: [needId], from: ["da_chiedere"], to: "chiesta", actor: asker, expect: { count: 1, code: "domande_cambiate" } }),
        referentEventSql({ workspaceId: ws, useCaseId: silentCard, code: "inviata", actor: asker }),
      ]);
      await exec(client, expireStatements({ workspaceId: ws, useCaseId: silentCard, requestId, actorUserId: null, schedule: context.schedule, now }));
      const silentRows = await client.query(`SELECT 1 FROM use_case_notifications WHERE use_case_id = $1::uuid AND kind = 'senza_risposta' AND recipient_user_id = $2::uuid`, [silentCard, lead.id]);
      if (!silentRows.rowCount) throw new Error("The expiry wrote no «Nessuna risposta» row for function-lead");
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
    const whole = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth;
    };
    // The «Prossimo passo» box (`<section id="decisione" data-slot="next-step">`): on a ready card
    // (G9) `?capitolo=realizzazione` brings it to the top and focuses its heading; the «Realizzazione»
    // fold (`<details id="realizzazione" data-slot="fold">`) stays closed.
    const box = document.getElementById("decisione");
    const start = box ? [...box.querySelectorAll("a, button")].find((el) => el.textContent.replace(/\s+/g, " ").trim() === "Avvia la realizzazione") : null;
    const fold = document.getElementById("realizzazione");
    const active = document.activeElement;
    const isFold = fold instanceof HTMLDetailsElement && fold.dataset.slot === "fold";
    // «Richieste inviate» (`<details id="richieste" data-slot="needs-requests">` in «Cosa serve»):
    // `?capitolo=richieste` opens it from the server, brings it to the top and focuses its summary.
    const requests = document.getElementById("richieste");
    const isRequests = requests instanceof HTMLDetailsElement && requests.dataset.slot === "needs-requests";
    const summary = isRequests ? requests.querySelector(":scope > summary") : null;
    const askAgain = isRequests ? [...requests.querySelectorAll("a, button")].find((el) => el.textContent.replace(/\s+/g, " ").trim() === "Chiedi di nuovo") : null;
    // «Cosa serve» (`<section id="cosa-serve">`): `?capitolo=cosa-serve` focuses its heading.
    const needsHeading = document.getElementById("cosa-serve-titolo");
    return {
      open,
      rows: rows.map((el) => ({ href: el.getAttribute("href"), text: el.textContent.replace(/\s+/g, " ").trim() })),
      overflow: document.documentElement.scrollWidth > window.innerWidth,
      url: location.pathname + location.search + location.hash,
      chapterBar: Boolean(document.querySelector("[data-slot=chapter-nav]")),
      box: box?.dataset.slot === "next-step" ? (box.dataset.key ?? "") : null,
      boxFocus: Boolean(box && active && active !== document.body && box.contains(active)),
      boxInView: inView(box),
      startWhole: whole(start),
      startFilled: Boolean(start?.classList.contains("bg-primary")),
      realizationFold: isFold,
      realizationOpen: isFold && fold.open,
      requests: isRequests,
      requestsOpen: isRequests && requests.open,
      requestsFocus: Boolean(summary && active === summary),
      requestsInView: inView(summary),
      askAgainWhole: whole(askAgain),
      needsFocus: Boolean(needsHeading && active === needsHeading),
      needsInView: inView(needsHeading),
      focused: active && active !== document.body ? `${active.tagName.toLowerCase()}${active.dataset?.slot ? `[${active.dataset.slot}]` : ""}${active.id ? `#${active.id}` : ""}` : "body",
      subprocessorsInView: inView(document.getElementById("sub-responsabili")),
    };
  });
}

/**
 * A real click on `selector`. By default the element is first brought to the middle of the window;
 * with `{ inPlace: true }` the page is not scrolled (the bell and its menu on a card scrolled down to
 * «Cosa serve», as a person clicks them): the click waits until the element is whole in the window
 * and has kept its place for 150 ms (the menu settles where its anchor is).
 */
async function clickAt(page, selector, { inPlace = false } = {}) {
  const at = () =>
    evaluate(
      page,
      (sel, scroll) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        if (scroll) el.scrollIntoView({ block: "center" });
        const r = el.getBoundingClientRect();
        const whole = r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth;
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, whole };
      },
      selector,
      !inPlace,
    );
  let box = await at();
  if (inPlace) {
    const start = Date.now();
    for (;;) {
      await sleep(150);
      const next = await at();
      const settled = box && next && next.whole && next.x === box.x && next.y === box.y;
      box = next;
      if (settled || Date.now() - start > 5_000) break;
    }
    if (box && !box.whole) throw new Error(`Not whole in the window: ${selector}`);
  }
  if (!box) throw new Error(`Nothing to click: ${selector}`);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
    await page.send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
  }
}
async function openBell(page, options) {
  await clickAt(page, "[data-slot=notifications-bell]", options);
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

/**
 * The «Quando» control of the card and the page around it: the choice `label` starts with
 * («Più avanti», «Questo trimestre»), where it is in the window, the focus, the box's step and the
 * «Realizzazione» fold.
 */
function whenState(page, label) {
  return evaluate(page, (prefix) => {
    const radio = [...document.querySelectorAll("[data-slot=when-control] [role=radio]")].find((el) => (el.getAttribute("aria-label") ?? "").startsWith(prefix)) ?? null;
    const r = radio?.getBoundingClientRect();
    const fold = document.getElementById("realizzazione");
    const active = document.activeElement;
    return {
      radio: Boolean(radio),
      label: radio?.getAttribute("aria-label") ?? null,
      checked: radio?.getAttribute("aria-checked") === "true",
      top: r ? Math.round(r.top) : null,
      whole: Boolean(r && r.width > 0 && r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth),
      focusOnRadio: Boolean(radio && active === radio),
      focused: active && active !== document.body ? `${active.tagName.toLowerCase()}${active.id ? `#${active.id}` : ""}${active.getAttribute("aria-label") ? `[${active.getAttribute("aria-label")}]` : ""}${active.closest("details[id]") ? ` in #${active.closest("details[id]").id}` : ""}` : "body",
      box: document.getElementById("decisione")?.dataset.key ?? null,
      foldOpen: fold instanceof HTMLDetailsElement ? fold.open : null,
      scrollY: Math.round(window.scrollY),
      url: location.pathname + location.search + location.hash,
      overflow: document.documentElement.scrollWidth > window.innerWidth,
    };
  }, label);
}

/** The choice of «Quando» whose label starts with `label`, brought to the middle of the window as a person scrolls to it: its centre. */
async function scrollToWhen(page, label) {
  const at = await evaluate(page, (prefix) => {
    const radio = [...document.querySelectorAll("[data-slot=when-control] [role=radio]")].find((el) => (el.getAttribute("aria-label") ?? "").startsWith(prefix));
    if (!radio) return null;
    radio.scrollIntoView({ block: "center" });
    const r = radio.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, label);
  if (!at) throw new Error(`No «${label}» in «Quando»`);
  await sleep(300);
  return at;
}

/**
 * One «Quando» change on the landing address: the place of the choice in the window, the click (real
 * mouse events), the page reading its data again until the box shows `key`, then 1.5 s for a late
 * arrival. The choice must keep the focus and its place in the window (at most 48 px: the box above
 * changes height between G9 and G3), the fold must keep `foldOpen`.
 */
async function whenChange(page, tag, label, key, foldOpen) {
  const at = await scrollToWhen(page, label);
  const before = await whenState(page, label);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
    await page.send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
  }
  const start = Date.now();
  let after = await whenState(page, label);
  while (after.box !== key && Date.now() - start < 15_000) {
    await sleep(150);
    after = await whenState(page, label);
  }
  await sleep(1500);
  after = await whenState(page, label);
  const moved = before.top !== null && after.top !== null ? after.top - before.top : null;
  record(`${tag} «${label}» in «Quando» on the landing address (card ${before.box} → ${key}) keeps the focus, the window and the fold`, [
    ...(after.url.startsWith(`${readyPath}?capitolo=realizzazione`) ? [] : [`url ${after.url}`]),
    ...(after.box === key ? [] : [`the box is ${after.box}, not ${key}`]),
    ...(after.checked ? [] : [`«${label}» is not the chosen one`]),
    ...(after.focusOnRadio ? [] : [`focus left «${label}» (on ${after.focused})`]),
    ...(after.whole ? [] : [`«${label}» is no longer whole in the window`]),
    ...(moved !== null && Math.abs(moved) <= 48 ? [] : [`«${label}» moved ${moved} px in the window (scrollY ${before.scrollY} → ${after.scrollY})`]),
    ...(after.foldOpen === foldOpen ? [] : [`the «Realizzazione» fold ${after.foldOpen ? "opened" : "closed"} by itself`]),
    ...(after.overflow ? ["horizontal scroll"] : []),
  ]);
  console.log(`     scrollY ${before.scrollY} → ${after.scrollY}, «${label}» top ${before.top} → ${after.top}, focus on ${after.focused}`);
  return after;
}

/** The browser's Back (-1) or Forward (+1): a real history traversal, as the toolbar button does. */
async function historyGo(page, delta) {
  const history = await page.send("Page.getNavigationHistory");
  const entry = history.entries[history.currentIndex + delta];
  if (!entry) throw new Error(`No history entry at ${delta}`);
  await page.send("Page.navigateToHistoryEntry", { entryId: entry.id });
}

/** Where `?capitolo=cosa-serve` and `?capitolo=richieste` of the silent card landed: the failures. */
function silentLanding(s, chapter) {
  const failures = [...(s.url === `${silentPath}?capitolo=${chapter}` ? [] : [`url ${s.url}`]), ...(s.open ? ["menu still open"] : [])];
  if (!s.requests) return [...failures, "no «Richieste inviate» on the card"];
  if (chapter === "richieste") {
    failures.push(...(s.requestsOpen ? [] : ["«Richieste inviate» is closed"]), ...(s.requestsFocus ? [] : [`focus not on the summary of «Richieste inviate» (on ${s.focused})`]), ...(s.requestsInView ? [] : ["«Richieste inviate» not in view"]));
  } else {
    failures.push(...(s.requestsOpen ? ["«Richieste inviate» is open"] : []), ...(s.needsFocus ? [] : [`focus not on the heading of «Cosa serve» (on ${s.focused})`]), ...(s.needsInView ? [] : ["«Cosa serve» not in view"]));
  }
  return [...failures, ...(s.overflow ? ["horizontal scroll"] : [])];
}
const silentLanded = (chapter) => (s) => silentLanding(s, chapter).length === 0;

const READY = "Pronto da avviare";
const SUPPLIERS = "Autorizza i fornitori";
const SILENT = "Nessuna risposta";
const readyRow = (s) => s.rows.find((r) => r.href?.endsWith(`${readyPath}?capitolo=realizzazione`) && r.text.includes(READY));
const suppliersRow = (s) => s.rows.find((r) => r.href?.endsWith(`${settingsPath}#sub-responsabili`) && r.text.includes(SUPPLIERS));
const silentRow = (s) => s.rows.find((r) => r.href?.endsWith(`${silentPath}?capitolo=richieste`) && r.text.includes(SILENT));

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
        s = await waitFor(page, (x) => x.url.startsWith(`${readyPath}?capitolo=realizzazione`) && !x.open && x.boxFocus && x.boxInView && x.startWhole);
        // The state a second later: nothing (the closing menu, a late render) takes the focus back.
        await sleep(1000);
        s = await state(page);
        record(`${tag} its click opens the use case at «Prossimo passo», with «Avvia la realizzazione» in view`, [
          ...(s.url.startsWith(`${readyPath}?capitolo=realizzazione`) ? [] : [`url ${s.url}`]),
          ...(s.open ? ["menu still open"] : []),
          ...(s.box === "G9" ? [] : [`the box is ${s.box === null ? "missing" : `step ${s.box}`}, not G9`]),
          ...(s.boxFocus ? [] : [`focus not in «Prossimo passo» (on ${s.focused})`]),
          ...(s.boxInView ? [] : ["«Prossimo passo» not in view"]),
          ...(s.startWhole ? [] : ["«Avvia la realizzazione» not whole in the window"]),
          ...(s.startFilled ? [] : ["«Avvia la realizzazione» is not the filled button"]),
          ...(s.realizationFold ? [] : ["«Realizzazione» is not a fold of the card"]),
          ...(s.realizationOpen ? ["the «Realizzazione» fold is open"] : []),
          ...(s.chapterBar ? ["the old «Capitoli» bar is on the page"] : []),
          ...(s.overflow ? ["horizontal scroll"] : []),
        ]);
        console.log(`     focus on ${s.focused}`);

        // 1b. «Quando» on the same address: G9 → G3 with the fold closed, then G3 → G9 with the fold
        // the person opened. The arrival belongs to the click of the bell, not to the reloads after it.
        if (s.box === "G9") {
          await whenChange(page, tag, "Più avanti", "G3", false);
          const fold = await whenState(page, "Più avanti");
          if (fold.foldOpen === false) {
            await clickAt(page, "details#realizzazione > summary");
            await sleep(500);
          }
          const opened = await whenState(page, "Più avanti");
          if (opened.foldOpen !== true) record(`${tag} ls-lead opens the «Realizzazione» fold`, ["the fold did not open"]);
          await whenChange(page, tag, "Questo trimestre", "G9", true);
        }
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

      await navigate(page, `${app}/dashboard/${ws}/use-cases`);
      s = await openBell(page);
      const silent = silentRow(s);
      record(`${tag} function-lead sees «${SILENT}»`, [...(silent ? [] : [`rows: ${JSON.stringify(s.rows.map((r) => `${r.text.slice(0, 60)} → ${r.href}`))}`]), ...(s.overflow ? ["horizontal scroll"] : [])]);
      if (silent) {
        await clickAt(page, `[data-slot=dropdown-menu-content] a[href$="${silentPath}?capitolo=richieste"]`);
        s = await waitFor(page, (x) => x.url.startsWith(`${silentPath}?capitolo=richieste`) && !x.open && x.requestsOpen && x.requestsFocus && x.askAgainWhole);
        await sleep(1000);
        s = await state(page);
        record(`${tag} its click opens «Richieste inviate» with «Chiedi di nuovo» in view`, [
          ...(s.url.startsWith(`${silentPath}?capitolo=richieste`) ? [] : [`url ${s.url}`]),
          ...(s.open ? ["menu still open"] : []),
          ...(s.requests ? [] : ["no «Richieste inviate» on the card"]),
          ...(s.requests && !s.requestsOpen ? ["«Richieste inviate» is closed"] : []),
          ...(s.requestsFocus ? [] : [`focus not on the summary of «Richieste inviate» (on ${s.focused})`]),
          ...(s.requestsInView ? [] : ["«Richieste inviate» not in view"]),
          ...(s.askAgainWhole ? [] : ["«Chiedi di nuovo» not whole in the window"]),
          ...(s.chapterBar ? ["the old «Capitoli» bar is on the page"] : []),
          ...(s.overflow ? ["horizontal scroll"] : []),
        ]);
        console.log(`     focus on ${s.focused}`);

        // 3b. Back and Forward between the two bell addresses of the card: each lands where its address says.
        await navigate(page, `${app}${silentPath}?capitolo=cosa-serve`);
        s = await waitFor(page, silentLanded("cosa-serve"));
        await sleep(1000);
        s = await state(page);
        record(`${tag} ?capitolo=cosa-serve lands on «Cosa serve» with «Richieste inviate» closed`, silentLanding(s, "cosa-serve"));
        s = await openBell(page, { inPlace: true });
        if (silentRow(s)) {
          await clickAt(page, `[data-slot=dropdown-menu-content] a[href$="${silentPath}?capitolo=richieste"]`, { inPlace: true });
          s = await waitFor(page, silentLanded("richieste"));
          await sleep(1000);
          s = await state(page);
          record(`${tag} from that address, «${SILENT}» in the bell opens «Richieste inviate»`, silentLanding(s, "richieste"));
          for (const [delta, chapter, label] of [
            [-1, "cosa-serve", "Back"],
            [1, "richieste", "Forward"],
          ]) {
            await historyGo(page, delta);
            s = await waitFor(page, silentLanded(chapter));
            await sleep(1000);
            s = await state(page);
            record(`${tag} ${label} to ?capitolo=${chapter} lands ${chapter === "richieste" ? "on «Richieste inviate», open" : "on «Cosa serve», «Richieste inviate» closed"}`, silentLanding(s, chapter));
            console.log(`     focus on ${s.focused}`);
          }
        } else record(`${tag} «${SILENT}» in the bell on the card`, [`rows: ${JSON.stringify(s.rows.map((r) => r.text.slice(0, 60)))}`]);
      }

      await loginAs(page, "osservatore", { to: `/dashboard/${ws}/use-cases` });
      s = await openBell(page);
      record(`${tag} osservatore (contributor) sees none of the three rows`, [
        ...(readyRow(s) || suppliersRow(s) || silentRow(s) ? ["a use case row reached a contributor"] : []),
        ...(s.rows.some((r) => r.text.includes(READY) || r.text.includes(SUPPLIERS) || r.text.includes(SILENT)) ? ["one of the three titles in the bell"] : []),
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
