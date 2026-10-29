import test from "node:test";
import assert from "node:assert/strict";
import {
  CASE_STATUS_TONE,
  PAGES_WITHOUT_PRIMARY,
  UC_SHELL_PAGE_ROLES,
  activeTabKey,
  canOpenShellPage,
  caseHeadAlert,
  caseMenuFor,
  caseTabsFor,
  caseTrail,
  landingSegment,
  seesFilteredAudit,
  showsReadOnlyBadge,
  solutionSegmentsFor,
  stepHiddenOn,
  transitionNeedsReason,
} from "./case-shell.ts";
import { CASE_STATUS_TONE as LABELS_TONE } from "./labels.ts";
import { CASE_ROLES, type CaseRole } from "../vocab.ts";

const tabs = (role: CaseRole) => caseTabsFor([role]).map((t) => t.label);
const menu = (role: CaseRole, i: Partial<Parameters<typeof caseMenuFor>[1]> = {}) =>
  caseMenuFor([role], { pendingSignatures: 0, pastVia: false, exportable: false, ...i }).map((m) => m.label);

test("five tabs at most, by role as in DESIGN §2.3, never disabled ones", () => {
  assert.deepEqual(tabs("ls_lead"), ["Panoramica", "Domande", "Soluzione", "Valore", "Persone"]);
  assert.deepEqual(tabs("ls_analista"), ["Panoramica", "Domande", "Soluzione", "Valore", "Persone"]);
  assert.deepEqual(tabs("ls_sviluppatore"), ["Panoramica", "Domande", "Soluzione"]);
  assert.deepEqual(tabs("owner_cliente"), ["Panoramica", "Domande", "Soluzione", "Valore", "Persone"]);
  assert.deepEqual(tabs("ai_board"), ["Panoramica", "Soluzione", "Valore"]);
  assert.deepEqual(tabs("osservatore"), ["Panoramica", "Soluzione", "Valore"]);
  assert.deepEqual(tabs("approvatore_privacy"), [], "the privacy approver has no tab bar");
  for (const role of CASE_ROLES) assert.ok(caseTabsFor([role]).length <= 5, role);
});

test("everyone lands on the overview, the privacy approver on Privacy", () => {
  for (const role of ["ls_lead", "ls_analista", "ls_sviluppatore", "owner_cliente", "ai_board", "osservatore"] as const) {
    assert.equal(landingSegment([role]), null, role);
  }
  assert.equal(landingSegment(["approvatore_privacy"]), "privacy");
  for (const role of CASE_ROLES) assert.notEqual(landingSegment([role]), undefined, role);
});

test("the «⋯» menu shows only what serves, per role", () => {
  assert.deepEqual(menu("ls_lead", { pendingSignatures: 2, pastVia: true, exportable: true }), [
    "Da firmare (2)",
    "Privacy",
    "Attività",
    "Esporta…",
    "Sviluppo con Claude",
    "Impostazioni del caso",
  ]);
  assert.deepEqual(menu("ls_lead"), ["Privacy", "Attività", "Impostazioni del caso"], "no signatures, no via, nothing to export");
  assert.deepEqual(menu("ls_analista", { pendingSignatures: 3, pastVia: true, exportable: true }), ["Privacy", "Esporta…", "Sviluppo con Claude"]);
  assert.deepEqual(menu("ls_sviluppatore", { pastVia: true, exportable: true }), ["Esporta…", "Sviluppo con Claude"]);
  assert.deepEqual(menu("ls_sviluppatore"), [], "before the via the developer has nothing in the menu");
  assert.deepEqual(menu("owner_cliente", { pendingSignatures: 1, pastVia: true, exportable: true }), ["Da firmare (1)", "Privacy", "Attività", "Scarica in Excel"]);
  assert.deepEqual(menu("approvatore_privacy", { pendingSignatures: 1 }), ["Da firmare (1)", "Attività"]);
  assert.deepEqual(menu("approvatore_privacy"), ["Attività"]);
  for (const role of ["ai_board", "osservatore"] as const) assert.deepEqual(menu(role, { pendingSignatures: 4, pastVia: true }), [], role);
  const claude = caseMenuFor(["ls_lead"], { pendingSignatures: 0, pastVia: true, exportable: false }).find((m) => m.key === "claude");
  assert.equal(claude?.segment, "via#sviluppo-con-claude");
  const exp = caseMenuFor(["ls_lead"], { pendingSignatures: 0, pastVia: false, exportable: true }).find((m) => m.key === "esporta");
  assert.equal(exp?.segment, null, "export opens the panel");
});

