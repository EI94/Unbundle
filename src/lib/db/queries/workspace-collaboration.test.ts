import test from "node:test";
import assert from "node:assert/strict";
import {
  createInviteToken,
  getWorkspaceInvitationLifecycle,
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
