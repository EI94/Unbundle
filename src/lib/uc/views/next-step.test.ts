import test from "node:test";
import assert from "node:assert/strict";
import type { CaseRole } from "../vocab.ts";
import { caseNextSteps, myNextSteps, nextStepFor, resolveStepHref, whoseTurn, type NextStep, type NextStepInput } from "./next-step.ts";

const NOW = new Date("2026-10-14T10:00:00Z");

function input(over: Partial<NextStepInput> = {}): NextStepInput {
  return {
    now: NOW,
    status: "raccolta",
    statusBeforeSuspension: null,
    statusChangedAt: null,
    gateReconfirm: false,
    g1: { required: 245, ok: 0, ready: false, byGroup: {} },
    pendingGateReview: null,
    referents: 4,
    unassignedMust: 0,
    unsentMust: 0,
    toVerifyForMe: 0,
    toVerifyMust: 0,
    oldestToVerifyAt: null,
    toVerifyTotal: 0,
    waitingOnReferents: 0,
    blockersActive: 0,
    blockedMust: 0,
    privacyBlockerActive: false,
    mySignaturesPending: [],
    privacySignerMissing: false,
    forwardTransition: null,
    nextMilestone: null,
    catalog: null,
    ...over,
  };
}

const LEAD: CaseRole[] = ["ls_lead"];
const AN: CaseRole[] = ["ls_analista"];
const DEV: CaseRole[] = ["ls_sviluppatore"];
const OWN: CaseRole[] = ["owner_cliente"];
const PRIV: CaseRole[] = ["approvatore_privacy"];
const BOARD: CaseRole[] = ["ai_board"];
const OBS: CaseRole[] = ["osservatore"];

const steps = (i: Partial<NextStepInput>, roles: CaseRole[]) => caseNextSteps(input(i), { roles });
const primary = (i: Partial<NextStepInput>, roles: CaseRole[]) => nextStepFor(steps(i, roles));
const brief = (s: NextStep | null) => (s ? { label: s.label, detail: s.detail, href: s.href, owner: s.owner } : null);

test("row 1: a closed case has no step for anyone", () => {
  for (const roles of [LEAD, AN, OWN, PRIV, DEV]) {
    assert.deepEqual(steps({ status: "chiuso", unsentMust: 10, toVerifyForMe: 5, mySignaturesPending: [{ kind: "via", otherSideSigned: true }] }, roles), []);
  }
  assert.equal(whoseTurn([], input({ status: "chiuso" })), "Caso chiuso: si può solo leggere.");
});

test("row 2: a paused case only resumes, for the lead", () => {
  const paused = { status: "sospeso" as const, statusBeforeSuspension: "raccolta" as const, statusChangedAt: "2026-10-03T09:00:00Z", unsentMust: 10, toVerifyForMe: 5 };
  assert.deepEqual(brief(primary(paused, LEAD)), { label: "Riprendi il caso", detail: "In pausa dal 3 ott.", href: "/impostazioni#stato", owner: "me" });
  assert.equal(primary(paused, AN), null, "nothing to verify while paused");
  assert.deepEqual(steps(paused, OWN).map((s) => s.owner), ["ls"]);
  assert.equal(whoseTurn(steps(paused, OWN), input(paused)), null, "the header notice explains the pause");
});

test("row 3: the go-ahead to development must be confirmed again", () => {
  const s = primary({ status: "in_sviluppo", gateReconfirm: true, g1: { required: 245, ok: 242, ready: false, byGroup: {} } }, LEAD);
  assert.deepEqual(brief(s), { label: "Riconferma il via allo sviluppo", detail: "3 domande indispensabili non sono più a posto.", href: "/via", owner: "me" });
  assert.equal(primary({ status: "in_sviluppo", gateReconfirm: true, g1: { required: 10, ok: 9, ready: false, byGroup: {} } }, LEAD)?.detail, "1 domanda indispensabile non è più a posto.");
});

