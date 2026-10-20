import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkCronAuthorization } from "./cron-auth.ts";

// The Casi d'uso crons refuse when CRON_SECRET is missing (PIANO §1.3, §5.7):
// the existing pattern `Bearer ${process.env.CRON_SECRET}` lets «Bearer undefined» in.

test("a missing or blank secret always refuses, whatever the header says", () => {
  for (const secret of [undefined, null, "", "   "]) {
    assert.equal(checkCronAuthorization("Bearer undefined", secret), "segreto_mancante");
    assert.equal(checkCronAuthorization("Bearer ", secret), "segreto_mancante");
    assert.equal(checkCronAuthorization(null, secret), "segreto_mancante");
  }
});

test("only the exact bearer secret passes", () => {
  const secret = "s3cr3t-di-prova";
  assert.equal(checkCronAuthorization(`Bearer ${secret}`, secret), "ok");
  assert.equal(checkCronAuthorization(`Bearer ${secret}`, ` ${secret} `), "ok", "the configured value is trimmed");
  for (const header of [null, undefined, "", secret, `Basic ${secret}`, `bearer ${secret}`, `Bearer ${secret}x`, `Bearer ${secret.slice(1)}`, "Bearer undefined"]) {
    assert.equal(checkCronAuthorization(header, secret), "non_autorizzato", String(header));
  }
});

test("both cron routes go through the shared handler, and vercel.json schedules them", () => {
  for (const job of ["uc-reminders", "uc-freshness"]) {
    const route = readFileSync(new URL(`../../../app/api/cron/${job}/route.ts`, import.meta.url), "utf8");
    assert.match(route, new RegExp(`handleUcCron\\(request, "${job}"`));
    assert.match(route, /export const maxDuration = 120;/);
  }
  const handler = readFileSync(new URL("../../../app/api/cron/uc-handler.ts", import.meta.url), "utf8");
  assert.match(handler, /checkCronAuthorization\(request\.headers\.get\("authorization"\), process\.env\.CRON_SECRET\)/);
  assert.ok(!handler.includes("`Bearer ${process.env.CRON_SECRET}`"));
  const vercel = JSON.parse(readFileSync(new URL("../../../../vercel.json", import.meta.url), "utf8")) as { crons: { path: string; schedule: string }[] };
  const byPath = new Map(vercel.crons.map((c) => [c.path, c.schedule]));
  assert.equal(byPath.get("/api/cron/uc-reminders"), "0 8 * * 1-5");
  assert.equal(byPath.get("/api/cron/uc-freshness"), "0 3 * * *");
  assert.equal(byPath.get("/api/cron/weekly-pulse"), "0 9 * * 1", "existing crons untouched");
  assert.equal(byPath.get("/api/cron/slack-draft-nudge"), "0 8 * * *", "existing crons untouched");
});
