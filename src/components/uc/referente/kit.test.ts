import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { findHubForbidden } from "../../../lib/use-cases/copy-guard.ts";
import { findForbidden } from "../../../lib/uc/views/copy-guard.ts";
import {
  INVALID_LINK_MESSAGE,
  PERSONAL_LOCKED_MESSAGE,
  PRIVACY_PENDING_MESSAGE,
  REFERENT_PRIVACY_NOTICE,
  referentCapabilities,
  type ReferentItemView,
} from "../../../lib/uc/public-view.ts";
import { checkDelegation } from "../../../lib/uc/request-state.ts";
import { initialForm } from "../../../lib/uc/views/referente-form.ts";
import { R_TEXT } from "../../../lib/uc/views/referente-text.ts";
import { enableTsxImports } from "../../use-cases/detail/referent/tsx-test-loader.ts";

// (Rilascio 10, ondata 4 «Fuori», PROPOSTA-10 §3.11 «/r», §4, D5) Il link della realizzazione `/r` con le parole del
// kit del referente: «Non lo so», «Avanti» senza la freccia, «Chiedi a un'altra persona» con il genere neutro, un solo
// numero con «salvato», la fonte del dato dentro «Altre opzioni», «Rispondi dopo» pieno in «È più comodo dal computer»,
// una scheda per il link che non vale e una per l'errore con il solo «Riprova». Le parole in un file di testi
// (`referente-text.ts`), controllate dalle due copy guard («fuori» e ruoli del cliente). Resa in HTML con
// react-dom/server, senza database. Dati inventati.

// ── Le parole ────────────────────────────────────────────────────────

/** Gli esempi con cui si chiama ogni testo che dipende da un valore: un testo nuovo senza esempio fa fallire il test. */
const SAMPLES: Record<string, unknown[][]> = {
  "shell.client": [["Cliente Demo"]],
  "home.hello": [["Marco"], [null]],
  "home.finished": [["Marco"], [null]],
  "home.list": [["Già inviate", 12]],
  "say.partial": [[2, 1]],
  "step.count": [
    [3, 12, true],
    [3, 12, false],
  ],
  "step.valueText": [[3, 12]],
  "question.imported": [
    [1, "costi.xlsx", null],
    [12, "costi.xlsx", "Ho saltato 2 righe vuote."],
  ],
  "review.ready": [[0], [1], [3]],
  "review.partial": [
    [1, 2],
    [2, 1],
  ],
  "review.later": [[1], [3]],
  "review.send": [[1], [3]],
  "sent.next": [["Prezzi e sconti"]],
  "delegate.topic": [[5, "Prezzi e sconti"]],
  "delegate.group": [["Prezzi e sconti", 2, 5]],
  "delegate.toApprove": [["Giulia Neri"]],
  "delegate.copy": [["Giulia Neri"]],
  "delegate.doneOne": [["Giulia Neri"]],
  "delegate.doneMany": [[3, "Giulia Neri"]],
  "delegate.linkLabel": [["Giulia Neri"]],
  "clarification.rightValueLabel": [["Volumi del mese"]],
};

/** Ogni testo del modulo, con le funzioni chiamate sui loro esempi. */
function allTexts(): string[] {
  const out: string[] = [];
  const walk = (node: unknown, path: string) => {
    if (typeof node === "string") out.push(node);
    else if (typeof node === "function") {
      const calls = SAMPLES[path];
      assert.ok(calls, `${path}: manca un esempio in SAMPLES`);
      for (const args of calls) out.push(String((node as (...a: unknown[]) => unknown)(...args)));
    } else if (node && typeof node === "object") for (const [key, value] of Object.entries(node)) walk(value, path ? `${path}.${key}` : key);
  };
  walk(R_TEXT, "");
  return out;
}