test("row 4: signatures waiting for the viewer, for the lead, the client owner and the privacy approver", () => {
  const gate = [{ kind: "via" as const, otherSideSigned: true }];
  assert.deepEqual(brief(primary({ mySignaturesPending: gate }, OWN)), { label: "Firma il via allo sviluppo", detail: "Lateral Space ha già firmato.", href: "/firme", owner: "me" });
  assert.deepEqual(brief(primary({ mySignaturesPending: [{ kind: "scheda_privacy", otherSideSigned: false }] }, PRIV)), {
    label: "Firma la scheda privacy",
    detail: "Servono per andare avanti.",
    href: "/firme",
    owner: "me",
  });
  const three = [
    { kind: "altro" as const, otherSideSigned: true },
    { kind: "via" as const, otherSideSigned: true },
    { kind: "scheda_privacy" as const, otherSideSigned: true },
  ];
  assert.equal(primary({ mySignaturesPending: three }, OWN)?.label, "Firma 3 decisioni");
  assert.equal(primary({ mySignaturesPending: [{ kind: "altro", otherSideSigned: false }] }, LEAD)?.label, "Firma 1 decisione");
  assert.equal(primary({ mySignaturesPending: gate }, LEAD)?.detail, "Servono per andare avanti.");
  // Observers and the board never sign here.
  assert.equal(primary({ mySignaturesPending: gate }, OBS), null);
  assert.equal(primary({ mySignaturesPending: gate }, BOARD), null);
});

test("row 5: all indispensable questions in place, no proposal yet", () => {
  const ready = { g1: { required: 245, ok: 245, ready: true, byGroup: {} } };
  assert.deepEqual(brief(primary(ready, LEAD)), { label: "Proponi il via allo sviluppo", detail: "Le 245 domande indispensabili sono a posto.", href: "/via", owner: "me" });
  assert.equal(steps({ ...ready, pendingGateReview: { lsSigned: false, clientSigned: false } }, LEAD).some((s) => s.id === "proponi_via"), false);
  assert.equal(primary(ready, AN), null);
});

test("row 6: ready for development, confirmed in a dialog", () => {
  const s = primary({ status: "pronto_sviluppo", catalog: { version: 1, frozenAt: "2026-10-03" } }, LEAD);
  assert.deepEqual(s && { ...brief(s), transition: s.transition }, {
    label: "Avvia lo sviluppo",
    detail: "Il catalogo v1 è pronto.",
    href: "?conferma=in_sviluppo",
    owner: "me",
    transition: "in_sviluppo",
  });
});

test("row 7: draft without referents; the draft shows «Aggiungi i referenti» then «Invia le domande»", () => {
  const draft = { status: "bozza" as const, referents: 0, unassignedMust: 7, unsentMust: 7 };
  assert.deepEqual(
    myNextSteps(steps(draft, LEAD)).map((s) => s.label),
    ["Aggiungi i referenti", "Invia le domande"],
  );
  assert.deepEqual(brief(primary(draft, LEAD)), { label: "Aggiungi i referenti", detail: "Ognuno riceve un link con le sue domande.", href: "/persone?nuovo=1", owner: "me" });
});

test("row 8: indispensable questions not yet sent", () => {
  assert.deepEqual(brief(primary({ unassignedMust: 40, unsentMust: 137 }, LEAD)), {
    label: "Invia le domande",
    detail: "137 indispensabili non sono ancora partite.",
    href: "/persone?invia=1",
    owner: "me",
  });
  assert.equal(primary({ unassignedMust: 1, unsentMust: 0 }, LEAD)?.detail, "1 indispensabile non è ancora partita.");
});

