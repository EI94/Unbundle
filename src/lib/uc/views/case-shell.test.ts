import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CASE_STATUS_TONE,
  PAGES_WITHOUT_PRIMARY,
  STEPS_WITH_PAGE_COMMAND,
  UC_SHELL_PAGE_ROLES,
  VIA_SECTION_ID,
  activeTabKey,
  canOpenShellPage,
  caseHeadAlert,
  caseMenuFor,
  caseTabsFor,
  caseTrail,
  checksFiles,
  landingSegment,
  pastViaPhase,
  realizationTitle,
  seesFilteredAudit,
  settingsTransitions,
  showsHeaderProgress,
  stepHasPageCommand,
  stepHiddenOn,
  stepPanelOf,
  transitionNeedsReason,
  viaRedirect,
} from "./case-shell.ts";
import { VIA_HREF } from "./next-step.ts";
import { CASE_STATUS_TONE as LABELS_TONE } from "./labels.ts";
import { CASE_ROLES, CASE_STATUSES, type CaseRole } from "../vocab.ts";

const tabs = (role: CaseRole, pastVia = false) => caseTabsFor([role], { pastVia }).map((t) => t.label);
const menu = (role: CaseRole, i: Partial<Parameters<typeof caseMenuFor>[1]> = {}) => caseMenuFor([role], { exportable: false, ...i }).map((m) => m.label);

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

test("(rilascio 10, D9 (a)) after the via «Costruzione» takes the place of «Domande», for who opens it", () => {
  assert.deepEqual(tabs("ls_lead", true), ["Panoramica", "Costruzione", "Soluzione", "Valore", "Persone"]);
  assert.deepEqual(tabs("ls_analista", true), ["Panoramica", "Costruzione", "Soluzione", "Valore", "Persone"]);
  assert.deepEqual(tabs("ls_sviluppatore", true), ["Panoramica", "Costruzione", "Soluzione"]);
  assert.deepEqual(tabs("owner_cliente", true), ["Panoramica", "Costruzione", "Soluzione", "Valore", "Persone"]);
  assert.deepEqual(tabs("ai_board", true), ["Panoramica", "Costruzione", "Soluzione", "Valore"], "the AI Board gives its ok to the new tools there");
  assert.deepEqual(tabs("osservatore", true), ["Panoramica", "Costruzione", "Soluzione", "Valore"], "an outside builder is an observer of the realization");
  assert.deepEqual(tabs("approvatore_privacy", true), []);
  for (const role of CASE_ROLES) {
    const after = caseTabsFor([role], { pastVia: true });
    assert.ok(after.length <= 5, role);
    assert.ok(!(after.some((t) => t.key === "domande") && after.some((t) => t.key === "costruzione")), `${role}: never both`);
  }
  assert.equal(caseTabsFor(["ls_lead"], { pastVia: true })[1]?.segment, "costruzione");
});

test("(rilascio 10, D9 (a)) the phase: after the via, in a pause after it, and closed after an approved via", () => {
  assert.equal(pastViaPhase({ status: "raccolta" }), false);
  assert.equal(pastViaPhase({ status: "bozza", catalogVersion: 0 }), false);
  for (const status of ["pronto_sviluppo", "in_sviluppo", "backtest", "collaudo", "stabilizzazione", "in_esercizio", "misura_roi"] as const) assert.equal(pastViaPhase({ status }), true, status);
  assert.equal(pastViaPhase({ status: "sospeso", statusBeforeSuspension: "in_sviluppo" }), true);
  assert.equal(pastViaPhase({ status: "sospeso", statusBeforeSuspension: "raccolta", catalogVersion: 0 }), false);
  assert.equal(pastViaPhase({ status: "chiuso", catalogVersion: 1 }), true, "the frozen catalog says the via was approved");
  assert.equal(pastViaPhase({ status: "chiuso", catalogVersion: 0 }), false);
});

test("everyone lands on the overview, the privacy approver on Privacy", () => {
  for (const role of ["ls_lead", "ls_analista", "ls_sviluppatore", "owner_cliente", "ai_board", "osservatore"] as const) {
    assert.equal(landingSegment([role]), null, role);
  }
  assert.equal(landingSegment(["approvatore_privacy"]), "privacy");
  for (const role of CASE_ROLES) assert.notEqual(landingSegment([role]), undefined, role);
});

