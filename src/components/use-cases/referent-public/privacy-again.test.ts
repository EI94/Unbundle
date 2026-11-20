import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { installAppModules } from "../../../lib/ai/claude-test-kit.ts";
import type { ReferentAskView, ReferentNoticeView, ReferentQuestionView, ReferentThreadMessageView } from "../../../lib/use-cases/referent/contract.ts";
import { REFERENT_ERROR_MESSAGES, REFERENT_PRIVACY_NOTICE, privacyNoticeView } from "../../../lib/use-cases/referent/labels.ts";
import { enableTsxImports } from "../detail/referent/tsx-test-loader.ts";

// (Rilascio 9b) L'informativa cambia con un rilascio mentre il referente ha `/rispondi` aperta, oppure il server chiede
// di leggerla di nuovo. La pagina vera (`referent-ask-page.tsx`) gira qui su un React minimo, senza DOM: stato, ref ed
// effetti come in React, un render quando lo chiede il test. Le schede figlie sono finte (della pagina contano gli
// elementi, la loro posizione e le props che passa), il server risponde con un `fetch` finto. Niente di scritto si perde:
// le domande, i passi e i campi restano montati e nascosti, l'informativa torna con il testo del server, e un tocco su
// «Iniziamo» manda la prova del testo mostrato e fa ripartire quello che aspettava. Dati inventati (XX-0001).

type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void };
type Element = { type: unknown; key?: string | null; props: Record<string, unknown> };

/** Un componente montato sul React minimo: `render()` lo ridisegna con lo stato di adesso e fa girare gli effetti cambiati. */
function mount<P>(component: (props: P) => unknown, props: P) {
  const slots: Slot[] = [];
  let at = 0;
  let effects: Array<() => void> = [];
  const same = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) => Boolean(a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i])));
  const runtime = {
    useState(init: unknown) {
      const slot = (slots[at] ??= { value: typeof init === "function" ? (init as () => unknown)() : init });
      at += 1;
      const set = (next: unknown) => {
        slot.value = typeof next === "function" ? (next as (v: unknown) => unknown)(slot.value) : next;
      };
      return [slot.value, set];
    },
    useRef(value: unknown) {
      const slot = (slots[at] ??= { value: { current: value } });
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
export function useRef(value) { return r().useRef(value); }
export function useMemo(fn, deps) { return r().useMemo(fn, deps); }
export function useCallback(fn, deps) { return r().useMemo(() => fn, deps); }
export function useEffect(fn, deps) { r().useEffect(fn, deps); }`;
const JSX = `export function jsx(type, props, key) { return { type, key: key ?? null, props: props ?? {} }; }
export const jsxs = jsx;
export const Fragment = "frammento";`;
/** Le schede della pagina: qui contano solo i loro elementi e le loro props. */
const screens = (...names: string[]) => names.map((name) => `export function ${name}() { return null; }`).join("\n");

await installAppModules({
  react: REACT,
  "react/jsx-runtime": JSX,
  "@/components/ui/button": screens("Button"),
  "@/components/uc/referente/screen": `${screens("Notice")}\nexport const SECONDARY_CLASS = "secondario";`,
  "./privacy-card": `${screens("PrivacyCard", "PrivacyFooter")}\nexport const PRIVACY_TITLE_ID = "ucq-informativa";`,
  "./question-card": `${screens("QuestionCard")}\nexport const questionTitleId = (id) => \`ucq-domanda-\${id.toLowerCase()}-titolo\`;`,
  "./referent-steps": `${screens("ConfirmStep", "EstimateStep", "ImpactStep", "ReferentStepBar")}
export const stepTitleId = (step) => \`ucq-passo-\${step}-titolo\`;
export const benefitTitleId = (key) => \`ucq-beneficio-\${key}\`;
export const benefitCommentId = (key) => \`ucq-beneficio-\${key}-commento\`;`,
  "./state-card": screens("MessageCard", "PublicShell"),
  "./submit-bar": `${screens("SubmitBar")}\nexport const SUBMIT_ERROR_ID = "ucq-invio-errore";`,
  "./thread": `${screens("ClarificationCard", "SentDisclosure", "TeamReplyCard", "ThreadItem", "WriteToTeam")}\nexport const WRITE_KEY = "scrivi";\nexport const WRITE_ABOUT_ID = "ucq-scrivi-su";\nexport const WRITE_BUTTON_ID = "ucq-scrivi";\nexport const newsTitleId = (id) => \`ucq-novita-\${id.toLowerCase()}-titolo\`;`,
});
await enableTsxImports();
const { ReferentAskPage } = await import("./referent-ask-page.tsx");
const PrivacyCard: unknown = (await import("./privacy-card")).PrivacyCard;
const QuestionCard: unknown = (await import("./question-card")).QuestionCard;
const ConfirmStep: unknown = (await import("./referent-steps")).ConfirmStep;
const SubmitBar: unknown = (await import("./submit-bar")).SubmitBar;
const ThreadItem: unknown = (await import("./thread")).ThreadItem;
const ClarificationCard: unknown = (await import("./thread")).ClarificationCard;

