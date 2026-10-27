// Browser acceptance of the per-person bell (SPEC «Chiedi al referente» §P2.12.3, R10: «se clicco
// sulla notifica poi non si toglie il numerino e rimane sempre lì»), on the hub's local harness.
// It uses scripts/uc-test/cdp.mjs as a library and signs in through scripts/uc-test/browser-login.mjs.
//
//   export UC_TEST_ROOT=/private/tmp/<dir>/hub
//   export UC_TEST_PG_PORT=55479 UC_TEST_PG_DB=hub_<id>
//   export UC_TEST_APP_PORT=53120 UC_TEST_AUTH_PORT=59119 UC_TEST_LOGIN_PORT=53122
//   node scripts/uc-test/start-app.mjs --flag USE_CASE_HUB_WORKSPACES=<id of «a»> > app.log &
//   node scripts/uc-test/browser-login.mjs &
//   node scripts/use-case-test/bell-acceptance.mjs [--widths 375,1440]
//
// For each width, on workspace «a» of the fixtures (scripts/uc-test/seed-fixtures.mjs and
// scripts/use-case-test/seed-hub.mjs), it first seeds 12 fresh unread portfolio signals
// (new_portfolio_item on a seeded use case) and one «Risposte arrivate» notification on another
// seeded use case for the workspace's reviewers, with the app's own statement. Then, in the browser:
//  1. the badge reads «9+» and the button is named «Notifiche, N nuove» (N ≥ 13: the seed may add others);
//  2. opening the bell hides the badge at once; after closing it stays hidden;
//  3. after a reload: no badge, and the rows are still highlighted (unread for this person);
//  4. a click on the use case row navigates to its card at «Cosa serve», with the menu closed;
//     after a reload that row is no longer highlighted;
//  5. on that card, a click on a row that points to the same card closes the menu;
//  6. «Segna tutte come lette» → after a reload no row is highlighted;
//  7. `osservatore` (contributor) sees no use case row in the bell;
//  8. no horizontal scroll at any step (scrollWidth ≤ innerWidth).
// Writes only to the throwaway harness database (127.0.0.1, uc_test, hub_<id>); never to another
// host. Exit 1 on any failure.
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { closePage, evaluate, launchBrowser, loginAs, navigate, newPage } from "../uc-test/cdp.mjs";
import { notifyReviewersSql } from "../../src/lib/use-cases/referent/sql.ts";
import { UC_TEST_APP_PORT, UC_TEST_DB, UC_TEST_HOST, UC_TEST_LOGIN_PORT, UC_TEST_PORT, UC_TEST_USER, ucTestRoot } from "../uc-test/config.mjs";

const args = process.argv.slice(2);
let widths = [375, 1440];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--widths" && args[i + 1]) {
    widths = args[++i].split(",").map((w) => Number(w.trim()));
    if (widths.some((w) => !Number.isInteger(w) || w < 320 || w > 2560)) throw new Error("--widths takes integers between 320 and 2560");
  } else throw new Error(`Unknown option ${args[i]} (only --widths)`);
}
if ([53100, 53110, 53130].includes(UC_TEST_APP_PORT) || [53102, 53112].includes(UC_TEST_LOGIN_PORT)) {
  throw new Error(`App ${UC_TEST_APP_PORT} / login ${UC_TEST_LOGIN_PORT} are not the hub's: set UC_TEST_APP_PORT=53120 UC_TEST_LOGIN_PORT=53122`);
}
if ([55439, 55449, 55469].includes(UC_TEST_PORT)) throw new Error(`Port ${UC_TEST_PORT} is not the hub's cluster`);
if (!/^hub_[a-z0-9][a-z0-9_]{0,39}$/.test(UC_TEST_DB)) throw new Error(`UC_TEST_PG_DB must be a package copy hub_<id>, not ${UC_TEST_DB}`);
if (UC_TEST_HOST !== "127.0.0.1") throw new Error("The harness database must be on 127.0.0.1");

