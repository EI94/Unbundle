import test from "node:test";
import assert from "node:assert/strict";
import {
  CASE_ONLY_ROLE,
  CASE_ONLY_SURFACES,
  caseOnlyHomePath,
  caseOnlyRedirect,
  isCaseOnly,
  isWithinCaseOnlyScope,
  workspaceDoor,
} from "./case-only.ts";
import { learnerRedirect } from "../learning/learner-scope.ts";
import { COLLABORATOR_ROLES, PORTFOLIO_REVIEWER_ROLES, isCollaboratorRole } from "../workspace-permissions.ts";

// «Solo questo use case» (rilascio 8.0d-1 «Porte», RILASCIO-8.0d-ESTERNI-FASE-2.md §2.5, §2.10 U1-U2): la regola delle
// porte senza database e il perimetro per segmenti. Che le tre funzioni delle porte la usino lo dice
// src/lib/auth/case-only-guard.test.ts.

const W = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const CASE = "33333333-3333-3333-3333-333333333333";

/** Ogni valore di `member_role`, più la stringa vuota, un ruolo inventato e l'assenza di ruolo. */
const MEMBER_ROLES = ["exec_sponsor", "transformation_lead", "function_lead", "contributor", "analyst", "learner", "esterno_caso"];
const ODD = ["", "inventato", "LEARNER", "Esterno_caso", " esterno_caso", null, undefined];

test("i nomi comuni: il ruolo, i cinque collaboratori (i revisori più il Contributore)", () => {
  assert.equal(CASE_ONLY_ROLE, "esterno_caso");
  assert.deepEqual([...COLLABORATOR_ROLES], ["exec_sponsor", "transformation_lead", "function_lead", "analyst", "contributor"]);
  for (const role of PORTFOLIO_REVIEWER_ROLES) assert.ok(COLLABORATOR_ROLES.includes(role), role);
  assert.equal(isCollaboratorRole("learner"), false);
  assert.equal(isCollaboratorRole("esterno_caso"), false);
  assert.equal(isCaseOnly("esterno_caso"), true);
  for (const role of [...MEMBER_ROLES.filter((r) => r !== "esterno_caso"), ...ODD]) assert.equal(isCaseOnly(role), false, String(role));
});

test("U1: senza opzioni passano solo i cinque collaboratori; learner, esterno_caso e un ruolo sconosciuto no", () => {
  for (const role of COLLABORATOR_ROLES) {
    for (const opts of [{}, { allowLearner: true }, { allowCaseOnly: true }, { allowLearner: true, allowCaseOnly: true }]) {
      assert.equal(workspaceDoor(role, opts), "aperta", `${role} ${JSON.stringify(opts)}`);
    }
  }
  assert.equal(workspaceDoor("learner"), "formazione");
  assert.equal(workspaceDoor("esterno_caso"), "solo_caso");
  for (const role of ODD) assert.equal(workspaceDoor(role), "chiusa", String(role));
});

test("U1: esterno_caso passa solo con allowCaseOnly; learner solo con allowLearner; un ruolo sconosciuto mai", () => {
  assert.equal(workspaceDoor("esterno_caso", { allowCaseOnly: true }), "aperta");
  assert.equal(workspaceDoor("esterno_caso", { allowLearner: true }), "solo_caso");
  assert.equal(workspaceDoor("learner", { allowLearner: true }), "aperta");
  assert.equal(workspaceDoor("learner", { allowCaseOnly: true }), "formazione");
  for (const role of ODD) {
    assert.equal(workspaceDoor(role, { allowLearner: true, allowCaseOnly: true }), "chiusa", String(role));
  }
  // Ogni valore dell'enum ha il suo posto: nessuno cade in «chiusa» per caso.
  for (const role of MEMBER_ROLES) assert.notEqual(workspaceDoor(role), "chiusa", role);
});

