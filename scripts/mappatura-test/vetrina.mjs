#!/usr/bin/env node
// La vetrina della board dell'activity mapping (docs/mappatura/MAPPATURA-BOARD-PIANO.md §8.5).
//
// Pagine statiche fatte con i componenti veri (renderToStaticMarkup), i tre fogli della board e la board inventata di
// fixture.ts: «Processi di oggi» piena, vuota e in sola lettura; il drawer di un passo; il
// pannello dell'assistente; «Classificazione» (lo slot del compagno, come lo disegna il suo componente) e il suo drawer
// che confronta; la testata in
// ogni stato della pillola; i due toast del riferimento e quello con «Annulla». Niente app, niente database, niente
// login: la testata sta in cima alla finestra (nessuna barra del workspace sopra) e la board è larga quanto lei, come
// l'artifact di riferimento. Sopra i fogli della board c'è il preflight di Tailwind, come nell'app.
// I font arrivano da Google Fonts con un <link>, come li carica il riferimento.
//
//   node scripts/mappatura-test/vetrina.mjs [--out <cartella>]     (default: $TMPDIR/mappatura-vetrina)
//
// Le pagine si scrivono con data-theme="dark"; screens-board.mjs cambia il tema nel browser prima di ogni foto.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const FONTS_HREF = "https://fonts.googleapis.com/css2?family=Geist:wght@300..700&family=Geist+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&display=swap";
const SHEETS = ["src/components/mappatura/board.css", "src/components/mappatura/board-views.css", "src/components/mappatura/board-companion.css"];

/** Le pagine della vetrina: il nome del file, e se la foto è la sola finestra (un drawer è fermo alla finestra). */
// (Rilascio 10, ondata 6a) L'elenco delle unità è la vista «Processi» di «Contesto», fuori dalla board: niente più «00-unita».
export const PAGES = [
  { name: "02-oggi", viewport: false },
  { name: "02-oggi-in-corso", viewport: false },
  { name: "02-oggi-vuota", viewport: false },
  { name: "02-oggi-sola-lettura", viewport: false },
  { name: "02c-oggi-drawer-passo", viewport: true },
  { name: "02d-oggi-assistente", viewport: true },
  { name: "02e-oggi-toast-annulla", viewport: true },
  { name: "02f-oggi-assistente-toast", viewport: true },
  { name: "02g-assistente-sopra-toast", viewport: true },
  { name: "04-domani", viewport: false },
  { name: "04b-domani-drawer-confronto", viewport: true },
  { name: "status/0-caricamento", viewport: true, header: true },
  { name: "status/0b-caricamento-nome-lungo", viewport: true, header: true },
  { name: "status/1-salvato", viewport: true, header: true },
  { name: "status/1c-salvato-nome-lungo", viewport: true, header: true },
  { name: "status/1b-pronto", viewport: true, header: true },
  { name: "status/2-modifiche-da-salvare", viewport: true, header: true },
  { name: "status/3-salvataggio", viewport: true, header: true },
  { name: "status/5-sola-lettura", viewport: true, header: true },
  { name: "status/5b-sola-lettura-toast", viewport: true },
  { name: "status/6b-conflitto-toast", viewport: true },
  { name: "status/8-vista-locale-con-modifiche", viewport: true, header: true },
];

/** Il nome di un'unità che sul telefono va a capo (inventato, come tutta la vetrina). */
export const LONG_UNIT_NAME = "Amministrazione, finanza e controllo di gestione";

const escape = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function page(title, body) {
  const preflight = readFileSync(join(REPO, "node_modules/tailwindcss/preflight.css"), "utf8");
  const sheets = SHEETS.map((path) => `/* ${path} */\n${readFileSync(join(REPO, path), "utf8")}`).join("\n");
  return `<!doctype html>
<html lang="it" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${escape(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${FONTS_HREF}" rel="stylesheet">
<style>@layer base {
${preflight}
}</style>
<style>:root { --font-sans: "Geist"; --font-geist-mono: "Geist Mono"; --font-board-serif: "Instrument Serif"; } body { margin: 0; }</style>
<style>
${sheets}
</style>
</head>
<body data-theme-scope="">
<div data-board-root="" style="--board-shell-top: 0px; min-height: 100vh">${body}</div>
</body>
</html>
`;
}