test("(rilascio 10, §3.5) the «⋯» menu: Privacy · Attività · Esporta… · Impostazioni, only what serves, per role", () => {
  // (D9 (a)) After the via the Costruzione is a tab: the menu has the four entries of §3.5.
  assert.deepEqual(menu("ls_lead", { exportable: true, pastVia: true }), ["Privacy", "Attività", "Esporta…", "Impostazioni"]);
  assert.deepEqual(menu("ls_lead", { pastVia: true }), ["Privacy", "Attività", "Impostazioni"], "nothing to export");
  assert.deepEqual(menu("ls_analista", { exportable: true, pastVia: true }), ["Privacy", "Esporta…"]);
  assert.deepEqual(menu("ls_sviluppatore", { exportable: true, pastVia: true }), ["Esporta…"]);
  assert.deepEqual(menu("owner_cliente", { exportable: true, pastVia: true }), ["Privacy", "Attività", "Scarica in Excel"]);
  for (const role of ["ai_board", "osservatore"] as const) assert.deepEqual(menu(role, { pastVia: true }), [], role);
  // Before the via the project is set up during the collection too (8.0a): «Costruzione» opens from the menu, where the
  // agent's project was (F-011), so nothing is lost; the Agent Factory and the bell link it as well.
  assert.deepEqual(menu("ls_lead", { exportable: true }), ["Privacy", "Attività", "Esporta…", "Costruzione", "Impostazioni"]);
  assert.deepEqual(menu("ls_lead"), ["Privacy", "Attività", "Costruzione", "Impostazioni"], "nothing to export");
  assert.deepEqual(menu("ls_analista", { exportable: true }), ["Privacy", "Esporta…", "Costruzione"]);
  assert.deepEqual(menu("ls_sviluppatore", { exportable: true }), ["Esporta…", "Costruzione"]);
  assert.deepEqual(menu("ls_sviluppatore"), ["Costruzione"], "before the via the developer has only the agent's project (release 8.0a)");
  assert.deepEqual(menu("owner_cliente", { exportable: true }), ["Privacy", "Attività", "Scarica in Excel", "Costruzione"]);
  assert.deepEqual(menu("approvatore_privacy"), ["Attività"], "the privacy approver lands on Privacy");
  for (const role of ["ai_board", "osservatore"] as const) assert.deepEqual(menu(role, { exportable: false }), ["Costruzione"], role);
  assert.equal(caseMenuFor(["ai_board"], { exportable: false })[0]?.segment, "costruzione");
  assert.equal(canOpenShellPage("costruzione", ["approvatore_privacy"]), false, "the privacy approver does not need the agent's project");
  // «Da firmare (n)» is the filled «Firma …» and the signatures panel (F-006); «Sviluppo con Claude» lives in the via section (F-010, F-042).
  for (const role of ["ls_lead", "ls_analista", "ls_sviluppatore", "owner_cliente", "approvatore_privacy", "ai_board", "osservatore"] as const) {
    for (const pastVia of [false, true]) {
      const labels = menu(role, { exportable: true, pastVia });
      assert.ok(!labels.some((l) => /firmare|Claude|del caso|Progetto/.test(l)), `${role}: ${labels.join(", ")}`);
      assert.ok(labels.length <= (pastVia ? 4 : 5), role);
      if (labels.includes("Impostazioni")) assert.equal(labels.at(-1), "Impostazioni", "Impostazioni is always the last one");
    }
  }
  const exp = caseMenuFor(["ls_lead"], { exportable: true }).find((m) => m.key === "esporta");
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
  assert.equal(activeTabKey("costruzione"), "costruzione");
  assert.equal(activeTabKey("soluzione"), "soluzione");
  assert.equal(activeTabKey("valore"), "valore");
  assert.equal(activeTabKey("persone"), "persone");
  for (const s of ["via", "firme", "privacy", "attivita", "impostazioni", "export", "voci", "progetto"]) assert.equal(activeTabKey(s), null, s);
});

test("(rilascio 10, D9 (a)) with the viewer's tabs: Domande lights «Costruzione» after the via; the menu's Costruzione lights none", () => {
  const before = caseTabsFor(["ls_lead"]);
  const after = caseTabsFor(["ls_lead"], { pastVia: true });
  assert.equal(activeTabKey("domande", before), "domande");
  assert.equal(activeTabKey("domande", after), "costruzione", "Domande opens from «Catalogo ›» of the Costruzione");
  assert.equal(activeTabKey("costruzione", after), "costruzione");
  assert.equal(activeTabKey("costruzione", before), null, "before the via the Costruzione comes from the «⋯»");
  assert.equal(activeTabKey("domande", caseTabsFor(["ai_board"])), null);
  assert.equal(activeTabKey(null, after), "panoramica");
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
  assert.deepEqual(caseTrail({ workspaceId: ws, caseBase, parent: null }), { kind: "lista", back: { label: "Realizzazioni", href: "/dashboard/w1/casi-duso" } });
});

