import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPortfolioSharePath,
  createPortfolioShareToken,
  PORTFOLIO_SHARE_TTL_DAYS,
  verifyPortfolioShareToken,
} from "./share-link.ts";

const workspaceId = "54d65ec8-1969-4917-9260-7e58a7206585";
const useCaseId = "f2df1b91-e748-4d88-b491-3c4e160d8510";
const secret = "test-secret";
const now = Date.parse("2026-10-05T10:00:00Z");

test("un token vale solo per il suo workspace", () => {
  const token = createPortfolioShareToken(workspaceId, { secret, now });
  assert.deepEqual(verifyPortfolioShareToken(workspaceId, token, { secret, now }).ok, true);
  assert.deepEqual(
    verifyPortfolioShareToken("11111111-1111-1111-1111-111111111111", token, { secret, now }),
    { ok: false, reason: "invalid" }
  );
});

test("il link scade dopo il periodo previsto", () => {
  const token = createPortfolioShareToken(workspaceId, { secret, now });
  const justBefore = now + PORTFOLIO_SHARE_TTL_DAYS * 86_400_000 - 1000;
  const after = now + PORTFOLIO_SHARE_TTL_DAYS * 86_400_000 + 1000;
  assert.equal(verifyPortfolioShareToken(workspaceId, token, { secret, now: justBefore }).ok, true);
  assert.deepEqual(verifyPortfolioShareToken(workspaceId, token, { secret, now: after }), { ok: false, reason: "expired" });
});

test("alzare il contatore di revoca disattiva i link già condivisi", () => {
  const token = createPortfolioShareToken(workspaceId, { secret, now, epoch: 0 });
  assert.equal(verifyPortfolioShareToken(workspaceId, token, { secret, now, epoch: 1 }).ok, false);
  const fresh = createPortfolioShareToken(workspaceId, { secret, now, epoch: 1 });
  assert.equal(verifyPortfolioShareToken(workspaceId, fresh, { secret, now, epoch: 1 }).ok, true);
});

test("una scadenza modificata a mano invalida la firma", () => {
  const token = createPortfolioShareToken(workspaceId, { secret, now });
  const [exp, sig] = token.split(".");
  const forged = `${Number(exp) + 86_400 * 365}.${sig}`;
  assert.deepEqual(verifyPortfolioShareToken(workspaceId, forged, { secret, now }), { ok: false, reason: "invalid" });
});

test("i vecchi token permanenti v1 e quelli malformati non sono accettati", () => {
  assert.deepEqual(verifyPortfolioShareToken(workspaceId, "a".repeat(43), { secret, now }), { ok: false, reason: "invalid" });
  assert.deepEqual(verifyPortfolioShareToken(workspaceId, "", { secret, now }), { ok: false, reason: "invalid" });
  assert.deepEqual(verifyPortfolioShareToken(workspaceId, null, { secret, now }), { ok: false, reason: "invalid" });
});

test("costruisce il path pubblico firmato per il portfolio viewer", () => {
  const token = createPortfolioShareToken(workspaceId, { secret, now });
  assert.equal(
    buildPortfolioSharePath(workspaceId, useCaseId, { token }),
    `/share/portfolio/${workspaceId}/${useCaseId}?token=${encodeURIComponent(token)}`
  );
});
