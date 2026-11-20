import test from "node:test";
import assert from "node:assert/strict";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { enableTsxImports } from "../../use-cases/detail/referent/tsx-test-loader.ts";
import { FIXTURE_IDS, fixtureBoard } from "../../../lib/mappatura/board-fixture.ts";
import type { MappingBoard } from "../../../lib/mappatura/board-model.ts";
import { CHAT_REFUSAL_NOTICE, type ChatUIMessage } from "../../agent/chat-view.ts";
import { installAppModules } from "../../../lib/ai/claude-test-kit.ts";
import { CONTEXT_TEXT } from "../../../lib/context/text.ts";
import type { AiConsentNoticeData } from "../../../lib/db/queries/context-consent.ts";
import type { ChatConsent } from "../../agent/chat-consent.ts";

// (Mappatura board) L'assistente accanto alla board (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.5, §5, §7.4), reso sul
// server dentro lo store vero della board: i due bottoni piccoli, il benvenuto, i suggerimenti, la conversazione con
// le etichette della board, il campo con l'invio contornato (il bottone pieno della schermata è quello della testa).
// Poi i pezzi: un messaggio, l'errore, le proposte dai documenti, il caricamento.

// (Rilascio insieme) L'avviso dell'ok ai sub-responsabili di «Contesto» (rilascio 9a): la sua azione vive sul server, il
// router è quello di Next.
await installAppModules({
  "@/lib/actions/uc-subprocessors": `export async function declareSubprocessorsAction() { return { ok: true }; }`,
  "next/navigation": `export function useRouter() { return { refresh() {}, push() {} }; }`,
});
await enableTsxImports();
const { BoardProvider } = await import("../store/use-board.tsx");
const { ChatError, Companion, MessageText, MessageView } = await import("./companion.tsx");
const { Documents, uploadDocuments, uploadToast, uploadToastAction } = await import("./documents.tsx");
const { ProposalList, proposalsNext } = await import("./proposals.tsx");

const I = FIXTURE_IDS;
const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);
const h = <P extends object>(type: (props: P) => ReactNode, props: Omit<P, "children"> | null = null, ...children: ReactNode[]) =>
  createElement(type as unknown as FunctionComponent<Omit<P, "children">>, props, ...children);
const decode = (text: string) => text.replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");

function companion(options: { board?: MappingBoard; hasDocuments?: boolean; initialMessages?: Array<{ id: string; role: "user" | "assistant"; content: string }>; initialConsent?: ChatConsent } = {}) {
  return decode(
    html(
      h(
        BoardProvider,
        { workspaceId: I.workspace, departmentId: I.unit, userId: I.user, initial: options.board ?? fixtureBoard() },
        h(Companion, { workspaceId: I.workspace, departmentId: I.unit, unitName: "Ufficio acquisti", teamSize: 6, initialMessages: options.initialMessages ?? [], hasDocuments: options.hasDocuments ?? false, initialConsent: options.initialConsent }),
      ),
    ),
  );
}

test("l'assistente di un'unità senza conversazione: il benvenuto in una riga, tre suggerimenti, «Documenti ▾» con «Carica documenti», il campo", () => {
  const out = companion();
  assert.match(out, /^<div class="b-comp" data-b="companion">/);
  // (Rilascio 10, §3.7) Il benvenuto in una riga sola, con il nome in grassetto; tre suggerimenti.
  assert.match(out, /<p>Mappiamo il lavoro di <strong>Ufficio acquisti<\/strong>: su cosa va più tempo in una settimana tipo\?<\/p>/);
  assert.deepEqual([...out.matchAll(/<button type="button" class="b-fchip">([^<]+)<\/button>/g)].map((match) => match[1]), [
    "Le attività principali sono quattro o cinque",
    "Molto tempo va in report e controlli",
    "Tanti passaggi si fanno a mano",
  ]);
  // Un solo «Documenti ▾», chiuso; dentro un solo bottone finché l'unità non ha documenti («Proponi passi» dopo il primo).
  assert.match(out, /<button type="button" class="b-btn b-small" aria-expanded="false" aria-controls="([^"]+)" data-b="documents-menu">Documenti<span class="b-caret" aria-hidden="true">▾<\/span><\/button><div class="b-comp-tools" id="\1" hidden="">/);
  assert.match(out, /class="b-btn b-small" data-b="button" data-variant="outline">Carica documenti<\/button>/);
  assert.doesNotMatch(out, /Proponi passi dai documenti/);
  assert.match(out, /<input type="file" accept="\.pdf,\.txt,\.csv,\.md,\.docx,\.xlsx,\.pptx" multiple="" hidden="" tabindex="-1" aria-hidden="true" data-b="companion-files"\/>/);
  // Il campo, con il suo nome e il segnaposto; l'invio è contornato: il bottone pieno della schermata è nella testa.
  assert.match(out, /<textarea class="b-input b-comp-input" rows="1" aria-label="Messaggio per l'assistente" placeholder="Scrivi qui…" data-b="companion-input"><\/textarea>/);
  assert.match(out, /<button aria-label="Invia" title="Invia" data-action="send" type="submit" class="b-btn" data-b="button" data-variant="outline">/);
  assert.doesNotMatch(out, /data-variant="primary"/);
  assert.match(out, /<div class="b-comp-log" role="log" aria-busy="false" data-b="companion-log">/);
});

