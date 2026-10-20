// Screenshots and browser checks of the «Connettore Claude» settings card (PIANO-LAVORI
// §3.5, K7r) on the connector app, with synthetic data only:
//
//   export UC_TEST_ROOT=/private/tmp/<dir> UC_TEST_PG_PORT=55469 UC_TEST_PG_DB=<own database>
//   FIREBASE_TOOLS_ROOT=/opt/homebrew/lib/node_modules/firebase-tools node scripts/connettore-test/start-auth.mjs &
//   node --no-warnings scripts/connettore-test/start-app.mjs --production --auth-emulator &
//   node --no-warnings scripts/connettore-test/screens.mjs [--widths 1440,400] [--keep]
//
// UC_TEST_PG_DB is required and must be a database cloned from the template, never
// unbundle_conn_test itself (createdb -T needs the template free of connections).
//
// For each width: a fresh synthetic organization and workspace with the connector
// configured and five connector tokens (active, expiring in 9 days, exposed, revoked,
// expired; only random hashes, no secret), then as the organization's transformation lead:
// the card, a new token (the one-time value is checked against the stored hash, never
// printed, blurred before the capture, and gone after a reload), suspend and resume,
// revoke of the exposed token. At the first width, two accounts that must not see the
// card (a contributor of the organization and a lead invited to the workspace only), and
// the lead again once the row is like the one every workspace gets for the codes (D6:
// switched off, no guide): no card.
// Captures go to $UC_TEST_ROOT/conn-evidence/k7r (outside git). Data are deleted at the
// end unless --keep. Only loopback addresses are opened (cdp.mjs refuses any other host).
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { evaluate, launchBrowser, navigate, newPage, pageReport, screenshot, waitIdle } from "../uc-test/cdp.mjs";
import { ucTestRoot } from "../uc-test/config.mjs";
import { CONNECTOR_TOKEN_PREFIX } from "../../src/lib/connector/auth.ts";
import { EXAMPLE_CONNECTOR_PROFILE_INPUT, EXAMPLE_INSTRUCTIONS_TEMPLATE } from "../../src/lib/connector/contract.fixtures.ts";
import { CONNECTOR_APP_HOST, CONNECTOR_APP_PORT, CONNECTOR_AUTH_HOST, CONNECTOR_AUTH_PORT, CONNECTOR_AUTH_PROJECT } from "./auth-config.mjs";

const requireFromApp = createRequire(resolve("package.json"));
const { Client } = requireFromApp("pg");

const args = process.argv.slice(2);
const widthsArg = args.includes("--widths") ? args[args.indexOf("--widths") + 1] : "1440,400";
const widths = widthsArg.split(",").map((w) => Number(w.trim()));
if (widths.some((w) => !Number.isInteger(w) || w < 320 || w > 2560)) throw new Error("--widths takes pixel widths between 320 and 2560, e.g. 1440,400");
const keep = args.includes("--keep");

const port = process.env.UC_TEST_PG_PORT?.trim() || "55469";
const database = process.env.UC_TEST_PG_DB?.trim() ?? "";
if (!/^\d+$/.test(port) || ["55439", "55449", "55479"].includes(port)) throw new Error("Use the connector's own test cluster port (default 55469)");
if (!/^[a-z_][a-z0-9_]{2,62}$/.test(database)) throw new Error("UC_TEST_PG_DB must name your own database, cloned with createdb -T unbundle_conn_test");
if (database === "unbundle_conn_test") throw new Error("UC_TEST_PG_DB must be a clone, not the template unbundle_conn_test");

const APP = `http://${CONNECTOR_APP_HOST}:${CONNECTOR_APP_PORT}`;
const AUTH = `http://${CONNECTOR_AUTH_HOST}:${CONNECTOR_AUTH_PORT}`;
const PASSWORD = `Synthetic-only-conn-${randomBytes(4).toString("hex")}`;
const outDir = join(ucTestRoot(), "conn-evidence", "k7r");
const CARD = "#connettore-claude";