test("row 9: answers to verify, with four eyes already applied", () => {
  const verify = { toVerifyForMe: 160, toVerifyMust: 95, toVerifyTotal: 160, oldestToVerifyAt: new Date("2026-10-11T08:00:00Z") };
  assert.deepEqual(brief(primary(verify, AN)), {
    label: "Verifica 160 risposte",
    detail: "95 sono indispensabili. La più vecchia è di 3 giorni fa.",
    href: "/domande/verifica",
    owner: "me",
  });
  // Four eyes: the analyst entered these answers, so none is for them; another person verifies.
  const own = { toVerifyForMe: 0, toVerifyMust: 0, toVerifyTotal: 12 };
  assert.equal(primary(own, AN), null);
  assert.equal(whoseTurn(steps(own, AN), input(own)), "Tocca a Lateral Space: stanno verificando 12 risposte.");
  assert.equal(primary({ toVerifyForMe: 1, toVerifyMust: 0, toVerifyTotal: 1, oldestToVerifyAt: NOW }, AN)?.detail, "È appena arrivata.");
  assert.equal(primary({ toVerifyForMe: 1, toVerifyMust: 1, toVerifyTotal: 1, oldestToVerifyAt: "2026-10-01T08:00:00Z" }, AN)?.detail, "1 è indispensabile. È dell'1 ott.");
  assert.equal(primary({ toVerifyForMe: 2, toVerifyMust: 0, toVerifyTotal: 2, oldestToVerifyAt: "2026-09-30T08:00:00Z" }, AN)?.detail, "La più vecchia è del 30 set.");
  assert.equal(primary(verify, OWN), null, "the client never verifies");
  assert.equal(primary(verify, DEV), null);
});

test("row 10: blockers that stop indispensable questions; the privacy sheet opens Privacy", () => {
  assert.deepEqual(brief(primary({ blockersActive: 2, blockedMust: 10 }, LEAD)), { label: "Sciogli 2 blocchi", detail: "Fermano 10 domande indispensabili.", href: "/#blocchi", owner: "me" });
  assert.deepEqual(brief(primary({ blockersActive: 1, blockedMust: 1, privacyBlockerActive: true }, LEAD)), {
    label: "Sciogli il blocco",
    detail: "Ferma 1 domanda indispensabile.",
    href: "/privacy",
    owner: "me",
  });
  assert.equal(primary({ blockersActive: 2, blockedMust: 0 }, LEAD), null, "a blocker on optional questions only is not a step");
});

test("row 11: Lateral Space signed the proposal, the client did not", () => {
  const review = { pendingGateReview: { lsSigned: true, clientSigned: false, lsSignedAt: "2026-10-03T09:00:00Z" } };
  assert.deepEqual(brief(primary(review, LEAD)), { label: "Manda il link per firmare", detail: "Hai firmato il 3 ott. Manca il responsabile del cliente.", href: "/via", owner: "me" });
  assert.equal(whoseTurn(steps(review, AN), input(review)), "Tocca al cliente: manca la firma del responsabile del cliente.");
  assert.equal(whoseTurn(steps(review, LEAD), input(review)), "Tocca anche al cliente: manca la firma del responsabile del cliente.");
  // The client owner who must sign sees their own step, not «Tocca al cliente».
  const ownerView = { ...review, mySignaturesPending: [{ kind: "via" as const, otherSideSigned: true }] };
  assert.equal(primary(ownerView, OWN)?.label, "Firma il via allo sviluppo");
  assert.equal(whoseTurn(steps(ownerView, OWN), input(ownerView)), null);
});

test("row 12: the client owner names the privacy signer", () => {
  assert.deepEqual(brief(primary({ privacySignerMissing: true }, OWN)), { label: "Indica chi firma la privacy", detail: "Serve per usare dati reali.", href: "/persone", owner: "me" });
  assert.deepEqual(steps({ privacySignerMissing: true }, LEAD).map((s) => s.owner), ["cliente"]);
});

test("row 13: the developer downloads the validated catalog after the go-ahead", () => {
  const after = { status: "in_sviluppo" as const, catalog: { version: 1, frozenAt: "2026-10-03" } };
  assert.deepEqual(brief(primary(after, DEV)), { label: "Scarica il catalogo validato", detail: "Catalogo v1, congelato il 3 ott.", href: "?esporta=1", owner: "me" });
  assert.equal(primary({ status: "raccolta" }, DEV), null, "nothing before the go-ahead");
  assert.equal(primary({ status: "sospeso", statusBeforeSuspension: "in_sviluppo" }, DEV), null, "a paused case only resumes");
});