test("con i documenti: «Proponi passi dai documenti» e la frase in più del benvenuto; una board in sola lettura spegne i due bottoni", () => {
  const out = companion({ hasDocuments: true });
  assert.match(out, /data-action="propose" type="button" class="b-btn b-small" data-b="button" data-variant="outline">Proponi passi dai documenti<\/button>/);
  assert.match(out, /Uso anche i documenti caricati\./);
  const readOnly = companion({ hasDocuments: true, board: fixtureBoard({ readOnly: true }) });
  assert.equal(readOnly.match(/<button disabled=""[^>]*class="b-btn b-small"/g)?.length, 2, "spenti dal primo disegno (F9)");
});

test("una conversazione salvata: i messaggi com'erano, senza benvenuto né suggerimenti", () => {
  const out = companion({
    initialMessages: [
      { id: "m1", role: "user", content: "Le richieste arrivano per posta." },
      { id: "m2", role: "assistant", content: "Chi le **legge** per primo?" },
    ],
  });
  assert.match(out, /<div class="b-comp-msg" data-role="user"><div class="b-comp-text"><p>Le richieste arrivano per posta\.<\/p><\/div><\/div>/);
  assert.match(out, /<div class="b-comp-msg" data-role="assistant"><div class="b-comp-text"><p>Chi le <strong>legge<\/strong> per primo\?<\/p><\/div><\/div>/);
  assert.doesNotMatch(out, /Mappiamo il lavoro di|b-fchip/);
});

test("una risposta: il testo, poi i tool con le etichette della board; finito con la spunta, in corso a tratteggio; un tool fallito no", () => {
  const message: ChatUIMessage = {
    id: "a1",
    role: "assistant",
    parts: [
      { type: "step-start" },
      { type: "tool-saveActivity", toolCallId: "t1", state: "output-available", input: {}, output: { success: true } },
      { type: "tool-linkActivityDependency", toolCallId: "t2", state: "output-available", input: {}, output: { success: false, message: "no" } },
      { type: "tool-updateActivity", toolCallId: "t3", state: "input-available", input: {} },
    ],
  };
  const arriving = html(h(MessageView, { message, arriving: true }));
  assert.match(arriving, /<span class="b-st-chip b-ok" data-tone="ok" data-b="status-chip"><svg[^]*?<\/svg>Passo salvato<\/span>/);
  assert.match(arriving, /<span class="b-st-chip b-ver" data-tone="check" data-b="status-chip">Aggiorno il passo<\/span>/);
  assert.doesNotMatch(arriving, /Passi collegati|Collego i passi/);
  // Finita: restano i tool finiti, con il testo.
  const done = decode(html(h(MessageView, { message: { ...message, parts: [...message.parts, { type: "text", text: "Fatto:\n- primo\n- secondo" }] }, arriving: false })));
  assert.match(done, /<div class="b-comp-text"><p>Fatto:<\/p><div class="b-comp-li">primo<\/div><div class="b-comp-li">secondo<\/div><\/div><div class="b-comp-progress"><span class="b-st-chip b-ok"/);
  assert.doesNotMatch(done, /Aggiorno il passo/);
  // Rifiutata: l'avviso di sempre al posto del testo.
  const refused = decode(html(h(MessageView, { message: { id: "a2", role: "assistant", metadata: { finishReason: "content-filter" }, parts: [{ type: "text", text: "Ecco come" }] }, arriving: false })));
  assert.match(refused, new RegExp(`data-refused=""><p class="b-comp-note">${CHAT_REFUSAL_NOTICE}</p></div>`));
  assert.doesNotMatch(refused, /Ecco come/);
  // Una risposta ancora vuota non lascia una riga vuota.
  assert.equal(html(h(MessageView, { message: { id: "a3", role: "assistant", parts: [{ type: "step-start" }] }, arriving: false })), "");
});