/** Scrive le pagine della vetrina in `out` (la cartella si svuota prima) e restituisce l'elenco. */
export async function buildVetrina(out) {
  // L'avviso dell'ok ai sub-responsabili (nell'assistente) ha un'azione del server e il router di Next: nella vetrina non
  // servono, e senza le chiavi del server l'azione non si carica. Due moduli finti, come nei test del compagno.
  const { installAppModules } = await import(pathToFileURL(join(REPO, "src/lib/ai/claude-test-kit.ts")).href);
  await installAppModules({
    "@/lib/actions/uc-subprocessors": "export async function declareSubprocessorsAction() { return { ok: true }; }",
    "next/navigation": "export function useRouter() { return { refresh() {}, push() {} }; }",
  });
  const { enableTsxImports } = await import(pathToFileURL(join(REPO, "src/components/use-cases/detail/referent/tsx-test-loader.ts")).href);
  await enableTsxImports();
  const at = (path) => import(pathToFileURL(join(REPO, path)).href);
  const { createElement: h, Fragment } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { UnitBoard } = await at("src/components/mappatura/board/unit-board.tsx");
  const { StepDrawerBody, stepDrawerHead } = await at("src/components/mappatura/board/step-drawer.tsx");
  const { BoardProvider } = await at("src/components/mappatura/store/use-board.tsx");
  const { Companion } = await at("src/components/mappatura/companion/companion.tsx");
  const { CompleteButton } = await at("src/components/mappatura/companion/complete-button.tsx");
  const { ClassificationView } = await at("src/components/mappatura/classification/classification-view.tsx");
  const { ClassificationDetails } = await at("src/components/mappatura/classification/classification-drawer.tsx");
  const { DrawerStatic } = await at("src/components/mappatura/ui/drawer.tsx");
  const { BoardHeader, BoardPath, BoardTabs, BoardTitle, StatusPill } = await at("src/components/mappatura/ui/frame.tsx");
  const { BoardLoadingHeader } = await at("src/components/mappatura/board/loading-header.tsx");
  const { BOARD_TABS, BOARD_TEXT } = await at("src/lib/mappatura/text.ts");
  const { locateStep } = await at("src/lib/mappatura/board-model.ts");
  const { FIXTURE_IDS, SHOWCASE, fixtureBoard, showcaseBoard } = await at("scripts/mappatura-test/fixture.ts");

  const workspaceId = FIXTURE_IDS.workspace;
  const noop = () => {};
  const html = (element) => renderToStaticMarkup(element);
  /** La board di un'unità com'è al primo disegno, con i tre slot veri del compagno. */
  const unitBoard = (board, extra = {}) =>
    html(
      h(
        BoardProvider,
        { workspaceId, departmentId: board.unit.id, userId: FIXTURE_IDS.user, initial: board },
        h(UnitBoard, {
          workspaceId,
          workspaceName: SHOWCASE.workspaceName,
          unitTerm: SHOWCASE.unitTerm,
          assistantDefaultOpen: extra.assistantOpen ?? false,
          initialTab: extra.tab,
          assistant: h(Companion, { workspaceId, departmentId: board.unit.id, unitName: board.unit.name, teamSize: board.unit.teamSize, initialMessages: [], hasDocuments: false }),
          classification: h(ClassificationView, { workspaceId, useCaseHub: false }),
          headAction: h(CompleteButton, { workspaceId, departmentId: board.unit.id }),
        }),
      ),
    );
  /** Il toast della board a schermo: lo stesso markup di BoardToastView. */
  const toast = (text, action) => `<div class="b-toast b-on" role="status" aria-live="polite" data-b="toast"><span>${escape(text)}</span>${action ? `<button type="button">${escape(action)}</button>` : ""}</div>`;
  /** Il toast vuoto nel suo posto, come lo disegna BoardToastView senza toast. */
  const EMPTY_TOAST = '<div class="b-toast" role="status" aria-live="polite" data-b="toast"></div>';
  /** Una board con il toast a schermo nel posto della pagina: in fondo alla colonna della board. */
  const withPageToast = (markup, text, action) => {
    if (!markup.includes(EMPTY_TOAST)) throw new Error("vetrina: il posto del toast della pagina non c'è");
    return markup.replace(EMPTY_TOAST, toast(text, action));
  };
  /** Una board con il toast nel pannello dell'assistente sopra la pagina: sopra il campo, come lo mette PanelToast. */
  const withPanelToast = (markup, text, action) => {
    if (!markup.includes('<form class="b-comp-form">')) throw new Error("vetrina: il campo dell'assistente non c'è");
    return markup.replace('<form class="b-comp-form">', `<form class="b-comp-form"><div class="b-toast-dock" data-b="toast-dock">${toast(text, action)}</div>`);
  };
  /** La sola testata, in uno stato della pillola (le foto `status/` del riferimento sono la testata e basta). */
  const header = (state, savedAt, unitName = "Ufficio acquisti") =>
    html(
      h(BoardHeader, {
        // (Rilascio 10, §3.7) La prima riga: il percorso «Contesto › Processi › {Unità}».
        brand: h(BoardPath, { workspaceId, unitName }),
        title: h(BoardTitle, { plain: unitName, accent: BOARD_TEXT.boardTitleAccent }),
        aside: h(
          Fragment,
          null,
          h(StatusPill, { state, savedAt, onSaveNow: noop }),
          h("button", { type: "button", className: "b-btn b-hide-phone b-assist-toggle", "aria-expanded": false }, "Assistente"),
        ),
        tabs: h(BoardTabs, { label: BOARD_TEXT.tabsLabel, tabs: BOARD_TABS.map((id) => ({ id, label: BOARD_TEXT.tabs[id] })), selected: "oggi", onSelect: noop }),
      }),
    );

  const full = showcaseBoard({ classified: true });
  const place = locateStep(full, FIXTURE_IDS.richieste);
  const actions = { dispatch: noop, openStep: noop, close: noop, notify: noop, newId: () => "f0000000-0000-4000-8000-000000000001", setAdding: noop };
  const head = stepDrawerHead({ place, editable: true, actions });
  const drawer = html(h(DrawerStatic, { wide: true, context: head.context, title: head.title }, h(StepDrawerBody, { board: full, place, editable: true, addingLane: null, actions })));
  const savedAt = full.savedAt;
  // Il drawer che confronta (P27): un passo classificato con la proposta dell'assistente, come lo apre «Classificazione».
  const compared = locateStep(full, FIXTURE_IDS.confronto);
  const compare = html(
    h(DrawerStatic, { wide: true, context: `${compared.process.name} · ${compared.code}`, title: compared.step.title }, h(ClassificationDetails, { board: full, place: compared, dispatch: noop, newId: actions.newId })),
  );

  const bodies = {
    "02-oggi": unitBoard(full),
    "02-oggi-in-corso": unitBoard(showcaseBoard()),
    "02-oggi-vuota": unitBoard(fixtureBoard({ empty: true }), { assistantOpen: true }),
    "02-oggi-sola-lettura": unitBoard(showcaseBoard({ readOnly: true })),
    "02c-oggi-drawer-passo": unitBoard(full) + drawer,
    "02d-oggi-assistente": unitBoard(full, { assistantOpen: true }),
    "02e-oggi-toast-annulla": withPageToast(unitBoard(full), BOARD_TEXT.toast.noteRemoved, BOARD_TEXT.buttons.undo),
    // Il toast con il pannello dell'assistente agganciato (1440): centrato sull'area della board, accanto al pannello.
    "02f-oggi-assistente-toast": withPageToast(unitBoard(full, { assistantOpen: true }), BOARD_TEXT.toast.conflict),
    // Il pannello sopra la pagina (390): il toast sta nel pannello, sopra il campo dell'assistente.
    "02g-assistente-sopra-toast": withPanelToast(unitBoard(full, { assistantOpen: true }), BOARD_TEXT.toast.conflict),
    "04-domani": unitBoard(full, { tab: "classificazione" }),
    "04b-domani-drawer-confronto": unitBoard(full, { tab: "classificazione" }) + compare,
    // La cornice vera della board che si apre (loading.tsx): la stessa testata, con i nomi letti dal layout, e la pillola
    // «Caricamento». Con un nome lungo, che sul telefono va a capo: la testata deve finire dove finirà quella della board.
    "status/0-caricamento": html(h(BoardLoadingHeader, { workspaceId, departmentId: FIXTURE_IDS.unit, unitName: "Ufficio acquisti", workspaceName: SHOWCASE.workspaceName })),
    "status/0b-caricamento-nome-lungo": html(h(BoardLoadingHeader, { workspaceId, departmentId: FIXTURE_IDS.unit, unitName: LONG_UNIT_NAME, workspaceName: SHOWCASE.workspaceName })),
    "status/1-salvato": header("saved", savedAt),
    "status/1c-salvato-nome-lungo": header("saved", savedAt, LONG_UNIT_NAME),
    "status/1b-pronto": header("saved", null),
    "status/2-modifiche-da-salvare": header("dirty", savedAt),
    "status/3-salvataggio": header("saving", savedAt),
    "status/5-sola-lettura": header("readonly", savedAt),
    "status/5b-sola-lettura-toast": withPageToast(unitBoard(full), BOARD_TEXT.toast.readonly),
    "status/6b-conflitto-toast": withPageToast(unitBoard(full), BOARD_TEXT.toast.conflict),
    "status/8-vista-locale-con-modifiche": header("local", savedAt),
  };

  rmSync(out, { recursive: true, force: true });
  for (const { name } of PAGES) {
    if (typeof bodies[name] !== "string") throw new Error(`vetrina: la pagina ${name} non ha contenuto`);
    const file = join(out, `${name}.html`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, page(`Vetrina della board · ${name}`, bodies[name]));
  }
  return PAGES.map((entry) => ({ ...entry, file: join(out, `${entry.name}.html`) }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf("--out");
  const out = at !== -1 ? resolve(process.argv[at + 1]) : join(process.env.TMPDIR || tmpdir(), "mappatura-vetrina");
  const pages = await buildVetrina(out);
  console.log(`vetrina: ${pages.length} pagine in ${out}`);
}
