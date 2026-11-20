import test, { before } from "node:test";
import assert from "node:assert/strict";
import type { ReferentAskView, ReferentBenefitView, ReferentQuestionView, ReferentThreadMessageView } from "../../../lib/use-cases/referent/contract.ts";
import { findHubForbidden } from "../../../lib/use-cases/copy-guard.ts";
import { REFERENT_PRIVACY_NOTICE, REFERENT_PUBLIC_TEXT, privacyNoticeView } from "../../../lib/use-cases/referent/labels.ts";
import { enableTsxImports } from "../detail/referent/tsx-test-loader.ts";

// (Rilascio 10, §3.11) La pagina vera `/rispondi/<token>` resa in HTML, senza database, con viste inventate (Cliente
// Demo, XX-0024): il kit del referente schermata per schermata. Il marchio con la riga del cliente e nessun «Lateral
// Space via Unbundle.»; il titolo senza codice e «Riferimento XX-0024» in fondo; al passo 3 «Le domande» con tre controlli
// per domanda (il campo, «Allega», «Non lo so») più «Altro ▸»; un solo numero, nella barra, «0 di 3 · salvato»; un solo
// pulsante pieno; a lavoro finito il grazie, «Scrivi al team» e «Le tue risposte (n)» chiuso; «Novità» con la domanda del
// team come titolo della scheda; le due schede di servizio.

const T = REFERENT_PUBLIC_TEXT;
const TT = T.thread;
const TOKEN = "ucq_ABCDEFGHabcdefgh0123456789_-xy";
const N = ["55555555-0000-4000-8000-000000000001", "55555555-0000-4000-8000-000000000002", "55555555-0000-4000-8000-000000000003"];
const CONTACT = "privacy@example.test";
const NOTICE = privacyNoticeView({ company: "Cliente Demo", expires: "18 dicembre 2026", requester: "Persona di prova", contact: CONTACT });

let render: (element: unknown) => string;
let h: (type: unknown, props: unknown) => unknown;
let page: typeof import("./referent-ask-page.tsx");
let card: typeof import("./state-card.tsx");

before(async () => {
  await enableTsxImports();
  page = await import("./referent-ask-page.tsx");
  card = await import("./state-card.tsx");
  const react = await import("react");
  h = (type, props) => react.createElement(type as never, props as never);
  const { renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string };
  render = (element) =>
    renderToStaticMarkup(element)
      .replace(/&#x27;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
});

function question(i: number, over: Partial<ReferentQuestionView> = {}): ReferentQuestionView {
  return { needId: N[i], position: i + 1, title: ["Quanti preventivi fate in un mese?", "Come li preparate oggi?", "Ci mandi un preventivo di esempio?"][i], state: "aperta", fileRequired: false, draft: null, answer: null, files: [], ...over };
}
const sent = (i: number, over: Partial<ReferentQuestionView> = {}) =>
  question(i, { state: "inviata", answer: { text: `Risposta ${i}`, dontKnow: false, alreadyAttached: false, comment: null, submittedAt: "2026-11-03T10:00:00.000Z" }, editable: true, ...over });

function view(over: Partial<ReferentAskView> = {}): ReferentAskView {
  return {
    state: "aperta",
    privacy: { accepted: true, version: REFERENT_PRIVACY_NOTICE.version, contact: CONTACT, notice: NOTICE },
    company: "Cliente Demo",
    useCase: { code: "XX-0024", title: "Preventivi ai clienti" },
    requester: { name: "Persona di prova" },
    message: null,
    expiresOn: "2026-12-18",
    questions: [question(0), question(1, { templates: [{ id: "66666666-0000-4000-8000-000000000001", name: "modello-preventivo.xlsx", sizeBytes: 49_152 }] }), question(2, { fileRequired: true })],
    upload: { clientMode: true },
    kind: "domande",
    check: null,
    thread: { followUp: false, open: true, messages: [] },
    ...over,
  };
}

function html(v: ReferentAskView, initialStep: string | null = null): string {
  return render(h(page.ReferentAskPage, { token: TOKEN, initialView: v, today: "2026-11-20", initialStep }));
}

/** Il testo che si legge: senza tag, senza gli attributi. */
const visible = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
/** I pulsanti pieni (la variante di default: il colore primario). */
const filled = (markup: string) => [...markup.matchAll(/<button[^>]*class="[^"]*\bbg-primary\b[^"]*"[^>]*>([\s\S]*?)<\/button>/g)].map((m) => visible(m[1]));
/** Il blocco di una domanda, dal suo titolo. */
function cardOf(markup: string, needId: string): string {
  const start = markup.lastIndexOf("<section", markup.indexOf(`id="ucq-domanda-${needId}"`) + 20);
  return markup.slice(start, markup.indexOf("</section>", start));
}
/** I nomi dei pulsanti che si vedono (non nascosti) in un pezzo di pagina. */
function shownButtons(markup: string): string[] {
  const out: string[] = [];
  const hidden = /<div[^>]*\bhidden=""[^>]*>[\s\S]*?<\/div>/g;
  for (const m of markup.replace(hidden, "").matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)) out.push(visible(m[1]));
  return out;
}