test("(rilascio 10, §4.2) ogni parola di /r passa le copy guard: fuori dalla dashboard e per i ruoli del cliente", () => {
  const texts = [...allTexts(), INVALID_LINK_MESSAGE, PERSONAL_LOCKED_MESSAGE, PRIVACY_PENDING_MESSAGE];
  assert.ok(texts.length > 150, `${texts.length} testi controllati`);
  const found = texts.flatMap((t) => [...findHubForbidden(t, "esterno"), ...findForbidden(t, "cliente")].map((m) => `«${m.match}» in «${t}»`));
  assert.deepEqual(found, []);
  // I codici dei casi (XX-0000) e le chiavi non arrivano mai sullo schermo del link.
  assert.deepEqual(
    texts.filter((t) => /\b[A-Z]{2,4}-\d{4}\b|\bq\.[a-z]/.test(t)),
    [],
  );
});

test("(D5, §4.1) le parole del kit del referente: «Non lo so», «Avanti» senza freccia, «Chiedi a un'altra persona» al neutro", () => {
  const texts = allTexts();
  assert.equal(R_TEXT.actions.notKnown, "Non lo so");
  assert.equal(R_TEXT.actions.next, "Avanti");
  assert.deepEqual(
    texts.filter((t) => /→|Non ce l['’]ho|\buse case\b/i.test(t)),
    [],
  );
  // Chiedere a un'altra persona: una sola espressione, mai «un collega», e senza pronomi che dicono il genere.
  for (const label of [R_TEXT.more.delegate, R_TEXT.dontKnow.delegate, R_TEXT.delegate.title]) assert.equal(label, "Chiedi a un'altra persona");
  assert.equal(R_TEXT.intro.delegateTopic, "Gira tutto l'argomento a un'altra persona");
  assert.equal(R_TEXT.documentTitle.delegate, "Chiedi a un'altra persona · Unbundle");
  assert.deepEqual(
    texts.filter((t) => /\bcolleg[ah]i?\b|\bcolleghe\b|\blui\b|\bgli\b|\bmandargli\b|\blink suo\b/i.test(t)),
    [],
  );
  // «caso d'uso», mai «caso» da solo.
  assert.deepEqual(
    texts.filter((t) => /\bcaso\b(?!\s+d['’]uso)/i.test(t)),
    [],
  );
});

test("(§4.1) i messaggi della delega che arrivano dal server: «un'altra persona», mai «collega», e le copy guard", () => {
  // Le regole pure (`checkDelegation`), con ogni esito che rifiuta.
  const base = { parentDepth: 0, delegationsToday: 0, delegateEmail: "persona@cliente.test", caseContactDomains: ["cliente.test"], lsDomains: ["ls.test"], itemIds: ["i1"], activeItemIds: ["i1"] };
  const rules = [
    checkDelegation({ ...base, parentDepth: 2 }),
    checkDelegation({ ...base, delegationsToday: 5 }),
    checkDelegation({ ...base, delegateEmail: "non-una-email" }),
    checkDelegation({ ...base, delegateEmail: "persona@ls.test" }),
    checkDelegation({ ...base, itemIds: [] }),
    checkDelegation({ ...base, itemIds: ["i2"] }),
  ].map((r) => (r.ok ? "" : r.message));
  assert.ok(rules.every((m) => m !== ""), "ogni regola rifiuta con il suo messaggio");
  // Le scritture della delega (`delegateItems`) vogliono il database: i loro messaggi si leggono dal sorgente.
  const source = readFileSync(fileURLToPath(new URL("../../../lib/db/queries/uc-public.ts", import.meta.url)), "utf8");
  const start = source.indexOf("export async function delegateItems");
  assert.ok(start > 0, "la delega del server c'è");
  const delegation = source.slice(start, source.indexOf("\nexport ", start + 1));
  const server = [...delegation.matchAll(/publicFail\("[a-z_]+", "([^"]+)"/g), ...source.matchAll(/\btroppe_deleghe: "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(server.length >= 6, `${server.length} messaggi del server`);
  const texts = [...rules, ...server];
  assert.deepEqual(
    texts.filter((t) => /\bcolleg(?:a|hi|he)\b|\blui\b/i.test(t)),
    [],
  );
  const found = texts.flatMap((t) => [...findHubForbidden(t, "esterno"), ...findForbidden(t, "cliente")].map((m) => `«${m.match}» in «${t}»`));
  assert.deepEqual(found, []);
  for (const text of ["Indica l'email di un'altra persona, non la tua.", "Non si può girare una domanda a Lateral Space: chiedi a un'altra persona della tua azienda."]) {
    assert.ok(texts.includes(text), text);
  }
});

test("(§3.11) le schede del guscio: il link che non vale e l'errore con il solo «Riprova»", () => {
  assert.equal(R_TEXT.invalidLink.title, "Questo link non vale più.");
  assert.equal(R_TEXT.invalidLink.body, "Rispondi all'email che hai ricevuto: arriva a chi ti ha scritto.");
  assert.equal(INVALID_LINK_MESSAGE, `${R_TEXT.invalidLink.title} ${R_TEXT.invalidLink.body}`, "l'API dice le stesse parole della scheda");
  assert.equal(R_TEXT.error.title, "Questa pagina non si è caricata.");
  assert.equal(R_TEXT.error.retry, "Riprova");
  assert.equal(R_TEXT.shell.client("Cliente Demo"), "Cliente Demo · con Lateral Space");
  assert.equal(PERSONAL_LOCKED_MESSAGE, "Riguarda dati personali: si apre quando la tua azienda dà l'ok.", "senza il nome della scheda privacy");
});

test("(§3.11) un numero solo, con «salvato» accanto", () => {
  assert.equal(R_TEXT.step.count(3, 12, true), "3 di 12 · salvato");
  assert.equal(R_TEXT.step.count(3, 12, false), "3 di 12");
  assert.equal(R_TEXT.step.count(1, 2_812, false), "1 di 2.812");
});

test("(ondata 4) l'informativa di /r è la uc-2026-11-2: le parole del kit, «Iniziamo», «Chiedi a un'altra persona»; il messaggio la segue", () => {
  assert.equal(REFERENT_PRIVACY_NOTICE.version, "uc-2026-11-2");
  assert.equal(REFERENT_PRIVACY_NOTICE.button, "Iniziamo");
  const all = [REFERENT_PRIVACY_NOTICE.lead, ...REFERENT_PRIVACY_NOTICE.summary, ...REFERENT_PRIVACY_NOTICE.paragraphs].join(" ");
  assert.match(all, /«Chiedi a un'altra persona»/);
  assert.doesNotMatch(all, /collega/, "genere neutro: nessun «collega»");
  // I fatti di /r, non quelli di /rispondi: niente AI, niente «due giorni», niente «12 mesi».
  assert.doesNotMatch(all, /intelligenza artificiale|due giorni|12 mesi/);
  assert.equal(PRIVACY_PENDING_MESSAGE, `Prima leggi l'informativa e premi «${REFERENT_PRIVACY_NOTICE.button}».`);
});

// ── I sorgenti: niente parole scritte nei componenti delle schermate ──

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROUTE = fileURLToPath(new URL("../../../app/r/", import.meta.url));

/** I componenti delle schermate di /r. Restano fuori i campi dei tipi di risposta, gli allegati e l'Excel (testi dei campi). */
const SCREENS = [
  "link-card.tsx",
  "screen.tsx",
  "step-bar.tsx",
  "step-runner.tsx",
  "question-step.tsx",
  "more-options.tsx",
  "source-chips.tsx",
  "dont-know-panel.tsx",
  "module-intro.tsx",
  "module-review.tsx",
  "sent-screen.tsx",
  "delegate-screen.tsx",
  "clarification-screen.tsx",
  "declared-value.tsx",
  "privacy-gate.tsx",
  "referente-home.tsx",
  "referente-page.tsx",
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** Gli attributi JSX che vanno a schermo (o al lettore di schermo). */
const VISIBLE_ATTRIBUTES = new Set(["label", "title", "placeholder", "hint", "summary", "alt", "aria-label", "aria-valuetext", "backLabel", "body"]);
/** Una parola: almeno due lettere. Il marchio «U» e il triangolo «▸» non lo sono. */
const WORD = /[A-Za-zÀ-ÿ]{2,}/;

/** Le parole scritte nel JSX di un sorgente: testo tra i tag, stringhe figlie di un elemento, attributi visibili. */
function inlineWords(path: string): string[] {
  const sf = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node) && WORD.test(node.text)) out.push(node.text.trim());
    else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      // Una stringa che va dritta a schermo: figlia di un elemento (anche dentro `?:`, `&&`, `||`, `??`, ma non come
      // condizione) o valore di un attributo visibile; come `isRenderedLiteral` della copy guard dell'area.
      let child: ts.Node = node;
      let parent = node.parent;
      const passing = [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken];
      while (
        ts.isParenthesizedExpression(parent) ||
        (ts.isConditionalExpression(parent) && parent.condition !== child) ||
        (ts.isBinaryExpression(parent) && passing.includes(parent.operatorToken.kind) && (parent.right === child || parent.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken))
      ) {
        child = parent;
        parent = parent.parent;
      }
      const attributeOf = ts.isJsxAttribute(parent) ? parent : ts.isJsxExpression(parent) && ts.isJsxAttribute(parent.parent) ? parent.parent : null;
      const rendered = (ts.isJsxExpression(parent) && (ts.isJsxElement(parent.parent) || ts.isJsxFragment(parent.parent))) || (attributeOf !== null && VISIBLE_ATTRIBUTES.has(attributeOf.name.getText(sf)));
      const text = node.getText(sf);
      if (rendered && WORD.test(text)) out.push(text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

test("(§3.11) le schermate di /r leggono le parole dal file dei testi: niente testo scritto nel JSX né nelle etichette", () => {
  const found = [...SCREENS.map((name) => join(HERE, name)), ...sourceFiles(ROUTE)].flatMap((path) => inlineWords(path).map((t) => `${path}: «${t}»`));
  assert.deepEqual(found, []);
  // Il controllo trova davvero le parole scritte nel JSX.
  assert.ok(inlineWords(join(HERE, "inputs", "text-inputs.tsx")).some((t) => t.includes("Regole toccate")));
});

test("(§3.11) nessuna freccia dopo «Avanti», nessuna finestra del browser, l'errore con il solo «Riprova»", () => {
  const files = [...sourceFiles(HERE), ...sourceFiles(ROUTE)];
  for (const path of files) {
    const source = code(path);
    assert.doesNotMatch(source, /→/, path);
    assert.doesNotMatch(source, /window\.(?:confirm|prompt|alert)\b|\balert\(/, path);
    assert.doesNotMatch(source, /ClientLine|Lateral Space per /, `${path}: la riga del cliente sta nel guscio`);
  }
  const error = code(join(ROUTE, "[token]", "error.tsx"));
  assert.match(error, /<ErrorCard retry=\{retry\} \/>/);
  assert.doesNotMatch(error, /Ricarica|reload\(/);
});

// ── Le schermate, rese ───────────────────────────────────────────────

let render: (element: unknown) => string;
let h: (type: unknown, props: unknown) => unknown;
let shell: typeof import("./link-card.tsx");
let screen: typeof import("./screen.tsx");
let bar: typeof import("./step-bar.tsx");
let question: typeof import("./question-step.tsx");
let runner: typeof import("./step-runner.tsx");

before(async () => {
  await enableTsxImports();
  shell = await import("./link-card.tsx");
  screen = await import("./screen.tsx");
  bar = await import("./step-bar.tsx");
  question = await import("./question-step.tsx");
  runner = await import("./step-runner.tsx");
  const react = await import("react");
  h = (type, props) => react.createElement(type as never, props as never);
  const server = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string };
  render = (element) => server.renderToStaticMarkup(element as never).replaceAll("&#x27;", "'").replaceAll("&amp;", "&");
});

const noop = () => undefined;
const TOKEN = "ucr_ABCDEFGHabcdefgh0123456789_-xyZ";

/** I pulsanti della pagina (anche i link fatti pulsante), con il testo e se sono pieni. */
function buttons(html: string): { text: string; filled: boolean }[] {
  return [...html.matchAll(/<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/g)]
    .filter((m) => m[1] === "button" || /data-slot="button"/.test(m[2]))
    .map((m) => ({ text: m[3].replace(/<[^>]+>/g, "").trim(), filled: /\bbg-primary text-primary-foreground\b/.test(m[2]) }));
}

const filled = (html: string) => buttons(html).filter((b) => b.filled).map((b) => b.text);

function item(over: Partial<ReferentItemView> = {}): ReferentItemView {
  return {
    id: "66666666-6666-4666-8666-666666666666",
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
    ...over,
  };
}

function step(it: ReferentItemView, over: Record<string, unknown> = {}) {
  return h(question.QuestionStep, {
    item: it,
    token: TOKEN,
    form: initialForm(it),
    attachments: [],
    issues: [],
    busy: false,
    narrow: false,
    primaryLabel: R_TEXT.actions.next,
    immediate: false,
    delegateHref: "#/collega/66666666-6666-4666-8666-666666666666",
    onForm: noop,
    onAttachments: noop,
    onNext: noop,
    onConfirm: noop,
    onSkip: noop,
    onPicked: noop,
    ...over,
  });
}

test("il guscio: in alto «{Cliente} · con Lateral Space», non cliccabile; il piè di pagina solo se la pagina lo dà", () => {
  const withClient = render(h(shell.ReferentShell, { client: "Cliente Demo", footer: h("p", { children: "Come usiamo le tue risposte" }), children: h("p", { children: "Contenuto" }) }));
  assert.ok(withClient.includes("Cliente Demo · con Lateral Space"));
  assert.match(withClient, /<footer\b[\s\S]*Come usiamo le tue risposte[\s\S]*<\/footer>/);
  const head = withClient.slice(0, withClient.indexOf("Contenuto"));
  assert.doesNotMatch(head, /<a\b|<button\b/, "il marchio non si clicca");
  const bare = render(h(shell.ReferentShell, { children: h("p", { children: "Contenuto" }) }));
  assert.ok(bare.includes(R_TEXT.shell.brand) && !bare.includes("con Lateral Space"));
  assert.doesNotMatch(bare, /<footer\b/);
});

test("la scheda del link che non vale: le parole del guscio, nessun pulsante", () => {
  const html = render(h(shell.InvalidLinkCard, {}));
  assert.ok(html.includes("Questo link non vale più.") && html.includes("Rispondi all'email che hai ricevuto: arriva a chi ti ha scritto."));
  assert.equal(buttons(html).length, 0);
});

test("la scheda dell'errore e quella del servizio che non risponde: il solo «Riprova», pieno, a tutta larghezza e alto 48 px", () => {
  for (const html of [render(h(screen.ErrorCard, { retry: noop })), render(h(shell.UnavailableCard, {}))]) {
    assert.ok(html.includes(R_TEXT.error.title));
    assert.deepEqual(buttons(html), [{ text: "Riprova", filled: true }]);
    assert.match(html, /<button[^>]*class="[^"]*\bh-12\b[^"]*\bw-full\b/);
  }
});

test("la barra della domanda: un numero solo, con «salvato» accanto dopo la prima modifica", () => {
  const props = { backHref: "#/", context: "Prezzi e sconti", n: 3, total: 12, onSkip: noop };
  const saved = render(h(bar.StepBar, { ...props, saved: true }));
  assert.ok(saved.includes("3 di 12 · salvato"));
  assert.doesNotMatch(saved, />Salvato</);
  // Sullo schermo (il lettore di schermo legge anche «Domanda 3 di 12» della barra).
  assert.equal((saved.replace(/<[^>]+>/g, " ").match(/\b\d+ di \d+\b/g) ?? []).length, 1, "un numero solo");
  const fresh = render(h(bar.StepBar, { ...props, saved: false }));
  assert.ok(fresh.includes(">3 di 12<") && !fresh.includes("salvato"));
});

test("una domanda da scrivere: «Avanti» pieno e unico, la fonte del dato dentro «Altre opzioni» chiuso", () => {
  const html = render(step(item()));
  assert.deepEqual(filled(html), ["Avanti"]);
  assert.ok(buttons(html).some((b) => b.text === "Non lo so" && !b.filled));
  const details = html.indexOf("<details");
  const source = html.indexOf(R_TEXT.more.source);
  assert.ok(source > 0, "la fonte del dato c'è");
  assert.ok(details > 0 && details < source && source < html.indexOf("</details>", details), "la fonte sta dentro «Altre opzioni»");
  assert.doesNotMatch(html.slice(details, html.indexOf("</summary>", details)), /Da dove viene/);
  assert.match(html, /<details\b(?![^>]*\bopen\b)[^>]*>\s*<summary[^>]*>[\s\S]*?Altre opzioni/, "«Altre opzioni» chiuso");
  // Tre controlli per la domanda, a vista: il campo, «Non lo so», «Altre opzioni»; più «Avanti».
  const outside = html.slice(0, details) + html.slice(html.indexOf("</details>", details));
  assert.equal((outside.match(/<input\b(?![^>]*type="hidden")/g) ?? []).length, 1, "un campo");
  assert.deepEqual(
    buttons(outside).map((b) => b.text),
    ["Non lo so", "Avanti"],
  );
  assert.ok(html.includes("Chiedi a un'altra persona"));
});

test("«È più comodo dal computer» al telefono: «Rispondi dopo» è il pulsante pieno, il solo", () => {
  const table = item({ responseType: "tabella", config: {} });
  const html = render(step(table, { narrow: true }));
  assert.ok(html.includes(R_TEXT.heavy.title));
  assert.deepEqual(filled(html), ["Rispondi dopo"]);
  assert.ok(buttons(html).some((b) => b.text === R_TEXT.heavy.fillTable && !b.filled));
  // Una domanda da sola (senza «Rispondi dopo»): il pieno è «Compila qui».
  const alone = render(step(table, { narrow: true, onSkip: null }));
  assert.deepEqual(filled(alone), [R_TEXT.heavy.fillTable]);
  assert.ok(!alone.includes("Rispondi dopo"));
  // Dal computer la tabella si compila subito: niente schermata del computer.
  assert.ok(!render(step(table, { narrow: false })).includes(R_TEXT.heavy.title));
});

test("il giro delle domande: «Rispondi dopo» in alto, ma non due volte nella schermata del computer", () => {
  const props = (it: ReferentItemView, narrow: boolean) => ({
    steps: [it, item({ id: "77777777-7777-4777-8777-777777777777", title: "Seconda domanda" })],
    n: 1,
    contextFor: () => "Prezzi e sconti",
    backHref: "#/",
    token: TOKEN,
    forms: { [it.id]: initialForm(it) },
    attachments: {},
    issues: {},
    busy: false,
    narrow,
    savedFor: () => false,
    immediateFor: () => false,
    delegateHrefFor: () => null,
    inRound: true,
    onForm: noop,
    onAttachments: noop,
    onNext: noop,
    onConfirm: noop,
    onSkip: noop,
    onPicked: noop,
  });
  const count = (html: string) => (html.match(/Rispondi dopo/g) ?? []).length;
  const plain = render(h(runner.StepRunner, props(item(), true)));
  assert.equal(count(plain), 1, "la domanda normale: «Rispondi dopo» in alto");
  assert.ok(plain.includes(">1 di 2<"));
  assert.deepEqual(filled(plain), ["Avanti"]);
  const heavy = render(h(runner.StepRunner, props(item({ responseType: "tabella", config: {} }), true)));
  assert.equal(count(heavy), 1, "il computer: «Rispondi dopo» solo in basso, pieno");
  assert.deepEqual(filled(heavy), ["Rispondi dopo"]);
});
