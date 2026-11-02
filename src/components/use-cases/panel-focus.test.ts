import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { focusPanelStart } from "./panel-focus.ts";

// Il pannello laterale (`?apri=`) che torna in cima appena aperto. Al telefono il pannello è più
// alto della finestra e scorre per conto suo: con il «Prossimo passo:» del rilascio 3 sporge fino a
// circa 150 px a 375 px, e «Apri la scheda» sta sotto il bordo. Base UI dava il fuoco iniziale al
// primo elemento, «Chiudi» in cima, nel primo fotogramma dopo l'apertura (prima che il pannello sia
// disegnato) e con lo scorrimento: se tra l'apertura e quel fotogramma il pannello era stato fatto
// scorrere tornava in cima. Una persona non lo vede; lo vedeva la sonda «history» di probe-stall,
// che fa scorrere il pannello in quell'intervallo. Dare il fuoco a «Chiudi» non ha mai bisogno di
// far scorrere il pannello: ora `initialFocus` glielo dà con `preventScroll` e Base UI non lo sposta
// più. La prova nel browser vero è la sonda del harness che fa scorrere il pannello appena compare.

/** Un elemento finto: annota le chiamate a focus() con le loro opzioni. */
function fake(name: string, calls: string[]) {
  return {
    focus(options?: FocusOptions) {
      calls.push(`${name} ${JSON.stringify(options ?? null)}`);
    },
  };
}

function setup() {
  const calls: string[] = [];
  const inside = { inside: true } as unknown as Node;
  const outside = { inside: false } as unknown as Node;
  const popup = { ...fake("pannello", calls), contains: (other: Node | null) => other === inside };
  const close = { ...fake("Chiudi", calls), closest: (selector: string) => (selector === "[role=dialog]" ? popup : null) };
  return { calls, inside, outside, close };
}

test("all'apertura il fuoco va a «Chiudi» subito e senza far scorrere il pannello; Base UI non lo sposta più", () => {
  const { calls, outside, close } = setup();
  // Aperto da un link della pagina (nessun Trigger): Base UI passa un tipo vuoto.
  for (const openType of ["", "mouse", "keyboard", "pen"]) {
    calls.length = 0;
    assert.equal(focusPanelStart(openType, close, outside), false, `${openType || "vuoto"}: false, Base UI non mette un altro fuoco al fotogramma dopo`);
    assert.deepEqual(calls, ['Chiudi {"preventScroll":true}'], openType || "vuoto");
  }
});

test("aperto con un tocco il fuoco va al pannello stesso, come Base UI (niente tastiera virtuale), sempre senza scorrere", () => {
  const { calls, outside, close } = setup();
  assert.equal(focusPanelStart("touch", close, outside), false);
  assert.deepEqual(calls, ['pannello {"preventScroll":true}']);
});

test("se il fuoco è già nel pannello resta dov'è", () => {
  const { calls, inside, close } = setup();
  assert.equal(focusPanelStart("", close, inside), false);
  assert.deepEqual(calls, []);
});

test("senza «Chiudi» (riferimento vuoto) lascia fare a Base UI: true, il suo comportamento predefinito", () => {
  const { calls, inside, outside } = setup();
  for (const active of [null, inside, outside]) {
    assert.equal(focusPanelStart("", null, active), true);
    assert.equal(focusPanelStart("touch", null, active), true);
  }
  assert.deepEqual(calls, []);
});

test("il pannello passa a Base UI il suo fuoco iniziale, su «Chiudi»: nessun fuoco con lo scorrimento all'apertura", () => {
  const source = readFileSync(new URL("./use-case-panel.tsx", import.meta.url), "utf8");
  assert.match(source, /^import \{ focusPanelStart \} from "\.\/panel-focus";$/m);
  const content = source.slice(source.indexOf("<SheetContent"), source.indexOf("</SheetHeader>"));
  assert.match(content, /initialFocus=\{\(openType\) => focusPanelStart\(openType, closeRef\.current, document\.activeElement\)\}/);
  assert.match(content, /data-slot="use-case-panel"/);
  assert.match(content, /<SheetClose ref=\{closeRef\} /, "«Chiudi» è l'elemento del fuoco iniziale");
  // Il pannello è lui stesso il riquadro che scorre: il fuoco con lo scorrimento lo riportava in cima.
  assert.match(content, /className="gap-0 overflow-y-auto /);
});
