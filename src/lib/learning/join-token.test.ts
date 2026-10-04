import test from "node:test";
import assert from "node:assert/strict";
import {
  createJoinToken,
  hashJoinToken,
  looksLikeJoinToken,
  joinPath,
} from "./join-token.ts";
import { learningAdminRequestSchema } from "./admin-contract.ts";

const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

test("il token ha prefisso riconoscibile e 192 bit di casualita'", () => {
  const token = createJoinToken();
  assert.match(token, /^lrn_[A-Za-z0-9_-]{32}$/);
  assert.equal(looksLikeJoinToken(token), true);
});

test("due token non coincidono", () => {
  const seen = new Set(Array.from({ length: 200 }, () => createJoinToken()));
  assert.equal(seen.size, 200);
});

test("l'impronta e' sha256 esadecimale e stabile", () => {
  const token = createJoinToken();
  const hash = hashJoinToken(token);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hash, hashJoinToken(token));
  assert.notEqual(hash, hashJoinToken(createJoinToken()));
});

test("il token in chiaro non si ricava dall'impronta salvata", () => {
  const token = createJoinToken();
  assert.equal(hashJoinToken(token).includes(token.slice(4)), false);
});

test("spazzatura e token di altra natura sono rifiutati senza interrogare il database", () => {
  for (const value of [
    "",
    "lrn_",
    "lrn_troppocorto",
    `lrn_${"a".repeat(31)}`,
    `lrn_${"a".repeat(33)}`,
    "air_I1UGrHdN_WLP1-fUZU6HuUzaoy0Rw5DR", // token di survey: altra famiglia
    "../../etc/passwd",
    "lrn_abc$%&/()=?^",
    "LRN_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    null,
    undefined,
    42,
    {},
  ]) {
    assert.equal(
      looksLikeJoinToken(value as string),
      false,
      `${JSON.stringify(value)} non deve passare`
    );
  }
});

test("l'alfabeto del token sopravvive all'URL senza trasformazioni", () => {
  for (let i = 0; i < 50; i++) {
    const token = createJoinToken();
    assert.equal(joinPath(token), `/c/${token}`);
    assert.equal(decodeURIComponent(encodeURIComponent(token)), token);
  }
});

// ─── contratto admin ────────────────────────────────────────────────────

function joinLink(input: Record<string, unknown>) {
  return learningAdminRequestSchema.safeParse({
    expectedUserId: UUID,
    operation: "joinLink",
    input: { workspaceId: UUID, programId: UUID, cohortId: "c1", idempotencyKey: UUID, ...input },
  });
}

test("creare un link richiede posti e scadenza entro i limiti", () => {
  assert.equal(joinLink({ maxUses: 30, expiresInHours: 24 }).success, true);
  assert.equal(joinLink({ maxUses: 1, expiresInHours: 1 }).success, true);
  assert.equal(joinLink({ maxUses: 500, expiresInHours: 720 }).success, true);
});

test("un link senza scadenza, senza posti o oltre i tetti e' rifiutato", () => {
  assert.equal(joinLink({ maxUses: 30 }).success, false, "manca la scadenza");
  assert.equal(joinLink({ expiresInHours: 24 }).success, false, "mancano i posti");
  assert.equal(joinLink({ maxUses: 0, expiresInHours: 24 }).success, false);
  assert.equal(joinLink({ maxUses: 501, expiresInHours: 24 }).success, false);
  assert.equal(joinLink({ maxUses: 30, expiresInHours: 0 }).success, false);
  assert.equal(joinLink({ maxUses: 30, expiresInHours: 721 }).success, false);
  assert.equal(joinLink({ maxUses: 1.5, expiresInHours: 24 }).success, false);
});

test("un link nasce senza poter concedere ruoli: non esiste un campo per farlo", () => {
  assert.equal(
    joinLink({ maxUses: 30, expiresInHours: 24, role: "exec_sponsor" }).success,
    false,
    "lo schema e' strict: un campo role non e' nemmeno accettato"
  );
});

test("l'idempotency key e' obbligatoria: un doppio tocco non crea due link", () => {
  const parsed = learningAdminRequestSchema.safeParse({
    expectedUserId: UUID,
    operation: "joinLink",
    input: { workspaceId: UUID, programId: UUID, cohortId: "c1", maxUses: 30, expiresInHours: 24 },
  });
  assert.equal(parsed.success, false);
});

test("apertura, posti e revoca sono operazioni distinte e tipizzate", () => {
  const door = learningAdminRequestSchema.safeParse({
    expectedUserId: UUID,
    operation: "joinLinkDoor",
    input: { workspaceId: UUID, programId: UUID, linkId: UUID, doorOpen: true },
  });
  assert.equal(door.success, true);

  const seats = learningAdminRequestSchema.safeParse({
    expectedUserId: UUID,
    operation: "joinLinkSeats",
    input: { workspaceId: UUID, programId: UUID, linkId: UUID, maxUses: 50 },
  });
  assert.equal(seats.success, true);

  const revoke = learningAdminRequestSchema.safeParse({
    expectedUserId: UUID,
    operation: "revokeJoinLink",
    input: { workspaceId: UUID, programId: UUID, linkId: UUID },
  });
  assert.equal(revoke.success, true);

  // Un id che non e' un uuid non arriva al database.
  assert.equal(
    learningAdminRequestSchema.safeParse({
      expectedUserId: UUID,
      operation: "revokeJoinLink",
      input: { workspaceId: UUID, programId: UUID, linkId: "1 OR 1=1" },
    }).success,
    false
  );
});

test("l'operazione richiede sempre l'identita' di chi ha aperto la scheda", () => {
  assert.equal(
    learningAdminRequestSchema.safeParse({
      operation: "joinLink",
      input: { workspaceId: UUID, programId: UUID, cohortId: "c1", maxUses: 30, expiresInHours: 24, idempotencyKey: UUID },
    }).success,
    false,
    "senza expectedUserId una scheda aperta con un altro account potrebbe agire"
  );
});
