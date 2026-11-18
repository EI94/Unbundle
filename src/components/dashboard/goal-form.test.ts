import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { installAppModules } from "../../lib/ai/claude-test-kit.ts";
import { PORTFOLIO_REVIEWER_ROLES } from "../../lib/workspace-permissions.ts";
import { enableTsxImports } from "../use-cases/detail/referent/tsx-test-loader.ts";

// Home › Obiettivi (`/strategy`): gli obiettivi li scrive solo chi valuta gli use case (`createGoalAction`). La pagina
// vera, resa sul server con accesso e database finti, mostra «Aggiungi Goal / Obiettivo / Key Result» e «Suggerisci
// OKR con AI» solo a quei ruoli; il modulo non porta mai alla pagina d'errore e, dopo un rifiuto, tiene il testo.
// Clienti e obiettivi inventati.

type Prova = { role: string; goals: Array<Record<string, unknown>> };
const prova: Prova = { role: "contributor", goals: [] };
(globalThis as { __strategia?: Prova }).__strategia = prova;

await installAppModules({
  "@/lib/auth/require-workspace": `export async function requireWorkspacePage() {
    return { session: { user: { id: "utente-prova" } }, access: { role: globalThis.__strategia.role, source: "workspace" } };
  }`,
  "@/lib/db/queries/workspaces": `export async function getWorkspaceById(id) { return { id, name: "Cliente di prova" }; }
export async function getStrategicGoalsByWorkspace() { return globalThis.__strategia.goals; }`,
  "@/lib/actions/strategy": `export async function createGoalAction() { return { ok: true }; }
export async function suggestOKRsAction() { return []; }`,
});
await enableTsxImports();
const { default: StrategyPage } = (await import("../../app/(dashboard)/dashboard/[workspaceId]/strategy/page.tsx")) as unknown as {
  default: (props: { params: Promise<{ workspaceId: string }> }) => Promise<unknown>;
};
const { saveGoal, GOAL_SAVE_FAILED } = await import("./goal-form.tsx");

const goal = (id: string, type: string, title: string, parentId: string | null) => ({ id, workspaceId: "ws-prova", parentId, type, title, description: null, owner: null, timeframe: null, direction: null, kpiName: null, currentValue: null, targetValue: null });
/** Un goal con due obiettivi: uno con un key result e uno senza (i due punti della pagina con «Aggiungi Key Result»). */
const GOALS = [
  goal("g-1", "goal", "Consegne più rapide", null),
  goal("o-1", "objective", "Ridurre i resi", "g-1"),
  goal("o-2", "objective", "Rispondere prima ai clienti", "g-1"),
  goal("k-1", "key_result", "Resi sotto il 3%", "o-1"),
];

async function page(role: string, goals = GOALS): Promise<string> {
  Object.assign(prova, { role, goals });
  const element = await StrategyPage({ params: Promise.resolve({ workspaceId: "ws-prova" }) });
  return renderToStaticMarkup(element as never).replaceAll("<!-- -->", "");
}

const count = (html: string, text: string) => html.split(text).length - 1;

test("(rilascio 10, §2.4, §3.8) la pagina si chiama «Obiettivi», nel titolo e nella scheda del browser", async () => {
  for (const role of ["analyst", "contributor"]) {
    const html = await page(role);
    assert.match(html, /<h1 class="text-2xl font-semibold tracking-tight">Obiettivi<\/h1>/, role);
    assert.doesNotMatch(html, /OKR<\/h1>|Obiettivi &amp; OKR/, role);
  }
  const { metadata } = (await import("../../app/(dashboard)/dashboard/[workspaceId]/strategy/page.tsx")) as unknown as { metadata: { title: string } };
  assert.equal(metadata.title, "Obiettivi");
});

test("chi valuta gli use case vede tutti i pulsanti per aggiungere obiettivi e «Suggerisci OKR con AI»", async () => {
  for (const role of PORTFOLIO_REVIEWER_ROLES) {
    const html = await page(role);
    assert.equal(count(html, "Aggiungi Goal"), 1, role);
    assert.equal(count(html, "Aggiungi Obiettivo"), 1, `${role}: sotto il goal`);
    assert.equal(count(html, "Aggiungi Key Result"), 2, `${role}: sotto ogni obiettivo, con e senza key result`);
    assert.equal(count(html, "Suggerisci OKR con AI"), 1, role);
  }
  assert.match(await page("analyst", []), /Aggiungi goal strategici, obiettivi e key result\./);
});

test("un contributore legge gli obiettivi senza nessun pulsante che finirebbe in un rifiuto", async () => {
  const html = await page("contributor");
  for (const title of ["Consegne più rapide", "Ridurre i resi", "Rispondere prima ai clienti", "Resi sotto il 3%"]) assert.ok(html.includes(title), title);
  for (const label of ["Aggiungi Goal", "Aggiungi Obiettivo", "Aggiungi Key Result", "Suggerisci OKR con AI"]) assert.equal(count(html, label), 0, label);
  const empty = await page("contributor", []);
  assert.ok(empty.includes("Nessun obiettivo"));
  assert.ok(empty.includes("Gli obiettivi li aggiunge chi valuta gli use case."));
  assert.doesNotMatch(empty, /Aggiungi|Suggerisci OKR/);
});

test("«Salva» non lancia mai: il rifiuto del server torna con il suo messaggio, un errore con un testo calmo", async () => {
  const data = new FormData();
  data.set("title", "Ridurre i resi");
  const seen: FormData[] = [];
  const refused = { ok: false as const, message: "Gli obiettivi li aggiunge chi valuta gli use case." };
  assert.deepEqual(await saveGoal(async (f) => (seen.push(f), refused), data), refused);
  assert.equal(seen[0], data, "l'azione riceve il modulo così com'è");
  // In produzione il messaggio di un errore lanciato da una server action non arriva al browser.
  assert.deepEqual(await saveGoal(async () => Promise.reject(new Error("Minified React error #441")), data), { ok: false, message: GOAL_SAVE_FAILED });
  assert.deepEqual(await saveGoal(async () => ({ ok: true }), data), { ok: true });
  assert.equal(GOAL_SAVE_FAILED, "Salvataggio non riuscito. Il testo è ancora qui: riprova tra poco.");
});

test("il modulo salva con onSubmit, non con l'azione di React che svuota i campi, e mostra il messaggio nella finestra", () => {
  const source = readFileSync(new URL("./goal-form.tsx", import.meta.url), "utf8");
  assert.match(source, /<form onSubmit=\{submit\}>/);
  assert.doesNotMatch(source, /<form[^>]*\baction=/);
  assert.match(source, /event\.preventDefault\(\);\s*const formData = new FormData\(event\.currentTarget\);/);
  assert.match(source, /const result = await saveGoal\(createGoalAction, formData\);\s*if \(result\.ok\) setOpen\(false\);\s*else setError\(result\.message\);/);
  assert.match(source, /\{error \? \(\s*<p role="alert"[^>]*>\s*\{error\}/);
});
