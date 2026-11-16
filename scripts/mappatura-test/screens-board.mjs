#!/usr/bin/env node
// Le schermate della board dell'activity mapping, misurate (docs/mappatura/MAPPATURA-BOARD-PIANO.md §8.5).
//
// Costruisce la vetrina (vetrina.mjs), la serve da 127.0.0.1 e la apre con il Chrome senza finestra del repo
// (scripts/uc-test/cdp.mjs) a 1440 × 900 e a 390 × 844 (telefono: tocco, nessun passaggio), in «Scuro» e in «Chiaro»
// (`data-theme` su <html>). Salva le foto in <out>/{1440-dark,1440-light,390-dark,390-light}/ con i nomi del riferimento
// dove una vista ne rispecchia una, misura i numeri del riferimento (BOARD-SPEC §6, manifest.json) e si ferma con un
// errore se uno non torna:
// - i tre font caricati; titolo della vista 42 px a 1440 e 28 px a 390; titolo della board 28 px; scheda 13,5 px con il
//   numero d'ordine in mono 10,5 px; etichetta della riga 136 px (160 da 1500 px di board); card di una riga larghe
//   uguali, almeno 170 px; numero dei riquadri 30 px in serif; testata 127 ± 8 px a 1440;
// - la mappa che scorre nel suo riquadro a 390, e la pagina che non scorre mai di lato, in ogni vista; con la mappa fatta
//   scorrere fino in fondo l'etichetta di ogni riga al bordo sinistro, le righe larghe uguali, «+ passo» dentro la riga;
// - il drawer di 920 px a 1440 e di tutta la larghezza a 390; il pannello dell'assistente agganciato (380 px) a 1440 e
//   sopra la pagina a 390;
// - i colori calcolati della pagina, di un riquadro, del titolo, del suo corsivo, del punto della pillola e dei tre
//   stream uguali ai token di quel modo (letti da board.css);
// - al più un bottone pieno fuori dai drawer; nessun testo sul posto tagliato al primo disegno; sul telefono la seconda
//   riga di ogni unità che comincia allo stesso punto.
// Poi <out>/confronto.html mette ogni foto accanto a quella del riferimento con lo stesso nome (se <ref> c'è: i pixel
// non si confrontano, i contenuti sono diversi apposta) e <out>/misure.json tiene i numeri.
//
//   node scripts/mappatura-test/screens-board.mjs --out <cartella> [--ref <board-ref/shots>] [--vetrina <cartella>]
//
// Con `--live` (per l'integratore, con l'app accesa sul banco del hub, scripts/uc-test/start-app.mjs, e un'unità con la
// sua board) le pagine sono quelle vere: per ogni larghezza (390, 768, 900, 1024, 1280, 1440) e per ogni indirizzo di
// `--pages`, dopo l'accesso con l'account di prova `--account` (scripts/uc-test/browser-login.mjs), lo stato sotto 500,
// nessun errore nella pagina, la pagina che non scorre di lato; le foto in <out>/live/<larghezza>/.
//
//   node scripts/mappatura-test/screens-board.mjs --live --out <cartella> --pages /dashboard/<ws>/mapping,/dashboard/<ws>/mapping/<unità>
//        [--account ls-lead] [--origin http://127.0.0.1:53110]
//
// Solo indirizzi locali: la vetrina sta su 127.0.0.1; i font arrivano da Google Fonts come sul riferimento.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { closePage, evaluate, launchBrowser, loginAs, navigate, newPage, pageReport, screenshot } from "../uc-test/cdp.mjs";
import { UC_TEST_APP_PORT, UC_TEST_HOST } from "../uc-test/config.mjs";
import { REPO, buildVetrina } from "./vetrina.mjs";

const arg = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at !== -1 && process.argv[at + 1] ? resolve(process.argv[at + 1]) : fallback;
};
const text = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at !== -1 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};
const OUT = arg("--out", join(process.env.TMPDIR || tmpdir(), "mappatura-shots"));
const REF = arg("--ref", null);
const VETRINA = arg("--vetrina", join(process.env.TMPDIR || tmpdir(), "mappatura-vetrina"));

