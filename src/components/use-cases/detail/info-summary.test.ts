import test, { before } from "node:test";
import assert from "node:assert/strict";
import { infoProgressView, type InfoProgress } from "../../../lib/use-cases/info-progress.ts";
import { enableTsxImports } from "./referent/tsx-test-loader.ts";

// La riga in cima a «Cosa serve» (rilascio «Pulizia»): i conteggi e che cosa resta, in una riga sola.
// Lo stato a parole sta nella testata e qui non si ripete: niente titolo, niente chip, niente barra.
let summary: typeof import("./info-summary.tsx");
let renderToStaticMarkup: (element: unknown) => string;
let createElement: (type: unknown, props: unknown) => unknown;
before(async () => {
  await enableTsxImports();
  summary = await import("./info-summary.tsx");
  const react = await import("react");
  createElement = (type, props) => react.createElement(type as never, props as never);
  ({ renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string });
});

const render = (view: ReturnType<typeof infoProgressView>) => renderToStaticMarkup(createElement(summary.InfoSummary, { view }));
const textOf = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");
/** Lo spazio non separabile (`keepTogether`, `joinPieces`). */
const N = "\u00a0";

const waiting: InfoProgress = {
  state: "in_attesa",
  since: "2026-10-27",
  reminded: true,
  until: "2026-11-26",
  silentReason: null,
  blocked: false,
  received: 0,
  total: 6,
  toAsk: 2,
  toVerify: 0,
  waiting: 4,
  unanswered: 0,
  blockedCount: 0,
};

test("senza stato non c'è niente", () => {
  assert.equal(render(null), "");
});

test("in attesa: una riga con il conteggio e che cosa resta, senza la parola della testata", () => {
  const html = render(infoProgressView(waiting));
  // Il «·» resta con il gruppo prima: la riga va a capo dopo, mai dentro un gruppo.
  assert.equal(textOf(html), `0${N}di 6${N}informazioni ricevute${N}· 4${N}in${N}attesa${N}· 2${N}da${N}chiedere`);
  assert.match(html, /role="group"/);
  assert.match(html, /aria-label="Raccolta informazioni"/);
  assert.ok(!html.includes("Informazioni:"), "lo stato a parole sta solo nella testata");
  assert.ok(!html.includes('data-slot="info-chip"'), "nessun chip ripetuto");
  assert.ok(!html.includes("uppercase"), "nessun titolo in maiuscolo");
  assert.ok(!/<h\d/.test(html), "nessun titolo");
  assert.ok(!html.includes('data-slot="info-bar"'), "nessuna barra");
  assert.ok(!html.includes("27/10") && !html.includes("26/11") && !html.includes("promemoria"), "le date stanno nelle «Richieste»");
});

test("il conteggio si legge bene: text-foreground, mai text-muted-foreground", () => {
  const html = render(infoProgressView(waiting));
  const count = /<p data-slot="info-count"[^>]*>/.exec(html)?.[0] ?? "";
  assert.ok(count, "il paragrafo del conteggio");
  assert.match(count, /\btext-foreground\b/);
  assert.ok(!html.includes("text-muted-foreground"), html);
});

test("niente dal cliente: solo la frase, senza «che cosa resta»", () => {
  const html = render(infoProgressView({ ...waiting, state: "complete", received: 0, total: 0, toAsk: 0, waiting: 0 }));
  assert.equal(textOf(html), "Nessuna informazione serve dal cliente.");
  assert.ok(!html.includes('data-slot="info-next"'));
});

test("da verificare: tra parentesi dopo le ricevute, e ogni gruppo che resta, così i numeri fanno il totale", () => {
  const html = render(infoProgressView({ ...waiting, state: "da_verificare", received: 2, total: 5, toVerify: 1, waiting: 1, toAsk: 2 }));
  assert.equal(textOf(html), `2${N}di 5${N}informazioni ricevute (1 da verificare)${N}· 1${N}in${N}attesa${N}· 2${N}da${N}chiedere`);
  assert.match(html, /<span data-slot="info-received-note"> <span class="whitespace-nowrap">\(1 da verificare\)<\/span><\/span>/);
  // Al telefono si va a capo solo tra un gruppo e l'altro: «(1 da verificare)», «1 in attesa ·» e «2 da chiedere» restano interi,
  // e nessuna riga comincia con il «·».
  assert.match(html, new RegExp(`<span data-slot="info-next">${N}· 1${N}in${N}attesa${N}· 2${N}da${N}chiedere</span>`));
  assert.ok(!/[ >]· /.test(html), "mai un «·» in testa a una riga");
});
