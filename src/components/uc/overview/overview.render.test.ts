import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installAppModules } from "../../../lib/ai/claude-test-kit.ts";
import { enableTsxImports } from "../../use-cases/detail/referent/tsx-test-loader.ts";

// (Rilascio 10, docs/ui-10/PROPOSTA-10.md §3.5, prototipo S4) La Panoramica della realizzazione resa in HTML, con i
// suoi pezzi veri e i dati inventati di S4 (XX-0012, «186 di 245»): tre blocchi più gli argomenti, ≤120 parole e ≤15
// controlli, nessun pulsante pieno nei blocchi (quello della pagina è il passo della testata), «Da fare» senza il
// pulsante pieno, lo zero che non si vede; i comandi del via senza pulsanti spenti, «Non approvo» nel pannello delle
// firme, «Ritira la proposta» nel «⋯» della sezione. Le azioni del server sono finte; id inventati.

await installAppModules({
  "@/lib/actions/uc-gates": `export async function proposeGateAction() { return { ok: true }; }
export async function rejectGateAction() { return { ok: true }; }
export async function signGateAction() { return { ok: true }; }`,
  "@/lib/actions/uc-people": `export async function requestApprovalAction() { return { ok: true }; }`,
  "../decision-buttons": `export function DecisionButtons() { return null; }
export function MarkInProgressButton() { return null; }`,
  "./referent/dialog-host": `export function useReferentDialog() { return null; }`,
});

const WS = "00000000-0000-4000-8000-0000000000f1";
const CASE = "00000000-0000-4000-8000-000000000c01";
const base = `/dashboard/${WS}/casi-duso/${CASE}`;
const questions = `${base}/domande`;

type Render = (element: unknown) => string;
let render: Render;
let h: (type: unknown, props?: object | null, ...children: unknown[]) => unknown;
let S: Record<string, (props: never) => unknown>;
let G: { GatePanel: (props: never) => unknown; ViaWithdraw: (props: never) => unknown };
let views: typeof import("../../../lib/uc/views/progress.ts");
let steps: typeof import("../../../lib/uc/views/next-step.ts");

before(async () => {
  await enableTsxImports();
  const react = await import("react");
  const { renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: Render };
  const { AppRouterContext } = (await import("next/dist/shared/lib/app-router-context.shared-runtime.js")) as unknown as { AppRouterContext: import("react").Context<object | null> };
  const router = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} };
  h = react.createElement as never;
  render = (element) => renderToStaticMarkup(react.createElement(AppRouterContext.Provider, { value: router }, element as never)).replace(/&#x27;/g, "'");
  S = (await import("./overview-sections.tsx")) as never;
  G = (await import("../progress/gate-panel.tsx")) as never;
  views = await import("../../../lib/uc/views/progress.ts");
  steps = await import("../../../lib/uc/views/next-step.ts");
});

function visibleWords(page: string): string[] {
  const text = page
    .replace(/<span[^>]*class="sr-only"[^>]*>[^<]*<\/span>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/g, " ");
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
}
const controls = (page: string) => [...page.matchAll(/<(a|button|summary)\b[^>]*>/g)].map((m) => m[0]);
const filled = (page: string) => [...page.matchAll(/<(a|button)\b[^>]*class="[^"]*\bbg-primary\b[^"]*"/g)].length;

/** La Panoramica di S4 (responsabile Lateral Space, desktop): i pezzi come li compone la pagina. */
function s4(): string {
  const required = [
    ...Array.from({ length: 180 }, () => ({ moduleKey: "altro", status: "validata" as const, ok: true })),
    ...["a", "b", "c"].flatMap((moduleKey) => Array.from({ length: 2 }, () => ({ moduleKey, status: "validata" as const, ok: true }))),
    ...Array.from({ length: 12 }, () => ({ moduleKey: "volumi", status: "da_chiedere" as const, ok: false })),
    ...Array.from({ length: 9 }, () => ({ moduleKey: "sistemi", status: "in_verifica" as const, ok: false })),
    ...Array.from({ length: 6 }, () => ({ moduleKey: "eccezioni", status: "chiesta" as const, ok: false })),
    ...Array.from({ length: 19 }, () => ({ moduleKey: "dati", status: "chiesta" as const, ok: false })),
    ...Array.from({ length: 13 }, () => ({ moduleKey: "persone", status: "bloccata" as const, ok: false })),
  ];
  const progress = views.viaProgress(required, "ls");
  const topics = views.moduleProgress(
    required,
    ["volumi", "sistemi", "eccezioni", "dati", "persone", "a", "b", "c", "altro"].map((key) => ({ key, title: key === "volumi" ? "Volumi e tempi" : key[0].toUpperCase() + key.slice(1), roleKey: null })),
  );
  const todo = [
    { key: "invia_domande", label: "Invia le domande", href: `${base}/persone?invia=1`, icon: "chiedi" },
    { key: "controlla_file", label: "Controlla 2 file", href: `${base}${steps.FILES_HREF.slice(1)}`, icon: "dossier" },
  ];
  const turn = { title: "Firma del via allo sviluppo", turn: "Tocca al cliente" };
  return render(
    h(
      "div",
      null,
      h(S.OverviewTodo, { rows: todo, turn } as never),
      h(
        "section",
        { id: "via" },
        h(S.SectionTitle, { id: "uc-overview-via", title: "Via allo sviluppo" } as never),
        h(S.ViaNumber, { ok: progress.ok, required: progress.required, inReview: progress.inReview, audience: "ls", emptyText: null } as never),
        h(S.ViaGroupLinks, { links: views.viaGroupLinks(progress, "ls", { skip: ["da_verificare"] }), questionsHref: questions } as never),
        h(S.ViaStatusLine, { text: views.viaProposeWhen({ status: "raccolta", ready: false, required: 245, ok: 186 }), how: views.viaHowText("request_modules") } as never),
      ),
      h(S.NextMilestone, { text: views.nextMilestoneText({ title: "Via allo sviluppo", when: "12 dic", suffix: null }), allHref: `${base}?apri=tappe` } as never),
      h(S.TopicList, { rows: views.topTopics(topics), hrefFor: (r: { key: string }) => `${questions}?argomento=${r.key}`, allHref: questions, total: topics.length } as never),
      h(S.BlockerList, { rows: [{ id: "b1", key: "accesso_sistema", label: "Accesso al sistema", line: "", fullLabel: "", items: 4, href: `${base}?apri=blocco:b1` }] } as never),
    ),
  );
}

