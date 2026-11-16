import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { enableTsxImports } from "../../use-cases/detail/referent/tsx-test-loader.ts";

// Il drawer della board (docs/mappatura/MAPPATURA-BOARD-PIANO.md §4.9; P20, P27, P29–P33, F2). Il dialogo di Base UI
// non si disegna sul server (sta in un portale): la sua testa, il corpo e il posto del toast si provano con
// `DrawerStatic`, che usa gli stessi pezzi; il dialogo si prova dal suo sorgente.

await enableTsxImports();
const { BOARD_ROOT_SELECTOR, Compare, Drawer, DrawerColumns, DrawerList, DrawerStatic, Human, drawerInitialFocus } = await import("./drawer.tsx");

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);
/** `createElement` con i figli dopo le props: il tipo di React li vuole tra le props quando un componente li chiede. */
const h = <P extends object>(type: (props: P) => ReactNode, props: Omit<P, "children"> | null = null, ...children: ReactNode[]) =>
  createElement(type as unknown as FunctionComponent<Omit<P, "children">>, props, ...children);

test("il drawer aperto: velo, role=dialog con il titolo come nome, la riga del contesto, il titolo in serif, «Chiudi», il corpo e il toast", () => {
  const out = html(h(DrawerStatic, { wide: true, context: "Dall'ordine alla consegna · A2", title: "Raccolta delle richieste" }, "corpo"));
  assert.match(out, /^<div class="b-scrim b-on" data-b="scrim"><\/div><div class="b-drawer b-wide b-on" role="dialog" aria-modal="true" aria-labelledby="([^"]+)" data-b="drawer">/);
  const labelledBy = out.match(/aria-labelledby="([^"]+)"/)![1];
  assert.match(out, new RegExp(`<div class="b-dr-head"><div><div class="b-dr-sub">Dall&#x27;ordine alla consegna · A2</div><h2 class="b-dr-t" id="${labelledBy.replace(/[^\w-]/g, "\\$&")}">Raccolta delle richieste</h2></div><button type="button" class="b-btn b-x" data-b="drawer-close">Chiudi</button></div>`));
  assert.match(out, /<div class="b-dr-body">corpo<\/div><div class="b-toast" role="status" aria-live="polite" data-b="toast"><\/div><\/div>$/);
  // La forma stretta (540 px): i passi dai documenti, l'assistente sotto 1280 px, la mappa come testo.
  assert.match(html(h(DrawerStatic, { context: "Assistente", title: "Passi dai documenti" }, null)), /class="b-drawer b-on" role="dialog"/);
});

test("il dialogo: Base UI, modale, dentro la radice della board; velo e pannello con le classi del riferimento; la stessa testa", () => {
  // Sul server il portale non disegna niente, e niente si rompe.
  assert.equal(html(h(Drawer, { open: true, onClose() {}, context: "c", title: "t" }, "corpo")), "");
  assert.equal(html(h(Drawer, { open: false, onClose() {}, context: "c", title: "t" }, "corpo")), "");
  const source = readFileSync(new URL("./drawer.tsx", import.meta.url), "utf8");
  const drawer = source.slice(source.indexOf("export function Drawer("), source.indexOf("export function DrawerStatic("));
  assert.equal(BOARD_ROOT_SELECTOR, "[data-board-root]");
  assert.match(drawer, /<Dialog\.Root\s+open=\{p\.open\}\s+onOpenChange=\{\(open\) => \{\s+if \(!open\) p\.onClose\(\);\s+\}\}/, "Escape e il clic sul velo chiudono, con onClose");
  assert.match(drawer, /<Dialog\.Portal container=\{root \?\? undefined\}>/, "il portale sta nella radice della board");
  assert.match(drawer, /<Dialog\.Backdrop className=\{\(state\) => cx\("b-scrim", shown\(state\) && "b-on"\)\}/);
  assert.match(drawer, /<Dialog\.Popup className=\{\(state\) => cx\("b-drawer", p\.wide && "b-wide", shown\(state\) && "b-on"\)\} aria-labelledby=\{titleId\} initialFocus=\{initialFocus\}/);
  assert.match(drawer, /<DrawerFrame context=\{p\.context\} title=\{p\.title\} titleId=\{titleId\} toastHost=\{toastHost\} onClose=\{p\.onClose\} closeRef=\{closeRef\} titleRef=\{titleRef\} bodyRef=\{bodyRef\}>/);
  // Il fuoco all'apertura: «Chiudi», il campo del titolo di un passo appena aggiunto (P30), o il primo campo del corpo.
  assert.match(drawer, /const initialFocus = \(\) => drawerInitialFocus\(p\.initialFocus, \{ title: titleRef\.current, body: bodyRef\.current, close: closeRef\.current \}\);/);
  // Il toast sta nel drawer finché è aperto: fuori, la pagina è inerte.
  assert.match(drawer, /useClaimToastHost\(toastHost, p\.open\);/);
  assert.doesNotMatch(drawer, /modal=\{false\}|disablePointerDismissal/, "modale, e il clic sul velo chiude");
});