const manifestPath = join(ucTestRoot(), "uc-fixtures", "synthetic-fixtures.json");
if (!existsSync(manifestPath)) throw new Error(`No fixtures manifest at ${manifestPath}: run seed-fixtures.mjs and seed-hub.mjs first`);
const fixtures = JSON.parse(readFileSync(manifestPath, "utf8"));
const ws = fixtures.workspaces?.[fixtures.hub?.areaOn ?? "a"]?.workspaceId;
const lead = fixtures.accounts?.["function-lead"];
const observer = fixtures.accounts?.osservatore;
const seeded = fixtures.hub?.useCases?.a ?? [];
if (!ws || !lead?.id || !observer?.id || seeded.length < 2) throw new Error("The manifest needs workspace «a», function-lead, osservatore and two seeded use cases (seed-hub.mjs)");
const signalCard = seeded[0].id;
const noticeCard = seeded[1].id;
const app = `http://${UC_TEST_HOST}:${UC_TEST_APP_PORT}`;
const cardPath = `/dashboard/${ws}/use-cases/${noticeCard}`;

const { Client } = createRequire(resolve("package.json"))("pg");

/**
 * Seeds, for function-lead in «a», 12 fresh unread portfolio signals and one use case notification.
 * The notification goes through the app's own builder (`notifyReviewersSql`, the same statement the
 * referent's answers write): one row per reviewer, a same-day row collapsed, bumped and unread again.
 * Nothing is deleted except the signals of earlier runs of this script; the person's «seen up to»
 * stays, and every seeded row is newer than it.
 */
