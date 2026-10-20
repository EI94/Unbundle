import test from "node:test";
import assert from "node:assert/strict";
import {
  A8_PRIVACY_CLASSES,
  activeBlockerKeys,
  blockerEvidenceHash,
  blockerKeysForItem,
  blockerLinksForItem,
  blockerScopeToJson,
  canDeleteItemBlockerLink,
  checkBlockerEvidence,
  checkManualBlockerLink,
  checkReactivateBlocker,
  checkReclassification,
  checkResolveBlocker,
  effectiveScope,
  ensureMandatoryBlockers,
  initialBlockerStatus,
  itemsToBlock,
  itemsToUnblock,
  parseBlockerScope,
  realDataAllowed,
  unknownBlockerKeys,
  type BlockerDef,
  type ItemBlockerFacts,
} from "./blockers.ts";
import { checkItemTransition } from "./item-state.ts";
import type { Actor, Approval, ItemSnapshot } from "./types.ts";
import type { BlockerStatus, ItemStatus } from "./vocab.ts";

const scope = (over: Partial<BlockerDef["scope"]> = {}): BlockerDef["scope"] => ({ privacyClasses: [], availability: [], perimeters: [], realData: false, ...over });

/** Blocchi d'esempio, come li produce il normalizzatore (chiavi generiche, token inventati). */
const DEFS: BlockerDef[] = [
  { key: "a8", scope: scope({ privacyClasses: ["personale", "personale_equipaggio"], realData: true }), permanent: false },
  { key: "decisione_board", scope: scope({ perimeters: ["evoluzione"] }), permanent: false },
  { key: "fuori_foundation", scope: scope({ availability: ["fuori_foundation"] }), permanent: false },
  { key: "accesso_sistema", scope: scope({ availability: ["con_api_gestionale"] }), permanent: false, fallbackAllowed: "export autorizzato" },
  { key: "costi_art_8_4", scope: scope(), permanent: false },
  { key: "sanitario", scope: scope({ privacyClasses: ["escluso_sanitario"] }), permanent: true },
];

function facts(over: Partial<ItemBlockerFacts> = {}): ItemBlockerFacts {
  return { kind: "campo", privacyClass: "riservato_azienda", availability: [], perimeter: "in_contratto", explicitBlockedBy: [], ...over };
}

const LEAD: Actor = { type: "utente", userId: "u-lead", roles: ["ls_lead"] };
const ANALYST: Actor = { type: "utente", userId: "u-an", roles: ["ls_analista"] };
const OWNER: Actor = { type: "utente", userId: "u-owner", roles: ["owner_cliente"] };
const PRIVACY: Actor = { type: "utente", userId: "u-privacy", roles: ["approvatore_privacy"] };
const PRIVACY_LINK: Actor = { type: "owner_link", contactId: "c-privacy", requestId: "r-appr", designation: "privacy" };
const OWNER_LINK: Actor = { type: "owner_link", contactId: "c-owner", requestId: "r-appr", designation: "owner" };
const code = (r: { ok: boolean; code?: string }) => (r.ok ? "ok" : r.code);

