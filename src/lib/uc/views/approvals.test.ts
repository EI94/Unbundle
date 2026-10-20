import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as texts from "../../../components/uc/approvals/approval-texts.ts";
import { parsePendingSignatures } from "../../db/queries/uc-signatures.ts";
import * as publicRows from "../public-rows.ts";
import type { Row } from "../sql/readiness.ts";
import type { CaseRole } from "../vocab.ts";
import {
  APPROVAL_DECISION_ROLES,
  APPROVAL_SIGNER_ROLES,
  approvalDecisionAllowed,
  buildApprovals,
  buildCaseApprovals,
  fallbackApprovalHash,
  gateCountLine,
  naApprovalHash,
  waiverApprovalHash,
  zoneApprovalHash,
  type ApprovalStep,
  type PendingApprovalRows,
} from "./approvals.ts";
import { findForbiddenIn } from "./copy-guard.ts";

// Hashes frozen on the builder in `public-rows.ts` before WP0 moved it here
// (DESIGN §8.3 WP0 and WP9: «hash invariati»). WP9 rewrote titles and lines
// (§4.5) and the order (the via first): the hashes did not move. Synthetic rows
// only. If a hash below changes, every signature already given on the approval
// link stops matching: never update these values to make the test pass.

const OWNER = "3f4e5d6c-7a8b-4c9d-8e0f-2a3b4c5d6e7f";
const PRIVACY = "4a5f6e7d-8b9c-4d0e-9f1a-3b4c5d6e7f80";
const ITEM = "5b6a7f8e-9c0d-4e1f-8a2b-4c5d6e7f8091";
const ITEM2 = "6c7b8a9f-0d1e-4f2a-9b3c-5d6e7f8091a2";
const WAIVER_ITEM = "7d8c9b0a-1e2f-4a3b-8c4d-6e7f8091a2b3";
const FALLBACK_ITEM = "8e9d0c1b-2f3a-4b4c-9d5e-7f8091a2b3c4";
const GATE = "9f0e1d2c-3a4b-4c5d-8e6f-8091a2b3c4d5";
const A8 = "a0f1e2d3-4b5c-4d6e-9f7a-91a2b3c4d5e6";
const BENEFICIARY = "b0b0b0b0-1111-4222-8333-444455556666";

const HASH = {
  na: "6e30769d747aa6e6811facf55903d0cf925c526b5de9919c9dc604f616db09c6",
  na2: "0c0310146ba3378f92626e299ba470f6564c609dcc0e189f25dfb1b1b2cad608",
  deroga: "f75ef058e7b61e007d0cb95c8a95ddbee442d4ea4d75cdde0fd45d26369f6685",
  ripiego: "79191546e062217402d12c2bf75b5b71fbbba34013c8018d310dc6a2eaeb6889",
  ripiego2: "792ccd24812182e1dfb03e077ef6b59cd80fb08b350e6022bdee59c8065c94b8",
  gate: "ab".repeat(32),
  a8: "41fb4d2c152b4589ead8041a7b6fb5d3ea79842400a36a6b77665f19e305720e",
  zona: "004f1f468f7a1a5ad530958b1e5b7926a78f439aaf30d809be9b745ca5596e28",
};

