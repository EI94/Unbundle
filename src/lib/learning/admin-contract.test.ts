import test from "node:test";
import assert from "node:assert/strict";
import { learningAdminRequestSchema } from "./admin-contract.ts";

const workspaceId = "11111111-1111-4111-8111-aaaaaaaaaaaa";
const programId = "22222222-2222-4222-8222-bbbbbbbbbbbb";
const targetId = "33333333-3333-4333-8333-cccccccccccc";
const expectedUserId = "55555555-5555-4555-8555-dddddddddddd";
const scope = { workspaceId, programId };
const settings = { title: "Synthetic course", visibilityPolicy: "Synthetic named visibility policy.", retentionDays: 30 };
const validRequests = [
  { expectedUserId, operation: "catalog", input: { workspaceId } },
  { expectedUserId, operation: "detail", input: scope },
  { expectedUserId, operation: "inspectPack", input: { workspaceId, pack: {} } },
  { expectedUserId, operation: "importPack", input: { workspaceId, pack: {}, ...settings } },
  { expectedUserId, operation: "settings", input: { ...scope, ...settings } },
  { expectedUserId, operation: "lifecycle", input: { ...scope, action: "disable" } },
  { expectedUserId, operation: "session", input: { ...scope, sessionId: targetId, status: "scheduled" } },
  { expectedUserId, operation: "enroll", input: { ...scope, userIds: [targetId], cohortId: "synthetic-cohort" } },
  { expectedUserId, operation: "enrollment", input: { ...scope, enrollmentId: targetId, status: "revoked", cohortId: "synthetic-cohort" } },
  { expectedUserId, operation: "grant", input: { ...scope, userId: targetId, capability: "review", cohortId: "synthetic-cohort" } },
  { expectedUserId, operation: "revokeGrant", input: { ...scope, grantId: targetId } },
  { expectedUserId, operation: "purge", input: { ...scope, confirmProgramId: programId, confirmTitle: settings.title } },
];

test("admin accepts only supported operations with exact envelopes and inputs", () => {
  for (const request of validRequests) {
    assert.equal(learningAdminRequestSchema.safeParse(request).success, true, request.operation);
    assert.equal(learningAdminRequestSchema.safeParse({ ...request, actorId: targetId }).success, false, request.operation);
    for (const forged of [{ actorId: targetId }, { userRole: "exec_sponsor" }, { canManageAll: true }, { score: 100 }]) {
      assert.equal(learningAdminRequestSchema.safeParse({ ...request, input: { ...request.input, ...forged } }).success, false, `${request.operation}: forged authority`);
    }
  }
  for (const operation of ["constructor", "__proto__", "deleteProgram", "resetSurvey", "exportPrivatePack"]) {
    assert.equal(learningAdminRequestSchema.safeParse({ expectedUserId, operation, input: scope }).success, false);
  }
});

test("administrative settings cannot replace immutable publication or answer data", () => {
  for (const extra of [{ privatePack: {} }, { pack: {} }, { contentVersion: "forged" }, { packHash: "a".repeat(64) }, { publishedBy: targetId }, { responses: {} }]) {
    assert.equal(learningAdminRequestSchema.safeParse({ expectedUserId, operation: "settings", input: { ...scope, ...settings, ...extra } }).success, false);
  }
  for (const retentionDays of [0, 3651, 1.5, "30", null]) {
    assert.equal(learningAdminRequestSchema.safeParse({ expectedUserId, operation: "settings", input: { ...scope, ...settings, retentionDays } }).success, false);
  }
  for (const retentionDays of [1, 3650]) {
    assert.equal(learningAdminRequestSchema.safeParse({ expectedUserId, operation: "settings", input: { ...scope, ...settings, retentionDays } }).success, true);
  }
  for (const invalid of [{ title: "   " }, { title: "x".repeat(251) }, { visibilityPolicy: "short" }, { visibilityPolicy: "x".repeat(10_001) }]) {
    assert.equal(learningAdminRequestSchema.safeParse({ expectedUserId, operation: "settings", input: { ...scope, ...settings, ...invalid } }).success, false);
  }
});

test("enrollment batches are bounded, UUID-only, and duplicate identity aliases are rejected", () => {
  const request = (userIds: unknown) => ({ expectedUserId, operation: "enroll", input: { ...scope, cohortId: "synthetic-cohort", userIds } });
  for (const userIds of [[], [targetId, targetId], [targetId, targetId.toUpperCase()], ["learner@example.invalid"], "all-members"]) {
    assert.equal(learningAdminRequestSchema.safeParse(request(userIds)).success, false);
  }
  const users = Array.from({ length: 101 }, (_, index) => `44444444-4444-4444-8444-${index.toString(16).padStart(12, "0")}`);
  assert.equal(learningAdminRequestSchema.safeParse(request(users.slice(0, 100))).success, true);
  assert.equal(learningAdminRequestSchema.safeParse(request(users)).success, false);
});

test("grant and lifecycle payloads cannot invent capabilities, transitions or implicit global scope", () => {
  for (const capability of ["manage", "review", "aggregate", "export"]) {
    assert.equal(learningAdminRequestSchema.safeParse({ expectedUserId, operation: "grant", input: { ...scope, userId: targetId, capability, cohortId: null } }).success, true);
  }
  for (const capability of ["admin", "owner", "readAll", "*"]) {
    assert.equal(learningAdminRequestSchema.safeParse({ expectedUserId, operation: "grant", input: { ...scope, userId: targetId, capability, cohortId: null } }).success, false);
  }
  assert.equal(learningAdminRequestSchema.safeParse({ expectedUserId, operation: "grant", input: { ...scope, userId: targetId, capability: "manage" } }).success, false);
  for (const action of ["delete", "reset", "drop", "purge"]) {
    assert.equal(learningAdminRequestSchema.safeParse({ expectedUserId, operation: "lifecycle", input: { ...scope, action } }).success, false);
  }
  for (const status of ["submitted", "deleted", "pending_review"]) {
    assert.equal(learningAdminRequestSchema.safeParse({ expectedUserId, operation: "enrollment", input: { ...scope, enrollmentId: targetId, cohortId: "synthetic-cohort", status } }).success, false);
  }
});

test("purge requires explicit program and title confirmation and rejects mass deletion selectors", () => {
  const input = { ...scope, confirmProgramId: programId, confirmTitle: settings.title };
  for (const key of ["confirmProgramId", "confirmTitle"]) {
    const missing = { ...input } as Record<string, unknown>; delete missing[key];
    assert.equal(learningAdminRequestSchema.safeParse({ expectedUserId, operation: "purge", input: missing }).success, false);
  }
  for (const extra of [{ allPrograms: true }, { workspaceIds: [workspaceId] }, { deletePortfolio: true }, { overrideRetention: true }]) {
    assert.equal(learningAdminRequestSchema.safeParse({ expectedUserId, operation: "purge", input: { ...input, ...extra } }).success, false);
  }
});


test("every admin operation requires an explicit expected actor without treating it as authority", () => {
  for (const request of validRequests) {
    const { expectedUserId: omitted, ...unbound } = request; void omitted;
    assert.equal(learningAdminRequestSchema.safeParse(unbound).success, false, request.operation);
    for (const expectedUserId of [null, "", "admin", 123]) {
      assert.equal(learningAdminRequestSchema.safeParse({ ...request, expectedUserId }).success, false, request.operation);
    }
    assert.equal(learningAdminRequestSchema.safeParse({ ...request, input: { ...request.input, expectedUserId } }).success, false);
  }
});
