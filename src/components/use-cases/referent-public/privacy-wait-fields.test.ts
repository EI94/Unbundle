import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { installAppModules } from "../../../lib/ai/claude-test-kit.ts";
import type { ReferentAskView, ReferentFileView, ReferentQuestionView } from "../../../lib/use-cases/referent/contract.ts";
import { REFERENT_ERROR_MESSAGES, REFERENT_PUBLIC_TEXT } from "../../../lib/use-cases/referent/labels.ts";
import { enableTsxImports } from "../detail/referent/tsx-test-loader.ts";
import { questionSections } from "./public-view-render.ts";

// (Rilascio 9b) I campi veri della pagina del referente, su un React minimo e senza DOM, quando una scrittura aspetta
// l'informativa (503 «informativa_aggiornata» dal server nuovo, 409 «informativa_da_leggere» da uno di prima): la domanda
// tiene il testo e non riprova da sola; il caricamento e «Togli» non dicono «Prima premi «Iniziamo».» sotto un pulsante
// che non c'è; il campo sotto una risposta tiene il messaggio. In tutti i casi la pagina mostra di nuovo l'informativa
// (`onPrivacyWait`). Il server risponde con un `fetch` finto. Dati inventati.

type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void };
type Element = { type: unknown; key?: string | null; props: Record<string, unknown> };

let ids = 0;
/** Un componente montato sul React minimo: `props` si cambiano come farebbe il genitore, `render()` ridisegna. */
function mount<P extends object>(component: (props: P) => unknown, initial: P) {
  const props = { ...initial };
  const slots: Slot[] = [];
  let at = 0;
  let effects: Array<() => void> = [];
  const same = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) => Boolean(a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i])));
  const runtime = {
    useState(init: unknown) {
      const slot = (slots[at] ??= { value: typeof init === "function" ? (init as () => unknown)() : init });
      at += 1;
      return [slot.value, (next: unknown) => void (slot.value = typeof next === "function" ? (next as (v: unknown) => unknown)(slot.value) : next)];
    },
    useReducer(reducer: (s: unknown, a: unknown) => unknown, arg: unknown, init?: (a: unknown) => unknown) {
      const slot = (slots[at] ??= { value: init ? init(arg) : arg });
      at += 1;
      return [slot.value, (action: unknown) => void (slot.value = reducer(slot.value, action))];
    },
    useRef(value: unknown) {
      const slot = (slots[at] ??= { value: { current: value } });
      at += 1;
      return slot.value;
    },
    useId() {
      const slot = (slots[at] ??= { value: `:r${(ids += 1)}:` });
      at += 1;
      return slot.value;
    },
    useMemo(fn: () => unknown, deps: readonly unknown[]) {
      const slot = slots[at];
      if (slot && same(slot.deps, deps)) {
        at += 1;
        return slot.value;
      }
      const value = fn();
      slots[at] = { value, deps };
      at += 1;
      return value;
    },
    useEffect(fn: () => void | (() => void), deps?: readonly unknown[]) {
      const previous = slots[at];
      if (previous && same(previous.deps, deps)) {
        at += 1;
        return;
      }
      const slot: Slot = { deps };
      slots[at] = slot;
      at += 1;
      effects.push(() => {
        previous?.cleanup?.();
        const cleanup = fn();
        slot.cleanup = typeof cleanup === "function" ? cleanup : undefined;
      });
    },
  };
  return {
    props,
    render(): Element {
      at = 0;
      effects = [];
      (globalThis as { __miniReact?: unknown }).__miniReact = runtime;
      const tree = component(props) as Element;
      for (const effect of effects) effect();
      return tree;
    },
  };
}

const REACT = `const r = () => globalThis.__miniReact;
export function useState(init) { return r().useState(init); }
export function useReducer(reducer, arg, init) { return r().useReducer(reducer, arg, init); }
export function useRef(value) { return r().useRef(value); }
export function useId() { return r().useId(); }
export function useMemo(fn, deps) { return r().useMemo(fn, deps); }
export function useCallback(fn, deps) { return r().useMemo(() => fn, deps); }
export function useEffect(fn, deps) { r().useEffect(fn, deps); }`;
const JSX = `export function jsx(type, props, key) { return { type, key: key ?? null, props: props ?? {} }; }
export const jsxs = jsx;
export const Fragment = "frammento";`;
const screens = (...names: string[]) => names.map((name) => `export function ${name}() { return null; }`).join("\n");