function rows(): PendingApprovalRows {
  const na: Row[] = [
    { id: ITEM, key: "q.costi.04", title: "Quando serve la data?", na_reason: "La data non serve in questo processo", na_proposed_at: new Date("2026-10-10T08:00:00Z"), by_referent: true, ls_signed: false, client_user_signed: false, client_contact_id: null },
    { id: ITEM2, key: "q.costi.06", title: "Chi approva gli sconti?", na_reason: "Gli sconti non si usano", na_proposed_at: new Date("2026-10-11T15:30:00Z"), by_referent: false, ls_signed: true, client_user_signed: false, client_contact_id: null },
  ];
  return {
    na,
    waiversAndFallbacks: [
      {
        id: WAIVER_ITEM,
        key: "q.costi.01",
        title: "Costo medio di una richiesta",
        waiver: { motivo: "Il dato arriva con la chiusura del trimestre", piano: "Lo carica l'amministrazione a gennaio", scadenza: "2027-01-31", approvazioni: [{ ruolo: "ls_lead", user_id: "u", at: "x", metodo: "account" }] },
        fallback: { descrizione: "Si usa la media dell'anno scorso", valido_per: ["G1"], da_sostituire_entro: "2027-03-31", approvazioni: [] },
      },
      {
        id: FALLBACK_ITEM,
        key: "q.costi.02",
        title: "Tempo medio di risposta",
        waiver: null,
        fallback: { descrizione: "Stima del responsabile commerciale", valido_per: ["G1"], da_sostituire_entro: null, approvazioni: [{ ruolo: "ls_lead", at: "x", metodo: "account" }] },
      },
    ],
    gates: [
      {
        id: GATE,
        gate_key: "G1",
        computed: { required: 12, ok: 12, waivers: { used: 0, cap: 1, keys: [] }, summary_text: "G1 · ES-0001 · regola request_modules · 12 richieste, 12 a posto" },
        summary_text_hash: HASH.gate,
        approvals: [{ ruolo: "ls_lead", metodo: "account", at: "x" }],
        has_evidence: true,
      },
    ],
    a8: [
      {
        id: A8,
        key: "a8",
        evidence: { documento: "Scheda privacy di esempio", versione: "1.2", data: "2026-10-01", approvatori_per_ruolo: ["approvatore_privacy", "dpo"], titolo_art_15_2: true, regione_dati_verificata: false, accesso_zona_personale: ["u1"] },
        approvals: [],
        access_names: ["Analista di prova"],
      },
    ],
    zone: [
      {
        user_id: BENEFICIARY,
        personal_zone_grant: { beneficiary_user_id: BENEFICIARY, proposed_by_user_id: "c0c0c0c0-1111-4222-8333-444455556666", at: "2026-10-11T09:00:00.000Z", approvals: [] },
        name: "Analista di prova",
      },
    ],
  };
}

const designated = { owner: OWNER, privacy: PRIVACY };
const shape = (list: readonly ApprovalStep[]) => list.map((a) => [a.kind, a.targetId, a.textHash, a.canReject, a.waitingForLs, a.designation]);
const visible = (a: ApprovalStep) => [a.title, a.summary, a.intro ?? "", ...a.lines, ...a.details];

test("hashes: the link signs exactly the texts it signed before WP0 and WP9, the via first", () => {
  assert.deepEqual(shape(buildApprovals({ rows: rows(), contactId: OWNER, designated })), [
    ["gate", GATE, HASH.gate, true, false, "owner"],
    ["na", ITEM, HASH.na, true, true, "owner"],
    ["na", ITEM2, HASH.na2, true, false, "owner"],
    ["deroga", WAIVER_ITEM, HASH.deroga, false, false, "owner"],
    ["ripiego", WAIVER_ITEM, HASH.ripiego, false, true, "owner"],
    ["ripiego", FALLBACK_ITEM, HASH.ripiego2, false, false, "owner"],
  ]);
  assert.deepEqual(shape(buildApprovals({ rows: rows(), contactId: PRIVACY, designated })), [
    ["a8", A8, HASH.a8, false, true, "privacy"],
    ["zona_personale", BENEFICIARY, HASH.zona, false, false, "privacy"],
  ]);
});

test("hashes: each helper gives the frozen value", () => {
  assert.equal(naApprovalHash({ itemId: ITEM, reason: "La data non serve in questo processo", proposedAt: new Date("2026-10-10T08:00:00Z") }), HASH.na);
  // The item id is compared in lower case, as before the move.
  assert.equal(naApprovalHash({ itemId: ITEM.toUpperCase(), reason: "La data non serve in questo processo", proposedAt: new Date("2026-10-10T08:00:00Z") }), HASH.na);
  assert.equal(waiverApprovalHash({ motivo: "Il dato arriva con la chiusura del trimestre", piano: "Lo carica l'amministrazione a gennaio", scadenza: "2027-01-31" }), HASH.deroga);
  assert.equal(fallbackApprovalHash({ descrizione: "Si usa la media dell'anno scorso", valido_per: ["G1"], da_sostituire_entro: "2027-03-31" }), HASH.ripiego);
  assert.equal(fallbackApprovalHash({ descrizione: "Stima del responsabile commerciale", valido_per: ["G1"], da_sostituire_entro: null }), HASH.ripiego2);
  assert.equal(zoneApprovalHash({ beneficiary_user_id: BENEFICIARY, proposed_by_user_id: "c0c0c0c0-1111-4222-8333-444455556666", at: "2026-10-11T09:00:00.000Z" }), HASH.zona);
});