// ── Il browser finto ─────────────────────────────────────────────────

const focused: string[] = [];
const fakeElement = (id: string) => ({ scrollIntoView() {}, focus: () => void focused.push(id) });
Object.assign(globalThis, {
  window: {
    location: { search: "", pathname: "/rispondi/prova", reload() {} },
    history: { pushState() {}, replaceState() {} },
    matchMedia: () => ({ matches: true }),
    addEventListener() {},
    removeEventListener() {},
  },
  document: {
    getElementById: (id: string) => fakeElement(id),
    querySelector: (selector: string) => (selector.includes("referent-thread-composer") ? fakeElement("campo-aperto") : null),
  },
});

// ── Il caso d'uso e le viste ─────────────────────────────────────────

const TOKEN = "ucq_ABCDEFGHabcdefgh0123456789_-xy";
const NEED = "55555555-0000-4000-8000-000000000001";
const CONTACT = "privacy@example.test";
const NOW_NOTICE: ReferentNoticeView = privacyNoticeView({ company: "Cliente di prova", expires: "18 dicembre 2026", requester: "Persona di prova", contact: CONTACT });
/** L'informativa di un rilascio che verrà: un'altra versione, un altro testo, che la pagina non ha dentro. */
const NEXT: ReferentNoticeView = { ...NOW_NOTICE, version: "ucq-2027-01-1", lead: "Abbiamo cambiato due cose.", summary: ["Primo punto nuovo.", "Secondo punto nuovo."] };

const OPEN: ReferentQuestionView = { needId: NEED, position: 1, title: "Quante richieste arrivano al mese?", state: "aperta", fileRequired: false, draft: null, answer: null, files: [] };
const SENT: ReferentQuestionView = { ...OPEN, state: "inviata", answer: { text: "Circa 40", dontKnow: false, alreadyAttached: false, comment: null, submittedAt: "2026-11-10T10:00:00.000Z" }, editable: true };

function view(over: Partial<ReferentAskView> = {}): ReferentAskView {
  return {
    state: "aperta",
    privacy: { accepted: true, version: NOW_NOTICE.version, contact: CONTACT, notice: NOW_NOTICE },
    company: "Cliente di prova",
    useCase: { code: "XX-0001", title: "Caso di prova" },
    requester: { name: "Persona di prova" },
    message: null,
    expiresOn: "2026-12-18",
    questions: [OPEN],
    upload: { clientMode: false },
    kind: "domande",
    check: null,
    thread: { followUp: false, open: true, messages: [] },
    ...over,
  };
}
/** Il server chiede di leggere `notice` (o, senza, una versione di cui la pagina non ha il testo). */
const unread = (notice: ReferentNoticeView | null, version = notice?.version ?? "ucq-2026-11-2"): ReferentAskView["privacy"] => ({
  accepted: false,
  version,
  contact: CONTACT,
  ...(notice ? { notice } : {}),
});

// ── Il server finto ──────────────────────────────────────────────────