test("i blocchi del drawer: le colonne, l'etichetta in mono con il suo contenuto, oggi accanto alla classificazione, «Decide una persona»", () => {
  assert.equal(html(h(DrawerColumns, null, "blocchi")), '<div class="b-dr-cols" data-b="drawer-cols">blocchi</div>');
  assert.equal(html(h(DrawerList, { label: "Attività" }, "note")), '<div data-b="drawer-list"><p class="b-k">Attività</p>note</div>');
  assert.equal(html(h(DrawerList, { label: "Mai", never: true }, "x")), '<div data-b="drawer-list"><p class="b-k b-never">Mai</p>x</div>');
  assert.equal(
    html(h(Compare, { was: "Si fa a mano.", now: "Si automatizza.", wasLabel: "Oggi", nowLabel: "Classificazione" })),
    // L'etichetta sopra la riga grigia o dell'accento, non dentro: la riga comincia sotto di lei, come sul riferimento.
    '<div class="b-compare" data-b="compare"><div><p class="b-k">Oggi</p><div class="b-was">Si fa a mano.</div></div><div><p class="b-k">Classificazione</p><div class="b-now">Si automatizza.</div></div></div>',
  );
  assert.equal(html(h(Human, { label: "Decide una persona" }, "Il buyer conferma l'ordine.")), '<div class="b-human" data-b="human"><b>Decide una persona</b>Il buyer conferma l&#x27;ordine.</div>');
  // Senza nome della decisione, niente etichetta: il blocco sopra dice già «Decide una persona».
  for (const label of [null, undefined, "  "]) assert.equal(html(h(Human, { label }, "Il buyer conferma l'ordine.")), '<div class="b-human" data-b="human">Il buyer conferma l&#x27;ordine.</div>');
});

test("il fuoco all'apertura: «Chiudi»; il primo campo del titolo o del corpo quando chiesto, e «Chiudi» se non c'è", () => {
  const close = { name: "chiudi" } as unknown as HTMLElement;
  const field = { name: "campo" } as unknown as HTMLElement;
  const holding = (element: HTMLElement | null) => ({ querySelector: () => element }) as unknown as Pick<ParentNode, "querySelector">;
  const empty = holding(null);
  assert.equal(drawerInitialFocus(undefined, { title: holding(field), body: holding(field), close }), close);
  assert.equal(drawerInitialFocus("close", { title: holding(field), body: holding(field), close }), close);
  assert.equal(drawerInitialFocus("title", { title: holding(field), body: empty, close }), field);
  // La mappa come testo: il testo da copiare prende il fuoco subito, senza aspettare un timer (P62).
  assert.equal(drawerInitialFocus("body", { title: empty, body: holding(field), close }), field);
  assert.equal(drawerInitialFocus("body", { title: empty, body: empty, close }), close);
  assert.equal(drawerInitialFocus("title", { title: null, body: null, close: null }), true);
});