test("public-rows keeps exporting the same builder and helpers", () => {
  assert.equal(publicRows.buildApprovals, buildApprovals);
  assert.equal(publicRows.naApprovalHash, naApprovalHash);
  assert.equal(publicRows.waiverApprovalHash, waiverApprovalHash);
  assert.equal(publicRows.fallbackApprovalHash, fallbackApprovalHash);
  assert.equal(publicRows.zoneApprovalHash, zoneApprovalHash);
});

test("texts: titles and lines of DESIGN §4.5 for the client, titles of the questions, never a key", () => {
  const owner = buildApprovals({ rows: rows(), contactId: OWNER, designated });
  assert.deepEqual(
    owner.map((a) => ({ title: a.title, summary: a.summary, intro: a.intro, lines: a.lines, details: a.details })),
    [
      {
        title: "Via allo sviluppo",
        summary: "Lateral Space può iniziare a costruire la soluzione.",
        intro: "Con la tua firma Lateral Space inizia a costruire la soluzione con le risposte verificate.",
        lines: ["12 domande indispensabili su 12 sono a posto."],
        details: ["Nessuna domanda parte senza risposta.", "Prova scritta allegata."],
      },
      {
        title: "Una domanda che non vale per voi",
        summary: "Quando serve la data?",
        intro: null,
        lines: ["Domanda: Quando serve la data?", "Perché non vale: La data non serve in questo processo", "L'ha proposto: il referente"],
        details: [],
      },
      {
        title: "Una domanda che non vale per voi",
        summary: "Chi approva gli sconti?",
        intro: null,
        lines: ["Domanda: Chi approva gli sconti?", "Perché non vale: Gli sconti non si usano", "L'ha proposto: Lateral Space"],
        details: [],
      },
      {
        title: "Partire senza una risposta",
        summary: "Costo medio di una richiesta",
        intro: null,
        lines: [
          "Domanda: Costo medio di una richiesta",
          "Perché partire senza: Il dato arriva con la chiusura del trimestre",
          "Come la chiudiamo: Lo carica l'amministrazione a gennaio",
          "Entro il 31 gen 2027.",
        ],
        details: [],
      },
      {
        title: "Una soluzione provvisoria",
        summary: "Costo medio di una richiesta",
        intro: null,
        lines: ["Domanda: Costo medio di una richiesta", "Al suo posto usiamo: Si usa la media dell'anno scorso", "Da sostituire entro il 31 mar 2027.", "Vale solo per l'avvio dello sviluppo."],
        details: [],
      },
      {
        title: "Una soluzione provvisoria",
        summary: "Tempo medio di risposta",
        intro: null,
        lines: ["Domanda: Tempo medio di risposta", "Al suo posto usiamo: Stima del responsabile commerciale", "Da sostituire appena possibile.", "Vale solo per l'avvio dello sviluppo."],
        details: [],
      },
    ],
  );
  const privacy = buildApprovals({ rows: rows(), contactId: PRIVACY, designated });
  assert.deepEqual(
    privacy.map((a) => ({ title: a.title, summary: a.summary, lines: a.lines })),
    [
      {
        title: "Scheda privacy del caso",
        summary: "Scheda privacy di esempio, versione 1.2",
        lines: [
          "Documento: Scheda privacy di esempio, versione 1.2, dell'1 ott 2026",
          "L'hanno approvata: approvatore privacy, dpo",
          "La vostra azienda può usare questi dati per il caso: sì",
          "I dati restano nella regione concordata: no",
          "Potranno vederli: Analista di prova",
        ],
      },
      {
        title: "Accesso ai dati personali",
        summary: "Analista di prova di Lateral Space",
        lines: ["Analista di prova di Lateral Space potrà vedere i dati personali del caso.", "Ogni accesso resta registrato.", "Proposto l'11 ott 2026."],
      },
    ],
  );
  // Nothing technical reaches the client: no key, article, via code, hash or «A.8».
  const all = [...owner, ...privacy];
  assert.ok(all.every((a) => a.technical.length === 0 && a.side === "cliente"));
  assert.deepEqual(findForbiddenIn(all.flatMap(visible), "cliente"), []);
});