type Call = { route: string; body: unknown };
type Reply = { status: number; body: unknown };
const ok = (data: unknown): Reply => ({ status: 200, body: { ok: true, data } });
const refused = (status: number, error: string): Reply => ({ status, body: { ok: false, error, message: REFERENT_ERROR_MESSAGES[error] ?? "x" } });
const WAIT = refused(503, "informativa_aggiornata");

/**
 * Risposte per «METODO percorso» (dopo `/api/rispondi/<token>`), in ordine: l'ultima si ripete. La vista (`GET`) è
 * `server.view`, che il test cambia come cambierebbe sul server. Le scritture registrate, con il corpo.
 */
function server(t: TestContext, replies: Record<string, Reply[]>, first: ReferentAskView) {
  const s = { view: first, writes: [] as Call[], reads: 0, offline: false };
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit = {}) => {
    const path = String(url).replace(`/api/rispondi/${encodeURIComponent(TOKEN)}`, "").replace(/^\//, "");
    const route = `${init.method ?? "GET"} ${path}`.trim();
    if (route === "GET") {
      s.reads += 1;
      if (s.offline) throw new TypeError("Failed to fetch");
      return Response.json({ ok: true, data: s.view });
    }
    s.writes.push({ route, body: init.body ? JSON.parse(String(init.body)) : null });
    const queue = replies[route] ?? [ok({})];
    const reply = queue.length > 1 ? queue.shift()! : queue[0];
    return Response.json(reply.body, { status: reply.status });
  });
  return s;
}

async function settle() {
  for (let i = 0; i < 30; i++) await new Promise((resolve) => setImmediate(resolve));
}

// ── L'albero ─────────────────────────────────────────────────────────

const isElement = (node: unknown): node is Element => Boolean(node && typeof node === "object" && "props" in node);

/** Il percorso (indici dei figli) fino al primo elemento che soddisfa `match`, oppure null. */
function pathTo(node: unknown, match: (e: Element) => boolean, path: number[] = []): number[] | null {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const found = pathTo(node[i], match, [...path, i]);
      if (found) return found;
    }
    return null;
  }
  if (!isElement(node)) return null;
  if (match(node)) return path;
  for (const key of ["children", "extra", "privacyGate"]) {
    const found = pathTo(node.props[key], match, [...path, key.length]);
    if (found) return found;
  }
  return null;
}

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
  for (const key of ["children", "extra", "privacyGate"]) {
    const found = find(node.props[key], match);
    if (found) return found;
  }
  return null;
}

const ofType = (type: unknown) => (e: Element) => e.type === type;
const slot = (name: string) => (e: Element) => e.props["data-slot"] === name;

function one(node: unknown, type: unknown, what: string): Element {
  const found = find(node, ofType(type));
  assert.ok(found, what);
  return found;
}

function open(initialView: ReferentAskView) {
  focused.length = 0;
  return mount(ReferentAskPage as unknown as (props: unknown) => unknown, { token: TOKEN, initialView, today: "2026-11-18", initialStep: null });
}

/** Due render: il secondo vede lo stato messo durante il primo (come React, che rifà il render subito). */
function show(page: ReturnType<typeof open>): Element {
  page.render();
  return page.render();
}

// ── Le prove ─────────────────────────────────────────────────────────

