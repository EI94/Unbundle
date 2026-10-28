import test, { before } from "node:test";
import assert from "node:assert/strict";
import type { ValueParts } from "../../lib/use-cases/format.ts";
import { enableTsxImports } from "./detail/referent/tsx-test-loader.ts";

// Il Valore a schermo (rilascio «Pulizia»): con una cifra in euro solo la cifra, senza parola né
// punteggio, nella riga, nel pannello e nella scheda. Senza euro la parola, come prima.
let figure: typeof import("./value-figure.tsx");
let renderToStaticMarkup: (element: unknown) => string;
let createElement: (type: unknown, props: unknown) => unknown;
before(async () => {
  await enableTsxImports();
  figure = await import("./value-figure.tsx");
  const react = await import("react");
  createElement = (type, props) => react.createElement(type as never, props as never);
  ({ renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string });
});

type Props = import("./value-figure.tsx").ValueFigureProps;
const render = (props: Props) => renderToStaticMarkup(createElement(figure.ValueFigure, props));
const textOf = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");
const sourcesOf = (html: string) => (html.match(/data-source=/g) ?? []).length;

const counted = (over: Partial<NonNullable<ValueParts["benefits"]>> = {}): NonNullable<ValueParts["benefits"]> => ({
  state: "contato",
  benefitEur: 12_250,
  pendingEur: 0,
  hours: 350,
  ...over,
});

test("forma corta: con gli euro all'anno solo la cifra, senza la parola e non in grigio", () => {
  const value: ValueParts = { score: 1.4, word: "basso", source: "team", perYear: { amount: 12_250, source: "team" }, benefits: counted() };
  const html = render({ value, withLabel: true });
  assert.equal(textOf(html), "Valore: 12.250 €/anno");
  assert.doesNotMatch(html, /Basso/);
  assert.match(html, /<span class="whitespace-nowrap font-medium">12\.250 €\/anno<\/span>/);
  // Con «Benefici e costi» la cifra va senza fonte, anche nel pannello.
  assert.equal(sourcesOf(render({ value, withSource: true })), 0);
});

test("forma corta con la fonte, senza modello: la fonte degli euro, «team» o «dossier»", () => {
  const team = render({ value: { score: 2, word: "basso", source: "team", perYear: { amount: 12_250, source: "team" } }, withSource: true });
  assert.equal(textOf(team), "12.250 €/anno · team");
  assert.match(team, /data-source="team"/);
  assert.equal(sourcesOf(team), 1);
  const dossier = render({ value: { score: 2, word: "basso", source: "ai", perYear: { amount: 12_250, source: "dossier" } }, withSource: true });
  assert.equal(textOf(dossier), "12.250 €/anno · dossier");
  assert.match(dossier, /data-source="dossier"/);
  assert.doesNotMatch(dossier, /data-source="ai"/, "la fonte è quella della cifra scritta");
});

test("forma corta senza euro: la parola con la fonte del punteggio, come prima", () => {
  const html = render({ value: { score: 3.8, word: "alto", source: "ai", perYear: null }, withSource: true });
  assert.equal(textOf(html), "Alto · AI");
  assert.match(html, /data-source="ai"/);
  // 0 € non è una cifra: resta la parola.
  assert.equal(textOf(render({ value: { score: 3.8, word: "alto", source: "team", perYear: { amount: 0, source: "team" } } })), "Alto");
  assert.equal(textOf(render({ value: null, withLabel: true })), "Valore: da stimare");
});

test("forma lunga con gli euro: una sola cifra grande con la sua fonte, senza parola né punteggio", () => {
  const html = render({ value: { score: 2.2, word: "basso", source: "team", perYear: { amount: 12_250, source: "dossier" } }, form: "lunga", withLabel: true });
  assert.equal((html.match(/12\.250 € all&#x27;anno/g) ?? []).length, 1, html);
  assert.equal(sourcesOf(html), 1);
  assert.match(html, /data-source="dossier"[^>]*>dal dossier</);
  assert.doesNotMatch(html, /Basso · 2,2/);
  assert.doesNotMatch(html, /Basso|2,2/);
  assert.match(html, /<span class="text-xl font-semibold tracking-tight">12\.250 € all&#x27;anno<\/span>/, "non in grigio");
  // La fonte sulla riga sotto la cifra, nello stesso posto del costo.
  assert.match(html, /<\/span><\/div><div data-slot="figure-source"><span data-source="dossier"/);
});

test("forma lunga con «Benefici e costi»: le voci da misurare sotto la cifra; il solo tetto in grigio", () => {
  const withPending = render({
    value: { score: 1.4, word: "basso", source: "team", perYear: { amount: 12_250, source: "team" }, benefits: counted({ pendingEur: 1680 }) },
    form: "lunga",
  });
  assert.ok(withPending.includes("e fino a 1.680 € da misurare"), withPending);
  assert.ok(withPending.includes("12.250 € all&#x27;anno"));
  assert.doesNotMatch(withPending, /Basso/);

  const pendingOnly = render({
    value: { score: null, word: null, source: "team", perYear: null, benefits: { state: "da_misurare", benefitEur: 0, pendingEur: 5840, hours: 0 } },
    form: "lunga",
  });
  assert.match(pendingOnly, /<span class="text-xl font-semibold tracking-tight text-muted-foreground">da misurare · fino a 5\.840 €<\/span>/);
  assert.doesNotMatch(pendingOnly, /e fino a/, "il tetto è già la cifra");
});

test("forma lunga senza euro: «Alto · 3,8» con la fonte del punteggio", () => {
  const html = render({ value: { score: 3.8, word: "alto", source: "ai", perYear: null }, form: "lunga" });
  assert.match(html, />Alto · 3,8</);
  assert.match(html, /data-source="ai"[^>]*>AI</);
  assert.equal(sourcesOf(html), 1);
});