test("scope by privacy class, availability tokens (any of them), perimeter and explicit blocked_by", () => {
  const cases: [string, Partial<ItemBlockerFacts>, string[]][] = [
    ["nothing special", {}, []],
    ["public", { privacyClass: "nessuna" }, []],
    ["personal", { privacyClass: "personale" }, ["a8"]],
    ["crew personal", { privacyClass: "personale_equipaggio" }, ["a8"]],
    ["health data on a field", { privacyClass: "escluso_sanitario" }, ["a8", "sanitario"]],
    ["health data on a question too", { kind: "domanda", privacyClass: "escluso_sanitario" }, ["a8", "sanitario"]],
    ["health data on a KPI too", { kind: "kpi", privacyClass: "escluso_sanitario" }, ["a8", "sanitario"]],
    ["after A.8", { availability: ["dopo_a8"] }, ["a8"]],
    ["several tokens, one matches", { availability: ["oggi_export", "con_api_gestionale"] }, ["accesso_sistema"]],
    ["several tokens, two blockers", { availability: ["da_costruire", "con_api_gestionale", "dopo_a8"] }, ["a8", "accesso_sistema"]],
    ["outside Foundation", { availability: ["fuori_foundation"] }, ["fuori_foundation"]],
    ["evolution", { perimeter: "evoluzione" }, ["decisione_board"]],
    ["evolution and personal", { perimeter: "evoluzione", privacyClass: "personale" }, ["a8", "decisione_board"]],
    ["explicit only (manual-only blocker)", { explicitBlockedBy: ["costi_art_8_4"] }, ["costi_art_8_4"]],
    ["explicit a8 on a question", { kind: "domanda", explicitBlockedBy: ["a8"] }, ["a8"]],
    ["unknown token", { availability: ["oggi_export"] }, []],
  ];
  for (const [name, over, expected] of cases) {
    assert.deepEqual(blockerKeysForItem(facts(over), DEFS), expected, name);
  }
  const links = blockerLinksForItem(facts({ privacyClass: "personale", explicitBlockedBy: ["a8", "costi_art_8_4"], perimeter: "evoluzione" }), DEFS);
  assert.deepEqual(links, [
    { key: "a8", origin: "template" },
    { key: "decisione_board", origin: "scope" },
    { key: "costi_art_8_4", origin: "template" },
  ]);
  assert.deepEqual(unknownBlockerKeys(["a8", "titolo_dati", "titolo_dati"], DEFS), ["titolo_dati"]);
});

test("a8 always covers every class of rank ≥ personale and dopo_a8, even if the template forgets", () => {
  assert.deepEqual([...A8_PRIVACY_CLASSES], ["escluso_sanitario", "personale_equipaggio", "personale"]);
  const narrow: BlockerDef[] = [{ key: "a8", scope: scope({ privacyClasses: ["personale"] }), permanent: false }];
  assert.deepEqual(blockerKeysForItem(facts({ privacyClass: "personale_equipaggio" }), narrow), ["a8"]);
  assert.deepEqual(blockerKeysForItem(facts({ availability: ["dopo_a8"] }), narrow), ["a8"]);
  assert.equal(effectiveScope(narrow[0]).realData, true);
  // Without a8 and sanitario in the template, the case still gets them.
  const withMandatory = ensureMandatoryBlockers([{ key: "decisione_board", scope: scope({ perimeters: ["evoluzione"] }), permanent: false }]);
  assert.deepEqual(withMandatory.map((d) => d.key), ["decisione_board", "a8", "sanitario"]);
  assert.deepEqual(blockerKeysForItem(facts({ privacyClass: "escluso_sanitario" }), withMandatory), ["a8", "sanitario"]);
  assert.equal(ensureMandatoryBlockers(DEFS).length, DEFS.length);
});

test("sanitario is permanent whatever the template says; scopes round-trip through jsonb", () => {
  assert.equal(initialBlockerStatus({ key: "sanitario", permanent: false }), "permanente");
  assert.equal(initialBlockerStatus({ key: "a8", permanent: false }), "attivo");
  assert.equal(initialBlockerStatus({ key: "altro", permanent: true }), "permanente");
  const parsed = parseBlockerScope({ privacy_classes: ["personale", "inventata", "personale"], availability: ["dopo_a8", "Non Valido", 3], perimeters: ["evoluzione", "x"], real_data: true });
  assert.deepEqual(parsed, { privacyClasses: ["personale"], availability: ["dopo_a8"], perimeters: ["evoluzione"], realData: true });
  assert.deepEqual(parseBlockerScope(blockerScopeToJson(parsed)), parsed);
  assert.deepEqual(parseBlockerScope(null), scope());
  assert.deepEqual(parseBlockerScope([]), scope());
});

