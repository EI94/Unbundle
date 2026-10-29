// Headless Chrome driver for the local harness (Chrome DevTools Protocol over the
// built-in WebSocket of Node, no dependencies). A library: screens.mjs uses it, and so
// can later scripts (for example scripts/use-case-test/screens-hub.mjs) without editing it.
//
//   import { launchBrowser, newPage, loginAs, navigate, evaluate, screenshot, pageReport } from "./cdp.mjs";
//   const browser = await launchBrowser();
//   const page = await newPage(browser, { width: 400 });
//   await loginAs(page, "ls-lead", { to: "/dashboard/<ws>/casi-duso" });
//   const { status } = await navigate(page, "http://127.0.0.1:53110/dashboard/<ws>/casi-duso/<case>");
//   const report = await pageReport(page);
//   await screenshot(page, "/private/tmp/…/shot.png");
//   await browser.close();
//
// Only loopback addresses are opened: navigate() refuses any other host. Chrome runs with
// a throw-away profile in TMPDIR, removed on close. Set UC_TEST_CHROME to use another binary.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { UC_TEST_HOST, UC_TEST_LOGIN_PORT } from "./config.mjs";

export const CHROME_PATH = process.env.UC_TEST_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function assertLoopback(url) {
  const u = new URL(url);
  if (!LOOPBACK.has(u.hostname) || !["http:", "https:"].includes(u.protocol)) throw new Error(`The harness driver opens only loopback addresses, not ${u.origin}`);
}

/**
 * Starts headless Chrome and connects to it. `colorScheme` is the default
 * `prefers-color-scheme` of new pages ("dark" like the app, or "light").
 */
export async function launchBrowser({ chromePath = CHROME_PATH, colorScheme = "dark", timeoutMs = 20_000 } = {}) {
  if (!existsSync(chromePath)) throw new Error(`Chrome not found at ${chromePath} (set UC_TEST_CHROME)`);
  const profile = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "uc-cdp-"));
  const chrome = spawn(
    chromePath,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      "--remote-debugging-address=127.0.0.1",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      "--metrics-recording-only",
      "--hide-scrollbars",
      "--mute-audio",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  const portFile = join(profile, "DevToolsActivePort");
  const started = Date.now();
  while (!existsSync(portFile) || readFileSync(portFile, "utf8").split("\n").length < 2) {
    if (chrome.exitCode !== null) throw new Error(`Chrome exited with code ${chrome.exitCode}`);
    if (Date.now() - started > timeoutMs) {
      chrome.kill();
      throw new Error("Chrome did not open its DevTools port in time");
    }
    await sleep(100);
  }
  const [port, path] = readFileSync(portFile, "utf8").trim().split("\n");
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("DevTools WebSocket did not open")), { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(String(event.data));
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, reject, method } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
      else resolve(msg.result ?? {});
      return;
    }
    for (const listener of listeners) listener(msg);
  });

  const browser = {
    colorScheme,
    /** Sends a DevTools command, to the browser or to a page session. */
    send(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject, method });
        ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
    /** Subscribes to DevTools events; returns the unsubscribe function. */
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async close() {
      try {
        await Promise.race([browser.send("Browser.close"), sleep(2000)]);
      } catch {
        // already gone
      }
      ws.close();
      chrome.kill();
      await sleep(200);
      rmSync(profile, { recursive: true, force: true });
    },
  };
  return browser;
}

/**
 * Opens a new tab with its own viewport. The page collects console errors and uncaught
 * exceptions in `page.errors`, and the status of the last main document in `page.status`.
 */
export async function newPage(browser, { width = 1440, height, mobile, colorScheme } = {}) {
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params) => browser.send(method, params, sessionId);
  const inflight = new Set();
  // The document (loaderId) of the main frame that sent each request. A request that the old
  // document still had open when a new one commits is cancelled with it, and Chrome never
  // reports its end (no loadingFinished, no loadingFailed): without this, waitIdle() would
  // wait for it until its timeout.
  const loaderOf = new Map();
  const page = {
    browser,
    sessionId,
    targetId,
    send,
    errors: [],
    status: null,
    lastNetworkAt: Date.now(),
    loaded: false,
    inflight,
    viewport: null,
  };
  page.unsubscribe = browser.on((msg) => {
    if (msg.sessionId !== sessionId) return;
    const p = msg.params ?? {};
    switch (msg.method) {
      case "Runtime.consoleAPICalled":
        if (p.type === "error" || p.type === "assert") page.errors.push({ kind: "console", text: p.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 500) });
        break;
      case "Runtime.exceptionThrown":
        page.errors.push({ kind: "exception", text: String(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text ?? "").slice(0, 500) });
        break;
      case "Network.requestWillBeSent":
        inflight.add(p.requestId);
        if (p.frameId === targetId) loaderOf.set(p.requestId, p.loaderId);
        page.lastNetworkAt = Date.now();
        break;
      case "Network.loadingFinished":
      case "Network.loadingFailed":
        inflight.delete(p.requestId);
        loaderOf.delete(p.requestId);
        page.lastNetworkAt = Date.now();
        break;
      case "Page.frameNavigated":
        // A new document in the main frame (a client-side router navigation does not fire this).
        if (p.frame?.id !== targetId) break;
        for (const [id, loader] of loaderOf) {
          if (loader === p.frame.loaderId) continue;
          inflight.delete(id);
          loaderOf.delete(id);
        }
        break;
      case "Network.responseReceived":
        if (p.type === "Document" && p.frameId === targetId) page.status = p.response.status;
        break;
      case "Page.loadEventFired":
        page.loaded = true;
        break;
      default:
    }
  });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await setViewport(page, { width, height, mobile, colorScheme: colorScheme ?? browser.colorScheme });
  return page;
}