test("il testo di un messaggio: le righe, i trattini come elenco, il grassetto; nient'altro del markdown", () => {
  assert.equal(html(h(MessageText, { text: "Uno **due**\n— tre\n\n# quattro" })), '<div class="b-comp-text"><p>Uno <strong>due</strong></p><div class="b-comp-li">tre</div><p></p><p># quattro</p></div>');
});

test("l'errore della chat: un avviso, con le parole della casa e mai il messaggio dell'errore", () => {
  const out = decode(html(h(ChatError, { error: new Error("Unit not found: d1d1") })));
  assert.equal(out, '<div class="b-comp-error" role="alert"><b>Errore</b><span>Qualcosa non ha funzionato. Riprova.</span></div>');
});

test("le proposte dai documenti: una riga da scegliere per proposta, con titolo, descrizione, tipo di lavoro, ore e strumenti", () => {
  const items = [
    { title: "Raccolta delle richieste", description: "Le richieste arrivano per e-mail.", workType: "enrichment" as const, estimatedHoursWeek: 4.5, toolsUsed: ["E-mail", " "], reasoning: "x" },
    { title: "Invio dell'ordine", description: "", reasoning: "y" },
  ];
  const out = decode(html(h(ProposalList, { items, chosen: new Set([0]), onToggle() {} })));
  assert.match(out, /^<div class="b-comp-props" data-b="proposals"><button type="button" class="b-comp-prop" aria-pressed="true"><span class="b-comp-tick" aria-hidden="true"><svg/);
  assert.match(out, /<b>Raccolta delle richieste<\/b><span>Le richieste arrivano per e-mail\.<\/span><small>Raccolta dati · 4,5 h a settimana<\/small><span class="b-chips"><span class="b-chip b-tool">E-mail<\/span><\/span>/);
  assert.match(out, /<button type="button" class="b-comp-prop" aria-pressed="false"><span class="b-comp-tick" aria-hidden="true"><\/span><span class="b-comp-prop-body"><b>Invio dell'ordine<\/b><\/span><\/button><\/div>$/);
  // Mentre i passi si aggiungono le righe restano raggiungibili ma non si cambiano (F1).
  let toggled = 0;
  const busy = ProposalList({ items, chosen: new Set(), busy: true, onToggle: () => void (toggled += 1) });
  assert.match(html(busy), /<button type="button" class="b-comp-prop" aria-pressed="false" aria-disabled="true"/);
  assert.doesNotMatch(html(busy), /disabled=""/);
  ((busy.props.children as Array<{ props: { onClick(): void } }>)[0].props.onClick)();
  assert.equal(toggled, 0);
});

test("il caricamento: un invio per file con il workspace e l'unità; il toast dice se è andato tutto", async () => {
  const sent: Array<{ url: string; fields: Record<string, string> }> = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const form = init?.body as FormData;
    sent.push({ url: String(url), fields: { workspaceId: String(form.get("workspaceId")), departmentId: String(form.get("departmentId")), file: (form.get("file") as File).name } });
    if ((form.get("file") as File).name === "rotto.pdf") throw new TypeError("Failed to fetch");
    return new Response("{}", { status: (form.get("file") as File).name === "grande.pdf" ? 400 : 200 });
  }) as typeof globalThis.fetch;
  const files = ["procedure.pdf", "grande.pdf", "rotto.pdf"].map((name) => new File(["x"], name, { type: "application/pdf" }));
  assert.deepEqual(await uploadDocuments(files, { workspaceId: I.workspace, departmentId: I.unit, fetch }), { uploaded: 1, failed: 2, consentMissing: 0 });
  assert.deepEqual(sent.map(({ url, fields }) => [url, fields.workspaceId, fields.departmentId, fields.file]), [
    ["/api/documents/upload", I.workspace, I.unit, "procedure.pdf"],
    ["/api/documents/upload", I.workspace, I.unit, "grande.pdf"],
    ["/api/documents/upload", I.workspace, I.unit, "rotto.pdf"],
  ]);
  assert.deepEqual([uploadToast({ uploaded: 2, failed: 0 }), uploadToast({ uploaded: 1, failed: 1 }), uploadToast({ uploaded: 0, failed: 0 })], [
    "Documento caricato.",
    "Caricamento non riuscito. Riprova.",
    "Caricamento non riuscito. Riprova.",
  ]);
  // Il bottone da solo: contornato e piccolo, spento se la board non si modifica.
  const out = html(h(BoardProvider, { workspaceId: I.workspace, departmentId: I.unit, userId: I.user, initial: fixtureBoard() }, h(Documents, { workspaceId: I.workspace, departmentId: I.unit, disabled: true, onUploaded() {} })));
  assert.match(out, /<button disabled="" data-action="upload" type="button" class="b-btn b-small"/);
});

