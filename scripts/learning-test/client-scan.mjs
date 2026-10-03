import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const output = process.env.LEARNING_TEST_OUTPUT;
if (!output?.startsWith("/private/tmp/") && !output?.startsWith("/tmp/")) throw new Error("Use temporary output outside Git");
const fixture = JSON.parse(await readFile(resolve(output, "synthetic-fixtures.json"), "utf8"));
const login = await fetch("http://127.0.0.1:53102/as/learner-b2", { redirect: "manual" }); assert.equal(login.status, 302);
const cookie = login.headers.get("set-cookie").split(";")[0], workspace = fixture.workspaces.b;
const url = `http://127.0.0.1:53100/dashboard/${workspace.workspaceId}/learning/${workspace.programId}/activities/m1-exit-a`;
const response = await fetch(url, { headers: { cookie }, redirect: "manual" }); assert.equal(response.status, 200);
const html = await response.text();
const forbidden = ["PRIVATE_FEEDBACK_MARKER", "PRIVATE_REFERENCE_MARKER", "PRIVATE_FACT_MARKER", "PRIVATE_BOUNDARY_MARKER", "PRIVATE_SOURCE_MARKER", "PRIVATE_PROMPT_MARKER", "correct_option_ids"];
const assets = [...new Set([...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1].replaceAll("&amp;", "&")))];
assert.ok(assets.length > 0);
const records = [];
for (const asset of assets) {
  const target = new URL(asset, url); assert.equal(target.origin, "http://127.0.0.1:53100");
  const resource = await fetch(target); assert.equal(resource.status, 200);
  const text = await resource.text();
  for (const marker of forbidden) assert.ok(!text.includes(marker), `Private marker ${marker} in client script`);
  records.push({ path: target.pathname, bytes: Buffer.byteLength(text) });
}
for (const marker of forbidden) assert.ok(!html.includes(marker), `Private marker ${marker} in HTML`);
const rsc = await fetch(url, { headers: { cookie, RSC: "1" }, redirect: "manual" }); assert.equal(rsc.status, 200);
const rscText = await rsc.text(); for (const marker of forbidden) assert.ok(!rscText.includes(marker), `Private marker ${marker} in RSC`);
await writeFile(resolve(output, process.env.LEARNING_TEST_RUNTIME === "production" ? "client-scan-production.json" : "client-scan.json"), JSON.stringify({ timestamp: new Date().toISOString(), status: "PASS", environment: "actual local HTTP before attempt start", url, htmlBytes: Buffer.byteLength(html), rscBytes: Buffer.byteLength(rscText), checkedMarkers: forbidden, scripts: records }, null, 2));
console.log(`PASS G04: learner HTML, RSC and ${records.length} actual client scripts contain no generic private-bank markers or correct_option_ids.`);
