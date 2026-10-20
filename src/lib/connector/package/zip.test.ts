import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createZip, readZip } from "./zip.ts";

const sample = [
  { path: "pacchetto/.claude-plugin/plugin.json", data: '{"name":"pacchetto"}\n' },
  { path: "pacchetto/skills/esempio/SKILL.md", data: "---\nname: esempio\n---\nTesto con accenti: perché, qualità.\n".repeat(50) },
  { path: "pacchetto/vuoto.txt", data: "" },
];

test("createZip e readZip: stesso contenuto, cartelle aggiunte, ordine stabile", () => {
  const entries = readZip(createZip(sample));
  assert.deepEqual(
    entries.map((e) => e.path),
    [
      "pacchetto/",
      "pacchetto/.claude-plugin/",
      "pacchetto/.claude-plugin/plugin.json",
      "pacchetto/skills/",
      "pacchetto/skills/esempio/",
      "pacchetto/skills/esempio/SKILL.md",
      "pacchetto/vuoto.txt",
    ]
  );
  for (const input of sample) {
    const found = entries.find((e) => e.path === input.path);
    assert.ok(found && !found.isDirectory);
    assert.equal(found.data.toString("utf8"), input.data);
  }
  assert.ok(entries.filter((e) => e.path.endsWith("/")).every((e) => e.isDirectory && e.data.length === 0));
});

test("createZip è deterministico: stessi byte con qualunque ordine delle voci", () => {
  const a = createZip(sample);
  const b = createZip([...sample].reverse());
  assert.ok(a.equals(b));
});

test("createZip rifiuta percorsi pericolosi, voci ripetute e cartelle con contenuto", () => {
  for (const path of ["../fuori.txt", "/assoluto.txt", "a/../b.txt", "a\\b.txt", "a//b.txt"]) {
    assert.throws(() => createZip([{ path, data: "x" }]), /Percorso non ammesso/);
  }
  assert.throws(() => createZip([{ path: "a.txt", data: "x" }, { path: "a.txt", data: "y" }]), /ripetuta/);
  assert.throws(() => createZip([{ path: "cartella/", data: "x" }]), /cartella/);
});

test("readZip si accorge di un archivio rovinato", () => {
  const zip = createZip([{ path: "a/testo.txt", data: "contenuto da proteggere con il CRC" }]);
  const wrongCrc = Buffer.from(zip);
  // L'ultima copia del nome è quella della directory centrale: l'intestazione inizia 46 byte prima.
  const central = wrongCrc.lastIndexOf("a/testo.txt") - 46;
  assert.equal(wrongCrc.readUInt32LE(central), 0x02014b50);
  wrongCrc.writeUInt32LE((wrongCrc.readUInt32LE(central + 16) ^ 0xff) >>> 0, central + 16);
  assert.throws(() => readZip(wrongCrc), /CRC/);
  assert.throws(() => readZip(zip.subarray(0, zip.length - 30)), /Zip non valido/);
  assert.throws(() => readZip(Buffer.from("non è uno zip")), /Zip non valido/);
});

test("lo zip passa il controllo di unzip, se c'è sul sistema", { skip: !existsSync("/usr/bin/unzip") && "unzip non disponibile" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "k9-zip-"));
  try {
    const file = join(dir, "prova.zip");
    writeFileSync(file, createZip(sample));
    const tested = spawnSync("/usr/bin/unzip", ["-tq", file], { encoding: "utf8" });
    assert.equal(tested.status, 0, tested.stdout + tested.stderr);
    const listed = spawnSync("/usr/bin/unzip", ["-Z1", file], { encoding: "utf8" });
    assert.equal(listed.status, 0);
    assert.ok(listed.stdout.split("\n").includes("pacchetto/.claude-plugin/plugin.json"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