test("page roles: settings for the case lead only, signatures for whoever signs", () => {
  assert.deepEqual([...UC_SHELL_PAGE_ROLES.impostazioni], ["ls_lead"]);
  assert.deepEqual([...UC_SHELL_PAGE_ROLES.firme].sort(), ["approvatore_privacy", "ls_lead", "owner_cliente"]);
  assert.deepEqual([...UC_SHELL_PAGE_ROLES.registro].sort(), ["approvatore_privacy", "ls_lead", "owner_cliente"]);
  for (const role of ["osservatore", "ai_board", "ls_sviluppatore"] as const) {
    assert.equal(canOpenShellPage("persone", [role]), false, role);
    assert.equal(canOpenShellPage("registro", [role]), false, role);
    assert.equal(canOpenShellPage("impostazioni", [role]), false, role);
  }
  assert.equal(canOpenShellPage("via", ["ls_sviluppatore"]), true);
  assert.equal(canOpenShellPage("via", ["approvatore_privacy"]), false);
  assert.equal(canOpenShellPage("privacy", ["approvatore_privacy"]), true);
  assert.equal(canOpenShellPage("privacy", ["osservatore"]), false);
});

test("only the case lead sees the full activity", () => {
  assert.equal(seesFilteredAudit(["ls_lead"]), false);
  assert.equal(seesFilteredAudit(["owner_cliente"]), true);
  assert.equal(seesFilteredAudit(["approvatore_privacy"]), true);
});

test("active tab from the first segment; pages without a tab light none", () => {
  assert.equal(activeTabKey(null), "panoramica");
  assert.equal(activeTabKey("domande"), "domande");
  assert.equal(activeTabKey("soluzione"), "soluzione");
  assert.equal(activeTabKey("valore"), "valore");
  assert.equal(activeTabKey("persone"), "persone");
  for (const s of ["via", "firme", "privacy", "attivita", "impostazioni", "export", "voci"]) assert.equal(activeTabKey(s), null, s);
});

test("solution segments by role: Data only for Lateral Space", () => {
  const keys = (role: CaseRole) => solutionSegmentsFor([role]).map((s) => s.key);
  for (const role of ["ls_lead", "ls_analista", "ls_sviluppatore"] as const) assert.deepEqual(keys(role), ["descrizione", "mappa", "regole", "dati"], role);
  assert.deepEqual(keys("owner_cliente"), ["descrizione", "mappa", "regole"]);
  assert.deepEqual(keys("ai_board"), ["descrizione", "mappa"]);
  assert.deepEqual(keys("osservatore"), ["descrizione", "mappa"]);
  assert.deepEqual(keys("approvatore_privacy"), []);
});

test("the trail: use case, code, Realizzazione; the title without a code; the old link without a parent card", () => {
  const ws = "w1";
  const caseBase = "/dashboard/w1/casi-duso/c1";
  const withCode = caseTrail({ workspaceId: ws, caseBase, parent: { id: "u1", code: "XX-0012", title: "Smistamento richieste" } });
  assert.deepEqual(withCode, {
    kind: "use_case",
    root: { label: "Use case", href: "/dashboard/w1/use-cases?vista=panoramica" },
    parent: { label: "XX-0012", href: "/dashboard/w1/use-cases/u1?capitolo=realizzazione", isCode: true },
    current: { label: "Realizzazione", href: caseBase },
  });
  const noCode = caseTrail({ workspaceId: ws, caseBase, parent: { id: "u1", code: "  ", title: "Smistamento richieste" } });
  assert.equal(noCode.kind === "use_case" && noCode.parent.label, "Smistamento richieste");
  assert.equal(noCode.kind === "use_case" && noCode.parent.isCode, false);
  assert.deepEqual(caseTrail({ workspaceId: ws, caseBase, parent: null }), { kind: "lista", back: { label: "Casi d'uso", href: "/dashboard/w1/casi-duso" } });
});