test("S4: three blocks plus the topics within ≤120 words and ≤15 controls, no filled button of their own", () => {
  const page = s4();
  const words = visibleWords(page);
  assert.ok(words.length <= 120, `${words.length} words: ${words.join(" ")}`);
  assert.ok(controls(page).length <= 15, `${controls(page).length} controls`);
  assert.equal(filled(page), 0, "the filled button of the page is the step of the header");
  for (const title of ["Da fare", "Via allo sviluppo", "Prossima tappa", "Per argomento"]) assert.match(page, new RegExp(`<h2[^>]*>${title}</h2>`), title);
  assert.match(page, /data-slot="big-number-value"[^>]*>186 di 245</);
  assert.match(page, /domande indispensabili a posto/);
  assert.match(page, /role="progressbar"[^>]*aria-valuenow="186"/);
  // The groups as links, without the answers to verify (they are the filled «Verifica 9 risposte»).
  assert.match(page, new RegExp(`href="${questions}\\?vista=da-fare"[^>]*>Da fare 37<`));
  assert.match(page, new RegExp(`href="${questions}\\?vista=bloccate"[^>]*>Bloccate 13<`));
  assert.doesNotMatch(page, /Da verificare 9/);
  // «Come funziona» is the «?» of the line, not a manual on the page.
  assert.match(page, /Si propone quando sono tutte a posto\./);
  assert.match(page, /aria-label="Come funziona il via allo sviluppo"/);
  assert.doesNotMatch(page, /Come funziona<|Le fasi del caso|Cosa serve ancora/);
  // «Prossima tappa»: one line and «Tutte le tappe ›»; «Per argomento»: 3 topics and «Tutti gli argomenti (9) ›».
  assert.match(page, /Via allo sviluppo · 12 dic/);
  assert.match(page, new RegExp(`href="${base}\\?apri=tappe"[^>]*>Tutte le tappe`));
  assert.deepEqual([...page.matchAll(/argomento=([a-z]+)/g)].map((m) => m[1]), ["dati", "persone", "volumi"], "the 3 with most open questions first");
  assert.match(page, />12 aperte</);
  assert.match(page, /Tutti gli argomenti \(9\)/);
  assert.match(page, /Blocco: Accesso al sistema/);
});

test("«Da fare»: icon and verb per row, «Tocca a …» without a link; nothing to do, no section", () => {
  const page = render(
    h(S.OverviewTodo, {
      rows: [{ key: "verifica", label: "Verifica 9 risposte", href: `${base}/domande/verifica`, icon: "verifica" }],
      turn: { title: "Risposte a 6 domande", turn: "Tocca ai referenti" },
    } as never),
  );
  assert.match(page, new RegExp(`<a[^>]*href="${base}/domande/verifica"[^>]*>[\\s\\S]*?data-icon="inline-start"[\\s\\S]*?Verifica 9 risposte`));
  const turn = /<div data-slot="row"[^>]*>[\s\S]*?<\/div>/.exec(page)?.[0] ?? "";
  assert.match(turn, /Risposte a 6 domande[\s\S]*Tocca ai referenti/);
  assert.equal(filled(page), 0);
  assert.equal(render(h(S.OverviewTodo, { rows: [], turn: null } as never)), "");
  assert.equal(render(h(S.TopicList, { rows: [], hrefFor: () => null, allHref: questions, total: 4 } as never)), "", "no topic with open questions: no section");
  assert.equal(render(h(S.BlockerList, { rows: [] } as never)), "");
  assert.equal(render(h(S.ViaNumber, { ok: 0, required: 0, inReview: 0, audience: "cliente", emptyText: null } as never)), "", "no indispensable questions: no zero for the client");
});