test("U2: dentro solo agent-factory e casi-duso/<id>/progetto (più l'indirizzo breve del progetto), per segmenti", () => {
  for (const path of [
    `/dashboard/${W}/agent-factory`,
    `/dashboard/${W}/agent-factory/`,
    `/dashboard/${W}/agent-factory?x=1`,
    `/dashboard/${W}/agent-factory#chi-costruisce`,
    `/dashboard/${W}/casi-duso/${CASE}/progetto`,
    `/dashboard/${W}/casi-duso/${CASE}/progetto#compiti`,
    `/dashboard/${W}/use-cases/${CASE}/progetto`,
    `/dashboard/${W}/use-cases/${CASE}/progetto#banco`,
  ]) {
    assert.equal(isWithinCaseOnlyScope(path, W), true, path);
    assert.equal(caseOnlyRedirect({ role: "esterno_caso", pathname: path, workspaceId: W }), null, path);
  }
});

test("U2: fuori agent-factory-x, casi-duso/<id>, casi-duso/<id>/progetto/altro, settings, learning e tutto il resto", () => {
  for (const path of [
    `/dashboard/${W}/agent-factory-x`,
    `/dashboard/${W}/agent-factoryx/y`,
    `/dashboard/${W}/agent-factory/altro`,
    `/dashboard/${W}/casi-duso/${CASE}`,
    `/dashboard/${W}/casi-duso/${CASE}/progetto/altro`,
    `/dashboard/${W}/casi-duso/${CASE}/via`,
    `/dashboard/${W}/casi-duso/${CASE}/persone`,
    `/dashboard/${W}/casi-duso/${CASE}/progettox`,
    `/dashboard/${W}/casi-duso`,
    `/dashboard/${W}/casi-duso/nuovo`,
    `/dashboard/${W}/use-cases`,
    `/dashboard/${W}/use-cases/${CASE}`,
    `/dashboard/${W}/use-cases/${CASE}/proposte`,
    `/dashboard/${W}/settings`,
    `/dashboard/${W}/learning`,
    `/dashboard/${W}/learning/register`,
    `/dashboard/${W}/contesto`,
    `/dashboard/${W}/programma`,
    `/dashboard/${W}/portfolio`,
    `/dashboard/${W}/mapping`,
    `/dashboard/${W}/account`,
    `/dashboard/${W}`,
    `/dashboard/${W}agent-factory`,
    `/dashboard/${OTHER}/agent-factory`,
    `/dashboard/${OTHER}/casi-duso/${CASE}/progetto`,
    `/dashboard`,
    "",
  ]) {
    assert.equal(isWithinCaseOnlyScope(path, W), false, path);
    assert.equal(caseOnlyRedirect({ role: "esterno_caso", pathname: path, workspaceId: W }), caseOnlyHomePath(W), path);
  }
  assert.equal(caseOnlyHomePath(W), `/dashboard/${W}/agent-factory`);
});

test("U2: il perimetro vale solo per esterno_caso; chi segue un corso resta nel suo", () => {
  for (const role of [...COLLABORATOR_ROLES, "learner", ...ODD]) {
    assert.equal(caseOnlyRedirect({ role, pathname: `/dashboard/${W}/settings`, workspaceId: W }), null, String(role));
  }
  // Un learner nell'Agent Factory torna alla Formazione, non resta lì.
  assert.equal(learnerRedirect({ role: "learner", pathname: `/dashboard/${W}/agent-factory`, workspaceId: W }), `/dashboard/${W}/learning`);
  assert.equal(learnerRedirect({ role: "esterno_caso", pathname: `/dashboard/${W}/learning`, workspaceId: W }), null);
});

test("le porte che aprono a esterno_caso sono un elenco fisso, senza doppioni", () => {
  assert.equal(new Set(CASE_ONLY_SURFACES).size, CASE_ONLY_SURFACES.length);
  assert.ok(Object.isFrozen(CASE_ONLY_SURFACES));
  assert.equal(CASE_ONLY_SURFACES.length, 9);
});