test("texts: the via without a written proof drops that line for the client; with waivers it says how many", () => {
  const r = rows();
  const gate = { ...r.gates[0], has_evidence: false, computed: { required: 3, ok: 1, waivers: { used: 2 }, summary_text: "x" }, approvals: [] };
  const [client] = buildApprovals({ rows: { ...r, gates: [gate] }, contactId: OWNER, designated });
  assert.deepEqual(client.lines, ["1 domanda indispensabile su 3 è a posto."]);
  assert.deepEqual(client.details, ["2 domande partono senza risposta."]);
  assert.equal(client.otherSideSigned, false);
  assert.equal(client.waitingForLs, true);
  assert.equal(gateCountLine(null, null), "Le domande indispensabili sono a posto.");
});

test("texts: a privacy sheet that gives nobody access says so", () => {
  const r = rows();
  const sheet = { ...r.a8[0], evidence: { ...(r.a8[0].evidence as Record<string, unknown>), accesso_zona_personale: [] }, access_names: [] };
  const [a8] = buildApprovals({ rows: { ...r, a8: [sheet], zone: [] }, contactId: PRIVACY, designated });
  assert.equal(a8.kind, "a8");
  assert.ok(a8.lines.includes("Potranno vederli: nessuno"), a8.lines.join(" | "));
});

test("A1/A2 identical: the client's account on /firme gets the same decisions, texts and hashes as the link", () => {
  assert.deepEqual(buildCaseApprovals({ rows: rows(), roles: ["owner_cliente"] }), buildApprovals({ rows: rows(), contactId: OWNER, designated }));
  assert.deepEqual(buildCaseApprovals({ rows: rows(), roles: ["approvatore_privacy"] }), buildApprovals({ rows: rows(), contactId: PRIVACY, designated }));
  assert.deepEqual(buildCaseApprovals({ rows: rows(), roles: ["ls_analista", "osservatore"] }), []);
  assert.deepEqual(buildApprovals({ rows: rows(), contactId: "11111111-2222-4333-8444-555566667777", designated }), [], "a contact no longer designated signs nothing");
});

test("the Lateral Space lead signs what misses Lateral Space's signature, with the same hashes and technical details", () => {
  const lead = buildCaseApprovals({ rows: rows(), roles: ["ls_lead"] });
  assert.deepEqual(
    lead.map((a) => [a.kind, a.targetId, a.side, a.otherSideSigned, a.textHash]),
    [
      ["na", ITEM, "ls", false, HASH.na],
      ["ripiego", WAIVER_ITEM, "ls", false, HASH.ripiego],
      ["a8", A8, "ls", false, HASH.a8],
    ],
  );
  assert.equal(lead[0].title, "Una domanda che non si applica");
  assert.ok(lead[2].lines.includes("Il cliente può usare questi dati per il caso: sì"));
  assert.ok(lead.every((a) => a.technical.includes(`Impronta del testo: ${a.textHash}`)));
  // The via waits for Lateral Space only if the proposal lost its signature: then the confirmed text is in the technical details.
  const r = rows();
  const unsigned = buildCaseApprovals({ rows: { ...r, gates: [{ ...r.gates[0], approvals: [], has_evidence: false }] }, roles: ["ls_lead"] });
  assert.deepEqual(unsigned[0].details, ["Nessuna domanda parte senza risposta.", "Prova scritta: non ancora allegata."]);
  assert.ok(unsigned[0].technical.some((l) => l.startsWith("Testo confermato: G1 · ES-0001")));
});

