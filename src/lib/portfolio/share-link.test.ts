import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPortfolioSharePath,
  createPortfolioShareToken,
  parsePortfolioReviewPath,
  verifyPortfolioShareToken,
} from "./share-link.ts";

const workspaceId = "54d65ec8-1969-4917-9260-7e58a7206585";
const useCaseId = "f2df1b91-e748-4d88-b491-3c4e160d8510";
const secret = "test-secret";

test("crea e valida token viewer legato al workspace", () => {
  const token = createPortfolioShareToken(workspaceId, secret);
  assert.equal(verifyPortfolioShareToken(workspaceId, token, secret), true);
  assert.equal(
    verifyPortfolioShareToken(
      "11111111-1111-1111-1111-111111111111",
      token,
      secret
    ),
    false
  );
});

test("costruisce il path pubblico firmato per il portfolio viewer", () => {
  const token = createPortfolioShareToken(workspaceId, secret);
  assert.equal(
    buildPortfolioSharePath(workspaceId, useCaseId, { token }),
    `/share/portfolio/${workspaceId}/${useCaseId}?token=${token}`
  );
});

test("riconosce i vecchi link privati di review per fallback viewer", () => {
  assert.deepEqual(
    parsePortfolioReviewPath(
      `/dashboard/${workspaceId}/portfolio/review/${useCaseId}`
    ),
    { workspaceId, useCaseId }
  );
  assert.equal(parsePortfolioReviewPath(`/dashboard/${workspaceId}/portfolio`), null);
});
