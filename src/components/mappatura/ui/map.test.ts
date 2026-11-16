import test from "node:test";
import assert from "node:assert/strict";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { enableTsxImports } from "../../use-cases/detail/referent/tsx-test-loader.ts";

// La mappa dei processi (docs/mappatura/MAPPATURA-BOARD-PIANO.md §4.9; P11–P17, P19, P22–P25): il riquadro, le righe con
// l'etichetta, la freccia, la card di un passo oggi (attrito) e nella classificazione (stream). Markup statico.

await enableTsxImports();
const { ProcessMap, ProcessRow, STEP_CARD_TOOLS, StepArrow, StepCard } = await import("./map.tsx");
const { ExposureBadge, StreamBadge } = await import("./atoms.tsx");

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);
/** `createElement` con i figli dopo le props: il tipo di React li vuole tra le props quando un componente li chiede. */
const h = <P extends object>(type: (props: P) => ReactNode, props: Omit<P, "children"> | null = null, ...children: ReactNode[]) =>
  createElement(type as unknown as FunctionComponent<Omit<P, "children">>, props, ...children);
const noop = () => {};

test("il riquadro della mappa e una riga: l'etichetta con lettera, nome, chi lo segue; i passi; «+ passo» in fondo", () => {
  assert.equal(html(h(ProcessMap, null, "righe")), '<div class="b-pm" data-b="map">righe</div>');
  assert.equal(html(h(ProcessMap, { dim: true }, "righe")), '<div class="b-pm" data-dim="" data-b="map">righe</div>');
  const row = html(h(ProcessRow, { letter: "A", name: "Dall'ordine alla consegna", owner: "Buyer", extra: "2 attriti", steps: 3, after: "+ passo" }, "passi"));
  assert.equal(
    row,
    '<div class="b-pm-row" style="--steps:3" data-b="process-row"><div class="b-pm-lab"><span class="b-lid">A</span><b>Dall&#x27;ordine alla consegna</b><small>Buyer</small><div class="b-pm-extra">2 attriti</div></div><div class="b-pm-steps">passi<div class="b-pm-after">+ passo</div></div></div>',
  );
  // La larghezza minima segue i passi; una riga vuota ne conta uno (P13).
  assert.match(html(h(ProcessRow, { letter: "B", name: "Resi", steps: 0 }, null)), /style="--steps:1"/);
  assert.doesNotMatch(html(h(ProcessRow, { letter: "B", name: "Resi", steps: 2 }, null)), /<small>|b-pm-extra|b-pm-after/);
  assert.equal(html(h(StepArrow)), '<div class="b-arrow" aria-hidden="true" data-b="arrow"><svg viewBox="0 0 16 10" focusable="false"><path d="M0 5h13M10 1l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.3"></path></svg></div>');
});