test("«non si applica» signed from the link counts only for the signer designated now", () => {
  const r = rows();
  const linkSigned = (flag: boolean | undefined): PendingApprovalRows => ({
    ...r,
    na: [{ ...r.na[0], client_contact_id: "c1c1c1c1-1111-4222-8333-444455556666", ...(flag === undefined ? {} : { client_link_signed: flag }) }],
  });
  const ownerKinds = (p: PendingApprovalRows) => buildCaseApprovals({ rows: p, roles: ["owner_cliente"] }).filter((a) => a.kind === "na").length;
  assert.equal(ownerKinds(linkSigned(false)), 1, "the former signer's link signature does not count");
  assert.equal(ownerKinds(linkSigned(true)), 0, "the designated signer already signed");
  assert.equal(ownerKinds(linkSigned(undefined)), 0, "rows without the column: any link signature counts, as before");
  assert.equal(buildApprovals({ rows: linkSigned(undefined), contactId: OWNER, designated }).filter((a) => a.kind === "na").length, 1, "the link compares with its own contact");
});

test("the short list of the header and the menu is the /firme list, in the same order", () => {
  const r = rows();
  const asStatements = [r.gates, r.na, r.waiversAndFallbacks, r.a8, r.zone];
  const roleSets: CaseRole[][] = [["ls_lead"], ["owner_cliente"], ["approvatore_privacy"], ["ls_analista"]];
  for (const roles of roleSets) {
    const full = buildCaseApprovals({ rows: r, roles });
    const short = parsePendingSignatures(asStatements, roles);
    assert.deepEqual(
      short.map((s) => [s.targetId, s.side, s.otherSideSigned]),
      full.map((a) => [a.targetId, a.side, a.otherSideSigned]),
      roles.join(","),
    );
    assert.deepEqual(findForbiddenIn(short.map((s) => s.title), "cliente"), [], "titles, never keys");
  }
  assert.deepEqual(
    parsePendingSignatures(asStatements, ["owner_cliente"]).map((s) => s.kind),
    ["via", "non_si_applica", "non_si_applica", "partire_senza_risposta", "soluzione_provvisoria", "soluzione_provvisoria"],
  );
  assert.deepEqual(parsePendingSignatures([], ["ls_lead"]), []);
});

test("texts: a question title with a key or a privacy sheet code reaches the client signer clean, hashes unchanged", () => {
  const coded = (r: PendingApprovalRows): PendingApprovalRows => ({
    ...r,
    na: r.na.map((row) => ({ ...row, title: "Turni del personale (A.8) (q.turni.01)" })),
    waiversAndFallbacks: r.waiversAndFallbacks.map((row) => ({ ...row, title: "Costo medio (art. 8.4), vedi q.costi.09" })),
  });
  const kinds = new Set(["na", "deroga", "ripiego"]);
  for (const roles of [["owner_cliente"], ["approvatore_privacy", "owner_cliente"]] as CaseRole[][]) {
    const client = buildCaseApprovals({ rows: coded(rows()), roles }).filter((a) => kinds.has(a.kind));
    assert.ok(client.length > 0, roles.join(","));
    assert.ok(client.every((a) => a.side === "cliente"));
    assert.deepEqual(findForbiddenIn(client.flatMap((a) => [...visible(a), a.subject ?? ""]), "cliente"), [], roles.join(","));
    // The signed texts never include the title.
    assert.deepEqual(shape(client), shape(buildCaseApprovals({ rows: rows(), roles }).filter((a) => kinds.has(a.kind))));
  }
  const na = buildCaseApprovals({ rows: coded(rows()), roles: ["owner_cliente"] }).find((a) => a.kind === "na");
  assert.equal(na?.summary, "Turni del personale");
  assert.equal(na?.lines[0], "Domanda: Turni del personale");
  const r = coded(rows());
  const menu = parsePendingSignatures([r.gates, r.na, r.waiversAndFallbacks, r.a8, r.zone], ["owner_cliente"]).map((s) => s.title);
  assert.deepEqual(findForbiddenIn(menu, "cliente"), [], "the header's signature menu");
  assert.ok(menu.includes("Non si applica: «Turni del personale»"));
  // Lateral Space reads the title as it is, codes included.
  const lead = buildCaseApprovals({ rows: coded(rows()), roles: ["ls_lead"] }).find((a) => a.kind === "na");
  assert.equal(lead?.summary, "Turni del personale (A.8) (q.turni.01)");
  // A title made only of a key falls back to the untitled wording.
  const keyOnly = buildCaseApprovals({ rows: { ...rows(), na: rows().na.map((row) => ({ ...row, title: "q.turni.01" })) }, roles: ["owner_cliente"] }).find((a) => a.kind === "na");
  assert.equal(keyOnly?.summary, "Una domanda senza titolo");
});

