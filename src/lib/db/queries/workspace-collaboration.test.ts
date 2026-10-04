import test from "node:test";
import assert from "node:assert/strict";
import {
  createInviteToken,
  decideInviteAcceptance,
  getWorkspaceInvitationLifecycle,
  maskInviteEmail,
  hashInviteToken,
  isInvitationActive,
  WORKSPACE_INVITE_EXPIRES_IN_DAYS,
  WORKSPACE_INVITE_MAX_USES,
} from "../../workspace-invite-token.ts";
import type { WorkspaceInvitation } from "../schema.ts";

function invitation(
  patch: Partial<WorkspaceInvitation> = {}
): WorkspaceInvitation {
  const now = new Date("2026-04-27T12:00:00Z");
  return {
    id: "00000000-0000-0000-0000-000000000001",
    workspaceId: "00000000-0000-0000-0000-000000000002",
    organizationId: "00000000-0000-0000-0000-000000000003",
    email: null,
    role: "contributor",
    tokenHash: hashInviteToken("token"),
    maxUses: 1,
    usedCount: 0,
    expiresAt: new Date("2026-05-04T12:00:00Z"),
    revokedAt: null,
    createdByUserId: null,
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

test("i token invito sono URL-safe e vengono salvati come hash non reversibile", () => {
  const token = createInviteToken();
  const hash = hashInviteToken(token);

  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.equal(hash.length, 64);
  assert.notEqual(hash, token);
  assert.equal(hashInviteToken(token), hash);
});

test("un invito e attivo solo se non scaduto, non revocato e con utilizzi disponibili", () => {
  const now = new Date("2026-04-27T12:00:00Z");

  assert.equal(isInvitationActive(invitation(), now), true);
  assert.equal(
    isInvitationActive(
      invitation({ expiresAt: new Date("2026-04-26T12:00:00Z") }),
      now
    ),
    false
  );
  assert.equal(isInvitationActive(invitation({ revokedAt: now }), now), false);
  assert.equal(isInvitationActive(invitation({ usedCount: 1 }), now), false);
});

test("la UI usa default semplici e prevedibili per gli inviti workspace", () => {
  assert.equal(WORKSPACE_INVITE_EXPIRES_IN_DAYS, 7);
  assert.equal(WORKSPACE_INVITE_MAX_USES, 1);
});

test("lo stato lifecycle degli inviti distingue pending, accettato, scaduto e revocato", () => {
  const now = new Date("2026-04-27T12:00:00Z");

  assert.equal(getWorkspaceInvitationLifecycle(invitation(), now), "active");
  assert.equal(
    getWorkspaceInvitationLifecycle(invitation({ usedCount: 1 }), now),
    "used"
  );
  assert.equal(
    getWorkspaceInvitationLifecycle(
      invitation({ expiresAt: new Date("2026-04-26T12:00:00Z") }),
      now
    ),
    "expired"
  );
  assert.equal(
    getWorkspaceInvitationLifecycle(invitation({ revokedAt: now }), now),
    "revoked"
  );
});

// ─── Accettazione di un invito ─────────────────────────────────────────

const NOW = new Date("2026-04-28T12:00:00Z");
const user = (email: string, emailVerified = true) => ({ email, emailVerified });
const decide = (patch: Partial<WorkspaceInvitation>, u = user("anna@azienda.it"), roles: { orgRole?: string | null; workspaceRole?: string | null } = {}) =>
  decideInviteAcceptance({
    invitation: invitation(patch),
    user: u,
    orgRole: roles.orgRole ?? null,
    workspaceRole: roles.workspaceRole ?? null,
    now: NOW,
  });

test("una persona nuova con un link valido lo consuma ed entra", () => {
  assert.deepEqual(decide({}), { kind: "claim", upgradesLearner: false });
});

test("chi è già nel workspace o nell'organizzazione entra senza consumare il link né cambiare ruolo", () => {
  assert.deepEqual(decide({}, user("a@x.it"), { orgRole: "exec_sponsor" }), { kind: "already_member", role: "exec_sponsor", source: "organization" });
  assert.deepEqual(decide({ role: "transformation_lead" }, user("a@x.it"), { workspaceRole: "analyst" }), { kind: "already_member", role: "analyst", source: "workspace" });
  // Anche con il link già usato o scaduto: chi è dentro non resta fuori.
  assert.equal(decide({ usedCount: 1 }, user("a@x.it"), { workspaceRole: "contributor" }).kind, "already_member");
});

test("un partecipante a un corso che accetta un invito diventa collaboratore", () => {
  assert.deepEqual(decide({ role: "analyst" }, user("a@x.it"), { workspaceRole: "learner" }), { kind: "claim", upgradesLearner: true });
});

test("i link non più validi dicono perché: annullato, scaduto o già usato", () => {
  assert.deepEqual(decide({ revokedAt: NOW }), { kind: "reject", reason: "revoked" });
  assert.deepEqual(decide({ expiresAt: new Date("2026-04-27T00:00:00Z") }), { kind: "reject", reason: "expired" });
  assert.deepEqual(decide({ usedCount: 1 }), { kind: "reject", reason: "used" });
});

test("un invito riservato a un'email vale solo per quella casella, verificata", () => {
  assert.deepEqual(decide({ email: "anna@azienda.it" }, user("ANNA@azienda.it ")), { kind: "claim", upgradesLearner: false });
  assert.deepEqual(decide({ email: "anna@azienda.it" }, user("marco@azienda.it")), { kind: "reject", reason: "email_mismatch" });
  assert.deepEqual(decide({ email: "anna@azienda.it" }, user("anna@azienda.it", false)), { kind: "reject", reason: "email_unverified" });
  // Senza email riservata la verifica non serve.
  assert.deepEqual(decide({ email: null }, user("chiunque@gmail.com", false)), { kind: "claim", upgradesLearner: false });
});

test("l'email riservata si mostra mascherata a chi non ha ancora fatto l'accesso", () => {
  assert.equal(maskInviteEmail("anna.rossi@azienda.it"), "a***@azienda.it");
  assert.equal(maskInviteEmail("non-una-email"), "***");
});