test("una bozza aspetta l'informativa nuova: la domanda resta montata e nascosta, l'informativa torna con il testo del server, «Iniziamo» manda la prova e la bozza riparte da sola", async (t) => {
  const s = server(t, { "POST privacy": [ok({ accepted: true })] }, view());
  const page = open(view());
  let tree = show(page);
  const card = one(tree, QuestionCard, "la domanda è sullo schermo");
  const where = pathTo(tree, ofType(QuestionCard));
  const flush = t.mock.fn(async () => true);
  (card.props.registerFlush as (needId: string, f: unknown) => void)(NEED, flush);

  // Il rilascio: il salvataggio della domanda risponde 503 «informativa_aggiornata» e la scheda lo dice alla pagina.
  s.view = view({ privacy: unread(NEXT) });
  (card.props.onPrivacyWait as () => void)();
  tree = show(page);
  assert.equal(one(tree, PrivacyCard, "subito l'informativa").props.busy, true, "senza «Iniziamo» finché non arriva il testo di adesso");
  await settle();
  tree = show(page);

  const gate = one(tree, PrivacyCard, "l'informativa è di nuovo sullo schermo");
  assert.deepEqual(gate.props.texts, NEXT, "con il testo che si accetta: quello del server, non quello della pagina");
  assert.equal(gate.props.again, true, "con la riga «Quello che hai scritto resta qui»");
  assert.equal(gate.props.busy, false);
  const content = find(tree, slot("referent-content"));
  assert.equal(content?.props.hidden, true, "le domande sono nascoste, non smontate");
  const kept = one(content, QuestionCard, "la domanda c'è ancora");
  assert.equal(kept.key, card.key, "la stessa chiave");
  assert.deepEqual(pathTo(tree, ofType(QuestionCard)), where, "nello stesso posto: React la tiene, con il testo scritto");
  assert.equal(kept.props.paused, true, "nessun salvataggio parte da solo mentre l'informativa è sullo schermo");
  assert.equal(s.writes.length, 0, "nessuna scrittura: solo la vista riletta");
  assert.equal(flush.mock.callCount(), 0);
  assert.equal(focused.at(-1), "ucq-informativa", "il fuoco sul titolo dell'informativa");

  (gate.props.onAccept as () => void)();
  await settle();
  tree = show(page);
  assert.deepEqual(
    s.writes.map((w) => [w.route, w.body]),
    [["POST privacy", { version: NEXT.version, shown: NEXT.version }]],
    "si accetta la versione del testo mostrato, con la prova",
  );
  assert.equal(flush.mock.callCount(), 1, "un tocco, e la bozza in attesa parte da sola");
  assert.equal(find(tree, ofType(PrivacyCard)), null);
  assert.equal(find(tree, slot("referent-content"))?.props.hidden, undefined, "le domande tornano");
  const back = one(tree, QuestionCard, "la stessa domanda");
  assert.equal(back.key, card.key);
  assert.deepEqual(pathTo(tree, ofType(QuestionCard)), where);
  assert.equal(back.props.paused, false);
  assert.equal(focused.at(-1), `ucq-domanda-${NEED}-titolo`, "il fuoco torna sulla domanda");
});

test("una vista senza il testo della versione da accettare (un server di un altro rilascio): «Ricarica la pagina», mai «Iniziamo»", async (t) => {
  const s = server(t, {}, view());
  const page = open(view());
  const card = one(show(page), QuestionCard, "la domanda");
  s.view = view({ privacy: unread(null, "ucq-2026-11-2") });
  (card.props.onPrivacyWait as () => void)();
  await settle();
  const tree = show(page);
  assert.equal(one(tree, PrivacyCard, "l'informativa").props.texts, null, "la pagina non ha quel testo: chiede di ricaricarsi");
  assert.equal(one(find(tree, slot("referent-content")), QuestionCard, "la domanda resta").key, card.key);
  assert.equal(s.writes.length, 0);
});

test("senza rete la vista non si rilegge: resta il testo che la pagina ha, con «Iniziamo» (il server accetta solo quello di adesso)", async (t) => {
  const s = server(t, {}, view());
  const page = open(view());
  const card = one(show(page), QuestionCard, "la domanda");
  s.offline = true;
  (card.props.onPrivacyWait as () => void)();
  await settle();
  const gate = one(show(page), PrivacyCard, "l'informativa");
  assert.deepEqual(gate.props.texts, NOW_NOTICE);
  assert.equal(gate.props.busy, false, "«Iniziamo» si può premere");
  assert.equal(one(find(show(page), slot("referent-content")), QuestionCard, "la domanda resta").key, card.key);
});

