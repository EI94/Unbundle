import test from "node:test";
import assert from "node:assert/strict";
import { findHubForbiddenIn } from "../../../lib/use-cases/copy-guard.ts";
import { validateNeedInput, validateNeedPatch, type NeedView } from "../../../lib/use-cases/needs.ts";
import {
  NEED_FORM_TEXT,
  draftFromNeed,
  emptyNeedDraft,
  needCreatePayload,
  needDraftErrors,
  needErrorsFromService,
  needPatchPayload,
  withNeedType,
} from "./need-draft.ts";

const NEED: NeedView = {
  id: "11111111-1111-4111-8111-111111111111",
  type: "requisito",
  kind: "accesso",
  title: "Accesso al gestionale",
  detail: null,
  ownerLabel: "Ufficio IT",
  ownerSide: "cliente",
  status: "chiesta",
  availability: "subito",
  dueOn: "2026-11-15",
  dueLabel: null,
  dueIsProposal: false,
  forLabel: null,
  sortOrder: 0,
  version: 3,
  importKey: null,
  createdAt: "2026-10-20T10:00:00.000Z",
  updatedAt: "2026-10-21T10:00:00.000Z",
  doneAt: null,
  archivedAt: null,
  archiveReason: null,
  useCaseIds: [],
};

test("bozza nuova: stato di partenza del tipo; il servizio la accetta così com'è", () => {
  const draft = { ...emptyNeedDraft(), title: " Estratto delle fatture " };
  assert.equal(draft.status, "da_chiedere");
  assert.equal(emptyNeedDraft("passo").status, "proposta");
  const payload = needCreatePayload(draft);
  assert.equal(payload.title, "Estratto delle fatture");
  assert.equal(payload.detail, null, "un testo vuoto vale null");
  assert.equal(payload.ownerSide, null);
  assert.equal(payload.availability, null);
  assert.equal(payload.dueOn, null);
  const parsed = validateNeedInput(payload);
  assert.ok(parsed.ok, JSON.stringify(parsed));
});

test("titolo obbligatorio prima di chiamare il servizio", () => {
  assert.deepEqual(needDraftErrors(emptyNeedDraft()), { title: "Scrivi che cosa serve." });
  assert.deepEqual(needDraftErrors({ ...emptyNeedDraft(), title: "x" }), {});
});

test("cambiare tipo: lo stato resta se vale, altrimenti riparte", () => {
  const requirement = { ...emptyNeedDraft(), status: "validata" as const };
  const step = withNeedType(requirement, "passo");
  assert.equal(step.type, "passo");
  assert.equal(step.status, "proposta");
  assert.equal(withNeedType(step, "passo"), step, "stesso tipo, stessa bozza");
  assert.equal(withNeedType({ ...step, status: "fatta" }, "requisito").status, "da_chiedere");
});

test("modifica: solo i campi cambiati, nessuno se non cambia niente; il servizio la accetta", () => {
  const draft = draftFromNeed(NEED);
  assert.equal(draft.detail, "");
  assert.equal(draft.dueOn, "2026-11-15");
  assert.deepEqual(needPatchPayload(NEED, draft), {});
  assert.deepEqual(needPatchPayload(NEED, { ...draft, title: "  Accesso al gestionale  " }), {}, "gli spazi non sono un cambio");

  const patch = needPatchPayload(NEED, { ...draft, status: "validata", dueOn: "", ownerSide: "", detail: "Utente in sola lettura" });
  assert.deepEqual(patch, { status: "validata", dueOn: null, ownerSide: null, detail: "Utente in sola lettura" });
  const parsed = validateNeedPatch(patch, { type: NEED.type, status: NEED.status });
  assert.ok(parsed.ok, JSON.stringify(parsed));

  const toStep = needPatchPayload(NEED, withNeedType(draft, "passo"));
  assert.deepEqual(toStep, { type: "passo", status: "proposta" });
});

test("errori del servizio: i campi della bozza restano, il resto va sotto il modulo", () => {
  assert.deepEqual(needErrorsFromService({ title: "Scrivi che cosa serve.", importKey: "Questa chiave è già usata in questo workspace.", useCaseIds: "Use case non trovato." }), {
    title: "Scrivi che cosa serve.",
    form: "Questa chiave è già usata in questo workspace.",
  });
  assert.deepEqual(needErrorsFromService({ archiveReason: "Scrivi perché la archivi." }), { archiveReason: "Scrivi perché la archivi." });
  assert.deepEqual(needErrorsFromService(undefined), {});
});

test("testi del modulo: niente parole vietate dell'area", () => {
  assert.deepEqual(findHubForbiddenIn(Object.values(NEED_FORM_TEXT), "area"), []);
});