test("row 14: the forward steps after development, confirmed in a dialog", () => {
  const cases = [
    ["backtest", "Passa alla prova sul passato"],
    ["collaudo", "Passa al collaudo"],
    ["stabilizzazione", "Avvia il rodaggio"],
    ["in_esercizio", "Metti in uso"],
    ["misura_roi", "Misura il valore"],
  ] as const;
  for (const [to, label] of cases) {
    const s = primary({ status: "in_sviluppo", forwardTransition: to }, LEAD);
    assert.equal(s?.label, label, to);
    assert.equal(s?.href, `?conferma=${to}`);
    assert.equal(s?.transition, to);
    assert.ok(s?.detail && !/ROI|gate/i.test(s.detail), to);
  }
  assert.equal(primary({ status: "in_sviluppo", forwardTransition: "in_sviluppo" }, LEAD), null, "going back is not a forward step");
});

test("board and observers never get a button", () => {
  const busy = { unsentMust: 10, toVerifyForMe: 5, toVerifyTotal: 5, blockersActive: 1, blockedMust: 2, privacySignerMissing: true, waitingOnReferents: 3 };
  for (const roles of [BOARD, OBS]) assert.equal(primary(busy, roles), null);
});

test("the first rule wins: sending and signing come before verifying", () => {
  const seeded = {
    g1: { required: 245, ok: 0, ready: false, byGroup: { da_fare: 140, da_verificare: 95, bloccate: 10 } },
    unassignedMust: 0,
    unsentMust: 137,
    toVerifyForMe: 160,
    toVerifyMust: 95,
    toVerifyTotal: 160,
    oldestToVerifyAt: "2026-10-11T08:00:00Z",
    blockersActive: 2,
    blockedMust: 10,
    waitingOnReferents: 40,
  };
  // On the seeded case the lead sees «Invia le domande» and the analyst «Verifica 160 risposte».
  assert.equal(primary(seeded, LEAD)?.label, "Invia le domande");
  assert.equal(primary(seeded, AN)?.label, "Verifica 160 risposte");
  assert.deepEqual(myNextSteps(steps(seeded, LEAD)).map((s) => s.label), ["Invia le domande", "Verifica 160 risposte", "Sciogli 2 blocchi"]);
  assert.deepEqual(myNextSteps(steps(seeded, AN)).map((s) => s.label), ["Verifica 160 risposte"], "the analyst only has their own steps");
  assert.equal(whoseTurn(steps(seeded, LEAD), input(seeded)), "Tocca anche ai referenti: 40 domande sono da loro. I promemoria partono da soli.");
  assert.equal(whoseTurn(steps(seeded, OWN), input(seeded)), "Tocca a Lateral Space: stanno verificando 160 risposte.");
});

test("days 1, 8 and 11 take the elided article", () => {
  const paused = (day: string) => primary({ status: "sospeso", statusBeforeSuspension: "raccolta", statusChangedAt: day }, LEAD)?.detail;
  assert.equal(paused("2026-10-01"), "In pausa dall'1 ott.");
  assert.equal(paused("2026-10-08"), "In pausa dall'8 ott.");
  assert.equal(paused("2026-10-11"), "In pausa dall'11 ott.");
  assert.equal(paused("2026-10-03"), "In pausa dal 3 ott.");
  assert.equal(paused("2026-09-18"), "In pausa dal 18 set.", "18 keeps «dal»");
  const signed = (day: string, roles: CaseRole[]) => steps({ pendingGateReview: { lsSigned: true, clientSigned: false, lsSignedAt: day } }, roles).find((s) => s.id === "manda_link_firma")?.detail;
  assert.equal(signed("2026-10-08", LEAD), "Hai firmato l'8 ott. Manca il responsabile del cliente.");
  assert.equal(signed("2026-10-11", AN), "Lateral Space ha firmato l'11 ott. Manca il responsabile del cliente.");
  const catalog = (day: string) => primary({ status: "in_sviluppo", catalog: { version: 1, frozenAt: day } }, DEV)?.detail;
  assert.equal(catalog("2026-10-01"), "Catalogo v1, congelato l'1 ott.");
  assert.equal(catalog("2026-10-23"), "Catalogo v1, congelato il 23 ott.");
  assert.equal(primary({ toVerifyForMe: 3, toVerifyMust: 0, toVerifyTotal: 3, oldestToVerifyAt: "2026-10-01T08:00:00Z" }, AN)?.detail, "La più vecchia è dell'1 ott.");
});