/** Viewport, touch and color scheme. Widths under 768 emulate a phone unless `mobile` says otherwise. */
export async function setViewport(page, { width = 1440, height, mobile, colorScheme = "dark" } = {}) {
  const isMobile = mobile ?? width < 768;
  const h = height ?? (isMobile ? 860 : 900);
  page.viewport = { width, height: h, mobile: isMobile };
  await page.send("Emulation.setDeviceMetricsOverride", { width, height: h, deviceScaleFactor: 1, mobile: isMobile });
  await page.send("Emulation.setTouchEmulationEnabled", isMobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
  await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: colorScheme }] });
}

/** Waits for the load event and a quiet network (no request in flight for `quietMs`). */
export async function waitIdle(page, { quietMs = 800, timeoutMs = 60_000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (page.loaded && page.inflight.size === 0 && Date.now() - page.lastNetworkAt > quietMs) return true;
    await sleep(100);
  }
  return false;
}

/**
 * Opens a loopback URL and waits until the page is quiet. Returns the status of the last
 * main document (after redirects) and the final URL.
 */
export async function navigate(page, url, { quietMs, timeoutMs } = {}) {
  assertLoopback(url);
  page.loaded = false;
  page.status = null;
  page.errors = [];
  page.inflight.clear();
  page.lastNetworkAt = Date.now();
  const result = await page.send("Page.navigate", { url });
  if (result.errorText) throw new Error(`Navigation to ${url} failed: ${result.errorText}`);
  const idle = await waitIdle(page, { quietMs, timeoutMs });
  const finalUrl = await evaluate(page, "location.href");
  return { status: page.status, url: finalUrl, idle };
}

/**
 * Evaluates an expression, or a function with JSON arguments, in the page and returns
 * the value (awaited if it is a promise).
 */
export async function evaluate(page, expressionOrFunction, ...args) {
  const expression =
    typeof expressionOrFunction === "function" ? `(${expressionOrFunction.toString()})(...${JSON.stringify(args)})` : String(expressionOrFunction);
  const out = await page.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (out.exceptionDetails) throw new Error(`Evaluation failed: ${out.exceptionDetails.exception?.description ?? out.exceptionDetails.text}`);
  return out.result?.value;
}

/** Full-page PNG (up to `maxHeight` px), written to `file`. */
export async function screenshot(page, file, { fullPage = true, maxHeight = 12_000 } = {}) {
  const { width, height } = page.viewport ?? { width: 1440, height: 900 };
  let clipHeight = height;
  if (fullPage) {
    const metrics = await page.send("Page.getLayoutMetrics");
    const content = metrics.cssContentSize ?? metrics.contentSize;
    clipHeight = Math.min(Math.max(Math.ceil(content?.height ?? height), height), maxHeight);
  }
  const shot = await page.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: fullPage,
    clip: { x: 0, y: 0, width, height: clipHeight, scale: 1 },
  });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(shot.data, "base64"));
  return file;
}

/** Forgets the session of the previous account. */
export async function clearCookies(page) {
  await page.send("Network.clearBrowserCookies");
}

/**
 * Signs in as a synthetic account through scripts/uc-test/browser-login.mjs and lands on
 * `to` (a /dashboard/… or /r/… path). The session cookie is set for 127.0.0.1.
 */
export async function loginAs(page, account, { to, loginOrigin = `http://${UC_TEST_HOST}:${UC_TEST_LOGIN_PORT}`, quietMs, timeoutMs } = {}) {
  await clearCookies(page);
  const target = new URL(`/as/${encodeURIComponent(account)}`, loginOrigin);
  if (to) target.searchParams.set("to", to);
  const landed = await navigate(page, target.href, { quietMs, timeoutMs });
  if (new URL(landed.url).origin === new URL(loginOrigin).origin) throw new Error(`Login as ${account} failed (status ${landed.status}): check the emulator, the app and browser-login.mjs`);
  return landed;
}

/**
 * The automatic checks of DESIGN §8.1 (c), measured in the page:
 * - `horizontalOverflow`: scrollWidth > innerWidth;
 * - `applicationError`: Next's «Application error» text;
 * - `filledButtons`: visible `[data-slot=button].bg-primary` outside `[role=dialog]`;
 * - `headHeight`: height of `[data-uc-case-head]` (dossier header plus tabs), if present;
 * - `text`: the visible text, for the copy guard; `h1`, `title`, `notFound`.
 */
export async function pageReport(page) {
  return evaluate(page, () => {
    const visible = (el) => {
      if (!(el instanceof HTMLElement)) return false;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const d = document.documentElement;
    const text = document.body ? document.body.innerText : "";
    const filled = [...document.querySelectorAll("[data-slot=button].bg-primary")].filter((el) => visible(el) && !el.closest("[role=dialog]"));
    const head = document.querySelector("[data-uc-case-head]");
    return {
      url: location.href,
      title: document.title,
      h1: [...document.querySelectorAll("h1")].map((h) => h.textContent.trim()).slice(0, 3),
      scrollWidth: d.scrollWidth,
      innerWidth: window.innerWidth,
      horizontalOverflow: d.scrollWidth > window.innerWidth,
      applicationError: /Application error/.test(text),
      filledButtons: filled.length,
      filledButtonLabels: filled.map((el) => el.textContent.trim().slice(0, 60)),
      headHeight: head ? Math.round(head.getBoundingClientRect().height) : null,
      notFound: !!document.querySelector('meta[name="robots"][content*="noindex"]') && /non trovat|not found|404/i.test(text.slice(0, 3000)),
      text,
    };
  });
}

/** Closes a tab. */
export async function closePage(page) {
  page.unsubscribe?.();
  await page.browser.send("Target.closeTarget", { targetId: page.targetId }).catch(() => {});
}