test("alla prima apertura: solo l'informativa, con il testo della vista; «Iniziamo» manda version e shown, poi le domande", async (t) => {
  // Un testo della stessa versione che la pagina non ha: la pagina mostra quello del server.
  const served = { ...NOW_NOTICE, lead: "Testo scritto dal server." };
  const first = view({ privacy: unread(served) });
  const s = server(t, { "POST privacy": [ok({ accepted: true })] }, first);
  const page = open(first);
  let tree = show(page);
  const gate = one(tree, PrivacyCard, "«Prima di iniziare»");
  assert.equal((gate.props.texts as ReferentNoticeView).lead, "Testo scritto dal server.");
  assert.equal(gate.props.again, false, "niente riga «resta qui» alla prima apertura");
  assert.equal(find(tree, slot("referent-content")), null, "niente domande, bozze o caricamenti prima di «Iniziamo»");
  (gate.props.onAccept as () => void)();
  await settle();
  tree = show(page);
  assert.deepEqual(s.writes, [{ route: "POST privacy", body: { version: REFERENT_PRIVACY_NOTICE.version, shown: REFERENT_PRIVACY_NOTICE.version } }]);
  assert.equal(find(tree, ofType(PrivacyCard)), null);
  one(tree, QuestionCard, "le domande dopo «Iniziamo»");
});

test("«Iniziamo» rifiutato perché il server ha un'altra versione: il riquadro passa a «Ricarica la pagina»", async (t) => {
  const first = view({ privacy: unread(NOW_NOTICE) });
  server(t, { "POST privacy": [refused(409, "informativa_cambiata")] }, first);
  const page = open(first);
  (one(show(page), PrivacyCard, "l'informativa").props.onAccept as () => void)();
  await settle();
  const gate = one(show(page), PrivacyCard, "l'informativa");
  assert.equal(gate.props.texts, null, "il testo sullo schermo non è quello da accettare: si ricarica");
  assert.equal(gate.props.error, null);
});

test("una bozza del passo «Il caso d'uso» aspetta l'informativa: il passo resta montato, la bozza si tiene e parte dopo «Iniziamo»", async (t) => {
  const check = {
    description: "Descrizione di prova.",
    benefits: null,
    draft: { confirm: null, note: null, estimate: null, timesPerMonth: null, minutesEach: null, stale: false, savedAt: null },
    submittedAt: null,
  };
  const first = view({ kind: "referente", check });
  const s = server(t, { "POST check": [WAIT, ok({ savedAt: "2026-11-18T20:00:00.000Z", warnings: [] })], "POST privacy": [ok({ accepted: true })] }, first);
  const page = open(first);
  let tree = show(page);
  const step = one(tree, ConfirmStep, "il passo 1");
  const where = pathTo(tree, ofType(ConfirmStep));
  const actions = step.props.actions as { save: (body: unknown) => Promise<boolean> };
  s.view = view({ kind: "referente", check, privacy: unread(NEXT) });
  assert.equal(await actions.save({ step: 1, confirm: "si", note: null }), false);
  await settle();
  tree = show(page);
  one(tree, PrivacyCard, "l'informativa torna");
  assert.equal(one(find(tree, slot("referent-content")), ConfirmStep, "il passo resta").key, step.key);
  assert.deepEqual(pathTo(tree, ofType(ConfirmStep)), where);
  // Mentre l'informativa è sullo schermo, una bozza del passo non parte: si tiene, l'ultima per passo.
  const note = { step: 1, confirm: "correggi", note: "Le fatture arrivano anche via PEC." };
  assert.equal(await actions.save(note), false);
  assert.deepEqual(s.writes.map((w) => w.route), ["POST check"]);
  (one(tree, PrivacyCard, "l'informativa").props.onAccept as () => void)();
  await settle();
  show(page);
  assert.deepEqual(s.writes.map((w) => w.route), ["POST check", "POST privacy", "POST check"], "un tocco, e la bozza del passo parte");
  assert.deepEqual(s.writes[2].body, note, "l'ultima scritta");
});