test("whoseTurn: everything in order, with the next milestone", () => {
  const quiet = { nextMilestone: { title: "Mappatura dei dati", date: "2026-10-23" } };
  assert.equal(whoseTurn(steps(quiet, OBS), input(quiet)), "Tutto in ordine. Prossima tappa: 23 ott.");
  assert.equal(whoseTurn(steps({}, OBS), input()), "Tutto in ordine.");
  assert.equal(whoseTurn(steps({ unsentMust: 3 }, LEAD), input({ unsentMust: 3 })), null, "no line when only the viewer has something to do");
  assert.equal(whoseTurn(steps({ waitingOnReferents: 1 }, OWN), input({ waitingOnReferents: 1 })), "Tocca ai referenti: 1 domanda è da loro. I promemoria partono da soli.");
});

test("whoseTurn: never «Tutto in ordine» while a step of someone else is pending", () => {
  const line = (i: Partial<NextStepInput>, roles: CaseRole[]) => whoseTurn(steps(i, roles), input(i));
  const reconfirm = { status: "in_sviluppo" as const, gateReconfirm: true, g1: { required: 10, ok: 8, ready: false, byGroup: {} }, nextMilestone: { title: "Prova", date: "2026-10-23" } };
  assert.deepEqual(steps(reconfirm, OWN).map((s) => `${s.id}:${s.owner}`), ["riconferma_via:ls"]);
  for (const roles of [OWN, OBS, BOARD, AN, DEV]) assert.equal(line(reconfirm, roles), null, `riconferma_via for ${roles[0]}`);
  const blocked = { blockersActive: 2, blockedMust: 10 };
  assert.deepEqual(steps(blocked, OWN).map((s) => `${s.id}:${s.owner}`), ["sciogli_blocchi:ls"]);
  for (const roles of [OWN, OBS, AN]) assert.equal(line(blocked, roles), null, `sciogli_blocchi for ${roles[0]}`);
  const signer = { privacySignerMissing: true };
  assert.deepEqual(steps(signer, LEAD).map((s) => `${s.id}:${s.owner}`), ["indica_firmatario_privacy:cliente"]);
  for (const roles of [LEAD, AN, OBS]) assert.equal(line(signer, roles), null, `indica_firmatario_privacy for ${roles[0]}`);
  const draft = { status: "bozza" as const, referents: 0, unsentMust: 7 };
  assert.deepEqual(steps(draft, OWN).map((s) => `${s.id}:${s.owner}`), ["aggiungi_referenti:ls", "invia_domande:ls"]);
  assert.equal(line(draft, OWN), null);
  // A proposal nobody has signed yet: the lead's signature is missing, so not «in order» either.
  assert.equal(line({ pendingGateReview: { lsSigned: false, clientSigned: false } }, OWN), null);
  // The covered lines still win over the silent ones.
  assert.equal(line({ ...blocked, waitingOnReferents: 3 }, OWN), "Tocca ai referenti: 3 domande sono da loro. I promemoria partono da soli.");
  // Nothing pending for anyone: in order. A forward step after development is not a wait.
  assert.equal(line({ pendingGateReview: { lsSigned: true, clientSigned: true } }, OBS), "Tutto in ordine.");
  const developing = { status: "in_sviluppo" as const, forwardTransition: "backtest" as const, nextMilestone: { title: "Prova", date: "2026-10-23" } };
  assert.equal(line(developing, OBS), "Tutto in ordine. Prossima tappa: 23 ott.");
  assert.equal(line(developing, LEAD), null, "the lead has the forward step");
});

test("hrefs are relative to the dossier root", () => {
  const base = "/dashboard/ws/casi-duso/caso";
  assert.equal(resolveStepHref(base, "/via"), `${base}/via`);
  assert.equal(resolveStepHref(`${base}/`, "/persone?invia=1"), `${base}/persone?invia=1`);
  assert.equal(resolveStepHref(base, "/#blocchi"), `${base}#blocchi`);
  assert.equal(resolveStepHref(base, "?conferma=in_sviluppo"), `${base}?conferma=in_sviluppo`);
  assert.equal(resolveStepHref(base, "/"), base);
  assert.equal(resolveStepHref(base, "/impostazioni#stato"), `${base}/impostazioni#stato`);
});
