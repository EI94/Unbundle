import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { installAppModules } from "../../../lib/ai/claude-test-kit.ts";
import { PRIVACY_PENDING_MESSAGE, PRIVACY_UPDATED_MESSAGE, REFERENT_PRIVACY_NOTICE, referentCapabilities, type ReferentItemView, type ReferentNoticeText, type ReferentView } from "../../../lib/uc/public-view.ts";
import { deviceDraftKey, initialForm, type ReferentForm } from "../../../lib/uc/views/referente-form.ts";
import { enableTsxImports } from "../../use-cases/detail/referent/tsx-test-loader.ts";

// (Ondata 0) L'informativa cambia con un rilascio mentre il referente ha `/r` aperta. La pagina vera
// (`referente-page.tsx`) e il salvataggio automatico vero (`use-autosave.ts`) girano qui su un React minimo, senza
// DOM: stato, ref ed effetti come in React, un render quando lo chiede il test. Le schermate figlie sono finte (della
// pagina contano gli elementi e le props che passa), il server risponde con un `fetch` finto. Il testo scritto resta
// sul dispositivo, l'informativa torna sullo schermo con il testo del server e un tocco su «Ho letto, iniziamo»
// riprende il lavoro. Dati inventati.

type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void };
type Element = { type: unknown; props: Record<string, unknown> };

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
export function useEffect(fn, deps) { r().useEffect(fn, deps); }
export function useSyncExternalStore(subscribe, getSnapshot) { return getSnapshot(); }`;
const JSX = `export function jsx(type, props) { return { type, props: props ?? {} }; }
export const jsxs = jsx;
export const Fragment = "frammento";`;
/** Le schermate della pagina: qui contano solo i loro elementi e le loro props. */
const screens = (...names: string[]) => names.map((name) => `export function ${name}() { return null; }`).join("\n");

await installAppModules({
  react: REACT,
  "react/jsx-runtime": JSX,
  "./approvals-view": screens("ApprovalsView"),
  "./clarification-screen": screens("ClarificationScreen"),
  "./delegate-screen": screens("DelegateScreen"),
  "./link-card": screens("InvalidLinkCard", "ReferentShell"),
  "./module-intro": screens("ModuleIntro"),
  "./module-review": screens("ModuleReview"),
  "./privacy-gate": screens("PrivacyGate"),
  "./referente-home": screens("ReferenteHome"),
  "./screen": `${screens("ClientLine", "Notice", "ScreenTitle")}\nexport const SCREEN_TITLE_ID = "uc-r-titolo";`,
  "./sent-screen": screens("SentScreen"),
  "./step-runner": screens("StepRunner"),
});
await enableTsxImports();
const { ReferentePage } = await import("./referente-page.tsx");
const PrivacyGate: unknown = (await import("./privacy-gate")).PrivacyGate;
const StepRunner: unknown = (await import("./step-runner")).StepRunner;

// ── Il browser finto ─────────────────────────────────────────────────

const store = new Map<string, string>();
const location = { hash: "", pathname: "/r/prova", search: "" };
Object.assign(globalThis, {
  window: {
    location,
    history: { state: null, replaceState() {} },
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, String(v)), removeItem: (k: string) => void store.delete(k) },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    scrollTo() {},
  },
  document: { title: "", visibilityState: "visible", addEventListener() {}, removeEventListener() {}, getElementById: () => null },
});

// ── Il caso d'uso e le viste ─────────────────────────────────────────

const TOKEN = "ucr_ABCDEFGHabcdefgh0123456789_-xyZ";
const ITEM_ID = "66666666-6666-4666-8666-666666666666";
const TOPIC = "m.servizio.base";
const DRAFT = `PUT /items/${ITEM_ID}/draft`;
const ANSWER = `POST /items/${ITEM_ID}/answer`;

const ITEM: ReferentItemView = {
  id: ITEM_ID,
  key: "q.servizio.02",
  title: "Quante richieste arrivano al mese?",
  explanation: null,
  why: null,
  example: null,
  help: null,
  attachmentHint: null,
  responseType: "numero",
  config: { unit: "richieste al mese", integer: true, min: 0 },
  status: "chiesta",
  statusReason: null,
  requestItemState: "da_fare",
  label: "Da rispondere",
  tone: "da_fare",
  done: false,
  personal: false,
  requiresValidFrom: false,
  healthRuleQuestion: false,
  currentAnswerId: null,
  toConfirm: null,
  ownAnswer: null,
  clarification: null,
  draft: null,
  files: [],
  can: referentCapabilities({ status: "chiesta", requestItemState: "da_fare", assignedToMe: true, privacyClass: "riservato_azienda", personalZoneOpen: false, writable: true, delegationDepth: 0 }),
};

/** L'informativa di un rilascio che verrà: un altro testo, un'altra versione. */
const NEXT_NOTICE: ReferentNoticeText = { ...REFERENT_PRIVACY_NOTICE, version: "uc-2027-01-1", lead: "Tre cose da sapere, aggiornate.", summary: ["Primo punto nuovo.", "Secondo punto nuovo.", "Terzo punto nuovo."] };

function view(privacy: ReferentView["privacy"]): ReferentView {
  return {
    access: "scrivibile",
    mode: "raccolta",
    clientLabel: "Cliente di prova",
    caseCode: "XX-0001",
    caseTitle: "Caso di prova",
    greetingName: "Marco",
    paused: false,
    expiresAt: "2026-12-18T10:00:00.000Z",
    privacy,
    progress: { done: 0, total: 1 },
    estimatedMinutes: 5,
    modules: [{ key: TOPIC, title: "Servizio", why: null, instructions: null, estimatedMinutes: 5, estimatedLabel: null, questionCount: 1, items: [ITEM] }],
    delegation: { allowed: false, depth: 0, max: 2 },
    approvals: [],
    emailConfigured: false,
  };
}

/** La pagina aperta con l'informativa di adesso già letta. */
const READ_NOW = view({ acknowledged: true, version: REFERENT_PRIVACY_NOTICE.version, notice: REFERENT_PRIVACY_NOTICE });

// ── Il server finto ──────────────────────────────────────────────────

type Call = { route: string; body: unknown };
type Reply = { status: number; body: unknown };
const refused = (status: number, error: string, message: string): Reply => ({ status, body: { ok: false, error, message } });
const ok = (data: unknown): Reply => ({ status: 200, body: { ok: true, data } });

/**
 * Risposte per «METODO percorso» (dopo `/api/r/<token>`), in ordine: l'ultima si ripete. La vista (`GET /`) è quella
 * di `server.view`, che il test cambia come cambierebbe sul server. Le scritture registrate, senza `opened`.
 */
function server(t: TestContext, replies: Record<string, Reply[]>) {
  const s = { view: READ_NOW, writes: [] as Call[] };
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init: RequestInit = {}) => {
    const route = `${init.method ?? "GET"} ${String(url).replace(`/api/r/${TOKEN}`, "") || "/"}`;
    if (route === "GET /") return Response.json({ ok: true, data: s.view });
    if (route !== "POST /opened") s.writes.push({ route, body: init.body ? JSON.parse(String(init.body)) : null });
    const queue = replies[route] ?? [ok({})];
    const reply = queue.length > 1 ? queue.shift()! : queue[0];
    return Response.json(reply.body, { status: reply.status });
  });
  return s;
}

// ── La pagina ────────────────────────────────────────────────────────

const DEVICE_KEY = deviceDraftKey(TOKEN, ITEM_ID);
const deviceCopy = () => store.get(DEVICE_KEY) ?? null;

async function settle() {
  for (let i = 0; i < 25; i++) await new Promise((resolve) => setImmediate(resolve));
}

function find(node: unknown, type: unknown): Element | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = find(child, type);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== "object" || !("props" in node)) return null;
  const element = node as Element;
  return element.type === type ? element : find(element.props.children, type);
}

function open(t: TestContext, hash: string) {
  store.clear();
  location.hash = hash;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  return mount(ReferentePage as unknown as (props: unknown) => unknown, { token: TOKEN, initialView: READ_NOW, nowIso: "2026-11-18T10:00:00.000Z" });
}

function runnerOf(tree: Element): Element {
  const runner = find(tree, StepRunner);
  assert.ok(runner, "la domanda è sullo schermo");
  return runner;
}

/** Il referente scrive «120» e una nota: la pagina tiene la copia sul dispositivo e salva sul server 2 secondi dopo. */
function typeAnswer(tree: Element) {
  const base = initialForm(ITEM);
  const typed: ReferentForm = { ...base, value: { ...(base.value as Record<string, unknown>), value: "120" }, note: "Dal gestionale, media dell'anno." };
  (runnerOf(tree).props.onForm as (item: ReferentItemView, form: ReferentForm) => void)(ITEM, typed);
  assert.ok(deviceCopy()?.includes("120"), "la copia sul dispositivo c'è da subito");
}

const typedValue = (tree: Element) => ((runnerOf(tree).props.forms as Record<string, ReferentForm>)[ITEM_ID].value as { value: string }).value;

test("informativa nuova (503 «informativa_aggiornata»): la bozza resta sul dispositivo, l'informativa torna con il testo del server, un tocco e la bozza parte", async (t) => {
  const s = server(t, { [DRAFT]: [refused(503, "informativa_aggiornata", PRIVACY_UPDATED_MESSAGE), ok({ saved: true, errors: [], warnings: [] })], "POST /privacy-ack": [ok({ version: NEXT_NOTICE.version })] });
  const page = open(t, `#/a/${TOPIC}/1`);
  typeAnswer(page.render());
  // Il rilascio: il server chiede l'informativa nuova, con il suo testo.
  s.view = view({ acknowledged: false, version: NEXT_NOTICE.version, notice: NEXT_NOTICE });
  t.mock.timers.tick(2000);
  await settle();

  let tree = page.render();
  const gate = find(tree, PrivacyGate);
  assert.ok(gate, "l'informativa è di nuovo sullo schermo, al posto della domanda");
  assert.deepEqual(gate.props.notice, NEXT_NOTICE, "con il testo che si accetta: quello del server, non quello della pagina");
  assert.equal(find(tree, StepRunner), null);
  assert.ok(deviceCopy()?.includes("120"), "la copia sul dispositivo resta");
  t.mock.timers.tick(120_000);
  await settle();
  assert.deepEqual(s.writes.map((c) => c.route), [DRAFT], "nessun nuovo tentativo mentre l'informativa è sullo schermo");

  s.view = view({ acknowledged: true, version: NEXT_NOTICE.version, notice: NEXT_NOTICE });
  (gate.props.onAcknowledge as () => void)();
  await settle();
  page.render();
  await settle();
  tree = page.render();
  assert.deepEqual(s.writes.map((c) => c.route), [DRAFT, "POST /privacy-ack", DRAFT], "un tocco, e la bozza in attesa parte da sola");
  assert.deepEqual(s.writes[1].body, { version: NEXT_NOTICE.version }, "si accetta la versione del testo mostrato");
  assert.deepEqual(s.writes[2].body, s.writes[0].body, "la stessa bozza di prima");
  assert.match(JSON.stringify(s.writes[2].body), /"value":"120"/);
  assert.equal(deviceCopy(), null, "salvata sul server: la copia sul dispositivo non serve più");
  assert.equal(typedValue(tree), "120", "di nuovo la stessa domanda, con il testo scritto");
});