await installAppModules({
  react: REACT,
  "react/jsx-runtime": JSX,
  "@/components/ui/button": screens("Button"),
  "lucide-react": screens("Check", "FileText", "Loader2", "Paperclip", "X", "Download"),
  "@/components/uc/referente/inputs/fields": `export const TEXTAREA_CLASS = "campo";`,
  "@/components/uc/referente/screen": `export const SECONDARY_CLASS = "secondario"; export const TEXT_BUTTON_CLASS = "testo";`,
  // La domanda vera, con i suoi file finti; i file veri si provano da soli (`./attachments.tsx`).
  "./attachments": screens("Attachments"),
  "./template-downloads": screens("TemplateDownloads"),
});
await enableTsxImports();
const { OpenQuestionCard } = await import("./question-card.tsx");
const { Attachments } = await import("./attachments.tsx");
const { ThreadItem } = await import("./thread.tsx");
const StubAttachments: unknown = (await import("./attachments")).Attachments;

Object.assign(globalThis, { window: { addEventListener() {}, removeEventListener() {}, location: { reload() {} } } });

const TOKEN = "ucq_ABCDEFGHabcdefgh0123456789_-xy";
const NEED = "55555555-0000-4000-8000-000000000001";
const QUESTION: ReferentQuestionView = { needId: NEED, position: 1, title: "Quante richieste arrivano al mese?", state: "aperta", fileRequired: false, draft: null, answer: null, files: [] };
const SECTION = questionSections({ questions: [QUESTION] } as unknown as ReferentAskView)[0];

type Reply = { status: number; body: unknown };
const ok = (data: unknown): Reply => ({ status: 200, body: { ok: true, data } });
const refused = (status: number, error: string): Reply => ({ status, body: { ok: false, error, message: REFERENT_ERROR_MESSAGES[error] ?? "x" } });

/** Risposte per «METODO percorso» (dopo `/api/rispondi/<token>`), in ordine: l'ultima si ripete. */
function server(t: TestContext, replies: Record<string, Reply[]>) {
  const writes: { route: string; body: unknown }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit = {}) => {
    const route = `${init.method ?? "GET"} ${String(url).replace(`/api/rispondi/${encodeURIComponent(TOKEN)}/`, "")}`;
    writes.push({ route, body: typeof init.body === "string" ? JSON.parse(init.body) : null });
    const queue = replies[route] ?? [ok({})];
    const reply = queue.length > 1 ? queue.shift()! : queue[0];
    return Response.json(reply.body, { status: reply.status });
  });
  return writes;
}

async function settle() {
  for (let i = 0; i < 30; i++) await new Promise((resolve) => setImmediate(resolve));
}

const isElement = (node: unknown): node is Element => Boolean(node && typeof node === "object" && "props" in node);
function find(node: unknown, match: (e: Element) => boolean): Element | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = find(child, match);
      if (found) return found;
    }
    return null;
  }
  if (!isElement(node)) return null;
  if (match(node)) return node;
  return find(node.props.children, match);
}
function one(node: unknown, match: (e: Element) => boolean, what: string): Element {
  const found = find(node, match);
  assert.ok(found, what);
  return found;
}
const answerField = (e: Element) => e.type === "textarea" && String(e.props.id).endsWith("-text");
const statusLine = (e: Element) => e.type === "p" && String(e.props.id).endsWith("-stato");
const text = (e: Element) => [e.props.children].flat().join("");

function openCard(t: TestContext) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.parse("2026-11-18T19:00:00Z") });
  const flushes: (() => Promise<boolean>)[] = [];
  const calls = { wait: 0, stale: [] as string[] };
  const card = mount(OpenQuestionCard as unknown as (props: Record<string, unknown>) => unknown, {
    token: TOKEN,
    section: SECTION,
    clientMode: false,
    issues: [],
    disabled: false,
    registerFlush: (_: string, flush: (() => Promise<boolean>) | null) => void (flush && flushes.push(flush)),
    onStale: (code: string) => void calls.stale.push(code),
    onPrivacyWait: () => void (calls.wait += 1),
    paused: false,
  });
  return { card, flushes, calls };
}

