import test from "node:test";
import assert from "node:assert/strict";
import { TEST_CASES_MAX_BYTES, formatFromFileName, readBoundedBody, readTestCasesUpload, sameSiteRequest, testCasesImportHref } from "./test-cases-upload.ts";

const WS = "22222222-2222-4222-8222-222222222222";
const CASE = "11111111-1111-4111-8111-111111111111";
const URL_BASE = `http://app.test/dashboard/${WS}/casi-duso/${CASE}/test-cases/import`;

test("the import link points to the route handler", () => {
  assert.equal(testCasesImportHref(WS, CASE), `/dashboard/${WS}/casi-duso/${CASE}/test-cases/import`);
});

test("same-site check: origin host against the request host or the public URL", () => {
  const h = (o: Record<string, string>) => new Headers(o);
  assert.equal(sameSiteRequest(h({ origin: "https://app.test", host: "app.test" })), true);
  assert.equal(sameSiteRequest(h({ origin: "http://app.test", host: "app.test" })), true, "internal http behind the proxy");
  assert.equal(sameSiteRequest(h({ origin: "https://evil.test", host: "app.test" })), false);
  assert.equal(sameSiteRequest(h({ origin: "https://www.app.test", host: "app.test" }), "https://www.app.test"), true);
  assert.equal(sameSiteRequest(h({ origin: "https://www.app.test", host: "app.test" }), "www.app.test"), true);
  assert.equal(sameSiteRequest(h({ origin: "null", host: "app.test" })), false);
  assert.equal(sameSiteRequest(h({ origin: "file://app.test", host: "app.test" })), false);
  assert.equal(sameSiteRequest(h({ host: "app.test", "sec-fetch-site": "same-origin" })), true);
  assert.equal(sameSiteRequest(h({ host: "app.test", "sec-fetch-site": "cross-site" })), false);
  assert.equal(sameSiteRequest(h({ host: "app.test" })), false);
});

test("bounded body: a lying or missing content-length cannot push past the limit", async () => {
  const small = await readBoundedBody(new Request(URL_BASE, { method: "POST", body: "abc" }), 10);
  assert.ok(small.ok);
  assert.equal(new TextDecoder().decode(small.value), "abc");
  const declared = await readBoundedBody(new Request(URL_BASE, { method: "POST", body: "abc", headers: { "content-length": "999" } }), 10);
  assert.equal(declared.ok ? "" : declared.code, "file_troppo_grande");
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < 5; i++) controller.enqueue(new Uint8Array(4));
      controller.close();
    },
  });
  const streamed = await readBoundedBody(new Request(URL_BASE, { method: "POST", body: stream, duplex: "half" } as RequestInit), 10);
  assert.equal(streamed.ok ? "" : streamed.code, "file_troppo_grande");
});

function multipart(file: File | null, extra: Record<string, string> = {}): Request {
  const form = new FormData();
  if (file) form.set("file", file);
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  return new Request(URL_BASE, { method: "POST", body: form });
}

test("upload: multipart JSON or CSV, format from the file name, UTF-8 only", async () => {
  const csv = await readTestCasesUpload(multipart(new File(["key;input;atteso\nc1;x;y\n"], "casi.csv", { type: "text/csv" })));
  assert.deepEqual(csv, { ok: true, value: { text: "key;input;atteso\nc1;x;y\n", format: "csv" } });
  const json = await readTestCasesUpload(multipart(new File(['[{"key":"c1"}]'], "casi.JSON")));
  assert.deepEqual(json, { ok: true, value: { text: '[{"key":"c1"}]', format: "json" } });
  const txt = await readTestCasesUpload(multipart(new File(["[]"], "casi.txt")));
  assert.deepEqual(txt, { ok: true, value: { text: "[]" } });

  const xlsx = await readTestCasesUpload(multipart(new File([new Uint8Array([0x50, 0x4b, 3, 4])], "casi.xlsx")));
  assert.equal(xlsx.ok ? "" : xlsx.code, "formato_non_supportato");
  assert.match(xlsx.ok ? "" : xlsx.message, /CSV UTF-8/);
  const latin1 = await readTestCasesUpload(multipart(new File([new Uint8Array([0x63, 0x61, 0x66, 0xe8])], "casi.csv")));
  assert.equal(latin1.ok ? "" : latin1.code, "codifica_non_valida");
  const empty = await readTestCasesUpload(multipart(new File([], "casi.csv")));
  assert.equal(empty.ok ? "" : empty.code, "file_mancante");
  const missing = await readTestCasesUpload(multipart(null, { file: "non un file" }));
  assert.equal(missing.ok ? "" : missing.code, "file_mancante");
  const big = await readTestCasesUpload(multipart(new File([new Uint8Array(TEST_CASES_MAX_BYTES + 1)], "casi.csv")));
  assert.equal(big.ok ? "" : big.code, "file_troppo_grande");
});

test("upload: raw JSON, CSV or text bodies; other content types are refused", async () => {
  const raw = (body: string, type: string) => new Request(URL_BASE, { method: "POST", body, headers: { "content-type": type } });
  assert.deepEqual(await readTestCasesUpload(raw("[]", "application/json; charset=utf-8")), { ok: true, value: { text: "[]", format: "json" } });
  assert.deepEqual(await readTestCasesUpload(raw("key\nc1", "text/csv")), { ok: true, value: { text: "key\nc1", format: "csv" } });
  assert.deepEqual(await readTestCasesUpload(raw("[]", "text/plain")), { ok: true, value: { text: "[]" } });
  const other = await readTestCasesUpload(raw("<x/>", "application/xml"));
  assert.equal(other.ok ? "" : other.code, "formato_non_supportato");
  const none = await readTestCasesUpload(raw("", "application/json"));
  assert.equal(none.ok ? "" : none.code, "file_mancante");
});

test("file name formats", () => {
  assert.deepEqual(formatFromFileName("a.tsv"), { ok: true, value: "csv" });
  assert.deepEqual(formatFromFileName("senza-estensione"), { ok: true, value: undefined });
  assert.equal(formatFromFileName("a.pdf").ok, false);
});
