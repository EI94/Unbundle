import test, { before } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { enableTsxImports } from "../../use-cases/detail/referent/tsx-test-loader.ts";
import { SIGN_PANEL_PARAM, SIGN_PANEL_TEXT, listIntro, signPanelState, signaturesPanelHref } from "./approval-texts.ts";
import { landingSegment } from "../../../lib/uc/views/case-shell.ts";
import type { ApprovalStep } from "../../../lib/uc/views/approvals.ts";

// Rilascio 10, §3.5 e §3.18: le firme in un pannello (`?firma=1`), aperto dal pulsante pieno; `/firme` porta lì con un
// 308 che tiene la query. «Leggile con calma» la legge solo il cliente.

const BASE = "/dashboard/11111111-1111-4111-8111-111111111111/casi-duso/22222222-2222-4222-8222-222222222222";
const CASE_DIR = "src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]";
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("/firme porta alla pagina d'arrivo di chi firma, con il pannello aperto e la query di prima", () => {
  assert.equal(SIGN_PANEL_PARAM, "firma");
  assert.equal(signaturesPanelHref(BASE, null), `${BASE}?firma=1`);
  assert.equal(signaturesPanelHref(`${BASE}/`, null), `${BASE}?firma=1`, "una barra in fondo alla radice non cambia niente");
  assert.equal(signaturesPanelHref(BASE, null, new URLSearchParams("da=email&x=1")), `${BASE}?da=email&x=1&firma=1`);
  assert.equal(signaturesPanelHref(BASE, null, new URLSearchParams("firma=0&da=email")), `${BASE}?da=email&firma=1`, "un solo «firma»");
  // L'approvatore privacy non apre la Panoramica: arriva su Privacy, con il pannello.
  assert.equal(signaturesPanelHref(BASE, landingSegment(["approvatore_privacy"])), `${BASE}/privacy?firma=1`);
  for (const role of ["ls_lead", "owner_cliente"] as const) assert.equal(signaturesPanelHref(BASE, landingSegment([role])), `${BASE}?firma=1`, role);
});

test("il pannello: le firme, la pausa o niente da firmare", () => {
  assert.equal(signPanelState({ status: "raccolta", readOnly: false }), "firma");
  assert.equal(signPanelState({ status: "sospeso", readOnly: false }), "pausa");
  assert.equal(signPanelState({ status: "chiuso", readOnly: false }), "nulla");
  assert.equal(signPanelState({ status: "raccolta", readOnly: true }), "nulla");
  assert.equal(SIGN_PANEL_TEXT.title, "Firma", "il verbo di §4, non «Da firmare»");
  assert.doesNotMatch(SIGN_PANEL_TEXT.paused, /\bcaso\b/, "a schermo «realizzazione»");
});

test("/firme è una route che risponde 308: accesso, ruolo di chi firma, poi il redirect; nessuna pagina", () => {
  assert.equal(existsSync(`${CASE_DIR}/firme/page.tsx`), false, "una pagina sotto loading.tsx risponderebbe 200 con meta refresh");
  const src = strip(readFileSync(`${CASE_DIR}/firme/route.ts`, "utf8"));
  const order = ["requireWorkspacePage(workspaceId)", "findDossierAccess(", 'canOpenShellPage("firme", caseAccess.roles)', "notFound()", "landingSegment(caseAccess.roles)", "permanentRedirect(signaturesPanelHref("];
  let last = -1;
  for (const needle of order) {
    const at = src.indexOf(needle);
    assert.ok(at > last, `${needle} manca o arriva troppo presto`);
    last = at;
  }
  assert.match(src, /request\.nextUrl\.searchParams/, "la query di prima resta");
});

test("il pannello apre da `?firma=1` solo a chi firma, rilegge le firme a ogni apertura e chiude togliendo il parametro", () => {
  const src = strip(readFileSync(new URL("./sign-panel.tsx", import.meta.url), "utf8"));
  assert.match(src, /searchParams\.get\(SIGN_PANEL_PARAM\) === "1" && canOpenShellPage\("firme", roles\)/);
  assert.match(src, /await loadApprovalsAction\(workspaceId, caseId\)/);
  assert.match(src, /next\.delete\(SIGN_PANEL_PARAM\)/);
  assert.match(src, /<SideSheet open=\{open\} onClose=\{close\} title=\{SIGN_PANEL_TEXT\.title\}>/);
  assert.match(src, /<CaseApprovals /, "lo stesso ApprovalRunner, con le stesse impronte");
});

const STEP: ApprovalStep = {
  kind: "gate",
  targetId: "33333333-3333-4333-8333-333333333333",
  designation: "owner",
  title: "Via allo sviluppo",
  lines: ["Lateral Space può iniziare a costruire la soluzione."],
  textHash: "h",
  canReject: true,
  waitingForLs: false,
  side: "ls",
  otherSideSigned: false,
  summary: "Smistamento delle richieste",
  intro: null,
  details: [],
  itemId: null,
  subject: null,
  technical: [],
};

let render: (variant: "ls" | "cliente") => string;

before(async () => {
  await enableTsxImports();
  const react = await import("react");
  const { renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string };
  const { ApprovalRunner } = await import("./approval-runner.tsx");
  render = (variant) => renderToStaticMarkup(react.createElement(ApprovalRunner, { approvals: [STEP], onDecide: async () => ({ ok: true, message: "" }), variant, headingLevel: 3 }));
});

test("«Leggile con calma» la legge solo il cliente; l'elenco e «Inizia» restano per tutti", () => {
  const intro = listIntro(1);
  const ls = render("ls");
  assert.ok(ls.includes(intro.lead));
  assert.ok(!ls.includes(intro.calm), "Lateral Space non legge il testo scritto per il cliente");
  assert.ok(ls.includes("Inizia") && ls.includes("Via allo sviluppo"));
  const client = render("cliente");
  assert.ok(client.includes(intro.lead) && client.includes(intro.calm), "il cliente sì, come sul link");
});