test("one alert at most, in the order of DESIGN §3.3", () => {
  const base = { status: "raccolta" as const, gateReconfirm: false, lsConfigured: true, workspaceAdmin: false, canOpenVia: true };
  assert.equal(caseHeadAlert(base), null);
  assert.deepEqual(caseHeadAlert({ ...base, status: "in_sviluppo", gateReconfirm: true, lsConfigured: false, workspaceAdmin: true })?.action, { label: "Vedi cosa manca", segment: "via" });
  assert.equal(caseHeadAlert({ ...base, status: "in_sviluppo", gateReconfirm: true, canOpenVia: false })?.action, null);
  assert.equal(caseHeadAlert({ ...base, status: "sospeso", lsConfigured: false, workspaceAdmin: true })?.kind, "pausa");
  assert.equal(caseHeadAlert({ ...base, status: "chiuso", gateReconfirm: true })?.kind, "chiuso");
  assert.equal(caseHeadAlert({ ...base, lsConfigured: false, workspaceAdmin: true })?.kind, "configurazione");
  assert.equal(caseHeadAlert({ ...base, lsConfigured: false, workspaceAdmin: false }), null, "the others see the badge instead");
  assert.equal(showsReadOnlyBadge({ lsConfigured: false, workspaceAdmin: false }), true);
  assert.equal(showsReadOnlyBadge({ lsConfigured: false, workspaceAdmin: true }), false);
  assert.equal(showsReadOnlyBadge({ lsConfigured: true, workspaceAdmin: false }), false);
  assert.equal(caseHeadAlert({ ...base, status: "sospeso" })?.text, "Caso in pausa: niente invii né promemoria finché non riprende.");
});

test("the primary hides on the page it leads to and stays only on Panoramica anchors", () => {
  const base = "/dashboard/w1/casi-duso/c1";
  const at = (href: string, panel?: boolean) => ({ href, caseBase: base, panel });
  assert.equal(stepHiddenOn(at(`${base}/via`), `${base}/via`), true);
  assert.equal(stepHiddenOn(at(`${base}/via`), `${base}/via/`), true);
  assert.equal(stepHiddenOn(at(`${base}/via`), base), false);
  assert.equal(stepHiddenOn(at(`${base}/persone?invia=1`), `${base}/persone`), true, "Persone has its own commands");
  assert.equal(stepHiddenOn(at(`${base}/persone?invia=1`), base), false);
  assert.equal(stepHiddenOn(at(`${base}#blocchi`), base), false, "an anchor of Panoramica stays on Panoramica");
  assert.equal(stepHiddenOn(at(`${base}#blocchi`), `${base}/via`), false);
  assert.equal(stepHiddenOn(at(`${base}/via#gate`), `${base}/via`), true, "an anchor elsewhere hides on its own page");
  assert.equal(stepHiddenOn(at(`${base}/impostazioni#stato`), `${base}/impostazioni`), true, "«Riprendi il caso» is the section of the same page");
  assert.equal(stepHiddenOn(at(`${base}/impostazioni#stato`), base), false);
  assert.equal(stepHiddenOn(at(`${base}/domande/verifica`), `${base}/domande`), false);
});

test("the primary never shows on Impostazioni, panels included: one filled button there", () => {
  const base = "/dashboard/w1/casi-duso/c1";
  assert.deepEqual(PAGES_WITHOUT_PRIMARY, ["impostazioni"]);
  assert.equal(stepHiddenOn({ href: `${base}/persone?invia=1`, caseBase: base }, `${base}/impostazioni`), true);
  assert.equal(stepHiddenOn({ href: `${base}/persone?nuovo=1`, caseBase: base }, `${base}/impostazioni/`), true);
  assert.equal(stepHiddenOn({ href: base, caseBase: base, panel: true }, `${base}/impostazioni`), true, "«Avvia lo sviluppo» opens its dialog from the other pages");
  assert.equal(stepHiddenOn({ href: base, caseBase: base, panel: true }, `${base}/via`), false);
  assert.equal(stepHiddenOn({ href: `${base}/persone?invia=1`, caseBase: `${base}/` }, `${base}/impostazioni`), true, "a trailing slash on the base changes nothing");
});

test("the case status tone comes from the vocabulary: a pause is grey", () => {
  assert.equal(CASE_STATUS_TONE, LABELS_TONE);
  assert.equal(CASE_STATUS_TONE.sospeso, "grigio");
});

test("suspension and closing ask for the reason", () => {
  assert.equal(transitionNeedsReason("sospeso"), true);
  assert.equal(transitionNeedsReason("chiuso"), true);
  assert.equal(transitionNeedsReason("in_sviluppo"), false);
});
