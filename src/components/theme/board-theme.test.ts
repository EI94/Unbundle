import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { compact, declarationsOf, parseCss } from "./test-support/board-css.ts";
import { atLeast, contrast, cvdDistance, declarations, on, parseColor, readRepo, topLevelRules, type Color } from "./test-support/color.ts";

// Il tema della board dell'activity mapping (docs/mappatura/MAPPATURA-BOARD-PIANO.md §4.8, §8.4). La board ha il suo
// foglio, fuori da globals.css: qui si controlla che resti dentro la sua radice, che i colori siano quelli della board
// di riferimento nei due modi, che le regole portate siano uguali a quelle del riferimento (ogni differenza ha il suo
// motivo, qui sotto), e che i contrasti reggano. I due fogli di riferimento sono in test-support/: sistema di design e
// basta, senza testi di un cliente.

const SHEETS = ["src/components/mappatura/board.css", "src/components/mappatura/board-views.css", "src/components/mappatura/board-companion.css"];
const ROOT = "[data-board-root]";
const LIGHT = `:root[data-theme="light"]:has([data-theme-scope]) ${ROOT}`;
const sheets = Object.fromEntries(SHEETS.map((path) => [path, readRepo(path)]));
const board = sheets[SHEETS[0]];
const boardRules = parseCss(board);
const reference = { v2: parseCss(readRepo("src/components/theme/test-support/board-reference-v2.css")), v1: parseCss(readRepo("src/components/theme/test-support/board-reference-v1.css")) };

// ─── 1. Scope ────────────────────────────────────────────────────────

/** Il primo pezzo di un selettore dopo la radice: una classe della board, uno stato, un attributo; mai un elemento nudo. */
const AFTER_ROOT = /^(\.b-[a-z0-9-]+|:focus-visible|\*|\[class[\^*]=" ?b-"\])/;

test("ogni regola dei tre fogli sta sotto la radice della board; nessun @import, nessun elemento nudo, nessun prefers-color-scheme", () => {
  for (const [path, css] of Object.entries(sheets)) {
    assert.doesNotMatch(css, /@import/, `${path}: @import`);
    assert.doesNotMatch(css, /prefers-color-scheme/, `${path}: il modo lo decide il tema dell'app, non il sistema`);
    assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ""), /@(font-face|layer|keyframes|property|namespace)/, `${path}: solo @media e @container`);
    for (const rule of parseCss(css)) {
      if (rule.at) assert.match(rule.at, /^@(media|container)\b/, `${path}: ${rule.at}`);
      const rest = rule.selector === ROOT || rule.selector === LIGHT ? "" : rule.selector.startsWith(`${LIGHT} `) ? rule.selector.slice(LIGHT.length + 1) : rule.selector.startsWith(`${ROOT} `) ? rule.selector.slice(ROOT.length + 1) : null;
      assert.notEqual(rest, null, `${path}: «${rule.selector}» non comincia dalla radice della board`);
      if (rest) assert.match(rest, AFTER_ROOT, `${path}: «${rule.selector}» comincia da un elemento nudo`);
      assert.doesNotMatch(rule.selector, /(^|[\s>+~])(html|body|:root)\b(?!\[data-theme)/, `${path}: «${rule.selector}» esce dalla radice`);
      // Nessuna parola nel CSS: le scritte stanno nel markup, dove un test le legge.
      const content = rule.declarations.get("content");
      if (content) assert.match(content, /^("[^\p{L}]*"|attr\(data-l\) ": ")$/u, `${path}: «${rule.selector}» scrive un testo con content`);
    }
  }
  // Il foglio delle viste e quello del compagno nascono vuoti con le fondamenta: valgono già le stesse regole.
  assert.ok(boardRules.length > 250);
});

test("la radice: la mette solo il layout della mappatura, con i tre fogli e il serif; nessun componente importa un foglio", () => {
  const layout = readRepo("src/app/(dashboard)/dashboard/[workspaceId]/mapping/layout.tsx");
  for (const sheet of ["board.css", "board-views.css", "board-companion.css"]) assert.ok(layout.includes(`import "@/components/mappatura/${sheet}";`), sheet);
  assert.match(layout, /Instrument_Serif\(\{ weight: "400", style: \["normal", "italic"\], subsets: \["latin"\], display: "swap", variable: "--font-board-serif" \}\)/);
  assert.match(layout, /<div data-board-root="" className=\{boardSerif\.variable\}>/);
  assert.doesNotMatch(layout, /data-theme-scope/);
  const walk = (dir: string): string[] => readdirSync(new URL(`../../../${dir}`, import.meta.url), { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]));
  const sources = [...walk("src/components/mappatura"), ...walk("src/lib/mappatura")].filter((file) => /\.tsx?$/.test(file));
  assert.ok(sources.length > 10);
  for (const file of sources) {
    const source = readRepo(file);
    assert.doesNotMatch(source, /import\s+["'][^"']+\.css["']|from\s+["'][^"']+\.css["']/, `${file}: un foglio lo importa solo il layout`);
    if (!file.endsWith(".test.ts")) assert.doesNotMatch(source, /next\/font/, `${file}: il font si chiama solo nel layout`);
  }
  // I font della board vengono dalle tre variabili: due sono già su <html>, la terza la mette il layout.
  const tokens = declarations(topLevelRules(board)[0].body);
  assert.equal(tokens["--board-font-sans"], 'var(--font-sans), ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif');
  assert.equal(tokens["--board-font-serif"], 'var(--font-board-serif), "Times New Roman", Georgia, serif');
  assert.equal(tokens["--board-font-mono"], 'var(--font-geist-mono), ui-monospace, "SF Mono", Menlo, monospace');
  // Niente di nuovo nei fogli dell'app.
  for (const file of ["src/app/globals.css", "src/app/theme-palette.css", "src/app/theme-viz.css"]) assert.doesNotMatch(readRepo(file), /--board-|data-board-root|\.b-[a-z]/, file);
});