function assertKit(markup: string) {
  assert.match(markup, /data-slot="public-brand"[^>]*>[\s\S]*?Cliente Demo · con Lateral Space<\/span>/, "in alto la riga del cliente");
  assert.ok(!markup.includes("Lateral Space via Unbundle"), "il marchio una volta: niente piè di pagina con il marchio");
  assert.match(markup, /<h1[^>]*>Preventivi ai clienti<\/h1>/, "(D6) il titolo senza codice");
  assert.ok(markup.includes(">Riferimento XX-0024<"), "il codice in piccolo in fondo");
  assert.ok(!/<h1[^>]*>[^<]*XX-0024/.test(markup));
  assert.deepEqual(findHubForbidden(visible(markup), "esterno"), [], "fuori dalla dashboard: «caso d'uso», mai «use case» né «Non ce l'ho»");
}

test("passo 3, le domande: tre controlli per domanda più «Altro ▸», un solo numero, un solo pulsante pieno", () => {
  const markup = html(view());
  assertKit(markup);
  assert.match(markup, /<h2[^>]*>Le domande<\/h2>/);
  for (const gone of ["Domanda 1 di", "Per ognuna", "Si salva da solo", "3 domande", "fatte", "La tua risposta", "Serve un file"]) assert.ok(!visible(markup).includes(gone), gone);
  // La domanda di tutti i giorni: il campo, «Allega», «Non lo so», «Altro ▸»; «È già allegato» e «Ho un dubbio» dentro «Altro».
  const plain = cardOf(markup, N[0]);
  assert.match(plain, /<textarea[^>]*aria-labelledby="ucq-domanda-[^"]+-titolo"/, "il titolo fa da etichetta del campo");
  assert.match(plain, /placeholder="Scrivi qui\. Bastano poche righe\."/);
  assert.deepEqual(shownButtons(plain), ["Allega", "Non lo so", "Altro ▸"]);
  assert.match(plain, /<div[^>]*hidden=""[^>]*data-slot="question-more"[^>]*>[\s\S]*È già allegato[\s\S]*Ho un dubbio/, "«È già allegato» e «Ho un dubbio» chiusi in «Altro»");
  assert.match(plain, /aria-expanded="false"[^>]*>Altro/);
  // Con un file da compilare: prima «Scarica», poi «Allega il file compilato», poi il campo chiuso.
  const template = cardOf(markup, N[1]);
  const order = ["Scarica il file da compilare", "modello-preventivo.xlsx · 48 KB", "Allega il file compilato", "Oppure scrivi la risposta"].map((t) => template.indexOf(t));
  assert.ok(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1])), `l'ordine: ${order.join(", ")}`);
  assert.doesNotMatch(template, /<textarea/);
  assert.deepEqual(shownButtons(template), ["Allega il file compilato", "Oppure scrivi la risposta ▸", "Non lo so", "Altro ▸"]);
  // Una domanda che vuole un file: «Allega un file» grande, «Non lo so», «Altro ▸».
  assert.deepEqual(shownButtons(cardOf(markup, N[2])), ["Allega un file", "Non lo so", "Altro ▸"]);
  // Il numero della scheda al posto di «Domanda 1 di 3».
  assert.match(plain, /data-slot="question-number"[^>]*>1<\/span>/);
  // Un solo numero, nella barra; un solo pulsante pieno.
  assert.match(markup, /data-slot="referent-progress"[^>]*>0 di 3 · salvato<\/p>/);
  assert.deepEqual(filled(markup), ["Invia"]);
  assert.ok(markup.includes(TT.generalDoubt), "«Hai un dubbio sul caso d'uso?»");
  assert.ok(markup.includes("Come usiamo le tue risposte"));
});