test("active statuses, deletable rows and real data", () => {
  const statuses = new Map<string, BlockerStatus>([["a8", "sciolto"], ["sanitario", "permanente"], ["decisione_board", "attivo"]]);
  assert.deepEqual(activeBlockerKeys(["a8", "sanitario", "decisione_board", "sconosciuto"], statuses), ["sanitario", "decisione_board", "sconosciuto"]);
  assert.equal(canDeleteItemBlockerLink("attivo"), false);
  assert.equal(canDeleteItemBlockerLink("permanente"), false);
  assert.equal(canDeleteItemBlockerLink("sciolto"), true);
  const a8 = DEFS[0];
  assert.equal(realDataAllowed([{ def: a8, status: "attivo" }, { def: DEFS[5], status: "permanente" }]), false);
  assert.equal(realDataAllowed([{ def: a8, status: "sciolto" }, { def: DEFS[5], status: "permanente" }]), true);
});

test("unblocking: an item unlocks only when all its blockers are resolved", () => {
  const links = [
    { itemId: "i1", blockerId: "b-a8" },
    { itemId: "i2", blockerId: "b-a8" },
    { itemId: "i2", blockerId: "b-board" },
    { itemId: "i3", blockerId: "b-a8" },
    { itemId: "i4", blockerId: "b-a8" },
    { itemId: "i4", blockerId: "b-health" },
    { itemId: "i5", blockerId: "b-a8" },
    { itemId: "i5", blockerId: "b-unknown" },
    { itemId: "i6", blockerId: "b-board" },
  ];
  const itemStatus = new Map<string, ItemStatus>([
    ["i1", "bloccata"], ["i2", "bloccata"], ["i3", "non_applicabile"], ["i4", "bloccata"], ["i5", "bloccata"], ["i6", "bloccata"],
  ]);
  const blockerStatus = new Map<string, BlockerStatus>([["b-a8", "attivo"], ["b-board", "attivo"], ["b-health", "permanente"]]);
  // a8 resolves: i1 unlocks; i2 keeps the board blocker; i3 is not blocked; i4 has the health lock; i5 has an unknown blocker.
  assert.deepEqual(itemsToUnblock({ resolvedBlockerId: "b-a8", links, blockerStatus, itemStatus }), ["i1"]);
  // Then the board resolves too: i2 and i6 unlock.
  const later = new Map(blockerStatus).set("b-a8", "sciolto");
  assert.deepEqual(itemsToUnblock({ resolvedBlockerId: "b-board", links, blockerStatus: later, itemStatus }), ["i2", "i6"]);
});

test("reactivation blocks every linked item except not applicable and already blocked ones", () => {
  const links = ["da_chiedere", "chiesta", "mancante", "parziale", "in_verifica", "validata", "non_applicabile", "bloccata"].map((s) => ({ itemId: s, blockerId: "b-a8" }));
  const itemStatus = new Map<string, ItemStatus>(links.map((l) => [l.itemId, l.itemId as ItemStatus]));
  assert.deepEqual(itemsToBlock({ reactivatedBlockerId: "b-a8", links: [...links, { itemId: "x", blockerId: "b-other" }], itemStatus }), [
    "da_chiedere", "chiesta", "mancante", "parziale", "in_verifica", "validata",
  ]);
  const reactivated = checkReactivateBlocker({ def: { key: "a8", permanent: false }, status: "sciolto", actor: LEAD, reason: "Scheda A.8 ritirata" });
  assert.deepEqual(reactivated.ok && reactivated.value.sideEffects, ["blocca_voci", "campanella_ls_lead", "chiudi_zona_personale"]);
  const board = checkReactivateBlocker({ def: { key: "decisione_board", permanent: false }, status: "sciolto", actor: LEAD, reason: "Decisione revocata" });
  assert.deepEqual(board.ok && board.value.sideEffects, ["blocca_voci", "campanella_ls_lead"]);
  assert.equal(code(checkReactivateBlocker({ def: { key: "a8", permanent: false }, status: "attivo", actor: LEAD, reason: "x".repeat(5) })), "blocco_non_sciolto");
  assert.equal(code(checkReactivateBlocker({ def: { key: "a8", permanent: false }, status: "sciolto", actor: LEAD, reason: " " })), "motivo_obbligatorio");
  assert.equal(code(checkReactivateBlocker({ def: { key: "a8", permanent: false }, status: "sciolto", actor: ANALYST, reason: "Ritirata" })), "attore_non_ammesso");
});