test("«Da completare»: la risposta a un chiarimento che aspetta l'informativa resta nel suo campo, senza «Prima premi «Iniziamo».»", async (t) => {
  const clarification: ReferentThreadMessageView = { id: "77777777-0000-4000-8000-000000000001", anchor: "domanda", needId: NEED, componentKey: null, side: "team", kind: "chiarimento", text: "Anche d'estate?", createdAt: "2026-11-12T10:00:00.000Z", replyTo: null, waiting: true, fresh: false };
  const first = view({ state: "completata", questions: [SENT], thread: { followUp: true, open: true, messages: [clarification] } });
  const s = server(t, { "POST reply": [WAIT, ok({ messageId: "77777777-0000-4000-8000-000000000002" })], "POST privacy": [ok({ accepted: true })] }, first);
  const page = open(first);
  let tree = show(page);
  (one(tree, ClarificationCard, "il chiarimento").props.onChange as (value: string) => void)("D'estate circa la metà.");
  tree = show(page);
  s.view = { ...first, privacy: unread(NEXT) };
  (one(tree, SubmitBar, "«Invia»").props.onSubmit as () => void)();
  await settle();
  tree = show(page);
  one(tree, PrivacyCard, "l'informativa torna");
  const reply = one(find(tree, slot("referent-content")), ClarificationCard, "il campo della risposta resta");
  assert.equal(reply.props.value, "D'estate circa la metà.");
  assert.equal(reply.props.error, null, "nessun messaggio sotto il campo");
  assert.equal(one(tree, SubmitBar, "«Invia»").props.busy, false);
  (one(tree, PrivacyCard, "l'informativa").props.onAccept as () => void)();
  await settle();
  tree = show(page);
  assert.equal(one(tree, ClarificationCard, "il chiarimento").props.value, "D'estate circa la metà.", "dopo «Iniziamo» la risposta è ancora lì, da inviare");
  (one(tree, SubmitBar, "«Invia»").props.onSubmit as () => void)();
  await settle();
  assert.deepEqual(s.writes.map((w) => w.route), ["POST reply", "POST privacy", "POST reply"]);
  assert.deepEqual(s.writes[2].body, s.writes[0].body);
});

test("(rilascio 10) «Scrivi al team» a lavoro finito: l'invio aspetta l'informativa, che si mostra al posto del campo; «Iniziamo» e il campo torna, con il fuoco", async (t) => {
  const first = view({ state: "completata", questions: [SENT], thread: { followUp: false, open: true, messages: [] } });
  const s = server(t, { "POST privacy": [ok({ accepted: true })] }, first);
  const page = open(first);
  const WriteToTeam: unknown = (await import("./thread")).WriteToTeam;
  const write = (tree: Element) => one(tree, WriteToTeam, "«Scrivi al team»");
  let tree = show(page);
  // Il campo di prima sotto ogni risposta non c'è più: «Scrivi al team» con «Su cosa?».
  assert.equal(find(tree, (e) => e.type === ThreadItem && e.props.targetKey === "g"), null, "niente «Ho un dubbio» sul caso d'uso in fondo");
  assert.deepEqual(
    (write(tree).props.targets as { key: string; kinds: string[] }[]).map((x) => [x.key, x.kinds]),
    [
      ["g", ["doubt"]],
      [`d:${NEED}`, ["doubt"]],
    ],
  );
  assert.equal(write(tree).props.primary, true, "a lavoro finito è il pulsante pieno della schermata");
  (write(tree).props.onOpen as (open: boolean) => void)(true);
  tree = show(page);
  assert.equal(write(tree).props.open, true);
  assert.equal(write(tree).props.privacyGate, null);
  s.view = { ...first, privacy: unread(NEXT) };
  (write(tree).props.onPrivacyWait as () => void)();
  await settle();
  tree = show(page);
  const gate = write(tree).props.privacyGate as Element;
  assert.equal(gate?.type, PrivacyCard, "l'informativa al posto del campo (la sola lettura non la chiede)");
  assert.deepEqual(gate.props.texts, NEXT);
  assert.equal(gate.props.again, true);
  assert.equal(write(tree).props.open, true, "il campo resta aperto, sotto");
  (gate.props.onAccept as () => void)();
  await settle();
  tree = show(page);
  assert.deepEqual(s.writes, [{ route: "POST privacy", body: { version: NEXT.version, shown: NEXT.version } }]);
  assert.equal(write(tree).props.privacyGate, null);
  assert.equal(write(tree).props.open, true);
  assert.equal(focused.at(-1), "campo-aperto", "il fuoco torna nel campo");
});
