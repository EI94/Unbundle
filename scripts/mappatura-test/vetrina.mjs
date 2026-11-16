#!/usr/bin/env node
// La vetrina della board dell'activity mapping (docs/mappatura/MAPPATURA-BOARD-PIANO.md §8.5).
//
// Pagine statiche fatte con i componenti veri (renderToStaticMarkup), i tre fogli della board e la board inventata di
// fixture.ts: l'elenco delle unità; «Processi di oggi» piena, vuota e in sola lettura; il drawer di un passo; il
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
export const PAGES = [
  { name: "00-unita", viewport: false },
  { name: "00-unita-vuota", viewport: false },
  { name: "02-oggi", viewport: false },
  { name: "02-oggi-in-corso", viewport: false },
  { name: "02-oggi-vuota", viewport: false },
  { name: "02-oggi-sola-lettura", viewport: false },
  { name: "02c-oggi-drawer-passo", viewport: true },
  { name: "02d-oggi-assistente", viewport: true },
  { name: "02e-oggi-toast-annulla", viewport: true },
  { name: "04-domani", viewport: false },
  { name: "04b-domani-drawer-confronto", viewport: true },
  { name: "status/0-caricamento", viewport: true, header: true },
  { name: "status/1-salvato", viewport: true, header: true },
  { name: "status/1b-pronto", viewport: true, header: true },
  { name: "status/2-modifiche-da-salvare", viewport: true, header: true },
  { name: "status/3-salvataggio", viewport: true, header: true },
  { name: "status/5-sola-lettura", viewport: true, header: true },
  { name: "status/5b-sola-lettura-toast", viewport: true },
  { name: "status/6b-conflitto-toast", viewport: true },
  { name: "status/8-vista-locale-con-modifiche", viewport: true, header: true },
];

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
  const { enableTsxImports } = await import(pathToFileURL(join(REPO, "src/components/use-cases/detail/referent/tsx-test-loader.ts")).href);
  await enableTsxImports();
  const at = (path) => import(pathToFileURL(join(REPO, path)).href);
  const { createElement: h, Fragment } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { UnitsView } = await at("src/components/mappatura/board/units-view.tsx");
  const { UnitBoard } = await at("src/components/mappatura/board/unit-board.tsx");
  const { StepDrawerBody, stepDrawerHead } = await at("src/components/mappatura/board/step-drawer.tsx");
  const { BoardProvider } = await at("src/components/mappatura/store/use-board.tsx");
  const { Companion } = await at("src/components/mappatura/companion/companion.tsx");
  const { CompleteButton } = await at("src/components/mappatura/companion/complete-button.tsx");
  const { ClassificationView } = await at("src/components/mappatura/classification/classification-view.tsx");
  const { ClassificationDetails } = await at("src/components/mappatura/classification/classification-drawer.tsx");
  const { DrawerStatic } = await at("src/components/mappatura/ui/drawer.tsx");
  const { BoardBrand, BoardHeader, BoardTabs, BoardTitle, StatusPill } = await at("src/components/mappatura/ui/frame.tsx");
  const { BoardLoadingHeader } = await at("src/components/mappatura/board/loading-header.tsx");
  const { BOARD_TABS, BOARD_TEXT } = await at("src/lib/mappatura/text.ts");
  const { locateStep } = await at("src/lib/mappatura/board-model.ts");
  const { FIXTURE_IDS, SHOWCASE, fixtureBoard, fixtureUnits, showcaseBoard } = await at("scripts/mappatura-test/fixture.ts");

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
  /** La sola testata, in uno stato della pillola (le foto `status/` del riferimento sono la testata e basta). */
  const header = (state, savedAt) =>
    html(
      h(BoardHeader, {
        brand: h(BoardBrand, { workspaceName: SHOWCASE.workspaceName, areaHref: `/dashboard/${workspaceId}/mapping` }),
        title: h(BoardTitle, { plain: "Ufficio acquisti", accent: BOARD_TEXT.boardTitleAccent }),
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
    "00-unita": html(h(UnitsView, { workspaceId, workspaceName: SHOWCASE.workspaceName, unitTerm: SHOWCASE.unitTerm, units: fixtureUnits() })),
    "00-unita-vuota": html(h(UnitsView, { workspaceId, workspaceName: SHOWCASE.workspaceName, unitTerm: SHOWCASE.unitTerm, units: [] })),
    "02-oggi": unitBoard(full),
    "02-oggi-in-corso": unitBoard(showcaseBoard()),
    "02-oggi-vuota": unitBoard(fixtureBoard({ empty: true }), { assistantOpen: true }),
    "02-oggi-sola-lettura": unitBoard(showcaseBoard({ readOnly: true })),
    "02c-oggi-drawer-passo": unitBoard(full) + drawer,
    "02d-oggi-assistente": unitBoard(full, { assistantOpen: true }),
    "02e-oggi-toast-annulla": unitBoard(full) + toast(BOARD_TEXT.toast.noteRemoved, BOARD_TEXT.buttons.undo),
    "04-domani": unitBoard(full, { tab: "classificazione" }),
    "04b-domani-drawer-confronto": unitBoard(full, { tab: "classificazione" }) + compare,
    // La cornice vera della board che si apre (loading.tsx): la stessa forma della testata, la pillola «Caricamento».
    "status/0-caricamento": html(h(BoardLoadingHeader, { workspaceId, departmentId: FIXTURE_IDS.unit })),
    "status/1-salvato": header("saved", savedAt),
    "status/1b-pronto": header("saved", null),
    "status/2-modifiche-da-salvare": header("dirty", savedAt),
    "status/3-salvataggio": header("saving", savedAt),
    "status/5-sola-lettura": header("readonly", savedAt),
    "status/5b-sola-lettura-toast": unitBoard(full) + toast(BOARD_TEXT.toast.readonly),
    "status/6b-conflitto-toast": unitBoard(full) + toast(BOARD_TEXT.toast.conflict),
    "status/8-vista-locale-con-modifiche": header("local", savedAt),
  };

  rmSync(out, { recursive: true, force: true });
  for (const { name } of PAGES) {
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