const A8_EVIDENCE = {
  documento: "Scheda A.8",
  versione: "1.0",
  data: "2026-10-01",
  approvatori_per_ruolo: ["owner_cliente", "approvatore_privacy"],
  file_id: "file-a8",
  titolo_art_15_2: true,
  regione_dati_verificata: true,
  accesso_zona_personale: ["u-an"],
};
const at = "2026-10-07T10:00:00Z";
/** Le due firme A.8 valgono sull'impronta delle stesse prove. */
const A8_HASH = blockerEvidenceHash(A8_EVIDENCE);
const LS_SIGNATURE: Approval = { ruolo: "ls_lead", user_id: "u-lead", at, metodo: "account", text_hash: A8_HASH };
const PRIVACY_SIGNATURE: Approval = { ruolo: "approvatore_privacy", contact_id: "c-privacy", at, metodo: "link", text_hash: A8_HASH };

test("a permanent blocker never resolves; a8 needs complete evidence and two signatures", () => {
  for (const def of [{ key: "sanitario", permanent: false }, { key: "altro", permanent: true }]) {
    for (const status of ["attivo", "permanente"] as const) {
      assert.equal(code(checkResolveBlocker({ def, status, evidence: { file_id: "f", data: "2026-10-01" }, approvals: [], actor: LEAD })), "blocco_permanente");
    }
  }
  const a8 = { key: "a8", permanent: false };
  assert.equal(code(checkResolveBlocker({ def: a8, status: "sciolto", evidence: A8_EVIDENCE, approvals: [], actor: LEAD })), "blocco_non_attivo");
  // One signature: still active, waiting for the client.
  const one = checkResolveBlocker({ def: a8, status: "attivo", evidence: A8_EVIDENCE, approvals: [LS_SIGNATURE], actor: LEAD });
  assert.ok(one.ok);
  assert.equal(one.ok && one.value.complete, false);
  assert.equal(one.ok && one.value.message, "In attesa della conferma del cliente");
  assert.deepEqual(one.ok && one.value.sideEffects, []);
  const onlyClient = checkResolveBlocker({ def: a8, status: "attivo", evidence: A8_EVIDENCE, approvals: [PRIVACY_SIGNATURE], actor: PRIVACY_LINK });
  assert.equal(onlyClient.ok && onlyClient.value.waitingFor, "lateral_space");
  // Owner instead of the privacy approver does not count.
  const ownerSig: Approval = { ruolo: "owner_cliente", user_id: "u-owner", at, metodo: "account", text_hash: A8_HASH };
  assert.equal(((r) => r.ok && r.value.complete)(checkResolveBlocker({ def: a8, status: "attivo", evidence: A8_EVIDENCE, approvals: [LS_SIGNATURE, ownerSig], actor: LEAD })), false);
  // Both: resolved, items unlock.
  for (const actor of [LEAD, PRIVACY, PRIVACY_LINK]) {
    const both = checkResolveBlocker({ def: a8, status: "attivo", evidence: A8_EVIDENCE, approvals: [LS_SIGNATURE, PRIVACY_SIGNATURE], actor });
    assert.ok(both.ok && both.value.complete);
    assert.deepEqual(both.ok && both.value.sideEffects, ["sblocca_voci", "campanella_bozze_pronte"]);
  }
  for (const actor of [OWNER, OWNER_LINK, ANALYST]) {
    assert.equal(code(checkResolveBlocker({ def: a8, status: "attivo", evidence: A8_EVIDENCE, approvals: [LS_SIGNATURE, PRIVACY_SIGNATURE], actor })), "attore_non_ammesso");
  }
  // The two signatures must be on the same evidence: another file or another access list does not count.
  const otherEvidence = { ...A8_EVIDENCE, accesso_zona_personale: ["u-an", "u-dev"] };
  const onOther: Approval = { ...PRIVACY_SIGNATURE, text_hash: blockerEvidenceHash(otherEvidence) };
  const mixed = checkResolveBlocker({ def: a8, status: "attivo", evidence: A8_EVIDENCE, approvals: [LS_SIGNATURE, onOther], actor: LEAD });
  assert.equal(mixed.ok && mixed.value.complete, false);
  assert.equal(mixed.ok && mixed.value.waitingFor, "cliente");
  const unhashed = checkResolveBlocker({ def: a8, status: "attivo", evidence: A8_EVIDENCE, approvals: [{ ...LS_SIGNATURE, text_hash: null }, PRIVACY_SIGNATURE], actor: LEAD });
  assert.equal(unhashed.ok && unhashed.value.waitingFor, "lateral_space");
  // The result carries the hash to sign; it ignores key order and changes with any evidence change.
  assert.equal(mixed.ok && mixed.value.evidenceHash, A8_HASH);
  const reordered = Object.fromEntries(Object.entries(A8_EVIDENCE).reverse());
  assert.equal(blockerEvidenceHash(reordered), A8_HASH);
  assert.notEqual(blockerEvidenceHash({ ...A8_EVIDENCE, file_id: "file-a8-v2" }), A8_HASH);
  // Roles are recomputed: a removed Lateral Space domain cannot resolve.
  const notLs = { userId: "u-lead", emailVerified: true, emailDomain: "x.test", isLateralSpace: false };
  assert.equal(code(checkResolveBlocker({ def: a8, status: "attivo", evidence: A8_EVIDENCE, approvals: [], actor: LEAD, user: notLs })), "attore_non_ammesso");
});