const pg = new Client({ host: "127.0.0.1", port: Number(port), user: "uc_test", database });
await pg.connect();
const q = async (text, params = []) => (await pg.query(text, params)).rows;

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}
const shots = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, { timeoutMs = 15_000, stepMs = 200 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await fn();
    if (value) return value;
    await sleep(stepMs);
  }
  return null;
}

// ── Synthetic data ───────────────────────────────────────────────────

async function emulatorAccount(email) {
  const signUp = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=local-only`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
  });
  const body = await signUp.json();
  if (!signUp.ok || !body.localId) throw new Error("Emulator signup failed: is scripts/connettore-test/start-auth.mjs running?");
  await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/${CONNECTOR_AUTH_PROJECT}/accounts:update`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer owner" },
    body: JSON.stringify({ localId: body.localId, emailVerified: true }),
  });
  return body.localId;
}

/** Ids and names decided before seeding, so that cleanup works after a partial seed too. */
function plan() {
  const suffix = randomBytes(3).toString("hex");
  return {
    suffix,
    ids: { org: randomUUID(), ws: randomUUID(), lead: randomUUID(), colleague: randomUUID(), guest: randomUUID() },
    accounts: {
      lead: `ls-gestore-${suffix}@ls.test`,
      colleague: `collega-${suffix}@cliente.test`,
      guest: `ospite-${suffix}@cliente.test`,
    },
    slug: `prova-${suffix}`,
    tokens: {},
  };
}

async function seed(data) {
  const { suffix, ids, accounts, slug, tokens } = data;
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova', $2)`, [ids.org, `conn-k7r-${suffix}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Workspace di prova del connettore')`, [ids.ws, ids.org]);
  for (const [key, name] of [["lead", "Gestore di prova"], ["colleague", "Collega di prova"], ["guest", "Ospite di prova"]]) {
    const uid = await emulatorAccount(accounts[key]);
    await q(`INSERT INTO users (id, firebase_uid, email, name, email_verified) VALUES ($1, $2, $3, $4, now())`, [ids[key], uid, accounts[key], name]);
  }
  await q(`INSERT INTO memberships (user_id, organization_id, role) VALUES ($1, $2, 'transformation_lead'), ($3, $2, 'contributor')`, [ids.lead, ids.org, ids.colleague]);
  // A lead invited to this workspace only: integrations stay with the organization.
  await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'transformation_lead')`, [ids.ws, ids.guest]);
  await q(
    `INSERT INTO workspace_connector_configs (workspace_id, slug, enabled, code_prefix, workspace_display_name, guide, guide_version, allowed_domains, profile, instructions_template)
     VALUES ($1, $2, true, 'PV', 'Organizzazione di prova', '{"guideVersion": "1.0"}'::jsonb, '1.0', '["cliente.test"]'::jsonb, $3::jsonb, $4)`,
    [ids.ws, slug, JSON.stringify(EXAMPLE_CONNECTOR_PROFILE_INPUT), EXAMPLE_INSTRUCTIONS_TEMPLATE]
  );
  // Connector tokens: only random hashes and a made-up prefix, never a usable secret.
  const rows = [
    ["active", "Connettore Claude ottobre", "20 days", "70 days", "1 day", null, null],
    ["expiring", "Connettore Claude luglio", "80 days", "9 days", "3 days", null, null],
    ["exposed", "Token di prova esposto", "5 days", "85 days", "2 hours", null, "2 hours"],
    ["revoked", "Primo token di prova", "100 days", "-10 days", "70 days", "60 days", null],
    ["expired", "Token di prova scaduto", "120 days", "-30 days", null, null, null],
  ];
  for (const [key, label, age, expires, used, revoked, exposed] of rows) {
    const [row] = await q(
      `INSERT INTO workspace_integration_tokens (workspace_id, label, provider, token_hash, token_prefix, scopes, created_at, updated_at, expires_at, last_used_at, revoked_at, exposed_at)
       VALUES ($1, $2, 'claude_connector', $3, $4, '["connector:read","connector:submit"]'::jsonb,
               (now() AT TIME ZONE 'UTC') - $5::interval, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC') + $6::interval,
               (now() AT TIME ZONE 'UTC') - $7::interval, (now() AT TIME ZONE 'UTC') - $8::interval, (now() AT TIME ZONE 'UTC') - $9::interval)
       RETURNING id`,
      [ids.ws, label, createHash("sha256").update(randomBytes(32)).digest("hex"), `${CONNECTOR_TOKEN_PREFIX}${randomBytes(5).toString("base64url").slice(0, 7)}...`, age, expires, used, revoked, exposed]
    );
    tokens[key] = row.id;
  }
}

