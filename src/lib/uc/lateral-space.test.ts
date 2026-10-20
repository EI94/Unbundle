import test from "node:test";
import assert from "node:assert/strict";
import { caseRoleAllowedFor, emailDomain, isClientUser, isEmailVerifiedValue, isLateralSpaceEmail, parseLsDomains, userContextFrom } from "./lateral-space.ts";
import { CASE_ROLES } from "./vocab.ts";

test("domains are parsed, lowercased, deduplicated and validated", () => {
  assert.deepEqual(parseLsDomains(" LS.test, @ls.test , altro.example,, not a domain, x"), ["ls.test", "altro.example"]);
  assert.deepEqual(parseLsDomains(undefined), []);
  assert.deepEqual(parseLsDomains(""), []);
});

test("email domain is exact and lowercase", () => {
  assert.equal(emailDomain("Mario@LS.test"), "ls.test");
  assert.equal(emailDomain("a@b@ls.test"), "ls.test");
  assert.equal(emailDomain("no-at-sign"), null);
  assert.equal(emailDomain("@ls.test"), null);
  assert.equal(emailDomain("x@"), null);
  assert.equal(emailDomain(null), null);
});

test("only a verified email in an exact domain is Lateral Space", () => {
  const domains = ["ls.test"];
  assert.equal(isLateralSpaceEmail({ email: "lead@ls.test", emailVerified: true }, domains), true);
  assert.equal(isLateralSpaceEmail({ email: "lead@ls.test", emailVerified: false }, domains), false);
  // No implicit subdomains and no suffix matches.
  assert.equal(isLateralSpaceEmail({ email: "lead@sub.ls.test", emailVerified: true }, domains), false);
  assert.equal(isLateralSpaceEmail({ email: "lead@notls.test", emailVerified: true }, domains), false);
  assert.equal(isLateralSpaceEmail({ email: "owner@cliente.test", emailVerified: true }, domains), false);
});

test("without configured domains nobody is Lateral Space", () => {
  assert.equal(isLateralSpaceEmail({ email: "lead@ls.test", emailVerified: true }, parseLsDomains(undefined)), false);
});

test("user context reads email_verified as a timestamp", () => {
  const ctx = userContextFrom({ id: "u1", email: "Lead@LS.test", emailVerified: new Date() }, ["ls.test"]);
  assert.deepEqual(ctx, { userId: "u1", emailVerified: true, emailDomain: "ls.test", isLateralSpace: true });
  const unverified = userContextFrom({ id: "u2", email: "lead@ls.test", emailVerified: null }, ["ls.test"]);
  assert.equal(unverified.isLateralSpace, false);
  assert.equal(unverified.emailVerified, false);
});

test("email_verified fails closed: only a valid date, a non-empty string or true count", () => {
  for (const v of [new Date("2026-01-01T00:00:00Z"), "2026-01-01 00:00:00+00", true]) assert.equal(isEmailVerifiedValue(v), true, String(v));
  for (const v of [undefined, null, false, "", "  ", 0, 1, {}, new Date("not a date")]) assert.equal(isEmailVerifiedValue(v), false, String(v));
  // A column left out of the SELECT does not make a Lateral Space domain verified.
  const missing = userContextFrom({ id: "u3", email: "lead@ls.test" }, ["ls.test"]);
  assert.equal(missing.emailVerified, false);
  assert.equal(missing.isLateralSpace, false);
});

test("Lateral Space roles only for Lateral Space users, client roles only for verified client people", () => {
  type U = Parameters<typeof caseRoleAllowedFor>[0];
  const ls: U = { isLateralSpace: true, emailVerified: true, emailDomain: "ls.test" };
  const client: U = { isLateralSpace: false, emailVerified: true, emailDomain: "cliente.test" };
  const unverifiedLs: U = { isLateralSpace: false, emailVerified: false, emailDomain: "ls.test" };
  const allowed = (u: U, domains?: string[]) => CASE_ROLES.filter((r) => caseRoleAllowedFor(u, r, domains));
  assert.deepEqual(allowed(ls), ["ls_lead", "ls_analista", "ls_sviluppatore", "osservatore"]);
  assert.deepEqual(allowed(client), ["owner_cliente", "approvatore_privacy", "ai_board", "osservatore"]);
  // Neither Lateral Space nor client: only the observer role.
  assert.deepEqual(allowed(unverifiedLs), ["osservatore"]);
  assert.deepEqual(allowed({ ...client, emailVerified: false }), ["osservatore"]);
  // With the domain list, a listed domain is never the client.
  assert.deepEqual(allowed({ ...client, emailDomain: "ls.test" }, ["ls.test"]), ["osservatore"]);
  assert.equal(isClientUser(client, ["ls.test"]), true);
  assert.equal(isClientUser(unverifiedLs), false);
});