for (const [label, wait] of [
  ["503 «informativa_aggiornata» (il server nuovo)", refused(503, "informativa_aggiornata")],
  ["409 «informativa_da_leggere» (un server di prima)", refused(409, "informativa_da_leggere")],
] as const) {
  test(`una domanda il cui salvataggio aspetta l'informativa, ${label}: il testo resta, nessuna riga, nessun tentativo da solo; dopo «Iniziamo» parte`, async (t) => {
    const writes = server(t, { "POST draft": [wait, ok({ savedAt: "2026-11-18T20:00:00.000Z", warnings: [] })] });
    const { card, flushes, calls } = openCard(t);
    let tree = card.render();
    (one(tree, answerField, "il campo della risposta").props.onChange as (e: unknown) => void)({ target: { value: "Circa 40 al mese." } });
    card.render();
    t.mock.timers.tick(1500);
    await settle();
    tree = card.render();
    assert.deepEqual(writes.map((w) => w.route), ["POST draft"]);
    assert.equal(calls.wait, 1, "la pagina mostra di nuovo l'informativa");
    assert.deepEqual(calls.stale, [], "mai la domanda ricostruita dalla bozza del server");
    assert.equal(one(tree, answerField, "il campo").props.value, "Circa 40 al mese.", "il testo resta nel campo");
    assert.equal(text(one(tree, statusLine, "la riga dello stato")), "", "mai «Non salvato: riprova» per un'attesa");

    // L'informativa è sullo schermo (la pagina mette in pausa le domande): uscire dal campo non fa partire niente.
    card.props.paused = true;
    (one(tree, answerField, "il campo").props.onBlur as () => void)();
    card.render();
    t.mock.timers.tick(60_000);
    await settle();
    card.render();
    assert.equal(writes.length, 1, "nessun tentativo mentre l'informativa è sullo schermo");

    // «Iniziamo»: la pagina toglie la pausa e fa partire quello che aspetta.
    card.props.paused = false;
    card.render();
    assert.equal(await flushes.at(-1)!(), true);
    await settle();
    tree = card.render();
    assert.deepEqual(writes.map((w) => w.route), ["POST draft", "POST draft"]);
    assert.deepEqual(writes[1].body, writes[0].body, "la stessa bozza di prima");
    assert.equal(text(one(tree, statusLine, "la riga dello stato")), REFERENT_PUBLIC_TEXT.autosave.saved);
  });
}

test("un rifiuto vero della bozza resta quello di prima: «Non salvato: riprova» e, per una domanda chiusa, la pagina si rilegge", async (t) => {
  server(t, { "POST draft": [refused(409, "gia_inviata")] });
  const { card, calls } = openCard(t);
  (one(card.render(), answerField, "il campo").props.onChange as (e: unknown) => void)({ target: { value: "Altro" } });
  card.render();
  t.mock.timers.tick(1500);
  await settle();
  const tree = card.render();
  assert.equal(calls.wait, 0);
  assert.deepEqual(calls.stale, ["gia_inviata"]);
  assert.equal(text(one(tree, statusLine, "la riga dello stato")), REFERENT_PUBLIC_TEXT.autosave.error);
});

test("la domanda passa ai suoi file l'attesa dell'informativa", (t) => {
  const { card } = openCard(t);
  const files = one(card.render(), (e) => e.type === StubAttachments, "i file della domanda");
  assert.equal(typeof files.props.onPrivacyWait, "function");
});

const FILE: ReferentFileView = { id: "66666666-0000-4000-8000-000000000001", name: "volumi.csv", sizeBytes: 40, status: "pulito", message: null, submitted: false };