test("evidence rules per blocker, table-driven", () => {
  const cases: [string, string, unknown, string][] = [
    ["a8 complete", "a8", A8_EVIDENCE, "ok"],
    ["a8 nobody in the personal zone", "a8", { ...A8_EVIDENCE, accesso_zona_personale: [] }, "ok"],
    ["a8 without file", "a8", { ...A8_EVIDENCE, file_id: "" }, "prove_mancanti"],
    ["a8 bad date", "a8", { ...A8_EVIDENCE, data: "31/09/2026" }, "prove_mancanti"],
    ["a8 approvers as names", "a8", { ...A8_EVIDENCE, approvatori_per_ruolo: ["Mario Rossi"] }, "prove_mancanti"],
    ["a8 no approvers", "a8", { ...A8_EVIDENCE, approvatori_per_ruolo: [] }, "prove_mancanti"],
    ["a8 without data title", "a8", { ...A8_EVIDENCE, titolo_art_15_2: false }, "titolo_dati_mancante"],
    ["a8 region not verified", "a8", { ...A8_EVIDENCE, regione_dati_verificata: "si" }, "regione_non_verificata"],
    ["a8 personal zone missing", "a8", { ...A8_EVIDENCE, accesso_zona_personale: undefined }, "prove_mancanti"],
    ["board with minutes", "decisione_board", { file_id: "f", data: "2026-10-01" }, "ok"],
    ["board without date", "decisione_board", { file_id: "f" }, "prove_mancanti"],
    ["outside Foundation without file", "fuori_foundation", { data: "2026-10-01" }, "prove_mancanti"],
    ["costs with authorization", "costi_art_8_4", { file_id: "f" }, "ok"],
    ["costs without file", "costi_art_8_4", { descrizione: "Autorizzati a voce" }, "prove_mancanti"],
    ["system access described", "accesso_sistema", { descrizione: "Lettura via export notturno", data: "2026-10-01" }, "ok"],
    ["system access too short", "accesso_sistema", { descrizione: "ok", data: "2026-10-01" }, "prove_mancanti"],
    ["other key with a file", "altro", { file_id: "f", data: "2026-10-01" }, "ok"],
    ["no evidence", "decisione_board", null, "prove_mancanti"],
  ];
  for (const [name, key, evidence, expected] of cases) {
    assert.equal(code(checkBlockerEvidence(key, evidence)), expected, name);
  }
  // Other blockers: ls_lead alone resolves them.
  const board = checkResolveBlocker({ def: { key: "decisione_board", permanent: false }, status: "attivo", evidence: { file_id: "f", data: "2026-10-01" }, approvals: [], actor: LEAD });
  assert.ok(board.ok && board.value.complete);
  assert.equal(code(checkResolveBlocker({ def: { key: "decisione_board", permanent: false }, status: "attivo", evidence: { file_id: "f", data: "2026-10-01" }, approvals: [], actor: PRIVACY })), "attore_non_ammesso");
});

