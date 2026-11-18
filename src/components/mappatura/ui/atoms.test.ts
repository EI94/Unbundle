import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { enableTsxImports } from "../../use-cases/detail/referent/tsx-test-loader.ts";

// I pezzi piccoli della board (docs/mappatura/MAPPATURA-BOARD-PIANO.md §4.9; P23, P25, P28, P34, P35, P37, P42–P45,
// P82, P85): bottoni, tag, chip, punti, badge, riquadri, legenda, filtri, sezioni, tabelle, righe. Markup statico; le
// funzioni si chiamano dagli elementi che il componente restituisce.

await enableTsxImports();
const atoms = await import("./atoms.tsx");
const { AddButton, BoardButton, Chip, Dot, ExposureBadge, FilterChip, GatePill, Kpis, Legend, LegendItem, MoreText, RowLink, Section, StackTable, StatusChip, StreamBadge, Tag } = atoms;

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);
/** `createElement` con i figli dopo le props: il tipo di React li vuole tra le props quando un componente li chiede. */
const h = <P extends object>(type: (props: P) => ReactNode, props: Omit<P, "children"> | null = null, ...children: ReactNode[]) =>
  createElement(type as unknown as FunctionComponent<Omit<P, "children">>, props, ...children);

/** Gli elementi di un albero restituito da un componente senza hook, in profondità. */
function* elements(node: unknown): Generator<ReactElement<Record<string, unknown>>> {
  if (Array.isArray(node)) {
    for (const item of node) yield* elements(item);
  } else if (node && typeof node === "object" && "props" in node) {
    const element = node as ReactElement<Record<string, unknown>>;
    yield element;
    yield* elements(element.props.children);
  }
}
const buttonsOf = (node: unknown) => [...elements(node)].filter((element) => element.type === "button");

test("i bottoni: contornato per default, pieno d'inchiostro, trasparente, piccolo; sempre type=button se non è detto altro", () => {
  assert.equal(html(h(BoardButton, null, "Aggiungi un passo")), '<button type="button" class="b-btn" data-b="button" data-variant="outline">Aggiungi un passo</button>');
  assert.equal(html(h(BoardButton, { variant: "primary" }, "Completa")), '<button type="button" class="b-btn b-primary" data-b="button" data-variant="primary">Completa</button>');
  assert.match(html(h(BoardButton, { variant: "ghost", small: true, disabled: true, "aria-label": "Copia" }, "Copia")), /^<button disabled="" aria-label="Copia" type="button" class="b-btn b-ghost b-small" data-b="button" data-variant="ghost">/);
  assert.match(html(h(BoardButton, { type: "submit" }, "Invia")), /type="submit"/);
  assert.equal(html(h(AddButton, { "aria-label": "Aggiungi un passo a Ordini" }, "+ passo")), '<button aria-label="Aggiungi un passo a Ordini" type="button" class="b-add" data-b="add">+ passo</button>');
});

test("tag, chip di ruoli e strumenti con la loro ×, punti della legenda, il rombo", () => {
  assert.equal(html(h(Tag, null, "nuovo")), '<span class="b-tag" data-b="tag">nuovo</span>');
  for (const [tone, css] of [["amber", "b-amber"], ["crit", "b-crit"], ["ink", "b-ink"], ["line", "b-line"]] as const) {
    assert.equal(html(h(Tag, { tone }, "x")), `<span class="b-tag ${css}" data-b="tag">x</span>`);
  }
  assert.equal(html(h(Chip, null, "Buyer")), '<span class="b-chip" data-b="chip">Buyer</span>');
  assert.match(html(h(Chip, { tool: true, onRemove() {} }, "Gestionale")), /^<span class="b-chip b-tool" data-b="chip">Gestionale<button type="button" aria-label="Togli Gestionale" title="Togli Gestionale"><svg/);
  assert.match(html(h(Chip, { onRemove() {}, removeLabel: "Togli il ruolo" }, createElement("b", null, "Buyer"))), /aria-label="Togli il ruolo"/);
  let removed = 0;
  const chip = Chip({ onRemove: () => void (removed += 1), children: "Buyer" });
  // La «×» porta prima il fuoco al chip vicino (ui/focus.ts): qui il controllo premuto non ha il fuoco, e niente si muove.
  (buttonsOf(chip)[0].props.onClick as (event: unknown) => void)({ currentTarget: { ownerDocument: { activeElement: null } } });
  assert.equal(removed, 1);
  assert.match(readFileSync(new URL("./atoms.tsx", import.meta.url), "utf8"), /focusBeforeRemoving\(event\.currentTarget as unknown as FocusNode, '\[data-b="chip"\]'\);\s+p\.onRemove\?\.\(\);/);

  assert.equal(html(h(Dot, { tone: "crit" })), '<i class="b-adot" data-tone="crit" aria-hidden="true" data-b="dot"></i>');
  assert.equal(html(h(Dot, { tone: "innovate" })), '<i class="b-adot" data-tone="innovate" aria-hidden="true" data-b="dot"></i>');
  assert.equal(html(h(Dot, { tone: "amber", diamond: true })), '<i class="b-adot b-diamond" aria-hidden="true" data-b="dot"></i>');
});