const CHECK = (benefits: ReferentBenefitView[] | null, description: string | null = "Le richieste di preventivo arrivano per email."): ReferentAskView["check"] => ({
  description,
  benefits,
  draft: { confirm: null, note: null, estimate: null, timesPerMonth: null, minutesEach: null, stale: false, savedAt: null },
  submittedAt: null,
});
const row = (key: string, draft: ReferentBenefitView["draft"] = null): ReferentBenefitView => ({ key, form: "ore", label: "Preparazione dei preventivi", team: { kind: "ore", volumeYear: 1440, minutes: 20, eurYear: null }, draft });

test("passo 1: la descrizione in 6 righe con «Leggi tutto» solo quando è lunga; i passi «Il caso d'uso · Le stime · Le domande»", () => {
  const short = html(view({ kind: "referente", check: CHECK(null) }));
  assertKit(short);
  const steps = short.slice(short.indexOf('data-slot="referent-steps"'), short.indexOf("</ol>"));
  const at = ["Il caso d'uso", "Le stime", "Le domande"].map((t) => steps.indexOf(t));
  assert.ok(at.every((x, i) => x > 0 && (i === 0 || x > at[i - 1])), `i passi in ordine: ${at.join(", ")}`);
  assert.ok(!short.includes(">Leggi tutto<"), "una descrizione corta si legge tutta");
  assert.deepEqual(filled(short), ["Sì, è così"]);
  const long = html(view({ kind: "referente", check: CHECK(null, "Le richieste arrivano per email, per telefono e dal sito. ".repeat(8)) }));
  assert.match(long, /<blockquote[^>]*class="[^"]*\bline-clamp-6\b/);
  assert.ok(long.includes(">Leggi tutto<"));
});

test("passo 2: «Ti tornano queste stime?» una volta, «Sì · Meno · Di più · Non lo so», il commento dopo una scelta diversa da «Sì»", () => {
  const confirmed = { confirm: "si" as const, note: null, estimate: null, timesPerMonth: null, minutesEach: null, stale: false, savedAt: null };
  const at = (draft: ReferentBenefitView["draft"]) => html(view({ kind: "referente", check: { ...CHECK([row("tempo-1", draft)])!, draft: confirmed } }), "2");
  const blank = at(null);
  assert.match(blank, /<h2[^>]*>Ti tornano queste stime\?<\/h2>/);
  assert.ok(blank.includes("Preparazione dei preventivi: circa 120 volte al mese, 20 minuti ogni volta."));
  assert.equal(visible(blank).split("Ti torna").length - 1, 1, "«Ti torna» solo nel titolo");
  assert.deepEqual(shownButtons(blank.slice(blank.indexOf('data-slot="referent-benefit"'))).slice(0, 4), ["Sì", "Meno", "Di più", "Non lo so"]);
  assert.ok(!blank.includes(T.addComment), "nessun commento prima di una scelta");
  assert.deepEqual(filled(blank), ["Avanti"]);
  const base = { timesPerMonth: null, minutesEach: null, eurYear: null, comment: null, stale: false };
  assert.ok(!at({ ...base, answer: "si" }).includes(T.addComment), "«Sì»: niente commento");
  for (const answer of ["meno", "piu", "non_so"] as const) assert.ok(at({ ...base, answer }).includes(T.addComment), answer);
});

const MSG = (over: Partial<ReferentThreadMessageView> & Pick<ReferentThreadMessageView, "id" | "side" | "kind">): ReferentThreadMessageView => ({
  anchor: "domanda",
  needId: N[0],
  componentKey: null,
  text: "Al mese o all'anno?",
  createdAt: "2026-11-09T10:00:00.000Z",
  replyTo: null,
  waiting: false,
  fresh: false,
  ...over,
});

