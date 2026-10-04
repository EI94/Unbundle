import test from "node:test";
import assert from "node:assert/strict";
import {
  isLearnerOnly,
  isWithinLearnerScope,
  learnerRedirect,
  learnerHomePath,
} from "./learner-scope.ts";

const W = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

test("solo il ruolo learner e' ristretto", () => {
  assert.equal(isLearnerOnly("learner"), true);
  for (const role of [
    "exec_sponsor",
    "transformation_lead",
    "function_lead",
    "contributor",
    "analyst",
    null,
    undefined,
    "",
  ]) {
    assert.equal(isLearnerOnly(role as string), false, `${role} non deve essere ristretto`);
  }
});

test("l'area Formazione del proprio workspace e' dentro il perimetro", () => {
  assert.equal(isWithinLearnerScope(`/dashboard/${W}/learning`, W), true);
  assert.equal(isWithinLearnerScope(`/dashboard/${W}/learning/`, W), true);
  assert.equal(isWithinLearnerScope(`/dashboard/${W}/learning/abc/m1`, W), true);
  assert.equal(isWithinLearnerScope(`/dashboard/${W}/learning?joined=1`, W), true);
  assert.equal(isWithinLearnerScope(`/dashboard/${W}/learning#top`, W), true);
});

test("tutto il resto del workspace e' fuori dal perimetro", () => {
  for (const path of [
    `/dashboard/${W}`,
    `/dashboard/${W}/strategy`,
    `/dashboard/${W}/reports`,
    `/dashboard/${W}/intelligence`,
    `/dashboard/${W}/blueprints`,
    `/dashboard/${W}/settings`,
    `/dashboard/${W}/ai-readiness`,
    `/dashboard/${W}/portfolio`,
  ]) {
    assert.equal(isWithinLearnerScope(path, W), false, `${path} deve stare fuori`);
  }
});

test("un prefisso che somiglia non basta: il confronto e' sui segmenti", () => {
  // startsWith farebbe passare questi.
  assert.equal(isWithinLearnerScope(`/dashboard/${W}/learning-admin`, W), false);
  assert.equal(isWithinLearnerScope(`/dashboard/${W}/learningx/y`, W), false);
  assert.equal(isWithinLearnerScope(`/dashboard/${W}learning`, W), false);
});

test("l'area Formazione di un ALTRO workspace e' fuori dal perimetro", () => {
  assert.equal(isWithinLearnerScope(`/dashboard/${OTHER}/learning`, W), false);
  assert.equal(
    learnerRedirect({ role: "learner", pathname: `/dashboard/${OTHER}/learning`, workspaceId: W }),
    learnerHomePath(W)
  );
});

test("il reindirizzamento scatta solo per i learner fuori perimetro", () => {
  assert.equal(
    learnerRedirect({ role: "learner", pathname: `/dashboard/${W}/strategy`, workspaceId: W }),
    `/dashboard/${W}/learning`
  );
  assert.equal(
    learnerRedirect({ role: "learner", pathname: `/dashboard/${W}/learning/p/m1`, workspaceId: W }),
    null
  );
  assert.equal(
    learnerRedirect({ role: "contributor", pathname: `/dashboard/${W}/strategy`, workspaceId: W }),
    null
  );
  assert.equal(
    learnerRedirect({ role: "exec_sponsor", pathname: `/dashboard/${W}`, workspaceId: W }),
    null
  );
});

test("un percorso vuoto o malformato non apre il perimetro", () => {
  for (const path of ["", "/", "/dashboard", `/dashboard/${W}/`, "//", "/learning"]) {
    assert.equal(isWithinLearnerScope(path, W), false, `"${path}" deve stare fuori`);
    assert.equal(
      learnerRedirect({ role: "learner", pathname: path, workspaceId: W }),
      learnerHomePath(W)
    );
  }
});

test("il registro della formazione resta fuori dal perimetro del partecipante", () => {
  for (const path of [`/dashboard/${W}/learning/register`, `/dashboard/${W}/learning/register/`, `/dashboard/${W}/learning/register?x=1`]) {
    assert.equal(isWithinLearnerScope(path, W), false, `"${path}" deve stare fuori`);
    assert.equal(learnerRedirect({ role: "learner", pathname: path, workspaceId: W }), learnerHomePath(W));
  }
  assert.equal(learnerRedirect({ role: "transformation_lead", pathname: `/dashboard/${W}/learning/register`, workspaceId: W }), null);
});