test("i badge: lo stream nel suo colore e con il suo nome (P23, P28); il grigio dell'esposizione; la pillola della decisione (P25)", () => {
  assert.equal(html(h(StreamBadge, { stream: "automate" })), '<span class="b-abadge" data-stream="automate" data-b="stream-badge" title="Automate">Automatizzare</span>');
  assert.equal(html(h(StreamBadge, { stream: "differentiate", small: true })), '<span class="b-abadge b-small" data-stream="differentiate" data-b="stream-badge" title="Differentiate">Differenziare</span>');
  assert.equal(html(h(ExposureBadge, { pct: 34.4 })), '<span class="b-abadge b-auto" data-b="exposure-badge">AI 34%</span>');
  assert.equal(html(h(ExposureBadge, { pct: 0, small: true })), '<span class="b-abadge b-auto b-small" data-b="exposure-badge">AI 0%</span>');
  assert.equal(html(h(GatePill, { label: "Conferma dell'ordine" })), '<span class="b-gate" data-b="gate">Conferma dell&#x27;ordine</span>');
  assert.equal(html(h(GatePill, { label: null })), '<span class="b-gate" data-b="gate">Decide una persona</span>');
  assert.equal(html(h(GatePill, { label: "  " })), '<span class="b-gate" data-b="gate">Decide una persona</span>');
});

test("i chip di stato, i riquadri dei numeri, la legenda", () => {
  for (const [tone, css] of [["neutral", "b-st-chip"], ["ok", "b-st-chip b-ok"], ["wait", "b-st-chip b-wait"], ["check", "b-st-chip b-ver"]] as const) {
    assert.equal(html(h(StatusChip, { tone }, "In corso")), `<span class="${css}" data-tone="${tone}" data-b="status-chip">In corso</span>`);
  }
  const kpis = html(h(Kpis, { items: [{ value: "12", label: "passi in 3 processi" }, { value: "28,5 h", label: "ore a settimana" }] }));
  assert.equal(
    kpis,
    '<div class="b-kpis" data-b="kpis"><div class="b-kpi"><div class="b-kv">12</div><div class="b-kl">passi in 3 processi</div></div><div class="b-kpi"><div class="b-kv">28,5 h</div><div class="b-kl">ore a settimana</div></div></div>',
  );
  const legend = html(h(Legend, null, h(LegendItem, { dot: h(Dot, { tone: "crit" }) }, "attrito forte")));
  assert.equal(legend, '<div class="b-legend" data-b="legend"><span data-b="legend-item"><i class="b-adot" data-tone="crit" aria-hidden="true" data-b="dot"></i>attrito forte</span></div>');
});

test("un chip che filtra o evidenzia: aria-pressed, e il clic arriva a chi lo usa (P45, P61, P85)", () => {
  assert.equal(html(h(FilterChip, { pressed: true, onToggle() {} }, "Evidenzia attriti")), '<button type="button" class="b-fchip" aria-pressed="true" data-b="filter-chip">Evidenzia attriti</button>');
  assert.match(html(h(FilterChip, { pressed: false, onToggle() {}, dot: h(Dot, { tone: "automate" }) }, "Automate")), /aria-pressed="false" data-b="filter-chip"><i class="b-adot" data-tone="automate"/);
  let toggled = 0;
  (buttonsOf(FilterChip({ pressed: false, onToggle: () => void (toggled += 1), children: "Tutti" }))[0].props.onClick as () => void)();
  assert.equal(toggled, 1);
});

