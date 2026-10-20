import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ucBlobPath } from "./files/filename.ts";
import { clientUploadAvailable, deleteUcObjects, pathBelongsToZone, storageConfig, storeConfigured, ucStore } from "./storage.ts";

const WS = "11111111-1111-4111-8111-111111111111";
const CASE = "22222222-2222-4222-8222-222222222222";
const ID = "33333333-3333-4333-8333-333333333333";
const dir = mkdtempSync(join(tmpdir(), "uc-storage-test-"));
after(() => rmSync(dir, { recursive: true, force: true }));

test("configuration: the local folder wins outside Vercel; Blob per zone with its own token; nothing without either", () => {
  assert.deepEqual(storageConfig({ UC_LOCAL_STORAGE_DIR: dir, BLOB_READ_WRITE_TOKEN: "x" }), { standard: "locale", personale: "locale" });
  assert.deepEqual(storageConfig({ UC_LOCAL_STORAGE_DIR: dir, VERCEL: "1", BLOB_READ_WRITE_TOKEN: "x" }), { standard: "blob", personale: null });
  assert.deepEqual(storageConfig({ BLOB_READ_WRITE_TOKEN: "x", UC_PERSONAL_BLOB_READ_WRITE_TOKEN: "y" }), { standard: "blob", personale: "blob" });
  assert.deepEqual(storageConfig({}), { standard: null, personale: null });
  assert.equal(storeConfigured("personale", { BLOB_READ_WRITE_TOKEN: "x" }), false, "the personal zone never falls back to the standard store");
  assert.equal(clientUploadAvailable({ UC_LOCAL_STORAGE_DIR: dir }), false, "never on the harness");
  assert.equal(clientUploadAvailable({ BLOB_READ_WRITE_TOKEN: "x" }), true);
  assert.equal(ucStore("standard", {}), null);
});

test("zones keep their own areas: quarantine and standard in one store, encrypted envelopes in the other", () => {
  assert.ok(pathBelongsToZone(ucBlobPath("quarantena", WS, CASE, ID), "standard"));
  assert.ok(pathBelongsToZone(ucBlobPath("standard", WS, CASE, ID), "standard"));
  assert.ok(pathBelongsToZone(ucBlobPath("personale", WS, CASE, ID), "personale"));
  assert.equal(pathBelongsToZone(ucBlobPath("personale", WS, CASE, ID), "standard"), false);
  assert.equal(pathBelongsToZone(ucBlobPath("standard", WS, CASE, ID), "personale"), false);
  assert.equal(pathBelongsToZone(`uc/s/${WS}/${CASE}/../x`, "standard"), false);
});

test("local store: put, head, read with a limit, stream, list and delete; wrong zone or traversal refused", async () => {
  const env = { UC_LOCAL_STORAGE_DIR: dir };
  const std = ucStore("standard", env)!;
  const per = ucStore("personale", env)!;
  const path = ucBlobPath("standard", WS, CASE, ID);
  await std.put(path, new Uint8Array([1, 2, 3]));
  assert.equal((await std.head(path))?.size, 3);
  assert.deepEqual([...((await std.read(path, 10)) ?? [])], [1, 2, 3]);
  await assert.rejects(std.read(path, 2), /limite/);
  const s = await std.stream(path);
  assert.ok(s);
  const chunks: Uint8Array[] = [];
  for await (const c of s.stream as unknown as AsyncIterable<Uint8Array>) chunks.push(c);
  assert.equal(Buffer.concat(chunks).length, 3);
  await assert.rejects(std.put(path, new Uint8Array([9]), { overwrite: false }), /esiste/);
  await assert.rejects(per.put(path, new Uint8Array([1])), /zona/);
  await assert.rejects(std.put(`uc/s/${WS}/${CASE}/../../x`, new Uint8Array([1])), /non valido/);
  assert.equal(statSync(join(dir, "standard", ...path.split("/"))).mode & 0o777, 0o600, "private file mode");

  const q = ucBlobPath("quarantena", WS, CASE, ID);
  await std.put(q, new Uint8Array([4]));
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
  utimesSync(join(dir, "standard", ...q.split("/")), old, old);
  const listed = await std.list("uc/q/");
  assert.deepEqual(listed.map((o) => o.path), [q]);
  assert.ok(listed[0].uploadedAt.getTime() <= old.getTime() + 1000);
  await assert.rejects(std.list("uc/p/"), /zona/);
  await assert.rejects(std.list("../"), /Prefisso/);

  const p = ucBlobPath("personale", WS, CASE, ID);
  await per.put(p, new Uint8Array([7]));
  const removed = await deleteUcObjects({ standard: [path, q], personale: [p, path] }, env);
  assert.deepEqual(removed, { deleted: 3, failed: 0 }, "a path of the wrong zone is skipped");
  assert.equal(await std.head(path), null);
  assert.equal(await std.read(q, 10), null);
  assert.equal(await per.head(p), null);
  await std.delete([path]);
});