const CONFIGS = [
  { dir: "1440-dark", width: 1440, height: 900, theme: "dark" },
  { dir: "1440-light", width: 1440, height: 900, theme: "light" },
  { dir: "390-dark", width: 390, height: 844, theme: "dark" },
  { dir: "390-light", width: 390, height: 844, theme: "light" },
];

/** La foto del riferimento che una foto della vetrina rispecchia (BOARD-SPEC §7.2). */
function referenceOf(name, config) {
  if (name.startsWith("status/")) return config.dir === "1440-light" ? `ledger/${name}.png` : null;
  if (name === "02e-oggi-toast-annulla") return config.width === 1440 ? `desk/detail-2x-${config.theme}/02-toast-con-annulla.png` : null;
  const same = { "00-unita": "07-casi", "02-oggi": "02-oggi", "02c-oggi-drawer-passo": "02c-oggi-drawer-passo", "04-domani": "04-domani", "04b-domani-drawer-confronto": "04b-domani-drawer-confronto" }[name];
  return same ? `ledger/${config.dir}/${same}.png` : null;
}

// ─── I token di board.css, nei due modi ──────────────────────────────

function tokens() {
  const css = readFileSync(join(REPO, "src/components/mappatura/board.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({ selector: match[1].trim(), body: match[2] }));
  const read = (selector) => Object.fromEntries([...rules.find((rule) => rule.selector === selector).body.matchAll(/(--board-[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));
  const dark = read("[data-board-root]");
  const light = { ...dark, ...read(':root[data-theme="light"]:has([data-theme-scope]) [data-board-root]') };
  const rgb = (all, name) => {
    let value = all[name];
    while (value?.startsWith("var(")) value = all[value.slice(4, -1)];
    const hex = /^#([0-9a-f]{6})$/i.exec(value ?? "");
    if (!hex) return value;
    const n = parseInt(hex[1], 16);
    return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
  };
  const pick = (all) => Object.fromEntries(["bone", "paper", "ink", "signal-deep", "ok", "automate", "differentiate", "innovate"].map((name) => [name, rgb(all, `--board-${name}`)]));
  return { dark: pick(dark), light: pick(light) };
}

// ─── Il server della vetrina ─────────────────────────────────────────

function serve(root) {
  return new Promise((done) => {
    const server = createServer((request, response) => {
      const path = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
      const file = resolve(root, `.${path}`);
      if (request.method !== "GET" || !file.startsWith(root + sep) || !existsSync(file)) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end(readFileSync(file));
    });
    server.listen(0, "127.0.0.1", () => done(server));
  });
}

// ─── Le misure, nella pagina ─────────────────────────────────────────

function measure() {
  const q = (selector) => document.querySelector(selector);
  const css = (element, property) => (element ? getComputedStyle(element)[property] : null);
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  const width = (element) => (element ? Math.round(element.getBoundingClientRect().width * 10) / 10 : null);
  const map = q(".b-pm");
  const drawer = q(".b-drawer.b-on");
  const assistant = q(".b-assist:not([hidden])");
  const top = q(".b-top");
  const tabbar = q(".b-tabbar");
  return {
    fonts: [...new Set([...document.fonts].filter((face) => face.status === "loaded").map((face) => face.family.replace(/["']/g, "")))].sort(),
    viewTitle: css(q(".b-h"), "fontSize"),
    boardTitle: css(q(".b-title"), "fontSize"),
    boardTitleFamily: css(q(".b-title"), "fontFamily"),
    tab: css(q(".b-tab"), "fontSize"),
    tabOrdinal: css(q(".b-tab .b-n"), "fontSize"),
    tabOrdinalFamily: css(q(".b-tab .b-n"), "fontFamily"),
    rowLabel: width(q(".b-pm-lab")),
    board: width(q(".b-main")),
    rows: [...document.querySelectorAll(".b-pm-row")].map((row) => ({
      widths: [...row.querySelectorAll(".b-pm-steps > .b-node-w, .b-pm-steps > .b-node")].map(width),
      // Senza maniglia (sola lettura) la card sta da sola nella riga, come sul riferimento.
      bare: row.querySelector(".b-pm-steps > .b-node") !== null,
    })),
    tabs: tabbar !== null,
    map: map ? { scrollWidth: map.scrollWidth, clientWidth: map.clientWidth } : null,
    // Ogni mappa fatta scorrere fino in fondo: l'etichetta di ogni riga resta al bordo sinistro (P13), le righe sono
    // larghe uguali e «+ passo» sta dentro la sua riga. Poi la mappa torna dov'era.
    pinned: [...document.querySelectorAll(".b-pm")].map((element) => {
      const before = element.scrollLeft;
      element.scrollLeft = element.scrollWidth;
      const edge = element.getBoundingClientRect().left + element.clientLeft;
      const labels = [...element.querySelectorAll(".b-pm-lab")].map((label) => Math.round((label.getBoundingClientRect().left - edge) * 10) / 10);
      const rows = [...element.querySelectorAll(".b-pm-row")].map((row) => Math.round(row.getBoundingClientRect().width * 10) / 10);
      const pinned = { scrolled: element.scrollLeft, scrollWidth: element.scrollWidth, labels, rows };
      element.scrollLeft = before;
      return pinned;
    }),
    page: { scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth },
    drawer: width(drawer),
    assistant: assistant ? { width: width(assistant), position: css(assistant, "position") } : null,
    header: top && css(top, "display") !== "contents" ? Math.round(top.getBoundingClientRect().height) : null,
    headerBottom: tabbar ? Math.ceil(tabbar.getBoundingClientRect().bottom + window.scrollY) : top ? Math.ceil(top.getBoundingClientRect().bottom + window.scrollY) : null,
    kpi: css(q(".b-kpi .b-kv"), "fontSize"),
    kpiFamily: css(q(".b-kpi .b-kv"), "fontFamily"),
    colours: {
      bone: css(q("[data-board-root]"), "backgroundColor"),
      paper: css(q(".b-kpi"), "backgroundColor"),
      ink: css(q(".b-title"), "color"),
      "signal-deep": css(q(".b-title i"), "color"),
      ok: css(q('.b-status[data-s="saved"] .b-dot'), "backgroundColor"),
      automate: css(q('.b-adot[data-tone="automate"]'), "backgroundColor"),
      differentiate: css(q('.b-adot[data-tone="differentiate"]'), "backgroundColor"),
      innovate: css(q('.b-adot[data-tone="innovate"]'), "backgroundColor"),
    },
    filled: [...document.querySelectorAll(".b-btn.b-primary")].filter((element) => visible(element) && !element.closest(".b-drawer")).map((element) => element.textContent.trim()),
    // Un testo sul posto è alto quanto il suo testo dal primo disegno: nessuno tagliato.
    clipped: [...document.querySelectorAll("textarea.b-textin")].filter((element) => visible(element) && element.scrollHeight > element.clientHeight + 1).map((element) => element.value.slice(0, 40)),
    // La seconda riga di un'unità (i conteggi) comincia allo stesso punto in ogni riga.
    unitMeta: [...document.querySelectorAll(".b-units .b-crow-meta")].map((element) => {
      const first = [...element.children].find((child) => getComputedStyle(child).display !== "none") ?? element;
      return Math.round(first.getBoundingClientRect().left);
    }),
  };
}

// ─── I controlli ─────────────────────────────────────────────────────

function check(name, config, m, expected, failures) {
  const fail = (what) => failures.push(`${config.dir} ${name}: ${what}`);
  const near = (value, want, tolerance, what) => {
    if (value === null || Math.abs(value - want) > tolerance) fail(`${what} ${value}, atteso ${want} ± ${tolerance}`);
  };
  // Ovunque: la pagina non scorre di lato; al più un bottone pieno fuori dai drawer.
  if (m.page.scrollWidth > m.page.innerWidth) fail(`la pagina scorre di lato (${m.page.scrollWidth} > ${m.page.innerWidth})`);
  if (m.filled.length > 1) fail(`${m.filled.length} bottoni pieni: ${m.filled.join(", ")}`);
  if (m.clipped.length) fail(`testi sul posto tagliati: ${m.clipped.join(" | ")}`);
  if (config.width === 390 && new Set(m.unitMeta).size > 1) fail(`la seconda riga delle unità comincia in punti diversi: ${m.unitMeta.join(", ")}`);
  for (const family of ["Geist", "Geist Mono", "Instrument Serif"]) if (!m.fonts.includes(family)) fail(`font non caricato: ${family}`);
  // I colori calcolati: quelli che la pagina mostra.
  for (const [token, value] of Object.entries(m.colours)) if (value !== null && value !== expected[token]) fail(`colore ${token} ${value}, atteso ${expected[token]}`);
  if (m.boardTitle !== null && m.boardTitle !== "28px") fail(`titolo della board ${m.boardTitle}`);
  if (m.boardTitle !== null && !/Instrument Serif/.test(m.boardTitleFamily)) fail(`titolo della board in ${m.boardTitleFamily}`);
  if (m.tab !== null && m.tab !== "13.5px") fail(`scheda ${m.tab}`);
  if (m.tabOrdinal !== null && (m.tabOrdinal !== "10.5px" || !/Geist Mono/.test(m.tabOrdinalFamily))) fail(`numero della scheda ${m.tabOrdinal} ${m.tabOrdinalFamily}`);
  if (m.kpi !== null && (m.kpi !== "30px" || !/Instrument Serif/.test(m.kpiFamily))) fail(`numero dei riquadri ${m.kpi} ${m.kpiFamily}`);
  if (m.viewTitle !== null && m.viewTitle !== (config.width === 1440 ? "42px" : "28px")) fail(`titolo della vista ${m.viewTitle}`);
  if (m.rowLabel !== null) near(m.rowLabel, m.board !== null && m.board >= 1500 ? 160 : 136, 0.5, "etichetta della riga");
  m.rows.forEach(({ widths }, index) => {
    if (widths.length === 0) return;
    // Le card della stessa riga sono larghe uguali, con o senza maniglia: anche senza (sola lettura, «Classificazione»)
    // la card parte da 170 px (board.css), così il bordo dell'attrito da 4 px non la allarga (sul riferimento di 3 px).
    if (Math.max(...widths) - Math.min(...widths) > 1) fail(`riga ${index + 1}: card di larghezze diverse ${widths.join(", ")}`);
    if (Math.min(...widths) < 170) fail(`riga ${index + 1}: card più strette di 170 px (${Math.min(...widths)})`);
  });
  // La testata della board (con le schede): 127 px sul riferimento. L'elenco delle unità non ha schede.
  if (config.width === 1440 && m.header !== null && m.tabs) near(m.header, 127, 8, "testata");
  if (config.width === 390 && m.map && m.rows.some((row) => row.widths.length >= 2) && !(m.map.scrollWidth > m.map.clientWidth)) fail("la mappa non scorre nel suo riquadro");
  m.pinned.forEach(({ labels, rows, scrollWidth }, index) => {
    const where = `mappa ${index + 1} in fondo`;
    if (labels.some((left) => Math.abs(left) > 1)) fail(`${where}: etichette fuori dal bordo sinistro (${labels.join(", ")})`);
    if (rows.length > 0 && Math.max(...rows) - Math.min(...rows) > 1) fail(`${where}: righe di larghezze diverse (${rows.join(", ")})`);
    if (rows.length > 0 && scrollWidth > Math.max(...rows) + 1) fail(`${where}: qualcosa esce dalle righe (la mappa scorre per ${scrollWidth} px, la riga è ${Math.max(...rows)})`);
  });
  if (name === "02c-oggi-drawer-passo" || name === "04b-domani-drawer-confronto") near(m.drawer, config.width === 1440 ? 920 : 390, 0.5, "drawer");
  if (name === "02d-oggi-assistente" && m.assistant) {
    if (config.width === 1440 && (m.assistant.width !== 380 || m.assistant.position !== "sticky")) fail(`assistente ${m.assistant.width} ${m.assistant.position}, atteso agganciato di 380 px`);
    if (config.width === 390 && (m.assistant.width !== 390 || m.assistant.position !== "fixed")) fail(`assistente ${m.assistant.width} ${m.assistant.position}, atteso sopra la pagina, largo 390 px`);
  }
  if (name === "02d-oggi-assistente" && !m.assistant) fail("il pannello dell'assistente non si vede");
}

// ─── Il confronto ────────────────────────────────────────────────────

function comparison(shots) {
  const rows = shots
    .map(({ config, name, file }) => {
      const ref = REF ? referenceOf(name, config) : null;
      const refFile = ref ? join(REF, ref) : null;
      const right = refFile && existsSync(refFile) ? `<img src="${pathToFileURL(refFile).href}" alt="riferimento ${name}">` : `<p class="none">${refFile ? "foto del riferimento assente" : "nessuna vista del riferimento"}</p>`;
      return `<tr><th>${config.dir}<br>${name}</th><td><img src="${pathToFileURL(file).href}" alt="${name}"></td><td>${right}</td></tr>`;
    })
    .join("\n");
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Board: vetrina e riferimento</title>
<style>body{font:13px system-ui;margin:16px;background:#ddd}table{border-collapse:collapse}th{text-align:left;vertical-align:top;padding:8px;width:160px;font-weight:500}td{vertical-align:top;padding:8px;width:45vw}img{max-width:100%;border:1px solid #999;background:#fff}.none{color:#555}</style></head>
<body><h1>Board: la vetrina (sinistra) e il riferimento (destra)</h1><p>I contenuti sono diversi apposta: si confrontano grafica e disposizione, non i pixel.</p><table>${rows}</table></body></html>`;
}

// ─── Le pagine vere (--live) ─────────────────────────────────────────

const LIVE_WIDTHS = [390, 768, 900, 1024, 1280, 1440];

/** Le pagine vere dell'app, a ogni larghezza: stato sotto 500, nessun errore, nessuno scorrimento di lato. */
async function live() {
  const origin = text("--origin", `http://${UC_TEST_HOST}:${UC_TEST_APP_PORT}`);
  const paths = text("--pages", "").split(",").map((path) => path.trim()).filter(Boolean);
  const account = text("--account", null);
  if (paths.length === 0) throw new Error("--live vuole --pages, gli indirizzi delle pagine della mappatura (/dashboard/<ws>/mapping,…)");
  const browser = await launchBrowser();
  const failures = [];
  const report = {};
  try {
    for (const width of LIVE_WIDTHS) {
      const tab = await newPage(browser, { width });
      if (account) await loginAs(tab, account, { to: paths[0] });
      for (const path of paths) {
        const landed = await navigate(tab, new URL(path, origin).href);
        const errors = tab.errors.map((error) => error.text);
        const page = await pageReport(tab);
        const slug = path.replace(/^\/+/, "").replace(/[^\w-]+/g, "_") || "radice";
        report[`${width}/${slug}`] = { status: landed.status, url: landed.url, scrollWidth: page.scrollWidth, innerWidth: page.innerWidth, errors };
        const where = `${width} ${path}`;
        if (landed.status === null || landed.status >= 500) failures.push(`${where}: stato ${landed.status}`);
        if (page.applicationError) failures.push(`${where}: «Application error»`);
        if (errors.length) failures.push(`${where}: errori nella pagina ${errors.join(" | ")}`);
        if (page.horizontalOverflow) failures.push(`${where}: la pagina scorre di lato (${page.scrollWidth} > ${page.innerWidth})`);
        await screenshot(tab, join(OUT, "live", String(width), `${slug}.png`));
      }
      await closePage(tab);
    }
  } finally {
    await browser.close();
  }
  mkdirSync(join(OUT, "live"), { recursive: true });
  writeFileSync(join(OUT, "live", "rapporto.json"), `${JSON.stringify(report, null, 1)}\n`);
  console.log(`pagine vere: ${Object.keys(report).length} foto in ${join(OUT, "live")}`);
  if (failures.length) {
    console.error(`\n${failures.length} controlli non tornano:\n${failures.join("\n")}`);
    process.exit(1);
  }
  console.log("tutte le pagine vere a posto");
}

if (process.argv.includes("--live")) {
  await live();
  process.exit(0);
}

// ─── Il giro ─────────────────────────────────────────────────────────

const pages = await buildVetrina(VETRINA);
const server = await serve(VETRINA);
const origin = `http://127.0.0.1:${server.address().port}`;
const expectedColours = tokens();
const browser = await launchBrowser();
const failures = [];
const shots = [];
const measures = {};
try {
  for (const config of CONFIGS) {
    const tab = await newPage(browser, { width: config.width, height: config.height, colorScheme: config.theme });
    for (const { name, viewport, header } of pages) {
      const url = `${origin}/${name}.html`;
      const landed = await navigate(tab, url);
      if (landed.status !== 200) failures.push(`${config.dir} ${name}: stato ${landed.status}`);
      await evaluate(tab, (theme) => {
        document.documentElement.dataset.theme = theme;
      }, config.theme);
      await evaluate(tab, "document.fonts.ready.then(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))");
      const m = await evaluate(tab, measure);
      measures[`${config.dir}/${name}`] = m;
      if (tab.errors.length) failures.push(`${config.dir} ${name}: errori nella pagina ${tab.errors.map((error) => error.text).join(" | ")}`);
      check(name, config, m, expectedColours[config.theme], failures);
      const file = join(OUT, config.dir, `${name}.png`);
      mkdirSync(dirname(file), { recursive: true });
      if (header && m.headerBottom) {
        const shot = await tab.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: config.width, height: m.headerBottom, scale: 1 } });
        writeFileSync(file, Buffer.from(shot.data, "base64"));
      } else {
        await screenshot(tab, file, { fullPage: !viewport });
      }
      shots.push({ config, name, file });
    }
    await closePage(tab);
  }
} finally {
  await browser.close();
  server.close();
}

writeFileSync(join(OUT, "misure.json"), `${JSON.stringify(measures, null, 1)}\n`);
writeFileSync(join(OUT, "confronto.html"), comparison(shots));
const summary = (key) => {
  const m = measures[key];
  return m ? `titolo vista ${m.viewTitle}, titolo board ${m.boardTitle}, scheda ${m.tab}/${m.tabOrdinal}, etichetta ${m.rowLabel}, card ${m.rows.map((row) => row.widths[0]).join("/")}, testata ${m.header}, riquadro ${m.kpi}, mappa ${m.map?.scrollWidth}/${m.map?.clientWidth}, pagina ${m.page.scrollWidth}/${m.page.innerWidth}` : "—";
};
for (const config of CONFIGS) console.log(`${config.dir} 02-oggi: ${summary(`${config.dir}/02-oggi`)}`);
for (const config of CONFIGS) console.log(`${config.dir} drawer ${measures[`${config.dir}/02c-oggi-drawer-passo`]?.drawer}, assistente ${JSON.stringify(measures[`${config.dir}/02d-oggi-assistente`]?.assistant)}`);
console.log(`foto: ${shots.length} in ${OUT} (${relative(OUT, join(OUT, "confronto.html"))}${REF ? `, accanto al riferimento di ${REF}` : ", senza riferimento"})`);
if (failures.length) {
  console.error(`\n${failures.length} misure non tornano:\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("tutte le misure tornano");