// ─── 2. Token ────────────────────────────────────────────────────────

/** I colori della board di riferimento, nei due modi (BOARD-SPEC §1.1), più i tre di Unbundle con il loro motivo. */
const DARK: Record<string, string> = {
  bone: "#14130F", "bone-2": "#1C1B16", "bone-3": "#2A2822", paper: "#201E19",
  ink: "#F2EEE5", "ink-2": "#DCD5C4", graphite: "#BDB5A6", "graphite-2": "#A39C8E", "graphite-3": "#6B655A",
  signal: "#7E876B", "signal-deep": "#B9C3A1", "signal-soft": "#2B2F24", "signal-ink": "#D5DCC2",
  amber: "#C9A26A", "amber-deep": "#D8B27A", "amber-soft": "#3A3122",
  crit: "#E59A86", "crit-soft": "#3B231D", ok: "#A9C49B",
  line: "rgba(242,238,229,.10)", "line-strong": "rgba(242,238,229,.22)", dot: "rgba(242,238,229,.08)",
  shadow: "0 1px 0 rgba(0,0,0,.3), 0 12px 26px -14px rgba(0,0,0,.8)",
  "a-1": "#8E9B7E", "a-2": "#7C9CC0", "a-3": "#D2A25E", "a-4": "#B88AAA", "a-5": "#62B3A8", "a-auto": "#9E978A",
  "on-agent": "#14130F",
  automate: "var(--board-a-1)", differentiate: "var(--board-a-4)", innovate: "#D2A25E",
  "on-auto": "#14130F", "amber-text": "#D8B27A",
  scrim: "rgba(19,18,14,.3)",
};
const LIGHT_VALUES: Record<string, string> = {
  bone: "#F2EEE5", "bone-2": "#EAE5D9", "bone-3": "#DCD5C4", paper: "#F8F5EE",
  ink: "#13120E", "ink-2": "#2A2722", graphite: "#514B41", "graphite-2": "#6B655A", "graphite-3": "#A39C8E",
  signal: "#A8B093", "signal-deep": "#5E6A53", "signal-soft": "#D9DBC9", "signal-ink": "#3F4838",
  amber: "#D8B27A", "amber-deep": "#9A7440", "amber-soft": "#EFDFC3",
  crit: "#9B3B2A", "crit-soft": "#F1D6CE", ok: "#4F6B45",
  line: "rgba(19,18,14,.10)", "line-strong": "rgba(19,18,14,.20)", dot: "rgba(19,18,14,.12)",
  shadow: "0 1px 0 rgba(19,18,14,.05), 0 10px 24px -14px rgba(19,18,14,.35)",
  "a-1": "#5E6A53", "a-2": "#3E5C7A", "a-3": "#A2722F", "a-4": "#7A4E6E", "a-5": "#2F7A72", "a-auto": "#8A8478",
  "on-agent": "#F8F5EE",
  // I tre che cambiano rispetto al riferimento: l'ocra di Innovate più scura (il testo del badge a 4,6:1 invece di
  // 3,9:1), il testo sul badge grigio (5,0:1 invece di 3,4:1), l'ambra dei testi (6,2:1 invece di 3,9:1).
  innovate: "#936729", "on-auto": "#13120E", "amber-text": "#715731",
};
/** Non cambiano con il tema: il velo (come sul riferimento) e i due stream che seguono il loro token d'agente. */
const SAME_IN_LIGHT = ["scrim", "automate", "differentiate"];
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\(|\b(?:white|black|red|green|blue|gray|grey|silver|yellow|orange|purple|pink|brown)\b/;

const [darkRule, lightRule, appRule] = topLevelRules(board);
const darkTokens = declarations(darkRule.body);
const lightTokens = declarations(lightRule.body);

test("i token della board: scuro per default, chiaro sotto il selettore del tema «Chiaro» dell'app, con i valori del riferimento", () => {
  assert.equal(darkRule.selector, ROOT);
  assert.equal(lightRule.selector, LIGHT);
  assert.match(darkRule.body, /color-scheme:\s*dark;/);
  assert.match(lightRule.body, /color-scheme:\s*light;/);
  const colours = (tokens: Record<string, string>) => Object.fromEntries(Object.entries(tokens).filter(([name]) => !/^--board-(font-|radius$|shell-top$)/.test(name)).map(([name, value]) => [name.replace("--board-", ""), value]));
  assert.deepEqual(colours(darkTokens), DARK);
  assert.deepEqual(colours(lightTokens), LIGHT_VALUES);
  // Il chiaro ridefinisce ogni colore dello scuro, tranne quelli che non cambiano con il tema; e nient'altro.
  assert.deepEqual(Object.keys(DARK).filter((name) => !(name in LIGHT_VALUES)).sort(), [...SAME_IN_LIGHT].sort());
  assert.deepEqual(Object.keys(LIGHT_VALUES).filter((name) => !(name in DARK)), []);
  assert.deepEqual(Object.keys(lightTokens).filter((name) => /^--board-(font-|radius$|shell-top$)/.test(name)), [], "font e misure non cambiano con il tema");
  // I token dell'app dentro la board prendono la tavolozza della board (un componente dell'app che finisce qui).
  assert.equal(appRule.selector, ROOT);
  const app = declarations(appRule.body);
  assert.deepEqual(app, {
    "--background": "var(--board-bone)", "--foreground": "var(--board-ink)",
    "--card": "var(--board-paper)", "--card-foreground": "var(--board-ink)",
    "--popover": "var(--board-paper)", "--popover-foreground": "var(--board-ink)",
    "--primary": "var(--board-ink)", "--primary-foreground": "var(--board-bone)",
    "--secondary": "var(--board-bone-2)", "--secondary-foreground": "var(--board-ink)",
    "--muted": "var(--board-bone-2)", "--muted-foreground": "var(--board-graphite)",
    "--accent": "var(--board-bone-3)", "--accent-foreground": "var(--board-ink)",
    "--destructive": "var(--board-crit)",
    "--border": "var(--board-line)", "--input": "var(--board-line-strong)", "--ring": "var(--board-signal-deep)",
  });
  // La barra del workspace: 61 px, 53 px da 48rem. La testata della board le sta sotto.
  assert.equal(darkTokens["--board-shell-top"], "61px");
  assert.match(board, /@media \(min-width: 48rem\) \{\s*\[data-board-root\] \{ --board-shell-top: 53px; \}\s*\}/);
});

test("i colori scritti a mano stanno solo nelle due regole dei token: tutto il resto è var(--board-…)", () => {
  for (const [path, css] of Object.entries(sheets)) {
    for (const rule of parseCss(css)) {
      const isTokens = path === SHEETS[0] && rule.at === null && (rule.selector === ROOT || rule.selector === LIGHT);
      for (const [property, value] of rule.declarations) {
        if (isTokens && property.startsWith("--board-")) continue;
        assert.doesNotMatch(value, COLOUR_LITERAL, `${path}: «${rule.selector}» ${property}: ${value}`);
        // Ogni token usato esiste.
        for (const used of value.matchAll(/var\((--board-[a-z0-9-]+)/g)) assert.ok(used[1] in darkTokens, `${path}: «${rule.selector}» usa ${used[1]}, che non c'è`);
      }
    }
  }
  // Fuori dalle due regole dei token nessuna regola ridefinisce un colore della board.
  const redefined = boardRules.filter((rule) => !(rule.at === null && (rule.selector === ROOT || rule.selector === LIGHT)) && [...rule.declarations.keys()].some((property) => property.startsWith("--board-") && property !== "--board-shell-top"));
  assert.deepEqual(redefined.map((rule) => rule.selector), []);
});

// ─── 3. Parità con il riferimento ────────────────────────────────────

const M = (condition: string) => `@media (${condition})`;
type Ported = [selector: string, at?: string];

/**
 * Le regole portate dal foglio v2 (la board che il titolare nomina): cornice, schede, pillola, bottoni, testa della
 * vista, tag, chip, punti, badge, card, punti di analisi, mappa, passo, freccia, decisione, dettagli a richiesta,
 * tabella, «Decide una persona», filtri, riquadri, riga, selettore a segmenti, drawer, confronto.
 */
const PORTED_V2: Ported[] = [
  [".mono"], [".wrap"], [".shell"], [".wrap", M("min-width:900px")], [".wrap", M("min-width:1500px")],
  [".top"], [".top-in"], [".brand"], [".brand b"], [".brand .x"], [".title"], [".title i"], [".spacer"],
  [".status"], [".status .dot"], ['.status[data-s="saved"] .dot'], ['.status[data-s="dirty"] .dot'], ['.status[data-s="saving"] .dot'],
  [".btn"], [".btn:hover"], [".btn.primary"], [".btn.small"],
  [".tabs"], [".tabs::-webkit-scrollbar"], [".tab"], [".tab .n"], ['.tab[aria-selected="true"]'], [".tab:hover"],
  ["main"], [".view"], [".view.on"], [".head"], [".head > div"], [".eyebrow"], ["h2.h"], ["h2.h i"], ["h3.sh"], ["h3.sh small"], [".lede"], [".block"], [".muted"],
  [".tag"], [".tag.amber"], [".tag.crit"], [".tag.line"], [".tag.ink"],
  [".chip"], [".chip.tool"], [".node .chips"], [".dr-body .chip"], [".more-t"], [".more-t summary"], [".more-t span"], [".chips"], [".adot"], [".abadge"],
  [".grid2"], [".grid3"], [".card"], [".card h4"], [".card p"], ["ul.l"], ["ul.l li"], [".k"], [".k.never"],
  [".grid3", M("max-width:1000px")], [".grid2", M("max-width:680px")], [".grid3", M("max-width:680px")],
  [".points"], [".point"], [".point b"], [".point span"], [".points", M("min-width:1500px")], [".points", M("max-width:900px")], [".points", M("max-width:560px")],
  [".legend"], [".legend span"], [".pm"], [".pm-row"], [".pm-row:first-child"], [".pm-lab"], [".pm-lab b"], [".pm-lab small"], [".pm-lab .lid"],
  [".pm-steps"], [".pm-steps .node"], [".pm-steps .node .who"], [".pm-steps .node .ns2"], [".pm-row", M("max-width:1499px")],
  [".node"], [".node:hover"], [".node .nt"], [".node .ns2"], [".node .who"], ['.node[data-pain="3"]'], ['.node[data-pain="2"]'], ['.node[data-pain="1"]'],
  [".arrow"], [".arrow svg"], [".node.tb"], [".node .ag"], [".node .gate"], [".node .gate::before"], [".node .none"],
  [".sec"], [".sec > summary"], [".sec > summary::-webkit-details-marker"], [".sec > summary::before"], [".sec[open] > summary::before"], [".sec > summary small"], [".sec .body"],
  [".tbl"], [".tbl th"], [".tbl td"], [".tscroll"], [".st-chip"], [".st-chip.ok"], [".st-chip.wait"], [".st-chip.ver"],
  [".tbl.stack thead", M("max-width:680px")], [".tbl.stack tr:not(.grp)", M("max-width:680px")], [".tbl.stack td", M("max-width:680px")],
  [".tbl.stack td:first-child", M("max-width:680px")], [".tbl.stack td[data-l]::before", M("max-width:680px")],
  [".human"], [".human b"],
  [".ctrl"], [".fchip"], ['.fchip[aria-pressed="true"]'], [".kpis"], [".kpi"], [".kpi .kv"], [".kpi .kl"], [".kpis", M("max-width:760px")],
  [".crow"], [".crow .cid"], [".crow .cn"], [".crow .cn small"], [".crow .num2"], [".crow .num2 small"],
  [".wsel"], [".wsel button"], [".wsel button:first-child"], ['.wsel button[aria-pressed="true"]'], [".wsel button.rec::after"],
  [".scrim"], [".scrim.on"], [".drawer"], [".drawer.on"], [".dr-head"], [".dr-head .x"], [".dr-body"], [".drawer.wide"],
  [".dr-body .grid2", "@container (max-width:620px)"], [".dr-cols"], [".dr-t"], [".dr-sub"],
  [".compare"], [".drawer.wide .compare"], [".compare .was"], [".compare .now"],
];
/**
 * Dal foglio v1 (l'unico dove le persone modificano una mappa) solo le parti di modifica: i due bottoni in più, i
 * conteggi, lo slot del trascinamento, «+ nota», la nota con i suoi stati e controlli, la maniglia, i voti, i bottoni
 * del livello, il toast con il bottone, la conferma in linea.
 */
const PORTED_V1: Ported[] = [
  [".btn.primary:hover"], [".btn.ghost"], [".btn[disabled]"], [".counts"],
  [".cell.over"], [".cell .add"], [".cell:hover .add"], [".cell:focus-within .add"], [".add:focus-visible"], [".cell .add", "@media (hover:none)"],
  [".note-w"], [".note"], [".note:focus"], ['.note-w[data-status="ipotesi"] .note'], ['.note-w[data-status="fonte"] .note'], ['.note-w[data-status="fonte"] .note:focus'],
  ['.note-w[data-status="validato"]::before'],
  [".note-ctl"], [".note-w:hover .note-ctl"], [".note-w:focus-within .note-ctl"], [".note-ctl", "@media (hover:none)"], [".note-ctl button"], [".note-ctl button svg"],
  [".grip"], [".note-w.dragging"], [".votes"], [".votes button"], [".feas"], [".feas button"], ['.feas button[aria-pressed="true"]'],
  [".toast"], [".toast.on"], [".toast button"], [".confirm"], [".confirm.on"],
];

/** Dal selettore del riferimento a quello della board: le classi con il prefisso `b-`, sotto la radice (§4.8, regole 2 e 3). */
function boardSelector(selector: string): string {
  const classes = selector.replace(/\bh2\.h\b/g, ".h").replace(/\bh3\.sh\b/g, ".sh").replace(/\bul\.l\b/g, ".l").replace(/^main$/, ".main");
  return `${ROOT} ${classes.replace(/\.([A-Za-z][\w-]*)/g, ".b-$1")}`;
}
/** Le soglie delle griglie sono container query sull'area della board, con gli stessi numeri (§4.8, regola 4). */
const boardAt = (at: string | undefined): string | null => (at ? at.replace(/^@media \(((?:max|min)-width:\d+px)\)$/, "@container board ($1)") : null);
/** Il valore della board con i nomi del riferimento: `var(--board-x)` torna `var(--x)`. */
const referenceValue = (value: string) => compact(value.replace(/var\(--board-/g, "var(--"));

/**
 * Le deviazioni dal riferimento: regola della board → proprietà → motivo. Il confronto qui sotto passa solo se le
 * differenze sono queste e nessun'altra, e se ognuna di queste è davvero una differenza.
 */
const DEVIATIONS: Record<string, Record<string, string>> = {
  [`${ROOT} .b-top`]: {
    top: "la testata sta sotto la barra del workspace (61 px, 53 px da 48rem), non in cima alla finestra",
    "z-index": "sotto la barra del workspace (20), sopra la pagina",
    container: "la testata è un container come l'area della board: il margine laterale ha le stesse soglie",
  },
  [`${ROOT} .b-main`]: {
    container: "le soglie delle griglie si misurano sull'area della board, non sulla finestra (accanto c'è la barra laterale dell'app)",
    flex: "l'area della board riempie la pagina dell'app, che è una colonna flessibile",
    "min-width": "come sopra: non allarga la pagina oltre lo spazio che c'è",
  },
  [`${ROOT} .b-pm-row`]: {
    "min-width":
      "segue i passi della riga più lunga della mappa (--steps, lo stesso per ogni riga, come la larghezza fissa del riferimento, che ne tiene sei) e lo spazio di «+ passo» (--b-after)",
  },
  [`@container board (max-width:1499px)|${ROOT} .b-pm-row`]: { "min-width": "come sopra, con l'etichetta di 136 px" },
  [`${ROOT} .b-node`]: { transition: "anche l'opacità: «Evidenzia attriti» sfuma i passi senza attrito (sul riferimento sfumano le note, con la stessa durata)" },
  [`${ROOT} .b-pm-steps .b-node`]: {
    flex: "base di 170 px, non 0: le card di una riga restano larghe uguali (P12) anche quando il bordo dell'attrito (4 px) e quello neutro (1 px) differiscono; sul riferimento la card con il bordo spesso è 3 px più larga",
  },
  [`${ROOT} .b-node .b-none`]: { color: "«da classificare» è un testo, non un segno: il grigio dei testi (7,5:1), non graphite-3 (2,4:1)" },
  [`${ROOT} .b-human b`]: { color: "l'etichetta di «Decide una persona» è un testo: amber-text (6,2:1 sul foglio in chiaro), non amber-deep (3,9:1)" },
  [`${ROOT} .b-l`]: { "list-style": "sotto il preflight dell'app una lista non ha i punti: quelle della board sì, come sul riferimento" },
  [`${ROOT} .b-crow`]: {
    "grid-template-columns": "una riga per unità o per use case ha altre colonne (stato, nome, punti, conteggi): le dà la vista",
    "text-decoration": "la riga è un link alla pagina che ha il dettaglio",
  },
  [`${ROOT} .b-scrim`]: { background: "il colore del velo è un token (lo stesso valore): fuori dalle regole dei token nessun colore scritto a mano", "z-index": "sopra le barre dell'app" },
  [`${ROOT} .b-drawer`]: { "z-index": "sopra le barre dell'app e sopra il velo" },
  [`${ROOT} .b-note`]: { background: "le note stanno sul colore della pagina: nessun colore per corsia (v2 non ne ha)", color: "il testo della pagina, nei due modi" },
  [`${ROOT} .b-note-w[data-status="ipotesi"] .b-note`]: { "background-image": "le righe sottili con un token al posto di un colore scritto a mano" },
  [`${ROOT} .b-note-w[data-status="fonte"] .b-note`]: { "box-shadow": "il contorno interno con un token al posto di un colore scritto a mano" },
  [`${ROOT} .b-note-w[data-status="validato"]::before`]: { "border-left": "la spunta con il verde della board (ok)", "border-bottom": "la spunta con il verde della board (ok)" },
  [`${ROOT} .b-grip`]: { "background-image": "i puntini della maniglia con un token al posto di un colore scritto a mano" },
  [`${ROOT} .b-toast button`]: { border: "il bordo con il colore del testo del toast (lo stesso valore in chiaro), come token" },
  [`${ROOT} .b-feas`]: { "flex-wrap": "quattro bottoni con una parola vanno a capo in un drawer stretto" },
  [`${ROOT} .b-feas button`]: {
    width: "i livelli dell'attrito hanno una parola («Nessuno», «Lieve», «Medio», «Forte»), non una cifra",
    "min-width": "almeno il quadrato del riferimento",
    padding: "lo spazio per la parola",
    "font-size": "la parola nel mono dei controlli",
  },
};

/**
 * Le regole del riferimento che la board non porta ma sostituisce, con il motivo: le scritte stanno nel markup (un test
 * le legge), e le note non hanno un colore per corsia.
 */
const REPLACED: Array<[sheet: "v1" | "v2", selector: string, why: string]> = [
  ["v2", ".node .who::before", "«Chi:» è nel markup"],
  ["v1", '.note-w[data-status="ipotesi"]::before', "la didascalia «ipotesi» è nel markup (.b-note-cap)"],
  ["v1", '.note-w[data-status="fonte"]::before', "la didascalia «da fonti» è nel markup (.b-note-cap)"],
  ["v1", '.note-w[data-status="fonte"][data-src]::before', "la fonte è nel markup (.b-note-cap)"],
];

function compare(sheet: "v1" | "v2", ported: Ported[]) {
  const seen = new Set<string>();
  for (const [selector, at] of ported) {
    const label = `${sheet} ${at ?? ""} ${selector}`;
    const expected = declarationsOf(reference[sheet], selector, at ?? null);
    assert.ok(expected, `${label}: non è nel riferimento`);
    const target = boardSelector(selector);
    const context = boardAt(at);
    const actual = declarationsOf(boardRules, target, context);
    assert.ok(actual, `${label}: manca in board.css «${context ?? ""} ${target}»`);
    const key = context ? `${context}|${target}` : target;
    assert.ok(!seen.has(key), `${label}: portata due volte`);
    seen.add(key);
    const allowed = DEVIATIONS[key] ?? {};
    const differing: string[] = [];
    for (const property of new Set([...expected.keys(), ...actual.keys()])) {
      const want = expected.has(property) ? compact(expected.get(property)!) : null;
      const got = actual.has(property) ? referenceValue(actual.get(property)!) : null;
      if (want === got) continue;
      differing.push(property);
      assert.ok(property in allowed, `${label}: «${property}» è «${got}», sul riferimento «${want}», e non è tra le deviazioni`);
    }
    assert.deepEqual(Object.keys(allowed).filter((property) => !differing.includes(property)), [], `${label}: deviazioni che non sono più differenze`);
  }
  return seen;
}

test("le regole portate sono quelle del riferimento, dichiarazione per dichiarazione; ogni differenza è una deviazione con il suo motivo", () => {
  const ported = new Set([...compare("v2", PORTED_V2), ...compare("v1", PORTED_V1)]);
  assert.equal(ported.size, PORTED_V2.length + PORTED_V1.length);
  // Ogni deviazione è di una regola portata, e ha un motivo scritto.
  for (const [key, properties] of Object.entries(DEVIATIONS)) {
    assert.ok(ported.has(key), `${key}: deviazione di una regola che non è tra quelle portate`);
    for (const [property, why] of Object.entries(properties)) assert.ok(why.length > 20, `${key} ${property}: manca il motivo`);
  }
  assert.equal(Object.keys(DEVIATIONS).length, 20);
});

test("fuori dal suo contesto una regola portata non si riscrive: solo la testata sul telefono", () => {
  // Una regola in più con lo stesso selettore, in un altro @media, cambierebbe una regola portata senza che il
  // confronto la veda. Le sole ammesse: la testata che sul telefono scorre con la pagina (§1.3, P79).
  const ported = new Map<string, Set<string | null>>();
  for (const [selector, at] of [...PORTED_V2, ...PORTED_V1]) {
    const target = boardSelector(selector);
    ported.set(target, (ported.get(target) ?? new Set()).add(boardAt(at)));
  }
  const elsewhere = boardRules.filter((rule) => ported.has(rule.selector) && !ported.get(rule.selector)!.has(rule.at)).map((rule) => `${rule.at} ${rule.selector}`);
  assert.deepEqual(elsewhere, ["@media (max-width: 47.99rem) [data-board-root] .b-top", "@media (max-width: 47.99rem) [data-board-root] .b-top-in"]);
  const phone = boardRules.filter((rule) => rule.at === "@media (max-width: 47.99rem)");
  const rule = (selector: string) => phone.find((item) => item.selector === `${ROOT} ${selector}`)?.declarations;
  // Sul telefono la testata non è più fissa: scorre con la pagina, e resta ferma la sola riga delle schede.
  assert.equal(rule(".b-top")?.get("display"), "contents");
  assert.deepEqual([rule(".b-top .b-tabbar")?.get("position"), rule(".b-top .b-tabbar")?.get("top"), rule(".b-top .b-tabbar")?.get("z-index")], ["sticky", "var(--board-shell-top)", "15"]);
  assert.equal(rule(".b-tabs-aside")?.get("display"), "flex");
});

test("quello che la board sostituisce non resta nel foglio: le scritte stanno nel markup, le note non hanno un colore per corsia", () => {
  for (const [sheet, selector, why] of REPLACED) {
    assert.ok(declarationsOf(reference[sheet], selector), `${sheet} ${selector}: non è nel riferimento`);
    assert.equal(declarationsOf(boardRules, boardSelector(selector)), null, `${selector}: ${why}`);
  }
  const rulesOnly = board.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(rulesOnly, /--board-st-|\.b-t-(step|who|tool|data|pain|time|idea)\b/, "nessun colore per corsia");
  assert.doesNotMatch(rulesOnly, /content:\s*"[^"]*\p{L}/u, "nessuna scritta nelle regole");
  // Al loro posto: «Chi:» in grassetto nel passo, la didascalia della nota. La corsia di note (.b-cell) è scritta a
  // mano: sul riferimento è una cella della griglia, con i suoi bordi; qui una colonna di note nel drawer.
  for (const selector of [".b-node .b-who b", ".b-note-cap", ".b-cell"]) assert.ok(declarationsOf(boardRules, `${ROOT} ${selector}`), selector);
  // Le viste del riferimento che qui non ci sono non lasciano regole: obiettivi, organigramma, agenti, demo, wave, grafici.
  assert.doesNotMatch(rulesOnly, /\.b-(obj|stepper|ns|fam|diagram|org-|agrid|acard|ad-|cov|flowbox|dsel|dstep|wcol|wcases|timeline|chart|roi-|rules|comp|params|hyp|ask|sess|news|canvas|lanes|ph|lh|tobe|agent|matrix|case|rank|act|dec)\b/);
});

test("le soglie delle griglie sono container query sull'area della board; drawer, velo e toast restano fermi alla finestra", () => {
  assert.equal(declarationsOf(boardRules, `${ROOT} .b-main`)?.get("container"), "board / inline-size");
  assert.equal(declarationsOf(boardRules, `${ROOT} .b-top`)?.get("container"), "board / inline-size", "la testata ha le stesse soglie");
  assert.equal(declarationsOf(boardRules, ROOT)?.has("container"), false, "non la radice: un container terrebbe fermi drawer, velo e toast");
  assert.equal(declarationsOf(boardRules, ROOT)?.has("container-type"), false);
  // Nessuna soglia di griglia sulla finestra: le sole @media sono la barra del workspace, il telefono, il tocco, il movimento.
  const media = [...new Set(boardRules.filter((rule) => rule.at?.startsWith("@media")).map((rule) => rule.at))].sort();
  assert.deepEqual(media, ["@media (hover:none)", "@media (max-width: 47.99rem)", "@media (min-width: 48rem)", "@media (prefers-reduced-motion: reduce)"]);
  const containers = [...new Set(boardRules.filter((rule) => rule.at?.startsWith("@container")).map((rule) => rule.at))].sort();
  assert.deepEqual(containers, [
    "@container (max-width:620px)",
    "@container board (max-width:1000px)", "@container board (max-width:1499px)", "@container board (max-width:560px)", "@container board (max-width:680px)",
    "@container board (max-width:760px)", "@container board (max-width:900px)", "@container board (min-width:1500px)", "@container board (min-width:900px)",
  ]);
  for (const fixed of [".b-drawer", ".b-scrim", ".b-toast"]) assert.equal(declarationsOf(boardRules, `${ROOT} ${fixed}`)?.get("position"), "fixed", fixed);
  assert.deepEqual([".b-scrim", ".b-drawer", ".b-toast"].map((selector) => Number(declarationsOf(boardRules, `${ROOT} ${selector}`)?.get("z-index"))), [49, 50, 60]);
});

// ─── 4. Contrasto, nei due modi ──────────────────────────────────────

function palette(mode: "dark" | "light") {
  const tokens: Record<string, string> = mode === "dark" ? darkTokens : { ...darkTokens, ...lightTokens };
  const colour = (name: string): Color => {
    let value = tokens[`--board-${name}`];
    assert.ok(value, `${mode}: manca --board-${name}`);
    while (value.startsWith("var(")) value = tokens[value.slice(4, -1)];
    return parseColor(value.replace(/\.(\d+)\)$/, "0.$1)").replace(/,\.(\d)/g, ",0.$1"));
  };
  const page = colour("bone").rgb;
  /** Il contrasto di `fg` su `bg` (se `bg` è trasparente, visto sulla pagina). */
  const ratio = (fg: string, bg: string) => contrast(colour(fg), on(colour(bg), page));
  return { colour, ratio };
}

test("contrasto: i testi almeno 7:1 e 4,5:1, i testi sui loro fondi 4,5:1, i segni 3:1, in scuro e in chiaro", () => {
  for (const mode of ["dark", "light"] as const) {
    const { ratio } = palette(mode);
    const text = (fg: string, bg: string, min: number) => atLeast(ratio(fg, bg), min, `${mode}: ${fg} su ${bg}`);
    for (const surface of ["bone", "paper"]) {
      text("ink", surface, 7);
      text("ink-2", surface, 7);
      text("graphite", surface, 7);
      text("graphite-2", surface, 4.5);
      text("signal-deep", surface, 4.5); // eyebrow, etichette, il corsivo dei titoli
      text("crit", surface, 4.5);
    }
    // I testi dei tag sui loro fondi.
    text("signal-ink", "signal-soft", 4.5);
    text("ink", "amber-soft", 4.5); // anche la pillola della decisione
    text("ink", "crit-soft", 4.5);
    text("bone", "ink", 4.5); // tag pieno, bottone pieno, controllo premuto, toast
    text("ink", "bone-3", 4.5); // chip di stato neutro
    text("graphite", "paper", 4.5); // tag tratteggiato «da validare»
    // Il testo dei badge su ogni stream e sul badge grigio.
    for (const stream of ["automate", "differentiate", "innovate"]) text("on-agent", stream, 4.5);
    text("on-auto", "a-auto", 4.5);
    text("on-auto", "amber", 4.5); // il totale dei voti
    // L'ambra dei testi.
    text("amber-text", "paper", 4.5);
    text("amber-text", "amber-soft", 4.5);
    // Come segni, almeno 3:1: i colori degli stream e l'attrito forte sul foglio, il rombo, l'anello del fuoco.
    for (const mark of ["automate", "differentiate", "innovate", "crit"]) text(mark, "paper", 3);
    text("amber-deep", "amber-soft", 3);
    text("amber-deep", "bone", 3);
    text("signal-deep", "bone", 3);
    text("signal-deep", "paper", 3);
    text("ok", "paper", 3); // il punto di «Salvato»
  }
});

test("i limiti conosciuti, con i loro numeri: cambiano solo per decisione", () => {
  const near = (value: number, expected: number, what: string) => assert.ok(Math.abs(value - expected) < 0.06, `${what}: ${value.toFixed(2)}:1, fissato a ${expected}:1`);
  const dark = palette("dark");
  const light = palette("light");
  // graphite-3: solo segni e due testi che ripetono quello che l'ordine dice già (il numero di una scheda, la lettera
  // di una riga o di un passo).
  near(light.ratio("graphite-3", "bone"), 2.35, "chiaro, graphite-3 sulla pagina");
  near(light.ratio("graphite-3", "paper"), 2.5, "chiaro, graphite-3 sul foglio");
  near(dark.ratio("graphite-3", "bone"), 3.22, "scuro, graphite-3 sulla pagina");
  near(dark.ratio("graphite-3", "paper"), 2.88, "scuro, graphite-3 sul foglio");
  const graphite3 = boardRules.filter((rule) => rule.declarations.get("color") === "var(--board-graphite-3)").map((rule) => rule.selector.replace(`${ROOT} `, ""));
  assert.deepEqual(graphite3.sort(), [".b-arrow", ".b-brand .b-x", ".b-pm-lab .b-lid", ".b-sec > summary::before", ".b-tab .b-n"], "nessun altro testo in graphite-3");
  // I bordi dell'attrito che non è forte: la legenda li nomina e il drawer dice il livello a parole, così il bordo non
  // è mai il solo segno.
  near(light.ratio("amber", "paper"), 1.82, "chiaro, attrito medio sul foglio");
  near(light.ratio("bone-3", "paper"), 1.34, "chiaro, attrito lieve sul foglio");
  near(dark.ratio("bone-3", "paper"), 1.13, "scuro, attrito lieve sul foglio");
  // I tre colori che cambiano rispetto al riferimento, e perché.
  near(light.ratio("on-agent", "innovate"), 4.58, "chiaro, testo del badge Innovate");
  near(light.ratio("on-agent", "a-3"), 3.87, "chiaro, lo stesso con l'ocra del riferimento");
  near(light.ratio("on-auto", "a-auto"), 5.04, "chiaro, testo sul badge grigio");
  near(light.ratio("on-agent", "a-auto"), 3.41, "chiaro, lo stesso con il testo del riferimento");
  near(light.ratio("amber-text", "paper"), 6.2, "chiaro, etichetta di «Decide una persona»");
  near(light.ratio("amber-deep", "paper"), 3.9, "chiaro, la stessa con l'ambra del riferimento");
});

// ─── 5. Gli stream si distinguono ────────────────────────────────────

test("i tre stream restano distinti per chi non distingue rosso e verde, nei due modi", () => {
  for (const mode of ["dark", "light"] as const) {
    const { colour } = palette(mode);
    const [automate, differentiate, innovate] = ["automate", "differentiate", "innovate"].map((name) => colour(name).rgb);
    for (const [a, b, what] of [[automate, differentiate, "Automate e Differentiate"], [automate, innovate, "Automate e Innovate"], [differentiate, innovate, "Differentiate e Innovate"]] as const) {
      assert.ok(cvdDistance(a, b) >= 0.05, `${mode}: ${what} a ${cvdDistance(a, b).toFixed(3)} in OKLab`);
    }
  }
  // Un colore per stream, lo stesso dappertutto: badge, punto della legenda, bordo del passo, bordo della riga.
  for (const stream of ["automate", "differentiate", "innovate"]) {
    assert.equal(declarationsOf(boardRules, `${ROOT} .b-abadge[data-stream="${stream}"]`)?.get("background"), `var(--board-${stream})`);
    assert.equal(declarationsOf(boardRules, `${ROOT} .b-adot[data-tone="${stream}"]`)?.get("background"), `var(--board-${stream})`);
    assert.equal(declarationsOf(boardRules, `${ROOT} .b-node.b-tb[data-stream="${stream}"]`)?.get("border-left-color"), `var(--board-${stream})`);
    assert.equal(declarationsOf(boardRules, `${ROOT} .b-crow[data-accent="${stream}"]`)?.get("border-left-color"), `var(--board-${stream})`);
  }
});

// ─── 6. Movimento, fuoco ─────────────────────────────────────────────

test("con il movimento ridotto nessuna transizione, dentro la board; il fuoco è l'anello di 2 px del riferimento", () => {
  const reduced = boardRules.filter((rule) => rule.at === "@media (prefers-reduced-motion: reduce)");
  assert.deepEqual(reduced.map((rule) => rule.selector), [ROOT, `${ROOT} *`, `${ROOT} *::before`, `${ROOT} *::after`]);
  for (const rule of reduced) assert.deepEqual([...rule.declarations], [["transition", "none !important"], ["animation", "none !important"]]);
  assert.deepEqual([...(declarationsOf(boardRules, `${ROOT} :focus-visible`) ?? [])], [["outline", "2px solid var(--board-signal-deep)"], ["outline-offset", "2px"]]);
  // La base del riferimento sta sulla radice: 14 px su 1,45, il sans della board, la pagina e il testo.
  const base = declarationsOf(boardRules, ROOT) as Map<string, string>;
  assert.deepEqual(
    ["background", "color", "font-family", "font-size", "line-height", "-webkit-font-smoothing", "overflow-wrap"].map((property) => base.get(property)),
    ["var(--board-bone)", "var(--board-ink)", "var(--board-font-sans)", "14px", "1.45", "antialiased", "break-word"],
  );
});
