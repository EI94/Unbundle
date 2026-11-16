import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { installAppModules } from "../../lib/ai/claude-test-kit.ts";
import { CONTEXT_TEXT } from "../../lib/context/text.ts";
import type { AiConsentNoticeData } from "../../lib/db/queries/context-consent.ts";
import { enableTsxImports } from "../use-cases/detail/referent/tsx-test-loader.ts";
import { CONSENT_OK, chatConsentFrom, chatConsentPath, composerState, isConsentError, loadChatConsent, type ChatConsent } from "./chat-consent.ts";

// (Rilascio 9a, RILASCIO-9a-COSTRUZIONE.md §6.3) L'ok ai sub-responsabili nella chat di Discovery e di mappatura: la
// rotta che lo dice (`GET /api/context/<ws>/consent`), la chat vera resa sul server (useChat finto) con l'avviso al
// posto del campo per scrivere e il campo che torna dopo l'ok, e l'avviso calmo dopo un caricamento senza l'ok.

type State = {
  actor: { ok: true; actor: Record<string, unknown> } | { ok: false; status: 401 | 404 };
  notice: AiConsentNoticeData | null;
  asked: unknown[];
  chatError?: Error;
};
const state: State = { actor: { ok: false, status: 401 }, notice: null, asked: [] };
(globalThis as { __consentProva?: State }).__consentProva = state;

await installAppModules({
  "@/lib/context/server/actor": `export async function contextActorFromSession() { return globalThis.__consentProva.actor; }`,
  "@/lib/db/queries/context-consent": `export async function loadAiConsentNotice(input) { globalThis.__consentProva.asked.push(input); return globalThis.__consentProva.notice; }`,
  "@ai-sdk/react": `export function useChat() { return { messages: [], status: "ready", error: globalThis.__consentProva.chatError, sendMessage() {} }; }`,
  "@/lib/actions/uc-subprocessors": `export async function declareSubprocessorsAction() { return { ok: true }; }`,
  "next/navigation": `export function useRouter() { return { refresh() {}, push() {} }; }`,
});
await enableTsxImports();
const { GET } = await import("../../app/api/context/[workspaceId]/consent/route.ts");
const { ChatInterface } = await import("./chat-interface.tsx");
const { uploadedNotice } = await import("../dashboard/document-upload.tsx");

const WS = "8a6f3c2e-1b4d-4e5f-9a7b-0c1d2e3f4a5b";
const NOTICE: AiConsentNoticeData = {
  workspaceId: WS,
  companyName: "Cliente di prova",
  declarer: "lateral_space",
  listVersion: "2026-10",
  statement: "Lateral Space registra l'ok per conto del cliente di prova.",
  suppliers: ["Anthropic"],
  buttonLabel: "Registra l'ok di Cliente di prova",
  settingsHref: `/dashboard/${WS}/settings#sub-responsabili`,
};

const decode = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");

// ─── La rotta ────────────────────────────────────────────────────────

async function ask() {
  const response = await GET(new Request(`http://localhost/api/context/${WS}/consent`), { params: Promise.resolve({ workspaceId: WS }) });
  return { status: response.status, body: (await response.json()) as Record<string, unknown>, cache: response.headers.get("cache-control") };
}

test("la rotta dell'ok: 401 senza sessione, 404 senza accesso o per chi segue solo un corso; mai in cache", async () => {
  state.actor = { ok: false, status: 401 };
  assert.deepEqual(await ask(), { status: 401, body: { error: "non_autorizzato", message: CONTEXT_TEXT.errors.denied }, cache: "no-store" });
  state.actor = { ok: false, status: 404 };
  assert.deepEqual(await ask(), { status: 404, body: { error: "non_trovato", message: CONTEXT_TEXT.errors.notFound }, cache: "no-store" });
  state.actor = { ok: true, actor: { workspaceId: WS, userId: "persona-1", role: "learner", isLateralSpace: false, channel: "web" } };
  assert.equal((await ask()).status, 404);
});

test("la rotta dell'ok: { ok: true } con l'ok; senza, l'avviso per chi guarda", async () => {
  state.actor = { ok: true, actor: { workspaceId: WS, userId: "persona-1", role: "contributor", isLateralSpace: false, channel: "web" } };
  state.asked = [];
  state.notice = null;
  assert.deepEqual(await ask(), { status: 200, body: { ok: true }, cache: "no-store" });
  state.notice = NOTICE;
  assert.deepEqual((await ask()).body, { ok: false, notice: NOTICE });
  assert.deepEqual(state.asked[0], { workspaceId: WS, userId: "persona-1", role: "contributor" });
});

// ─── La chat ─────────────────────────────────────────────────────────

function render(consent?: ChatConsent) {
  const props = { workspaceId: WS, conversationType: "leadership_setup", suggestions: ["Parliamo dell'azienda"], ...(consent ? { initialConsent: consent } : {}) };
  return decode(renderToStaticMarkup(createElement(ChatInterface, props)));
}