async function seed() {
  const client = new Client({ host: UC_TEST_HOST, port: UC_TEST_PORT, user: UC_TEST_USER, database: UC_TEST_DB });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM weekly_signals WHERE workspace_id = $1::uuid AND title LIKE 'Prova campanella %'`, [ws]);
    for (let i = 1; i <= 12; i++) {
      await client.query(
        `INSERT INTO weekly_signals (id, workspace_id, signal_type, title, description, related_entity_type, related_entity_id, is_read, created_at)
         VALUES ($1::uuid, $2::uuid, 'new_portfolio_item', $3, NULL, 'use_case', $4, false, now() - make_interval(secs => $5::int))`,
        // Seconds ago: after the start of the membership and after any earlier opening of the bell.
        [randomUUID(), ws, `Prova campanella ${i}`, signalCard, 13 - i],
      );
    }
    const notice = notifyReviewersSql({ workspaceId: ws, useCaseId: noticeCard, kind: "risposte", answers: 2, actorUserId: null });
    await client.query(notice.text, notice.params);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

const results = [];
function record(name, failures) {
  results.push({ name, failures });
  console.log(`${failures.length ? "FAIL" : "ok  "} ${name}${failures.length ? `: ${failures.join("; ")}` : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The bell as the page shows it now. */
function bellState(page) {
  return evaluate(page, () => {
    const trigger = document.querySelector("[data-slot=notifications-bell]");
    const badge = trigger?.querySelector("[data-slot=notifications-badge]");
    const menu = document.querySelector("[data-slot=dropdown-menu-content]");
    const open = Boolean(menu && getComputedStyle(menu).display !== "none" && menu.getBoundingClientRect().height > 0);
    const rows = open ? [...menu.querySelectorAll("[role=menuitem]")].filter((el) => el.querySelector(".line-clamp-2")) : [];
    return {
      label: trigger?.getAttribute("aria-label") ?? null,
      badge: badge ? badge.textContent.trim() : null,
      open,
      rows: rows.map((el) => ({ href: el.getAttribute("href"), unread: el.hasAttribute("data-unread") })),
      overflow: document.documentElement.scrollWidth > window.innerWidth,
      url: location.pathname + location.search,
    };
  });
}

/** A real mouse click at the centre of the first element matching `selector`. */
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
async function pressEscape(page) {
  for (const type of ["keyDown", "keyUp"]) await page.send("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
}
async function openBell(page) {
  await clickAt(page, "[data-slot=notifications-bell]");
  for (let i = 0; i < 40; i++) {
    const s = await bellState(page);
    if (s.open && s.rows.length) {
      // As a person does: a moment to look, while the «seen» write and the re-read finish.
      await sleep(1000);
      return bellState(page);
    }
    await sleep(100);
  }
  return bellState(page);
}
async function waitFor(page, predicate, timeoutMs = 8000) {
  const start = Date.now();
  let s = await bellState(page);
  while (!predicate(s) && Date.now() - start < timeoutMs) {
    await sleep(150);
    s = await bellState(page);
  }
  return s;
}

const browser = await launchBrowser({ colorScheme: "dark" });
try {
  for (const width of widths) {
    // The seeded signals are 1 to 12 seconds old: after the last opening of the previous width, wait
    // so that all of them are newer than the person's «seen up to».
    if (width !== widths[0]) await sleep(15_000);
    await seed();
    const page = await newPage(browser, { width });
    const tag = `${width}px`;
    try {
      await loginAs(page, "function-lead", { to: `/dashboard/${ws}/use-cases` });
      let s = await bellState(page);
      const named = /^Notifiche, (\d+) nuove$/.exec(s.label ?? "");
      record(`${tag} badge «9+», named «Notifiche, N nuove» with N ≥ 13`, [
        ...(s.badge === "9+" ? [] : [`badge ${s.badge}`]),
        ...(named && Number(named[1]) >= 13 ? [] : [`label ${s.label}`]),
        ...(s.overflow ? ["horizontal scroll"] : []),
      ]);

      s = await openBell(page);
      const openFailures = [...(s.open ? [] : ["menu not open"]), ...(s.badge === null ? [] : [`badge ${s.badge} while open`]), ...(s.overflow ? ["horizontal scroll"] : [])];
      await pressEscape(page);
      s = await waitFor(page, (x) => !x.open);
      record(`${tag} opening hides the number; closing keeps it hidden`, [...openFailures, ...(s.badge === null ? [] : [`badge ${s.badge} after closing`])]);

      await navigate(page, `${app}/dashboard/${ws}/use-cases`);
      s = await bellState(page);
      const reloadBadge = s.badge;
      s = await openBell(page);
      const highlighted = s.rows.filter((r) => r.unread).length;
      record(`${tag} after a reload: no number, rows still highlighted`, [
        ...(reloadBadge === null ? [] : [`badge ${reloadBadge}`]),
        ...(highlighted >= 13 ? [] : [`${highlighted} highlighted rows, expected 13`]),
      ]);

      await clickAt(page, `[data-slot=dropdown-menu-content] a[href$="?capitolo=cosa-serve"]`);
      s = await waitFor(page, (x) => x.url.startsWith(cardPath) && !x.open, 15_000);
      const clickFailures = [...(s.url.startsWith(cardPath) ? [] : [`url ${s.url}`]), ...(s.open ? ["menu still open"] : []), ...(s.overflow ? ["horizontal scroll"] : [])];
      await navigate(page, `${app}${cardPath}?capitolo=cosa-serve`);
      s = await openBell(page);
      const row = s.rows.find((r) => r.href?.endsWith("?capitolo=cosa-serve"));
      record(`${tag} a click navigates to the card with the menu closed; after a reload the row is read`, [
        ...clickFailures,
        ...(row ? [] : ["use case row missing"]),
        ...(row?.unread ? ["row still highlighted after reload"] : []),
      ]);

      // Already on the card: the same row keeps the pathname, the menu must close anyway.
      await clickAt(page, `[data-slot=dropdown-menu-content] a[href$="?capitolo=cosa-serve"]`);
      s = await waitFor(page, (x) => !x.open);
      record(`${tag} a row to the card already open closes the menu`, s.open ? ["menu still open"] : []);

      s = await openBell(page);
      const readAll = await evaluate(page, () => {
        const items = [...document.querySelectorAll("[data-slot=dropdown-menu-content] [role=menuitem]")];
        const item = items.find((el) => el.textContent.trim() === "Segna tutte come lette");
        if (!item) return false;
        item.setAttribute("data-bell-read-all", "1");
        return true;
      });
      if (readAll) await clickAt(page, "[data-bell-read-all]");
      await sleep(1500);
      await navigate(page, `${app}${cardPath}`);
      s = await openBell(page);
      record(`${tag} «Segna tutte come lette» → after a reload no row is highlighted`, [
        ...(readAll ? [] : ["«Segna tutte come lette» missing"]),
        ...(s.rows.some((r) => r.unread) ? [`${s.rows.filter((r) => r.unread).length} rows still highlighted`] : []),
        ...(s.overflow ? ["horizontal scroll"] : []),
      ]);

      await loginAs(page, "osservatore", { to: `/dashboard/${ws}/use-cases` });
      s = await openBell(page);
      record(`${tag} osservatore (contributor): no use case row`, [
        ...(s.rows.some((r) => r.href?.includes("?capitolo=cosa-serve")) ? ["a use case row reached a contributor"] : []),
        ...(s.overflow ? ["horizontal scroll"] : []),
      ]);
    } finally {
      await closePage(page);
    }
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => r.failures.length);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