test("la card di oggi: titolo, descrizione e «Chi:» tagliati a tre righe dal foglio, al più quattro strumenti, la decisione, «da validare», il bordo dell'attrito", () => {
  const card = html(
    h(StepCard, {
      code: "A2",
      title: "Raccolta delle richieste",
      description: "Le richieste arrivano per posta e per telefono.",
      who: ["Buyer", " ", "Segreteria"],
      tools: ["Posta", "Foglio condiviso", "Gestionale", "Telefono", "Portale"],
      accent: { kind: "friction", level: 3 },
      gate: "Conferma dell'ordine",
      toValidate: true,
      onOpen: noop,
    }),
  );
  assert.match(card, /^<button type="button" class="b-node" data-pain="3" data-step="A2" aria-haspopup="dialog" data-b="step">/);
  assert.match(card, /<span class="b-sr">A2<\/span><span class="b-nt">Raccolta delle richieste<\/span><span class="b-ns2">Le richieste arrivano per posta e per telefono\.<\/span>/);
  // «Chi:» è nel markup, non nel CSS (P15): la scritta resta da provare.
  assert.match(card, /<span class="b-who"><b>Chi:<\/b> Buyer, Segreteria<\/span>/);
  const tools = [...card.matchAll(/<span class="b-chip b-tool">([^<]+)<\/span>/g)].map((match) => match[1]);
  assert.equal(STEP_CARD_TOOLS, 4);
  assert.deepEqual(tools, ["Posta", "Foglio condiviso", "Gestionale", "Telefono"]);
  assert.match(card, /<span class="b-gate" data-b="gate">Conferma dell&#x27;ordine<\/span><span class="b-tag b-line">da validare<\/span><\/button>$/);
  // Nell'ordine del riferimento: titolo, descrizione, chi, strumenti, decisione, tag.
  const at = (needle: string) => card.indexOf(needle);
  assert.ok(at("b-nt") < at("b-ns2") && at("b-ns2") < at("b-who") && at("b-who") < at("b-chips") && at("b-chips") < at("b-gate") && at("b-gate") < at("b-tag"));

  // Gli altri livelli; nessun attrito: nessun bordo. Senza nome della decisione: «Decide una persona»; senza decisione: niente.
  for (const level of [1, 2] as const) assert.match(html(h(StepCard, { code: "A1", title: "Passo", accent: { kind: "friction", level }, onOpen: noop })), new RegExp(`data-pain="${level}"`));
  const plain = html(h(StepCard, { code: "A1", title: "Passo", accent: { kind: "friction", level: 0 }, gate: null, onOpen: noop }));
  assert.doesNotMatch(plain, /data-pain|b-ns2|b-who|b-chips|b-tag|b-tb/);
  assert.match(plain, /<span class="b-gate" data-b="gate">Decide una persona<\/span>/);
  assert.doesNotMatch(html(h(StepCard, { code: "A1", title: "Passo", gate: false, onOpen: noop })), /b-gate/);
});

test("la card della classificazione: i badge, «da classificare», il bordo dello stream (P23, P24, P25)", () => {
  const classified = html(
    h(StepCard, {
      code: "B1",
      title: "Confronto delle offerte",
      description: "Il confronto si fa a mano.",
      accent: { kind: "stream", stream: "differentiate" },
      badges: [createElement(StreamBadge, { key: "s", stream: "differentiate", small: true }), createElement(ExposureBadge, { key: "e", pct: 22, small: true })],
      gate: null,
      onOpen: noop,
    }),
  );
  assert.match(classified, /^<button type="button" class="b-node b-tb" data-stream="differentiate" data-step="B1"/);
  assert.match(classified, /<span class="b-nt">Confronto delle offerte<\/span><span class="b-ag"><span class="b-abadge b-small" data-stream="differentiate" data-b="stream-badge">Differentiate<\/span><span class="b-abadge b-auto b-small" data-b="exposure-badge">AI 22%<\/span><\/span><span class="b-ns2">/);
  const unclassified = html(h(StepCard, { code: "B2", title: "Archivio", accent: { kind: "stream", stream: null }, note: "da classificare", onOpen: noop }));
  assert.match(unclassified, /^<button type="button" class="b-node b-tb" data-step="B2"/, "senza stream il bordo resta quello di una linea");
  assert.match(unclassified, /<span class="b-none">da classificare<\/span>/);
  assert.doesNotMatch(unclassified, /data-stream|data-pain/);
});

test("la card si apre con un clic (Invio e Spazio: è un bottone); sfuma; la maniglia sta fuori dal bottone", () => {
  let opened = 0;
  const element = StepCard({ code: "A1", title: "Passo", onOpen: () => void (opened += 1) }) as ReactElement<{ onClick(): void }>;
  assert.equal(element.type, "button");
  element.props.onClick();
  assert.equal(opened, 1);
  assert.match(html(h(StepCard, { code: "A1", title: "Passo", dimmed: true, onOpen: noop })), /data-dimmed=""/);
  const grip = createElement("span", { className: "b-grip", "aria-hidden": "true" });
  const wrapped = html(h(StepCard, { code: "A1", title: "Passo", grip, onOpen: noop }));
  assert.match(wrapped, /^<div class="b-node-w"><span class="b-grip" aria-hidden="true"><\/span><button type="button" class="b-node"/);
});