/** Deletes by the planned ids: rows that were never inserted are simply not there. */
async function cleanup(data) {
  if (keep) return console.log(`Kept workspace ${data.ids.ws} (--keep)`);
  await q(`DELETE FROM organizations WHERE id = $1`, [data.ids.org]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[data.ids.lead, data.ids.colleague, data.ids.guest]]);
}

// ── Browser ──────────────────────────────────────────────────────────

async function signIn(page, email) {
  const signInResponse = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-only`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
  });
  const { idToken } = await signInResponse.json();
  if (!idToken) throw new Error("Emulator sign-in failed");
  const session = await fetch(`${APP}/api/auth/session`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: APP },
    body: JSON.stringify({ idToken }),
  });
  const value = /^__session=([^;]+)/.exec(session.headers.get("set-cookie") ?? "")?.[1];
  if (!session.ok || !value) throw new Error(`The app refused the synthetic session (${session.status}): is it started with --auth-emulator?`);
  await page.send("Network.clearBrowserCookies");
  await page.send("Network.setCookie", { name: "__session", value, url: APP, httpOnly: true, sameSite: "Lax" });
}

/** Accept every confirm() of the page (suspend, resume, revoke). */
function acceptDialogs(page) {
  return page.browser.on((msg) => {
    if (msg.sessionId === page.sessionId && msg.method === "Page.javascriptDialogOpening") {
      page.send("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
    }
  });
}

/** Real mouse click in the middle of the first element matching `selector`, once the layout is still. */
async function click(page, selector) {
  const measure = () =>
    evaluate(page, (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    }, selector);
  let box = await measure();
  for (let i = 0; i < 20 && box; i++) {
    await sleep(150);
    const again = await measure();
    if (again && again.x === box.x && again.y === box.y) break;
    box = again;
  }
  if (!box) throw new Error(`Nothing to click at ${selector}`);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
    await page.send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
  }
}

/** Capture of one element (document coordinates), `pad` px around it. */
async function shootElement(page, selector, file, pad = 16) {
  // From the top of the page: sticky bars would otherwise be drawn over the capture.
  await evaluate(page, () => window.scrollTo(0, 0));
  await sleep(300);
  const rect = await evaluate(page, (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height };
  }, selector);
  if (!rect) throw new Error(`No element ${selector} to capture`);
  const x = Math.max(0, Math.floor(rect.x - pad));
  const y = Math.max(0, Math.floor(rect.y - pad));
  const shot = await page.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: { x, y, width: Math.ceil(rect.width + 2 * pad), height: Math.ceil(rect.height + 2 * pad), scale: 1 },
  });
  const { mkdirSync, writeFileSync } = await import("node:fs");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(file, Buffer.from(shot.data, "base64"));
  shots.push(file);
  return file;
}

async function cardText(page) {
  return evaluate(page, (sel) => document.querySelector(sel)?.innerText ?? null, CARD);
}

async function settings(page, workspaceId) {
  const landed = await navigate(page, `${APP}/dashboard/${workspaceId}/settings`);
  await waitIdle(page, { quietMs: 600 });
  return landed;
}

function layoutChecks(report, page, label) {
  check(`${label}: no horizontal scroll`, !report.horizontalOverflow, `${report.scrollWidth}/${report.innerWidth}`);
  check(`${label}: no application error`, !report.applicationError);
  check(`${label}: no console error or exception`, page.errors.length === 0, page.errors.map((e) => e.text.slice(0, 120)).join(" | "));
}

// ── Run ──────────────────────────────────────────────────────────────

const browser = await launchBrowser({ colorScheme: "dark" });
try {
  for (const [index, width] of widths.entries()) {
    const data = plan();
    let page = null;
    let stopDialogs = () => {};
    try {
      await seed(data);
      page = await newPage(browser, { width });
      stopDialogs = acceptDialogs(page);
      const tag = `w${width}`;
      await signIn(page, data.accounts.lead);
      const landed = await settings(page, data.ids.ws);
      check(`${tag}: settings page 200`, landed.status === 200, `status ${landed.status}`);
      const text = await cardText(page);
      check(`${tag}: card visible to the organization's lead`, Boolean(text));
      for (const expected of [
        `https://www.theunbundle.com/api/mcp/connettore/${data.slug}`,
        data.slug,
        "il prossimo codice è PV-0001",
        "email facoltativa",
        "Organizzazione di prova",
        "1.0",
        "esposto, da revocare",
        "Token esposto, da revocare",
        "Token in scadenza",
        "Scade tra 9 giorni",
        "cliente.test",
        "200 invii e 3.000 letture l'ora per token",
        "1.000 invii al giorno per il workspace",
        "Token non più attivi (2)",
        "rimuove e riaggiunge il connettore",
      ]) {
        check(`${tag}: card shows «${expected}»`, text?.includes(expected));
      }
      check(`${tag}: no hash in the page`, !/[0-9a-f]{64}/.test((await pageReport(page)).text));
      layoutChecks(await pageReport(page), page, `${tag} card`);
      shots.push(await screenshot(page, join(outDir, `k7r-${tag}-pagina.png`)));
      await shootElement(page, CARD, join(outDir, `k7r-${tag}-scheda.png`));

      // New token: shown after creation, equal to the stored hash, 90 days, both scopes.
      await click(page, `${CARD} [data-connector-create]`);
      const shown = await until(() => evaluate(page, () => document.querySelector("[data-connector-new-token]")?.textContent?.trim() ?? null));
      check(`${tag}: new token shown after creation`, Boolean(shown) && shown.startsWith(CONNECTOR_TOKEN_PREFIX));
      if (shown) {
        const [row] = await q(
          `SELECT provider, scopes, round(extract(epoch FROM (expires_at - (now() AT TIME ZONE 'UTC'))) / 86400) AS days, exposed_at
             FROM workspace_integration_tokens WHERE token_hash = $1 AND workspace_id = $2`,
          [createHash("sha256").update(shown, "utf8").digest("hex"), data.ids.ws]
        );
        check(`${tag}: new token stored as hash only, connector provider and scopes, 90 days`, row?.provider === "claude_connector" && JSON.stringify(row?.scopes) === '["connector:read","connector:submit"]' && Number(row?.days) === 90, row ? `${row.days} days` : "no row");
        const plain = await q(`SELECT count(*)::int AS n FROM workspace_integration_tokens t WHERE workspace_id = $1 AND to_jsonb(t)::text LIKE $2`, [data.ids.ws, `%${shown}%`]);
        check(`${tag}: plain token never stored`, plain[0].n === 0);
      }
      await waitIdle(page, { quietMs: 600 });
      // The one-time value is blurred before the capture: the evidence never holds a token.
      await evaluate(page, () => {
        const el = document.querySelector("[data-connector-new-token]");
        if (el) el.style.filter = "blur(5px)";
      });
      await shootElement(page, CARD, join(outDir, `k7r-${tag}-token-creato.png`));
      const listedAfterCreate = await evaluate(page, () => document.querySelectorAll('[aria-label="Token attivi"] > li').length);
      check(`${tag}: the new token joins the active list`, listedAfterCreate === 4, `${listedAfterCreate} active`);

      // Shown once: after a reload neither the panel nor the value is anywhere in the page.
      await settings(page, data.ids.ws);
      const afterReload = await evaluate(
        page,
        (value) => ({ panel: Boolean(document.querySelector("[data-connector-new-token]")), inHtml: Boolean(value) && document.documentElement.outerHTML.includes(value) }),
        shown ?? ""
      );
      check(`${tag}: new token gone after a reload (shown once)`, Boolean(shown) && !afterReload.panel && !afterReload.inHtml);

      // Suspend, then resume.
      await click(page, `${CARD} [role=switch]`);
      const suspended = await until(async () => (await q(`SELECT enabled, updated_by FROM workspace_connector_configs WHERE workspace_id = $1`, [data.ids.ws]))[0]?.enabled === false);
      check(`${tag}: switch suspends the connector`, suspended);
      const [who] = await q(`SELECT updated_by FROM workspace_connector_configs WHERE workspace_id = $1`, [data.ids.ws]);
      check(`${tag}: suspension records who`, who.updated_by === data.ids.lead);
      await until(async () => (await cardText(page))?.includes("Connettore sospeso"));
      check(`${tag}: card says the connector is suspended`, (await cardText(page))?.includes("Connettore sospeso"));
      await shootElement(page, CARD, join(outDir, `k7r-${tag}-sospeso.png`));
      await click(page, `${CARD} [role=switch]`);
      check(`${tag}: switch resumes the connector`, await until(async () => (await q(`SELECT enabled FROM workspace_connector_configs WHERE workspace_id = $1`, [data.ids.ws]))[0]?.enabled === true));
      // The card re-renders after the action: wait until the suspended notice is gone.
      await until(async () => !(await cardText(page))?.includes("Connettore sospeso"));
      await waitIdle(page, { quietMs: 600 });

      // Revoke the exposed token.
      await click(page, `${CARD} li:has([data-connector-exposed]) form button[type=submit]`);
      const revoked = await until(async () => (await q(`SELECT revoked_at FROM workspace_integration_tokens WHERE id = $1`, [data.tokens.exposed]))[0]?.revoked_at != null);
      check(`${tag}: revoke stops the exposed token`, revoked);
      const others = await q(`SELECT count(*)::int AS n FROM workspace_integration_tokens WHERE workspace_id = $1 AND id <> ALL($2::uuid[]) AND revoked_at IS NOT NULL`, [data.ids.ws, [data.tokens.exposed, data.tokens.revoked]]);
      check(`${tag}: no other token revoked`, others[0].n === 0);
      await until(async () => !(await cardText(page))?.includes("Token esposto, da revocare"));
      const afterRevoke = await cardText(page);
      check(`${tag}: exposed warning gone after the revoke`, !afterRevoke?.includes("Token esposto, da revocare") && afterRevoke?.includes("Token non più attivi (3)"));
      layoutChecks(await pageReport(page), page, `${tag} after the actions`);
      await shootElement(page, CARD, join(outDir, `k7r-${tag}-dopo-revoca.png`));

      // People who must not see the card (first width only).
      if (index === 0) {
        for (const who of ["colleague", "guest"]) {
          await signIn(page, data.accounts[who]);
          const other = await settings(page, data.ids.ws);
          const hidden = await evaluate(page, (sel) => !document.querySelector(sel) && !document.body.innerText.includes("Connettore Claude"), CARD);
          check(`${tag}: ${who === "colleague" ? "contributor of the organization" : "lead invited to the workspace only"} does not see the card`, other.status === 200 && hidden, `status ${other.status}`);
        }

        // A row like the one every workspace gets for the codes (D6): switched off, no
        // guide. Only revoked or expired tokens left: no card for the lead either.
        await q(`UPDATE workspace_integration_tokens SET revoked_at = (now() AT TIME ZONE 'UTC') WHERE workspace_id = $1 AND revoked_at IS NULL`, [data.ids.ws]);
        await q(`UPDATE workspace_connector_configs SET enabled = false, guide = NULL, guide_version = NULL WHERE workspace_id = $1`, [data.ids.ws]);
        await signIn(page, data.accounts.lead);
        const d6 = await settings(page, data.ids.ws);
        const noCard = await evaluate(page, (sel) => !document.querySelector(sel) && !document.body.innerText.includes("Connettore Claude"), CARD);
        check(`${tag}: no card where the connector is not set up (D6 row, no guide)`, d6.status === 200 && noCard, `status ${d6.status}`);
      }
    } finally {
      stopDialogs();
      if (page) await page.send("Target.closeTarget", { targetId: page.targetId }).catch(() => {});
      await cleanup(data);
    }
  }
} finally {
  await browser.close();
  await pg.end();
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);
console.log(`Captures (outside git):\n${[...new Set(shots)].map((s) => `  ${s}`).join("\n")}`);
process.exit(failed.length ? 1 : 0);
