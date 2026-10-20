import test from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { ascii85Encode, buildRawPdf, buildZip, lzwEncode, pngUpEncode, runLengthEncode } from "./fixtures.ts";
import { openZip, readZipEntry } from "./ooxml.ts";

test("the LZW encoder reproduces the example of the PDF specification", () => {
  assert.equal(lzwEncode(Uint8Array.of(45, 45, 45, 45, 45, 65, 45, 45, 45, 66)).toString("hex"), "800b6050220c0c8501");
  assert.throws(() => lzwEncode(new Uint8Array(4000).map((_, i) => i % 251)));
});

test("ASCII85, RunLength and PNG Up encoders produce the expected bytes", () => {
  assert.equal(ascii85Encode(Buffer.from("Man is distinguished")), "9jqo^BlbD-BleB1DJ+*+F(f,q~>");
  assert.equal(ascii85Encode(new Uint8Array(4)), "z~>");
  assert.deepEqual([...runLengthEncode(Uint8Array.of(1, 2, 3))], [2, 1, 2, 3, 128]);
  const rows = inflateSync(pngUpEncode(Uint8Array.of(1, 2, 3, 4), 2));
  assert.deepEqual([...rows], [2, 1, 2, 2, 2, 2]);
});

test("synthetic zips and PDFs are well formed", () => {
  const zip = buildZip([{ name: "a.txt", data: "ciao" }]);
  const opened = openZip(zip);
  assert.ok(opened.ok);
  const read = readZipEntry(opened.value, opened.value.entries[0]);
  assert.ok(read.ok);
  assert.equal(read.value.toString(), "ciao");
  const pdf = buildRawPdf(["<< /Type /Catalog >>"]).toString("latin1");
  assert.ok(pdf.startsWith("%PDF-1.7"));
  assert.match(pdf, /1 0 obj\n<< \/Type \/Catalog >>\nendobj/);
  assert.match(pdf, /trailer\n<< \/Size 2 \/Root 1 0 R >>/);
});