test("manual blocker links: only ls_lead, block now only if active", () => {
  assert.deepEqual(((r) => r.ok && r.value)(checkManualBlockerLink({ blockerStatus: "attivo", itemStatus: "mancante", alreadyLinked: false, actor: LEAD })), { blockNow: true });
  assert.deepEqual(((r) => r.ok && r.value)(checkManualBlockerLink({ blockerStatus: "sciolto", itemStatus: "mancante", alreadyLinked: false, actor: LEAD })), { blockNow: false });
  assert.deepEqual(((r) => r.ok && r.value)(checkManualBlockerLink({ blockerStatus: "attivo", itemStatus: "non_applicabile", alreadyLinked: false, actor: LEAD })), { blockNow: false });
  assert.equal(code(checkManualBlockerLink({ blockerStatus: "attivo", itemStatus: "mancante", alreadyLinked: true, actor: LEAD })), "blocco_gia_presente");
  assert.equal(code(checkManualBlockerLink({ blockerStatus: "attivo", itemStatus: "mancante", alreadyLinked: false, actor: ANALYST })), "attore_non_ammesso");
});

test("reclassification recomputes locks and never weakens privacy on its own", () => {
  const statuses = new Map<string, BlockerStatus>(DEFS.map((d) => [d.key, initialBlockerStatus(d)]));
  const base = { defs: DEFS, blockerStatus: statuses };
  // Raising the class to personal adds a8 and blocks the item.
  const raised = checkReclassification({ ...base, before: facts(), after: facts({ privacyClass: "personale" }), itemStatus: "validata", existingLinks: [] });
  assert.ok(raised.ok);
  if (raised.ok) {
    assert.deepEqual(raised.value.add, [{ key: "a8", origin: "scope" }]);
    assert.equal(raised.value.block, true);
    assert.equal(raised.value.privacyChange, "alzata");
  }
  // Lowering needs the privacy approver's signature.
  const personal = facts({ privacyClass: "personale" });
  const a8Link = [{ key: "a8", origin: "scope" as const }];
  assert.equal(code(checkReclassification({ ...base, before: personal, after: facts(), itemStatus: "bloccata", existingLinks: a8Link })), "classe_privacy_abbassata");
  // With the signature: the active a8 row is never removed, so the item stays blocked.
  const lowered = checkReclassification({ ...base, before: personal, after: facts(), itemStatus: "bloccata", existingLinks: a8Link, privacyLoweringApproved: true });
  assert.ok(lowered.ok);
  if (lowered.ok) {
    assert.deepEqual(lowered.value.remove, []);
    assert.deepEqual(lowered.value.activeKeys, ["a8"]);
    assert.equal(lowered.value.privacyChange, "abbassata");
  }
  // Once a8 is resolved, the row of a resolved blocker that no longer matches can go.
  const resolved = new Map(statuses).set("a8", "sciolto");
  const afterA8 = checkReclassification({ defs: DEFS, blockerStatus: resolved, before: personal, after: facts(), itemStatus: "da_chiedere", existingLinks: a8Link, privacyLoweringApproved: true });
  assert.deepEqual(afterA8.ok && afterA8.value.remove, ["a8"]);
  // Health data: lowering keeps the permanent lock.
  const health = checkReclassification({
    ...base,
    before: facts({ privacyClass: "escluso_sanitario" }),
    after: facts({ privacyClass: "riservato_azienda" }),
    itemStatus: "bloccata",
    existingLinks: [{ key: "a8", origin: "scope" }, { key: "sanitario", origin: "scope" }],
    privacyLoweringApproved: true,
  });
  assert.deepEqual(health.ok && health.value.activeKeys, ["a8", "sanitario"]);
  // With a8 or sanitario active, availability tokens are not removed and the perimeter does not change.
  const afterA8Token = facts({ availability: ["dopo_a8", "oggi_export"] });
  assert.equal(code(checkReclassification({ ...base, before: afterA8Token, after: facts({ availability: ["oggi_export"] }), itemStatus: "bloccata", existingLinks: a8Link })), "blocco_privacy_attivo");
  assert.equal(code(checkReclassification({ ...base, before: personal, after: facts({ privacyClass: "personale", perimeter: "evoluzione" }), itemStatus: "bloccata", existingLinks: a8Link })), "blocco_privacy_attivo");
  // Adding a token is fine and may add a blocker.
  const added = checkReclassification({ ...base, before: afterA8Token, after: facts({ availability: ["dopo_a8", "oggi_export", "fuori_foundation"] }), itemStatus: "bloccata", existingLinks: a8Link });
  assert.deepEqual(added.ok && added.value.keys, ["a8", "fuori_foundation"]);
  assert.equal(added.ok && added.value.block, false, "already blocked");
  // Manual rows stay, even on resolved blockers.
  const manual = checkReclassification({ defs: DEFS, blockerStatus: new Map(statuses).set("costi_art_8_4", "sciolto"), before: facts(), after: facts({ availability: ["oggi_export"] }), itemStatus: "da_chiedere", existingLinks: [{ key: "costi_art_8_4", origin: "manuale" }] });
  assert.deepEqual(manual.ok && manual.value.remove, []);
  // A new item is born blocked or to ask.
  const born = checkReclassification({ ...base, before: null, after: facts({ availability: ["con_api_gestionale"] }), itemStatus: null, existingLinks: [] });
  assert.equal(born.ok && born.value.initialStatus, "bloccata");
  const free = checkReclassification({ ...base, before: null, after: facts(), itemStatus: null, existingLinks: [] });
  assert.equal(free.ok && free.value.initialStatus, "da_chiedere");
  // Not applicable items are not blocked again.
  const na = checkReclassification({ ...base, before: facts(), after: facts({ perimeter: "evoluzione" }), itemStatus: "non_applicabile", existingLinks: [] });
  assert.equal(na.ok && na.value.block, false);
});

