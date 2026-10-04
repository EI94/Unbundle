import test from "node:test";
import assert from "node:assert/strict";
import { INVITABLE_ROLES, ROLE_INFO, roleLabel } from "./workspace-roles.ts";
import { canManageWorkspaceCollaborators, canReviewWorkspacePortfolio } from "./workspace-permissions.ts";

test("ogni ruolo ha un nome in italiano, anche il partecipante ai corsi", () => {
  for (const role of ["exec_sponsor", "transformation_lead", "function_lead", "contributor", "analyst", "learner"]) {
    assert.ok(ROLE_INFO[role]?.label, role);
  }
  assert.equal(roleLabel("learner"), "Partecipante al corso");
  assert.equal(roleLabel("sconosciuto"), "sconosciuto");
});

test("un invito non può dare il ruolo di sponsor né quello di partecipante", () => {
  assert.deepEqual([...INVITABLE_ROLES].sort(), ["analyst", "contributor", "function_lead", "transformation_lead"]);
});

test("le descrizioni dei ruoli dicono il vero sui permessi", () => {
  for (const role of INVITABLE_ROLES) {
    const text = [...ROLE_INFO[role].can, ...(ROLE_INFO[role].cannot ?? [])].join(" ").toLowerCase();
    if (canReviewWorkspacePortfolio(role)) assert.match(text, /valuta/, `${role} valuta`);
    else assert.match(text, /non valuta/, `${role} non valuta`);
    if (canManageWorkspaceCollaborators(role)) assert.match(text, /invita/, `${role} invita`);
    else assert.match(text, /non invita|non valuta/, `${role} non invita`);
  }
});