/** The allow list of an action of today (`onCase(…, workspaceId, caseId, <list>, …)`), read from its source. */
function actionAllowList(file: string, action: string): string[] {
  const source = readFileSync(new URL(`../../actions/${file}`, import.meta.url), "utf8");
  const start = source.indexOf(`export async function ${action}(`);
  assert.ok(start >= 0, `${action} in ${file}`);
  const body = source.slice(start, source.indexOf("\n}\n", start));
  const m = body.match(/onCase\(\{ session, access \}, workspaceId, caseId, (\[[^\]]*\]|[A-Z_]+),/);
  assert.ok(m, `${action}: allow list`);
  const literal = m[1].startsWith("[") ? m[1] : source.match(new RegExp(`const ${m[1]}: readonly CaseRole\\[\\] = (\\[[^\\]]*\\])`))?.[1];
  assert.ok(literal, `${action}: ${m[1]}`);
  return JSON.parse(literal);
}

test("/firme decides with the same roles as the actions of today it adapts", () => {
  const today: Record<string, { approvo: [string, string]; non_approvo?: [string, string] }> = {
    na: { approvo: ["uc-catalog.ts", "signNaAction"], non_approvo: ["uc-catalog.ts", "rejectNaAction"] },
    deroga: { approvo: ["uc-catalog.ts", "signWaiverAction"] },
    ripiego: { approvo: ["uc-catalog.ts", "signFallbackAction"] },
    gate: { approvo: ["uc-gates.ts", "signGateAction"], non_approvo: ["uc-gates.ts", "rejectGateAction"] },
    a8: { approvo: ["uc-gates.ts", "resolveBlockerAction"] },
    zona_personale: { approvo: ["uc-cases.ts", "signPersonalZoneAccessAction"] },
  };
  for (const [kind, actions] of Object.entries(today)) {
    const roles = APPROVAL_DECISION_ROLES[kind as keyof typeof APPROVAL_DECISION_ROLES];
    assert.deepEqual([...roles.approvo].sort(), actionAllowList(...actions.approvo).sort(), `${kind} approvo`);
    assert.deepEqual([...roles.non_approvo].sort(), actions.non_approvo ? actionAllowList(...actions.non_approvo).sort() : [], `${kind} non_approvo`);
  }
  const union = new Set(Object.values(APPROVAL_DECISION_ROLES).flatMap((r) => [...r.approvo, ...r.non_approvo]));
  assert.deepEqual([...APPROVAL_SIGNER_ROLES].sort(), [...union].sort());
  assert.equal(approvalDecisionAllowed("gate", "approvo", ["owner_cliente"]), true);
  assert.equal(approvalDecisionAllowed("deroga", "non_approvo", ["owner_cliente"]), false, "a waiver is not rejected: one does not sign");
  assert.equal(approvalDecisionAllowed("zona_personale", "approvo", ["ls_lead"]), false);
  assert.equal(approvalDecisionAllowed("a8", "approvo", ["approvatore_privacy"]), true);
});

