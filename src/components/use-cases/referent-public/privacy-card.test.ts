import test, { before } from "node:test";
import assert from "node:assert/strict";
import { REFERENT_ERROR_MESSAGES, REFERENT_PRIVACY_NOTICE, REFERENT_PUBLIC_TEXT, fillText, privacyNoticeView } from "../../../lib/use-cases/referent/labels.ts";
import { findHubForbidden } from "../../../lib/use-cases/copy-guard.ts";
import { enableTsxImports } from "../detail/referent/tsx-test-loader.ts";

// (Rilascio 9b) «Prima di iniziare» resa in HTML, senza database: il testo è quello che la vista manda, mai quello della
// pagina; quando torna a metà visita dice che quello che è scritto resta; senza un testo della versione da accettare
// chiede di ricaricare la pagina, senza «Iniziamo». Sotto una risposta già inviata il campo resta montato, nascosto,
// sotto l'informativa. Dati inventati.

let card: typeof import("./privacy-card.tsx");
let thread: typeof import("./thread.tsx");
let render: (element: unknown) => string;
let h: (type: unknown, props: unknown) => unknown;

before(async () => {
  await enableTsxImports();
  card = await import("./privacy-card.tsx");
  thread = await import("./thread.tsx");
  const react = await import("react");
  h = (type, props) => react.createElement(type as never, props as never);
  const { renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string };
  render = (element) => renderToStaticMarkup(element).replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
});

const noop = () => {};
const SERVER = privacyNoticeView({ company: "Cliente di prova", expires: "26 novembre 2026", requester: "Persona di prova", contact: "privacy@example.test" });
/** Un testo che la pagina non ha dentro: arriva solo dalla vista. */
const NEXT = { ...SERVER, version: "ucq-2027-01-1", lead: "Abbiamo cambiato due cose.", summary: ["Primo punto nuovo.", "Secondo punto nuovo."] };

test("il testo è quello della vista, con «Iniziamo»; la riga «resta qui» solo quando l'informativa torna", () => {
  const html = render(h(card.PrivacyCard, { texts: NEXT, busy: false, error: null, onAccept: noop }));
  for (const text of [NEXT.title, NEXT.lead, ...NEXT.summary, NEXT.fullTextLabel, ...NEXT.paragraphs, NEXT.button]) assert.ok(html.includes(text), text);
  assert.ok(!html.includes(REFERENT_PRIVACY_NOTICE.lead), "mai il testo della pagina");
  assert.ok(!html.includes("Quello che hai scritto resta qui"));
  const again = render(h(card.PrivacyCard, { texts: NEXT, again: true, busy: false, error: null, onAccept: noop }));
  const line = fillText(REFERENT_PUBLIC_TEXT.privacyAgain, { bottone: NEXT.button });
  assert.equal(line, "Abbiamo aggiornato l'informativa. Quello che hai scritto resta qui: leggila e premi «Iniziamo» per continuare.");
  assert.ok(again.includes(line));
  assert.deepEqual(findHubForbidden(line, "esterno"), [], "calma, senza parole vietate");
  assert.doesNotMatch(line, /\b(token|MCP|workflow|versione|ucq-)\b/i);
});

test("senza il testo della versione da accettare: «Ricarica la pagina», mai «Iniziamo» sotto un altro testo", () => {
  const html = render(h(card.PrivacyCard, { texts: null, again: true, busy: false, error: null, onAccept: noop }));
  assert.ok(html.includes(REFERENT_PRIVACY_NOTICE.title));
  assert.ok(html.includes(REFERENT_ERROR_MESSAGES.informativa_aggiornata));
  assert.ok(html.includes(REFERENT_PUBLIC_TEXT.error.reload));
  assert.ok(!html.includes(`>${REFERENT_PRIVACY_NOTICE.button}<`), "nessun «Iniziamo»");
  for (const line of [...SERVER.summary, ...SERVER.paragraphs, REFERENT_PRIVACY_NOTICE.lead]) assert.ok(!html.includes(line), "nessun testo da accettare");
  assert.equal([...html.matchAll(/<button/g)].length, 1, "un solo pulsante");
});

test("sotto una risposta già inviata il campo aperto resta montato, nascosto, sotto l'informativa", () => {
  const base = {
    token: "ucq_abcdefghijklmnopqrstuvwxyz012345",
    targetKey: "g",
    subject: "Caso di prova",
    messages: [],
    actions: ["doubt"],
    today: "2026-11-18",
    composer: "doubt",
    onComposer: noop,
    primary: false,
    sent: false,
    onSent: noop,
    onStale: noop,
  };
  const gate = h(card.PrivacyCard, { texts: NEXT, again: true, busy: false, error: null, onAccept: noop });
  const gated = render(h(thread.ThreadItem, { ...base, privacyGate: gate }));
  assert.ok(gated.includes(NEXT.lead), "l'informativa al posto del campo");
  assert.match(gated, /<div hidden="">\s*<form[^>]*data-slot="referent-thread-composer"/, "il campo c'è ancora, nascosto");
  const open = render(h(thread.ThreadItem, { ...base, privacyGate: null }));
  assert.match(open, /<div>\s*<form[^>]*data-slot="referent-thread-composer"/, "senza informativa il campo si vede, nello stesso posto");
  assert.ok(!open.includes(NEXT.lead));
});
