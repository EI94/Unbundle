import test from "node:test";
import assert from "node:assert/strict";
import { readUploadForm, uploadStatusFor, UPLOAD_FORM_OVERHEAD } from "./multipart.ts";

// Invented content only.

function formRequest(build: (f: FormData) => void, headers: Record<string, string> = {}): Request {
  const form = new FormData();
  build(form);
  return new Request("http://127.0.0.1/api/r/x/upload", { method: "POST", body: form, headers });
}

test("reads one file and the text fields of a multipart body", async () => {
  const req = formRequest((f) => {
    f.set("file", new File([Buffer.from("a;b\n1;2\n")], "tratte.csv", { type: "text/csv" }));
    f.set("itemId", "11111111-1111-4111-8111-111111111111");
    f.set("declaration", "true");
  });
  const r = await readUploadForm(req);
  assert.ok(r.ok, r.ok ? "" : r.message);
  assert.equal(r.value.file.name, "tratte.csv");
  assert.equal(Buffer.from(r.value.file.bytes).toString("utf8"), "a;b\n1;2\n");
  assert.deepEqual(r.value.fields, { itemId: "11111111-1111-4111-8111-111111111111", declaration: "true" });
});

test("refuses non-multipart bodies, missing or repeated files and bodies over the limit", async () => {
  const json = await readUploadForm(new Request("http://127.0.0.1/x", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }));
  assert.equal(json.ok ? null : json.code, "formato_non_ammesso");
  const none = await readUploadForm(formRequest((f) => f.set("declaration", "true")));
  assert.equal(none.ok ? null : none.code, "file_mancante");
  const two = await readUploadForm(
    formRequest((f) => {
      f.append("file", new File(["a"], "a.txt"));
      f.append("file", new File(["b"], "b.txt"));
    }),
  );
  assert.equal(two.ok ? null : two.code, "file_mancante");
  const big = await readUploadForm(formRequest((f) => f.set("file", new File([new Uint8Array(2048)], "a.csv"))), 1024);
  assert.equal(big.ok ? null : big.code, "file_troppo_grande_server");
  const declared = formRequest((f) => f.set("file", new File(["a"], "a.txt")), {});
  const lying = new Request(declared, { headers: { "content-type": declared.headers.get("content-type")!, "content-length": String(10 * 1024 * 1024 + UPLOAD_FORM_OVERHEAD) } });
  const r = await readUploadForm(lying);
  assert.equal(r.ok ? null : r.code, "file_troppo_grande_server", "a declared length over the limit stops before reading");
});

test("HTTP status of upload failures", () => {
  assert.equal(uploadStatusFor("file_troppo_grande_server"), 413);
  assert.equal(uploadStatusFor("estensione_non_ammessa"), 415);
  assert.equal(uploadStatusFor("dichiarazione_mancante"), 422);
  assert.equal(uploadStatusFor("zona_personale_negata"), 403);
  assert.equal(uploadStatusFor("caricamento_non_trovato"), 404);
  assert.equal(uploadStatusFor("modalita_non_disponibile"), 503);
  assert.equal(uploadStatusFor("zona_personale_chiusa"), 409);
});