// ─── (Rilascio insieme) L'ok ai sub-responsabili di «Contesto» (RILASCIO-9a-COSTRUZIONE.md §6.2, §6.3) ───

const NOTICE: AiConsentNoticeData = {
  workspaceId: I.workspace,
  companyName: "Cliente di prova",
  declarer: "lateral_space",
  listVersion: "2026-10",
  statement: "Lateral Space registra l'ok per conto del cliente di prova.",
  suppliers: ["Anthropic"],
  buttonLabel: "Registra l'ok di Cliente di prova",
  settingsHref: `/dashboard/${I.workspace}/settings#sub-responsabili`,
};

test("(rilascio insieme) senza l'ok ai sub-responsabili: l'avviso di «Contesto» al posto del campo, niente suggerimenti; i messaggi restano", () => {
  const out = companion({ initialConsent: { state: "missing", notice: NOTICE }, initialMessages: [{ id: "m1", role: "assistant", content: "Chi le legge per primo?" }] });
  assert.match(out, /<div class="b-comp-form" data-b="companion-consent">/);
  assert.match(out, /data-testid="ai-consent-notice" data-declarer="lateral_space"/);
  assert.ok(out.includes(CONTEXT_TEXT.consent.title) && out.includes(NOTICE.buttonLabel!), "l'avviso calmo con la sua azione");
  assert.ok(out.includes(`<p class="b-comp-note">${CONTEXT_TEXT.consent.chatHint}</p>`));
  assert.doesNotMatch(out, /<textarea|data-action="send"|b-fchip/, "niente campo, niente invio, niente suggerimenti");
  assert.match(out, /<p>Chi le legge per primo\?<\/p>/, "la conversazione di prima resta");
  // Con l'ok, o mentre si chiede, il campo c'è come sempre.
  for (const initialConsent of [{ state: "ok" } as const, { state: "checking" } as const, undefined]) {
    const open = companion({ initialConsent });
    assert.match(open, /<textarea class="b-input b-comp-input" rows="1"/, JSON.stringify(initialConsent));
    assert.doesNotMatch(open, /ai-consent-notice|companion-consent/);
  }
});

test("(rilascio insieme) «Proponi passi dai documenti» senza l'ok: la riga dell'ok, non «non emergono passi»", () => {
  const item = { title: "Raccolta delle richieste", description: "", reasoning: "x" };
  assert.deepEqual(proposalsNext({ activities: [], consentMissing: true }), { toast: CONTEXT_TEXT.consent.title });
  assert.deepEqual(proposalsNext({ activities: [] }), { toast: "Dai documenti non emergono passi chiari." });
  assert.deepEqual(proposalsNext({ activities: [item] }), { open: [item] });
});

test("(rilascio insieme) un documento salvato senza l'ok: il toast lo dice, con «Apri» verso i sub-responsabili in Impostazioni", async () => {
  const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const name = ((init?.body as FormData).get("file") as File).name;
    return Response.json({ id: "doc", sourceId: "fonte", fileName: name, summary: "", textRead: true, ai: name === "senza-ok.pdf" ? "ok_mancante" : "ok" });
  }) as typeof globalThis.fetch;
  const files = ["con-ok.pdf", "senza-ok.pdf"].map((name) => new File(["x"], name, { type: "application/pdf" }));
  const result = await uploadDocuments(files, { workspaceId: I.workspace, departmentId: I.unit, fetch });
  assert.deepEqual(result, { uploaded: 2, failed: 0, consentMissing: 1 });
  assert.equal(uploadToast(result), CONTEXT_TEXT.documents.savedNoConsent);
  const opened: string[] = [];
  const action = uploadToastAction(result, I.workspace, (href) => opened.push(href));
  assert.equal(action?.label, CONTEXT_TEXT.documents.openSettings);
  action?.run();
  assert.deepEqual(opened, [`/dashboard/${I.workspace}/settings#sub-responsabili`]);
  // Con l'ok, o con un caricamento non riuscito, niente riga dell'ok e niente «Apri».
  assert.equal(uploadToastAction({ uploaded: 1, failed: 0, consentMissing: 0 }, I.workspace, () => {}), undefined);
  assert.equal(uploadToast({ uploaded: 1, failed: 1, consentMissing: 1 }), "Caricamento non riuscito. Riprova.");
  assert.equal(uploadToastAction({ uploaded: 1, failed: 1, consentMissing: 1 }, I.workspace, () => {}), undefined);
});