test("fixed texts of the signatures (list, buttons, other signature, outcome) pass the copy-guard", () => {
  const all: string[] = [
    ...Object.values(texts.APPROVAL_TEXT),
    ...[1, 3].flatMap((n) => [texts.listIntro(n).lead, texts.listIntro(n).calm, texts.startLabel(n)]),
    texts.stepCounter(0, 3),
    texts.nextLabel(1, 3),
    texts.approvalDocumentTitle(0, 3, "Via allo sviluppo"),
  ];
  for (const side of ["cliente", "ls"] as const) {
    all.push(texts.notRejectableText(side));
    for (const kind of ["gate", "na", "a8", "zona_personale"] as const) for (const otherSideSigned of [true, false]) all.push(texts.otherSideText({ kind, side, otherSideSigned }));
    for (const decision of ["approvo", "non_approvo"] as const)
      for (const complete of [true, false]) for (const waitingForEvidence of [true, false]) all.push(texts.outcomeText({ side, decision, complete, waitingForEvidence }));
  }
  assert.deepEqual(findForbiddenIn(all, "cliente"), []);
  assert.equal(texts.listIntro(1).lead, "Ci serve la tua firma su una decisione.");
  assert.equal(texts.listIntro(3).lead, "Ci servono le tue firme su 3 decisioni.");
  assert.equal(texts.nextLabel(1, 3), "Avanti · 2 di 3");
  assert.equal(texts.outcomeText({ side: "cliente", decision: "approvo", complete: false }), "Firmato. Ora manca la firma di Lateral Space.");
  assert.equal(texts.outcomeText({ side: "cliente", decision: "approvo", complete: true }), "Firmato. Con la tua firma la decisione è completa.");
  assert.equal(texts.notRejectableText("cliente"), "Se non sei d'accordo, non firmare e rispondi all'email di Lateral Space: senza la tua firma resta tutto fermo.");
});

test("A1/A2 identical: the client reads /firme with the link's sizes; Lateral Space with the app's", () => {
  assert.equal(texts.approvalVariantFor(["owner_cliente"]), "cliente");
  assert.equal(texts.approvalVariantFor(["approvatore_privacy"]), "cliente");
  assert.equal(texts.approvalVariantFor(["owner_cliente", "approvatore_privacy"]), "cliente");
  assert.equal(texts.approvalVariantFor(["ls_lead"]), "ls");
  assert.equal(texts.approvalVariantFor(["ls_lead", "owner_cliente"]), "ls", "a Lateral Space role keeps the app's sizes");
  assert.equal(texts.approvalVariantFor([]), "ls");
});

test("/firme rereads the page after the same refusals as the link: a changed text, a decision no longer pending", () => {
  assert.equal(texts.approvalNeedsReload("testo_cambiato"), true);
  assert.equal(texts.approvalNeedsReload("approvazione_non_trovata"), true);
  for (const code of ["ruolo_non_ammesso", "rifiuto_non_disponibile", "motivo_mancante", "caso_in_pausa", "dati_non_validi"]) assert.equal(texts.approvalNeedsReload(code), false, code);
  // The same codes the link page reloads on (referente-page.tsx, owner WP8).
  const linkPage = readFileSync(new URL("../../../components/uc/referente/referente-page.tsx", import.meta.url), "utf8");
  assert.match(linkPage, /r\.code === "testo_cambiato" \|\| r\.code === "approvazione_non_trovata"\) await refresh\(\)/);
  // The /firme host rereads its list on a refused decision with an action that returns the data (not router.refresh()).
  const host = readFileSync(new URL("../../../components/uc/approvals/case-approvals.tsx", import.meta.url), "utf8");
  assert.match(host, /if \(approvalNeedsReload\(r\.code\)\) await reload\(\);/);
  assert.match(host, /const r = await loadApprovalsAction\(workspaceId, caseId\);\s+if \(r\.ok\) setList\(r\.data\);/);
  assert.match(host, /<ApprovalRunner approvals=\{list\}/);
});

test("each step names itself in the tab (DESIGN §4.7)", () => {
  assert.equal(texts.approvalDocumentTitle(0, 3, "Via allo sviluppo"), "Firma 1 di 3 · Via allo sviluppo · Unbundle");
  assert.equal(texts.approvalDocumentTitle(1, 3, "Una domanda che non vale per voi"), "Firma 2 di 3 · Una domanda che non vale per voi · Unbundle");
});