test("senza l'ok la chat mostra l'avviso calmo e non il campo per scrivere, né i suggerimenti", () => {
  delete state.chatError;
  const html = render({ state: "missing", notice: NOTICE });
  assert.match(html, /data-testid="ai-consent-notice"/);
  assert.ok(html.includes(CONTEXT_TEXT.consent.title));
  assert.ok(html.includes(CONTEXT_TEXT.consent.chatHint));
  assert.ok(html.includes("Registra l'ok di Cliente di prova"));
  assert.equal(html.includes("<textarea"), false, "niente campo per scrivere");
  assert.equal(html.includes("Parliamo dell'azienda"), false, "niente suggerimenti da mandare");
});

test("con l'ok il campo c'è e si scrive; mentre si controlla resta spento", () => {
  delete state.chatError;
  const open = render(CONSENT_OK);
  assert.ok(open.includes("<textarea"));
  assert.equal(/<textarea[^>]*\sdisabled=""/.test(open), false);
  assert.equal(open.includes('data-testid="ai-consent-notice"'), false);
  assert.ok(open.includes("Parliamo dell'azienda"));
  const checking = render();
  assert.match(checking, /<textarea[^>]*\sdisabled=""/, "spento finché non si sa");
});

test("dopo l'ok il campo torna: la chat richiede l'ok e passa dall'avviso al campo", async () => {
  const replies = [{ ok: false, notice: NOTICE }, { ok: true }];
  const asked: string[] = [];
  const fetchImpl = async (input: string) => {
    asked.push(input);
    return Response.json(replies.shift());
  };
  const before = await loadChatConsent(WS, fetchImpl);
  assert.equal(composerState(before), "avviso");
  assert.equal(render(before).includes("<textarea"), false);
  const after = await loadChatConsent(WS, fetchImpl);
  assert.deepEqual(after, CONSENT_OK);
  assert.ok(render(after).includes("<textarea"));
  assert.deepEqual(asked, [chatConsentPath(WS), chatConsentPath(WS)]);
  // Nel componente: la domanda parte al montaggio, e di nuovo dopo l'ok (e dopo un 403 della rotta della chat).
  const source = readFileSync(new URL("./chat-interface.tsx", import.meta.url), "utf8");
  assert.match(source, /useEffect\(\(\) => checkConsent\(\), \[checkConsent\]\)/);
  assert.match(source, /onGranted=\{\(\) => \{\s+setConsent\(CONSENT_CHECKING\);\s+checkConsent\(\);\s+\}\}/);
  assert.match(source, /refusedForConsent \? checkConsent\(\) : undefined/);
});

test("la risposta della rotta: solo un avviso ben fatto ferma il campo; errori e reti che non rispondono lasciano scrivere", async () => {
  assert.deepEqual(chatConsentFrom(200, { ok: false, notice: NOTICE }), { state: "missing", notice: NOTICE });
  assert.deepEqual(chatConsentFrom(200, { ok: true }), CONSENT_OK);
  assert.deepEqual(chatConsentFrom(200, { ok: false, notice: { workspaceId: WS } }), CONSENT_OK);
  assert.deepEqual(chatConsentFrom(404, { ok: false, notice: NOTICE }), CONSENT_OK);
  assert.deepEqual(await loadChatConsent(WS, async () => { throw new Error("rete"); }), CONSENT_OK);
  assert.equal(chatConsentPath("ws/1"), "/api/context/ws%2F1/consent");
});

test("un 403 della rotta della chat senza l'ok: niente riquadro d'errore, la chat richiede l'ok", () => {
  state.chatError = new Error(JSON.stringify({ error: "ok_fornitori_mancante", message: "Serve l'ok ai fornitori di AI" }));
  assert.equal(isConsentError(state.chatError), true);
  assert.equal(isConsentError(new Error("Failed to fetch")), false);
  assert.equal(render(CONSENT_OK).includes("Errore imprevisto"), false);
  state.chatError = new Error("qualcosa non va");
  assert.ok(render(CONSENT_OK).includes("Errore imprevisto"), "gli altri errori restano");
  delete state.chatError;
});

// ─── Dopo un caricamento ─────────────────────────────────────────────

test("un documento caricato senza l'ok: l'avviso calmo e «Apri» verso Impostazioni; con l'ok il messaggio di sempre", () => {
  assert.deepEqual(uploadedNotice({ fileName: "verbale.docx", ai: "ok_mancante" }, WS), {
    text: CONTEXT_TEXT.documents.savedNoConsent,
    action: { label: CONTEXT_TEXT.documents.openSettings, href: `/dashboard/${WS}/settings#sub-responsabili` },
  });
  assert.deepEqual(uploadedNotice({ fileName: "verbale.docx", ai: "ok" }, WS), { text: "verbale.docx caricato e analizzato", action: null });
  const source = readFileSync(new URL("../dashboard/document-upload.tsx", import.meta.url), "utf8");
  assert.match(source, /toast\(notice\.text, \{ action: \{ label: action\.label, onClick: \(\) => router\.push\(action\.href\) \} \}\)/);
  assert.doesNotMatch(source, /toast\.error\(notice/, "niente rosso per l'ok mancante");
});