test("one alert at most, in the order of DESIGN §3.3; (rilascio 10) not when the filled button already says it", () => {
  const base = { status: "raccolta" as const, gateReconfirm: false, canOpenVia: true };
  assert.equal(caseHeadAlert(base), null);
  assert.deepEqual(caseHeadAlert({ ...base, status: "in_sviluppo", gateReconfirm: true })?.action, { label: "Vedi cosa manca", href: "/#via" });
  assert.equal(caseHeadAlert({ ...base, status: "in_sviluppo", gateReconfirm: true, canOpenVia: false })?.action, null);
  assert.equal(caseHeadAlert({ ...base, status: "sospeso" })?.kind, "pausa");
  assert.equal(caseHeadAlert({ ...base, status: "chiuso", gateReconfirm: true })?.kind, "chiuso");
  assert.equal(caseHeadAlert({ ...base, status: "sospeso" })?.text, "Realizzazione in pausa: niente invii né promemoria finché non riprende.");
  assert.equal(caseHeadAlert({ ...base, status: "chiuso" })?.text, "Realizzazione chiusa: si può solo leggere.");
  // One signal per state: «Riconferma il via allo sviluppo» and «Riprendi la realizzazione» say it already.
  assert.equal(caseHeadAlert({ ...base, status: "in_sviluppo", gateReconfirm: true, primary: "riconferma_via" }), null);
  assert.equal(caseHeadAlert({ ...base, status: "in_sviluppo", gateReconfirm: true, primary: "verifica" })?.kind, "riconferma", "another step: the alert stays");
  assert.equal(caseHeadAlert({ ...base, status: "sospeso", primary: "riprendi" }), null);
  assert.equal(caseHeadAlert({ ...base, status: "sospeso", primary: null })?.kind, "pausa", "the client has no «Riprendi»: the alert stays");
  // F-005: the incomplete configuration goes to the log and, until wave 6b moves it to Settings, to the admins only.
  const config = { ...base, lsConfigured: false };
  assert.deepEqual(caseHeadAlert({ ...config, workspaceAdmin: true }), { kind: "configurazione", text: "Configurazione da completare: la realizzazione è in sola lettura.", tone: "giallo", action: null });
  assert.equal(caseHeadAlert({ ...config, workspaceAdmin: false }), null, "no badge, no alert for the others");
  assert.equal(caseHeadAlert({ ...base, lsConfigured: true, workspaceAdmin: true }), null);
  assert.equal(caseHeadAlert({ ...config, workspaceAdmin: true, status: "sospeso" })?.kind, "pausa", "one alert at most, the state first");
});

test("(rilascio 10, §3.5) the title is always the use case's; the small progress only for who opens the Panoramica", () => {
  assert.equal(realizationTitle({ caseTitle: "Dossier di prova", parent: { title: "Smistamento delle richieste" } }), "Smistamento delle richieste");
  assert.equal(realizationTitle({ caseTitle: "Dossier di prova", parent: { title: "  " } }), "Dossier di prova", "an empty use case title falls back");
  assert.equal(realizationTitle({ caseTitle: "Dossier di prova", parent: null }), "Dossier di prova", "no parent card: the dossier's own");
  for (const role of ["ls_lead", "ls_analista", "ls_sviluppatore", "owner_cliente", "ai_board", "osservatore"] as const) assert.equal(showsHeaderProgress([role]), true, role);
  assert.equal(showsHeaderProgress(["approvatore_privacy"]), false, "the privacy approver never opens the Panoramica");
});

test("(rilascio 10, §3.5, F-043) /via goes to the via section of the Panoramica, keeping the query", () => {
  const root = "/dashboard/w1/casi-duso/c1";
  assert.equal(VIA_SECTION_ID, "via");
  assert.equal(VIA_HREF, `/#${VIA_SECTION_ID}`, "the steps point to the same anchor");
  assert.equal(viaRedirect(`${root}/via`, ""), `${root}#via`);
  assert.equal(viaRedirect(`${root}/via/`, "?"), `${root}#via`);
  assert.equal(viaRedirect(`${root}/via`, "?apri=tappe&x=1"), `${root}?apri=tappe&x=1#via`);
  assert.equal(viaRedirect(`${root}/via`, "x=1"), `${root}?x=1#via`);
  for (const path of [`${root}`, `${root}/via/storico`, `${root}/domande`, "/dashboard/w1/use-cases/u1/via", "/via"]) assert.equal(viaRedirect(path, ""), null, path);
});