test("un server di prima (409 «informativa_da_leggere», versione vecchia e nessun testo): la copia resta e la pagina chiede di ricaricarsi, mai «Ho letto» su un altro testo", async (t) => {
  const s = server(t, { [DRAFT]: [refused(409, "informativa_da_leggere", PRIVACY_PENDING_MESSAGE)] });
  const page = open(t, `#/a/${TOPIC}/1`);
  typeAnswer(page.render());
  s.view = view({ acknowledged: false, version: "uc-2026-10-2" });
  t.mock.timers.tick(2000);
  await settle();
  const gate = find(page.render(), PrivacyGate);
  assert.ok(gate, "l'informativa torna sullo schermo");
  assert.equal(gate.props.notice, null, "la pagina non ha il testo di quella versione: chiede di ricaricarsi");
  assert.ok(deviceCopy()?.includes("120"), "la copia sul dispositivo resta, per dopo il ricaricamento");
  t.mock.timers.tick(120_000);
  await settle();
  assert.deepEqual(s.writes.map((c) => c.route), [DRAFT], "nessun nuovo tentativo");
});

test("«Invia» di una domanda da sola: la copia sul dispositivo resta finché la risposta non è partita", async (t) => {
  const sent = ok({ itemId: ITEM_ID, status: "in_verifica", label: "In verifica" });
  const s = server(t, { [ANSWER]: [refused(503, "informativa_aggiornata", PRIVACY_UPDATED_MESSAGE), sent], "POST /privacy-ack": [ok({ version: NEXT_NOTICE.version })] });
  const page = open(t, `#/voce/${ITEM_ID}`);
  typeAnswer(page.render());
  s.view = view({ acknowledged: false, version: NEXT_NOTICE.version, notice: NEXT_NOTICE });
  (runnerOf(page.render()).props.onNext as (item: ReferentItemView, intent: string) => void)(ITEM, "risposta");
  await settle();
  const gate = find(page.render(), PrivacyGate);
  assert.ok(gate, "l'informativa torna sullo schermo");
  assert.ok(deviceCopy()?.includes("120"), "la risposta non è partita: la copia resta");

  s.view = view({ acknowledged: true, version: NEXT_NOTICE.version, notice: NEXT_NOTICE });
  (gate.props.onAcknowledge as () => void)();
  await settle();
  const tree = page.render();
  assert.equal(typedValue(tree), "120", "la risposta è ancora lì, da inviare");
  (runnerOf(tree).props.onNext as (item: ReferentItemView, intent: string) => void)(ITEM, "risposta");
  await settle();
  page.render();
  assert.deepEqual(s.writes.map((c) => c.route), [ANSWER, "POST /privacy-ack", ANSWER]);
  assert.equal(deviceCopy(), null, "partita: la copia sul dispositivo si toglie");
});

test("un rifiuto vero della bozza (la domanda non si può più modificare) la toglie dal dispositivo, come prima, e l'informativa non torna", async (t) => {
  const s = server(t, { [DRAFT]: [refused(409, "stato_non_ammesso", "Per ora questa domanda non si può modificare.")] });
  const page = open(t, `#/a/${TOPIC}/1`);
  typeAnswer(page.render());
  t.mock.timers.tick(2000);
  await settle();
  const tree = page.render();
  assert.equal(find(tree, PrivacyGate), null);
  assert.ok(find(tree, StepRunner));
  assert.equal(deviceCopy(), null);
  assert.deepEqual(s.writes.map((c) => c.route), [DRAFT]);
});
