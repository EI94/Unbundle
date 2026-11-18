import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { enableTsxImports } from "../use-cases/detail/referent/tsx-test-loader.ts";

// (Rilascio 10, ondata 1 · docs/ui-10/PROPOSTA-10.md §1 regola 7) `useSubmitConfirmation`, il modulo che chiede prima
// di partire, con React vero: un componente che usa l'aiuto, reso da `react-dom/client` in una radice senza DOM (il
// componente non disegna niente, la finestra no), e un modulo finto che a `requestSubmit` risponde come il browser,
// mandando l'invio al suo gestore con lo stesso pulsante. L'azione non parte prima della conferma, «Annulla» non fa
// niente, e parte una volta sola. Dati inventati.

type Confirmation = { open: boolean; target: string | null; ask(event: unknown, target: string): boolean; confirm(): void; onOpenChange(open: boolean): void };
type Act = (callback: () => void) => void;

const noop = () => {};
/** Il minimo che `react-dom/client` legge per una radice che non disegna niente: la finestra, il documento, il contenitore. */
const fakeWindow: Record<string, unknown> = { event: undefined, HTMLIFrameElement: class {} };
const fakeDocument = { nodeType: 9, nodeName: "#document", defaultView: fakeWindow, activeElement: null, body: null, addEventListener: noop, removeEventListener: noop };
fakeWindow.document = fakeDocument;
const container = { nodeType: 1, nodeName: "DIV", tagName: "DIV", ownerDocument: fakeDocument, addEventListener: noop, removeEventListener: noop, textContent: "" };
/** I pulsanti di un modulo: `submitterOf` riconosce il pulsante che aveva mandato il modulo. */
class FakeButton {
  form: unknown;
  constructor(form: unknown) {
    this.form = form;
  }
}
class FakeInput {}
const GLOBALS = { IS_REACT_ACT_ENVIRONMENT: true, window: fakeWindow, HTMLButtonElement: FakeButton, HTMLInputElement: FakeInput };

let act: Act;
let root: { render(element: unknown): void; unmount(): void };
let latest: Confirmation;

before(async () => {
  await enableTsxImports();
  const { useSubmitConfirmation } = (await import("../ui/confirm-dialog.tsx")) as unknown as { useSubmitConfirmation: () => Confirmation };
  const react = await import("react");
  Object.assign(globalThis, GLOBALS);
  const { createRoot } = (await import("react-dom/client")) as unknown as { createRoot(container: unknown): typeof root };
  act = react.act as unknown as Act;
  function Harness() {
    latest = useSubmitConfirmation();
    return null;
  }
  root = createRoot(container);
  act(() => root.render(react.createElement(Harness)));
});

after(() => {
  act(() => root.unmount());
  for (const key of Object.keys(GLOBALS)) delete (globalThis as Record<string, unknown>)[key];
});

/**
 * Un modulo con il suo gestore, come nei componenti: `if (!confirmation.ask(event, target)) return;`, poi l'azione.
 * `requestSubmit` lo rimanda come il browser; con un campo non valido (`valid: false`) l'invio non parte.
 */
function formWith(target: string) {
  const runs: string[] = [];
  const requested: unknown[] = [];
  let prevented = 0;
  const form = {
    valid: true,
    requestSubmit(submitter?: unknown) {
      requested.push(submitter);
      if (form.valid) submit(submitter ?? null);
    },
  };
  function submit(submitter: unknown) {
    const event = { preventDefault: () => (prevented += 1), currentTarget: form, nativeEvent: { submitter } };
    if (!latest.ask(event, target)) return;
    runs.push(target);
  }
  const button = new FakeButton(form);
  return { form, button, runs, requested, prevented: () => prevented, click: (from: unknown = button) => act(() => submit(from)) };
}

test("l'azione non parte prima della conferma; confermata, parte con lo stesso pulsante e la finestra si chiude", () => {
  const f = formWith("Rilevazione XX-0001");
  f.click();
  assert.deepEqual(f.runs, [], "il primo invio si ferma");
  assert.equal(f.prevented(), 1, "e il modulo non parte");
  assert.equal(latest.open, true);
  assert.equal(latest.target, "Rilevazione XX-0001", "la finestra sa che cosa chiedere");
  act(() => latest.confirm());
  assert.deepEqual(f.runs, ["Rilevazione XX-0001"]);
  assert.deepEqual(f.requested, [f.button], "lo stesso modulo, dallo stesso pulsante");
  assert.equal(f.prevented(), 1, "il secondo invio passa");
  assert.equal(latest.open, false);
  assert.equal(latest.target, null);
});

test("«Annulla», Esc o un clic fuori non fanno niente: niente parte, e il prossimo invio chiede di nuovo", () => {
  const f = formWith("Rilevazione XX-0002");
  f.click();
  assert.equal(latest.open, true);
  act(() => latest.onOpenChange(false));
  assert.equal(latest.open, false);
  assert.deepEqual([f.runs, f.requested], [[], []]);
  act(() => latest.confirm());
  assert.deepEqual([f.runs, f.requested], [[], []], "a finestra chiusa non c'è niente da confermare");
  f.click();
  assert.deepEqual(f.runs, []);
  assert.equal(latest.open, true, "chiede di nuovo");
  act(() => latest.onOpenChange(false));
});

test("parte una volta sola: ogni invio chiede, anche dopo una conferma o un modulo che non è partito", () => {
  const f = formWith("Rilevazione XX-0003");
  f.click();
  act(() => latest.confirm());
  act(() => latest.confirm());
  assert.deepEqual(f.runs, ["Rilevazione XX-0003"], "una seconda conferma, dopo, non rimanda il modulo");
  assert.equal(f.requested.length, 1);
  f.click();
  assert.deepEqual(f.runs, ["Rilevazione XX-0003"], "la conferma valeva per quell'invio solo");
  assert.equal(latest.open, true);
  // Un campo non valido: il browser non manda il modulo, e il prossimo invio non passa senza chiedere.
  f.form.valid = false;
  act(() => latest.confirm());
  assert.equal(f.requested.length, 2);
  f.form.valid = true;
  f.click();
  assert.deepEqual(f.runs, ["Rilevazione XX-0003"]);
  assert.equal(latest.open, true);
  // Un pulsante di un altro modulo non si riusa: il modulo riparte da solo.
  act(() => latest.onOpenChange(false));
  f.click(new FakeButton({}));
  act(() => latest.confirm());
  assert.equal(f.requested.at(-1), undefined);
  assert.deepEqual(f.runs, ["Rilevazione XX-0003", "Rilevazione XX-0003"]);
});