test("i dettagli a richiesta: la sezione chiusa con «+», il titolo e il conteggio; la prima frase e «Dettagli» (P34, P35)", () => {
  assert.equal(
    html(h(Section, { title: "Chi fa cosa e con quali strumenti", hint: "4 ruoli · 6 strumenti" }, "tabelle")),
    '<details class="b-sec" data-b="section"><summary>Chi fa cosa e con quali strumenti<small>4 ruoli · 6 strumenti</small></summary><div class="b-body">tabelle</div></details>',
  );
  assert.match(html(h(Section, { title: "Aperta", defaultOpen: true }, "x")), /^<details class="b-sec" open="" data-b="section">/);
  assert.equal(
    html(h(MoreText, { text: "Le richieste arrivano in tre modi. Nessuno le conta. Il resto si perde." })),
    '<div data-b="more"><span>Le richieste arrivano in tre modi.</span><details class="b-more-t"><summary>Dettagli</summary><span>Nessuno le conta. Il resto si perde.</span></details></div>',
  );
  assert.equal(html(h(MoreText, { text: "Una frase sola." })), '<div data-b="more"><span>Una frase sola.</span></div>');
});

test("la tabella che sul telefono diventa blocchi: le colonne prima dei valori (P82); la riga che porta alla pagina del dettaglio (P42)", () => {
  const table = html(h(StackTable, { columns: ["Ruolo", "Passi"], rows: [["Buyer", "A1, A2"], ["Magazzino", "B1"]] }));
  assert.equal(
    table,
    '<div class="b-tscroll" data-b="table"><table class="b-tbl b-stack"><thead><tr><th scope="col">Ruolo</th><th scope="col">Passi</th></tr></thead><tbody><tr><td>Buyer</td><td data-l="Passi">A1, A2</td></tr><tr><td>Magazzino</td><td data-l="Passi">B1</td></tr></tbody></table></div>',
  );
  const row = html(h(RowLink, { href: "/dashboard/ws/mapping/u1", accent: "innovate", label: "Apri la mappa di Ufficio acquisti" }, "contenuto"));
  assert.equal(row, '<a class="b-crow" data-accent="innovate" aria-label="Apri la mappa di Ufficio acquisti" data-b="row" href="/dashboard/ws/mapping/u1">contenuto</a>');
  assert.doesNotMatch(html(h(RowLink, { href: "/x", accent: null, label: "Apri" }, "c")), /data-accent/);
});

test("i pezzi della board non scrivono testi né colori propri: le scritte vengono da text.ts o da chi li usa", () => {
  const dir = new URL("./", import.meta.url);
  const sources = readdirSync(dir).filter((file) => file.endsWith(".tsx"));
  assert.deepEqual(sources.sort(), ["atoms.tsx", "drawer.tsx", "edit.tsx", "frame.tsx", "map.tsx"]);
  for (const file of sources) {
    const source = readFileSync(new URL(file, dir), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    // Nessun testo con lettere scritto nel markup, nessuna etichetta scritta a mano.
    // (Il `>` di un tag, non quello di una freccia `=>`, di un confronto `a > b` o di un tipo `Array<T> x`.)
    assert.doesNotMatch(source, /(?<![=\-\s])>\s*[\p{L}][^<>{}]*</u, `${file}: un testo scritto nel markup`);
    assert.doesNotMatch(source, /\b(aria-label|title|placeholder|alt)="[^"]*\p{L}/u, `${file}: un'etichetta scritta a mano`);
    // Nessun colore: solo le classi di board.css (che usano i token della board).
    assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(|className="[^"]*\b(text|bg|border)-/, `${file}: un colore`);
    assert.doesNotMatch(source, /import\s+["'][^"']+\.css["']/, `${file}: un foglio lo importa solo il layout`);
  }
});