test("blockers: at most 3 rows, then «Vedi tutti (n)»; each row opens its panel without jumping to the top", () => {
  const rows = ["a", "b", "c", "d"].map((id) => ({ id, key: "x", label: `Blocco ${id}`, line: "", fullLabel: "", items: 1, href: `${base}?apri=blocco:${id}` }));
  const page = render(h(S.BlockerList, { rows } as never));
  assert.match(page, /<section id="blocchi"/);
  assert.equal((page.match(/data-slot="row"/g) ?? []).length, 4);
  assert.match(page, /<summary[^>]*>Vedi tutti \(4\)/);
  assert.doesNotMatch(page, /<details[^>]*open/, "folded until asked");
});

test("the via commands: no dead button, the filled one only when the header hides its own, no «Non approvo» here", () => {
  const panel = (action: object, over: object = {}) =>
    render(h(G.GatePanel, { workspaceId: WS, caseId: CASE, action, filled: true, reviewId: "r1", contractCase: false, signHref: `${base}/firme`, files: [], ...over } as never));
  assert.equal(panel({ kind: "proponi", disabled: true, note: "Si propone quando sono tutte a posto." }), "", "F-036: the line says when, no button");
  const propose = panel({ kind: "proponi", disabled: false, note: null });
  assert.match(propose, />Proponi il via allo sviluppo</);
  assert.equal(filled(propose), 1, "on the Panoramica the header hides «Proponi»: this is the filled one");
  assert.equal(filled(panel({ kind: "proponi", disabled: false, note: null }, { filled: false })), 0);
  assert.match(panel({ kind: "firma_cliente", note: null }), new RegExp(`href="${base}/firme"[^>]*>Firma il via allo sviluppo`));
  assert.equal(panel({ kind: "firma_cliente", note: null }, { signHref: null }), "", "the header already says «Firma il via allo sviluppo»");
  const send = panel({ kind: "manda_link", canSend: true, attachEvidence: false, note: "Hai firmato il 3 ott. Manca il responsabile del cliente." });
  assert.match(send, /Manda il link per firmare/);
  assert.doesNotMatch(send, /Hai firmato/, "the signatures are the row above, once");
  assert.equal(panel({ kind: "manda_link", canSend: false, attachEvidence: false, note: "Hai firmato." }), "");
  assert.equal(panel({ kind: "nessuna", note: "Approvato il 3 ott · catalogo v1" }), "", "the approval is the status line");
  for (const a of [{ kind: "firma_cliente", note: null }, { kind: "manda_link", canSend: true, attachEvidence: false, note: "" }]) assert.doesNotMatch(panel(a), /Non approvo|Ritira la proposta/);
  const withdraw = render(h(G.ViaWithdraw, { workspaceId: WS, caseId: CASE, reviewId: "r1" } as never));
  assert.match(withdraw, /aria-label="Altre azioni sul via allo sviluppo"/);
  assert.equal(filled(withdraw), 0);
});

test("the Panoramica page: the via section inside, its anchor, folds closed, the panels, the loads in parallel", () => {
  const source = readFileSync(new URL("../../../app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/page.tsx", import.meta.url), "utf8");
  assert.match(source, /<section key=\{key\} id=\{VIA_SECTION_ID\}/);
  assert.match(source, /<Fold id="storico" title="Storico">/);
  assert.match(source, /<Fold id="diagnostica" title="Diagnostica">/);
  assert.doesNotMatch(source, /defaultOpen|<details[^>]*open/, "folds closed unless a link opens them");
  assert.match(source, /filled=\{!headerPrimary\}/);
  assert.match(source, /pageCommand: stepHasPageCommand\(primary\.id\)/, "the same rule as the header");
  assert.match(source, /await Promise\.all\(\[\s*loadOverview\(/);
  assert.match(source, /loadVia\(executor,/);
  assert.match(source, /<DetailSheet title="Tutte le tappe"/);
  assert.match(source, /<CasePhases phases=\{casePhaseGroups\(/, "the 11 states of «Come funziona» are in the path of the panel");
  assert.match(source, /<div id="sviluppo-con-claude"/, "«Sviluppo con Claude» stays where /via had it");
  const anchor = /export const CLAUDE_PANEL_ANCHOR = "([^"]+)"/.exec(readFileSync(new URL("../mcp/claude-dev-panel.tsx", import.meta.url), "utf8"))?.[1];
  assert.equal(anchor, "sviluppo-con-claude", "the anchor the panel opens itself on");
  assert.doesNotMatch(source, /import \{[^}]*CLAUDE_PANEL_ANCHOR/, "a value of a client module is not a string on the server");
  assert.doesNotMatch(source, /casePath\(workspaceId, caseId, "via"\)|"Dettagli"|Il caso"|SignatureCallout|ApprovedNote/);
});