test("end to end: resolving a8 unlocks the item through row 27 only when nothing else blocks it", () => {
  const item = (id: string, keys: string[]): ItemSnapshot => ({
    id, key: `q.modulo.${id}`, kind: "domanda", status: "bloccata", priority: "must", perimeter: "in_contratto", servesFor: ["modello"],
    inGateScope: true, privacyClass: "personale", responseType: "numero", ownerRoleKey: null, assigneeContactId: null,
    requiresValidityPeriod: false, freshnessDays: null, staleAt: null, currentAnswer: null, answerResponderUserIds: [],
    currentAnswerTokenIssuerUserIds: [], confirmedByContactId: null, confirmedByRoleKey: null, responderRoleKey: null,
    na: { reason: null, proposedAt: null, lsUserId: null, clientUserId: null, clientContactId: null, approvedAt: null },
    waiver: null, fallback: null, partialNa: null, activeBlockerKeys: keys, openClarification: false, hasActiveRequestItem: false,
    lastAutoCheckError: false,
  });
  const resolved = checkResolveBlocker({ def: { key: "a8", permanent: false }, status: "attivo", evidence: A8_EVIDENCE, approvals: [LS_SIGNATURE, PRIVACY_SIGNATURE], actor: PRIVACY_LINK });
  assert.ok(resolved.ok && resolved.value.complete);
  const status = new Map<string, BlockerStatus>([["a8", "sciolto"], ["decisione_board", "attivo"]]);
  const system: Actor = { type: "sistema", job: "blocchi" };
  const onlyA8 = checkItemTransition({ item: item("01", ["a8"]), to: "da_chiedere", trigger: "blocco_sciolto", actor: system, now: new Date(at), case: { status: "raccolta" }, blockerKeys: activeBlockerKeys(["a8"], status) });
  assert.equal(onlyA8.ok && onlyA8.value.patch.status, "da_chiedere");
  const twoLocks = checkItemTransition({ item: item("02", ["a8", "decisione_board"]), to: "da_chiedere", trigger: "blocco_sciolto", actor: system, now: new Date(at), case: { status: "raccolta" }, blockerKeys: activeBlockerKeys(["a8", "decisione_board"], status) });
  assert.equal(code(twoLocks), "blocco_attivo");
});