test("lavoro finito: il grazie, «Scrivi al team» pieno, «Le tue risposte (n)» chiuso con «Modifica» dentro", () => {
  const done = view({ state: "completata", questions: [sent(0), sent(1, { editable: false }), question(2, { state: "gestita" })], thread: { followUp: true, open: true, messages: [] } });
  const markup = html(done);
  assertKit(markup);
  assert.ok(!markup.includes("ti chiede alcune informazioni"), "solo il titolo sopra il grazie");
  assert.match(markup, /<h2[^>]*>Hai risposto il 03\/11\. Grazie!<\/h2>/);
  assert.deepEqual(filled(markup), ["Scrivi al team"]);
  assert.match(markup, /<details[^>]*data-slot="referent-sent"[^>]*>\s*<summary[^>]*>[\s\S]*?Le tue risposte \(3\)<\/summary>/, "chiuso, con il conteggio");
  assert.doesNotMatch(markup, /<details[^>]*\bopen\b/);
  const fold = markup.slice(markup.indexOf('data-slot="referent-sent"'));
  assert.deepEqual(shownButtons(fold), ["Modifica"], "dentro, solo «Modifica» dove si può ancora");
  for (const gone of [">Aggiungi qualcosa<", ">Ho un dubbio<"]) assert.ok(!markup.includes(gone), gone);
  // Prima del primo tocco: tre controlli in vista, il pulsante pieno, il riepilogo chiuso, il link all'informativa.
  const controls = markup.match(/<(button|summary)\b/g) ?? [];
  assert.equal(controls.length - (fold.match(/<button\b/g) ?? []).length, 3, "«Scrivi al team», «Le tue risposte», «Come usiamo le tue risposte»");
});

test("«Novità»: il titolo della scheda è la domanda del team, la riga grigia dice dove; il tipo senza numeri; un solo pulsante pieno", () => {
  const clar = MSG({ id: "77777777-0000-4000-8000-000000000001", side: "team", kind: "chiarimento", waiting: true });
  const news = view({ state: "completata", questions: [sent(0), sent(1)], thread: { followUp: true, open: true, messages: [clar] } });
  const markup = html(news);
  assertKit(markup);
  assert.match(markup, /<h2[^>]*>Novità<\/h2>/);
  assert.match(markup, /<h3[^>]*>Al mese o all'anno\?<\/h3>\s*<p[^>]*>Sulla domanda «Quanti preventivi fate in un mese\?»<\/p>/);
  for (const gone of ["Da completare", "Hai una novità", "1 di 1", "Il team chiede", "Già inviato"]) assert.ok(!visible(markup).includes(gone), gone);
  assert.ok(markup.includes("Le tue risposte (2)"));
  assert.deepEqual(filled(markup), ["Invia"]);
  assert.match(markup, /data-slot="referent-progress"[^>]*>0 di 1 · salvato<\/p>/, "un solo numero, con il salvataggio accanto");
  assert.ok(markup.includes(">Scrivi al team<"), "«Scrivi al team», bordato: il pieno è «Invia»");
});

test("le due schede di servizio: un link che non vale più, un errore con il solo «Riprova»", () => {
  const gone = render(h(card.StateScreen, { kind: "gone" }));
  assert.match(gone, /<h1[^>]*>Questo link non vale più\.<\/h1>/);
  assert.ok(gone.includes("Rispondi all'email che hai ricevuto: arriva a chi ti ha scritto."));
  assert.doesNotMatch(gone, /<button|<a\b|<footer/);
  assert.ok(gone.includes(">Unbundle<"), "senza cliente, il marchio");
  const error = render(h(card.StateScreen, { kind: "error" }));
  assert.match(error, /<h1[^>]*>Questa pagina non si è caricata\.<\/h1>/);
  assert.ok(error.includes("Le risposte che hai già inviato sono salve."), "le parole di `/r`");
  assert.deepEqual(shownButtons(error), ["Riprova"]);
  assert.deepEqual(filled(error), ["Riprova"]);
});