test("the link says the same outcome as /firme, also after «Non approvo» and for a via waiting for the written proof", () => {
  const [gate, na] = buildApprovals({ rows: rows(), contactId: OWNER, designated });
  assert.deepEqual([gate.kind, gate.otherSideSigned, na.kind, na.otherSideSigned], ["gate", true, "na", false]);
  // The link page passes only its message today: «completa» or «manca la firma di Lateral Space».
  const complete = { message: "Firmato. Con la tua firma la decisione è completa." };
  const notComplete = { message: "Firmato. Ora manca la firma di Lateral Space." };
  assert.equal(texts.linkOutcomeText(gate, "non_approvo", complete), "Non approvata. Lateral Space legge il tuo motivo.");
  assert.equal(texts.linkOutcomeText(na, "non_approvo", notComplete), "Non approvata. Lateral Space legge il tuo motivo.");
  assert.equal(texts.linkOutcomeText(gate, "approvo", complete), texts.outcomeText({ side: "cliente", decision: "approvo", complete: true }));
  assert.equal(texts.linkOutcomeText(na, "approvo", notComplete), "Firmato. Ora manca la firma di Lateral Space.");
  // Lateral Space already signed the via and it is still not complete: only the written proof is missing.
  assert.equal(texts.linkOutcomeText(gate, "approvo", notComplete), "Firmato. Ora Lateral Space allega la prova scritta.");
  // With the API's fields, they decide.
  assert.equal(texts.linkOutcomeText(gate, "approvo", { message: "", complete: true }), "Firmato. Con la tua firma la decisione è completa.");
  assert.equal(texts.linkOutcomeText(gate, "approvo", { message: "", complete: false, waitingForEvidence: true }), "Firmato. Ora Lateral Space allega la prova scritta.");
  assert.equal(texts.linkOutcomeText(na, "approvo", { message: "", complete: false, waitingForEvidence: false }), "Firmato. Ora manca la firma di Lateral Space.");
});

test("a step of an older link answer gets the client's defaults", () => {
  const [gate] = buildApprovals({ rows: rows(), contactId: OWNER, designated });
  const { side, otherSideSigned, summary, intro, details, itemId, subject, technical, ...old } = gate;
  assert.ok(side && summary !== undefined && intro !== undefined && details && itemId === null && subject === null && technical);
  const step = texts.asApprovalStep(old);
  assert.equal(step.side, "cliente");
  assert.equal(step.otherSideSigned, otherSideSigned, "from waitingForLs");
  assert.deepEqual([step.summary, step.intro, step.details, step.technical], ["", null, [], []]);
  assert.equal(texts.approvalKey({ kind: "na", targetId: ITEM.toUpperCase() }), `na:${ITEM}`);
});

/**
 * The fixed texts written in the signature components: what the static scan
 * reads is close enough to what the pages render (same scan as the referent
 * components in `referente-plan.test.ts`, which leaves `approvals-view.tsx` here).
 */
function signatureComponentTexts(): { file: string; text: string }[] {
  const components = fileURLToPath(new URL("../../../components/uc/", import.meta.url));
  const files = [
    ...readdirSync(join(components, "approvals"))
      .filter((n) => /\.tsx?$/.test(n))
      .map((n) => join("approvals", n)),
    join("referente", "approvals-view.tsx"),
  ];
  const out: { file: string; text: string }[] = [];
  for (const file of files) {
    const source = readFileSync(join(components, file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
      .replace(/^\s*import .*$/gm, "")
      // Operands of a comparison (`kind === "…"`) are codes, never rendered.
      .replace(/[!=]==\s*"[^"\n]*"/g, "");
    const add = (text: string) => {
      const t = text.replace(/\s+/g, " ").trim();
      if (!/[A-Za-zÀ-ÿ]/.test(t) || /^[./@#]/.test(t) || /^\)|\($|=>/.test(t)) return;
      out.push({ file, text: t });
    };
    for (const m of source.matchAll(/>([^<>{}]+)</g)) add(m[1]);
    for (const m of source.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) add(m[1]);
    for (const m of source.matchAll(/`((?:[^`\\]|\\.)*)`/g)) add(m[1].replace(/\$\{[^}]*\}/g, "1"));
  }
  return out;
}

test("fixed texts of the signature components pass the copy-guard", () => {
  const found = signatureComponentTexts();
  const all = found.map((t) => t.text);
  assert.ok(all.includes("Ho letto e approvo"), "the scan reads the texts module");
  assert.ok(all.includes("Confermo: non approvo"));
  assert.ok(found.some((t) => t.file.endsWith("approval-step.tsx")));
  assert.deepEqual(
    found.flatMap((t) => findForbiddenIn([t.text], "cliente").map((f) => `${t.file}: «${f.match}» in «${t.text}»`)),
    [],
  );
});
