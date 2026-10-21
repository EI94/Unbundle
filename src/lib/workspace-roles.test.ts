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
    const can = ROLE_INFO[role].can.join(" ").toLowerCase();
    const cannot = (ROLE_INFO[role].cannot ?? []).join(" ").toLowerCase();
    // Chi valuta lo dice, e decide anche (D3); chi non valuta non lo promette e dice cosa non vede (D4).
    if (canReviewWorkspacePortfolio(role)) {
      assert.match(can, /valuta/, `${role} valuta`);
      assert.match(`${ROLE_INFO[role].summary} ${can}`, /decide/, `${role} decide`);
    } else {
      assert.doesNotMatch(can, /valuta|decide/, `${role} non valuta né decide`);
      assert.match(cannot, /non vede valutazioni/, `${role} non vede valutazioni`);
    }
    if (canManageWorkspaceCollaborators(role)) assert.match(can, /invita/, `${role} invita`);
    else assert.doesNotMatch(can, /invita/, `${role} non invita`);
  }
});

test("i testi degli use case sono quelli di docs/use-case/DESIGN.md §14.4", () => {
  assert.ok(ROLE_INFO.transformation_lead.can.includes("Valuta e decide gli use case"));
  assert.equal(ROLE_INFO.function_lead.summary, "valuta e decide gli use case");
  assert.ok(ROLE_INFO.function_lead.can.includes("Decide se e quando fare gli use case"));
  assert.ok(ROLE_INFO.analyst.can.includes("Propone, valuta e decide gli use case"));
  assert.ok(ROLE_INFO.contributor.can.includes("Propone nuovi use case e ne vede la fase; delle proprie vede anche codice e nota pubblica"));
  assert.deepEqual(ROLE_INFO.contributor.cannot, ["Non vede valutazioni, costi e note interne"]);
  // Le wave escono con l'area (D1): nessun ruolo le promette più.
  for (const [role, info] of Object.entries(ROLE_INFO)) {
    assert.doesNotMatch([info.summary, ...info.can, ...(info.cannot ?? [])].join(" "), /\bwave\b/i, role);
  }
});