function openFiles(files: ReferentFileView[]) {
  const calls = { wait: 0, files: [] as unknown[] };
  const view = mount(Attachments as unknown as (props: Record<string, unknown>) => unknown, {
    token: TOKEN,
    needId: NEED,
    files,
    onFiles: (update: unknown) => void calls.files.push(update),
    clientMode: false,
    allowUpload: true,
    disabled: false,
    onPrivacyWait: () => void (calls.wait += 1),
  });
  return { view, calls };
}
const errorLine = (e: Element) => e.type === "p" && e.props.role === "alert";
const removeButton = (e: Element) => typeof e.props["aria-label"] === "string" && String(e.props["aria-label"]).startsWith("Togli");

test("un file che aspetta l'informativa: niente «Prima premi «Iniziamo».», la pagina mostra l'informativa", async (t) => {
  const writes = server(t, { "POST upload": [refused(503, "informativa_aggiornata")], "POST file-remove": [refused(409, "informativa_da_leggere")] });
  const { view, calls } = openFiles([FILE]);
  let tree = view.render();
  const input = one(tree, (e) => e.type === "input" && e.props.type === "file", "la scelta del file");
  (input.props.onChange as (e: unknown) => void)({ currentTarget: { files: [new File(["mese;fatture\nottobre;420\n"], "ottobre.csv", { type: "text/csv" })] } });
  await settle();
  tree = view.render();
  assert.deepEqual(writes.map((w) => w.route), ["POST upload"]);
  assert.equal(calls.wait, 1);
  assert.equal(find(tree, errorLine), null, "nessun messaggio sotto «Allega un file»");
  (one(tree, removeButton, "«Togli»").props.onClick as () => void)();
  await settle();
  tree = view.render();
  assert.deepEqual(writes.map((w) => w.route), ["POST upload", "POST file-remove"]);
  assert.equal(calls.wait, 2);
  assert.deepEqual(calls.files, [], "il file resta nell'elenco");
  assert.equal(find(tree, errorLine), null);
});

test("un rifiuto vero di «Togli» si dice ancora sotto i file", async (t) => {
  server(t, { "POST file-remove": [refused(409, "file_gia_inviato")] });
  const { view, calls } = openFiles([FILE]);
  (one(view.render(), removeButton, "«Togli»").props.onClick as () => void)();
  await settle();
  assert.equal(text(one(view.render(), errorLine, "il messaggio")), REFERENT_ERROR_MESSAGES.file_gia_inviato);
  assert.equal(calls.wait, 0);
});

test("il campo sotto una risposta: l'invio che aspetta l'informativa tiene il messaggio e non scrive niente sotto", async (t) => {
  const writes = server(t, { "POST doubt": [refused(503, "informativa_aggiornata")] });
  const calls = { wait: 0, stale: 0 };
  const item = ThreadItem({
    token: TOKEN,
    targetKey: "g",
    subject: "Caso di prova",
    messages: [],
    actions: ["doubt"],
    today: "2026-11-18",
    composer: "doubt",
    onComposer() {},
    primary: false,
    privacyGate: null,
    sent: false,
    onSent() {},
    onStale: () => void (calls.stale += 1),
    onPrivacyWait: () => void (calls.wait += 1),
  }) as Element;
  const composer = one(item, (e) => typeof e.type === "function" && (e.type as { name?: string }).name === "ThreadComposer", "il campo aperto");
  const field = mount(composer.type as (props: Record<string, unknown>) => unknown, composer.props);
  let tree = field.render();
  (one(tree, (e) => e.type === "textarea", "il testo").props.onChange as (e: unknown) => void)({ target: { value: "Cosa intendete per pratica?" } });
  tree = field.render();
  (one(tree, (e) => e.type === "form", "il modulo").props.onSubmit as (e: unknown) => void)({ preventDefault() {} });
  await settle();
  tree = field.render();
  assert.deepEqual(writes.map((w) => [w.route, w.body]), [["POST doubt", { anchor: "generale", text: "Cosa intendete per pratica?" }]]);
  assert.equal(calls.wait, 1, "la pagina mostra di nuovo l'informativa");
  assert.equal(calls.stale, 0);
  assert.equal(one(tree, (e) => e.type === "textarea", "il testo").props.value, "Cosa intendete per pratica?", "il messaggio resta");
  assert.equal(find(tree, (e) => e.type === "p" && String(e.props.id).endsWith("-errore")), null, "nessun messaggio sotto il campo");
});