test("(rilascio 10, §3.5, F-076) «Controlla N file»: who checks PDFs by hand, on an open realization", () => {
  const open = { isLateralSpace: true, readOnly: false, status: "raccolta" as const };
  assert.equal(checksFiles({ ...open, roles: ["ls_lead"] }), true);
  assert.equal(checksFiles({ ...open, roles: ["ls_analista"] }), true);
  for (const role of ["ls_sviluppatore", "owner_cliente", "approvatore_privacy", "ai_board", "osservatore"] as const) assert.equal(checksFiles({ ...open, roles: [role] }), false, role);
  assert.equal(checksFiles({ ...open, roles: ["ls_lead"], isLateralSpace: false }), false, "only a person of Lateral Space");
  assert.equal(checksFiles({ ...open, roles: ["ls_lead"], readOnly: true }), false);
  for (const status of ["sospeso", "chiuso"] as const) assert.equal(checksFiles({ ...open, roles: ["ls_lead"], status }), false, status);
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

test("(rilascio 10, §3.5) a step whose command is in the via section hides on the Panoramica, which has the filled one", () => {
  const base = "/dashboard/w1/casi-duso/c1";
  assert.deepEqual([...STEPS_WITH_PAGE_COMMAND], ["proponi_via", "manda_link_firma"]);
  assert.equal(stepHasPageCommand("proponi_via"), true);
  assert.equal(stepHasPageCommand("riconferma_via"), false, "nothing to press there: the filled one stays and scrolls to #via");
  const propose = { href: `${base}#via`, caseBase: base, pageCommand: true };
  assert.equal(stepHiddenOn(propose, base), true, "on the Panoramica the section proposes");
  assert.equal(stepHiddenOn(propose, `${base}/`), true);
  assert.equal(stepHiddenOn(propose, `${base}/domande`), false, "on the other tabs it leads there");
  assert.equal(stepHiddenOn({ href: `${base}#via`, caseBase: base }, base), false, "an anchor of the Panoramica without a command stays");
});

test("(rilascio 10, §3.5) the panel of a step: the header's dialogs, «Esporta…», and the File panel of Domande, which stays on Domande", () => {
  assert.deepEqual(stepPanelOf({ id: "avvia_sviluppo", transition: "in_sviluppo" }), { name: "conferma", value: "in_sviluppo" });
  assert.deepEqual(stepPanelOf({ id: "scarica_catalogo" }), { name: "esporta", value: "1" });
  assert.deepEqual(stepPanelOf({ id: "firma", panel: { name: "firma", value: "1" } }), { name: "firma", value: "1" }, "the signatures panel of the shell");
  assert.deepEqual(stepPanelOf({ id: "controlla_file", panel: { name: "apri", value: "file" } }), { name: "apri", value: "file" });
  assert.equal(stepPanelOf({ id: "verifica" }), undefined);
  const base = "/dashboard/w1/casi-duso/c1";
  const files = { href: `${base}/domande?apri=file`, caseBase: base, panel: true };
  assert.equal(stepHiddenOn(files, `${base}/domande`), false, "on Domande the filled button stays: it opens the panel there");
  assert.equal(stepHiddenOn(files, base), false);
  assert.equal(stepHiddenOn(files, `${base}/impostazioni`), true, "never on Impostazioni");
});

test("the primary never shows on Impostazioni, panels included: one filled button there", () => {
  const base = "/dashboard/w1/casi-duso/c1";
  assert.deepEqual(PAGES_WITHOUT_PRIMARY, ["impostazioni", "costruzione"], "(8.0a) il progetto dell'agente, oggi la Costruzione, ha la sua azione principale");
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

test("(Ondata 0) Impostazioni del caso: «Chiudi il caso» una volta sola, in «Zona pericolosa»", () => {
  for (const current of CASE_STATUSES) {
    const all = settingsTransitions(current, CASE_STATUSES);
    assert.ok(!all.state.includes("chiuso"), `${current}: la chiusura non sta in «Stato del caso»`);
    assert.deepEqual(all.danger, ["chiuso"], `${current}: sta in «Zona pericolosa»`);
  }
  assert.deepEqual(settingsTransitions("in_sviluppo", ["sospeso", "chiuso", "backtest"]), { state: ["sospeso"], danger: ["chiuso"] }, "il passo avanti resta in testata");
  assert.deepEqual(settingsTransitions("sospeso", ["in_sviluppo", "chiuso"]), { state: ["in_sviluppo"], danger: ["chiuso"] }, "in pausa: la ripresa");
  assert.deepEqual(settingsTransitions("pronto_sviluppo", ["in_sviluppo", "sospeso"]), { state: ["sospeso"], danger: [] }, "da «pronto» lo sviluppo è il passo avanti");
  assert.deepEqual(settingsTransitions("collaudo", ["in_sviluppo"]), { state: ["in_sviluppo"], danger: [] }, "il ritorno allo sviluppo per correggere");
  const page = readFileSync(new URL("../../../app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/impostazioni/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const stateOptions = transitions\.state\.map\(option\);/);
  assert.match(page, /const closeOption = transitions\.danger\.map\(option\);/);
});
