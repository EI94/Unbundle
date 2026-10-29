import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KEY_FILE, STAMP_FILE, rotateServerActionKey } from "../../../scripts/rotate-server-action-key.mjs";

// Accanto alla guardia dell'aggiornamento di Next (navigation-ping.test.ts): gli ID delle server
// action vengono dalla chiave che Next riusa dalla cache di build, ripristinata da Vercel. Con un altro
// Next cambia il formato del FormData (da 16.2.3 a 16.4.3 i campi passano da `1_title` a `_1_title`) e
// una scheda aperta sul deploy precedente salvava un FormData vuoto senza errore. `npm run build`
// toglie la chiave quando cambia la versione di Next, così gli ID cambiano e la stessa scheda riceve un
// 409 senza scrivere niente; con la stessa versione la chiave resta, come prima.
const ROOT = new URL("../../../", import.meta.url);

function cacheWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "uc-rscinfo-"));
  const cacheDir = join(dir, "cache");
  mkdirSync(cacheDir);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(cacheDir, name), text);
  return cacheDir;
}

test("`npm run build` controlla la chiave delle server action prima di `next build`", () => {
  const pkg = JSON.parse(readFileSync(new URL("package.json", ROOT), "utf8")) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts.build, "node scripts/rotate-server-action-key.mjs && next build");
});

test("chiave delle server action: nuova quando la cache viene da un altro Next o non dice quale", () => {
  for (const [label, stamp, previous] of [
    ["cache di 16.2.3, prima di questo script", null, null],
    ["cache di un altro Next", "16.2.3\n", "16.2.3"],
  ] as const) {
    const cacheDir = cacheWith({ [KEY_FILE]: '{"encryption.key":"vecchia"}', ...(stamp ? { [STAMP_FILE]: stamp } : {}), ".tsbuildinfo": "x" });
    try {
      assert.deepEqual(rotateServerActionKey({ cacheDir, nextVersion: "16.4.3" }), { rotated: true, previous }, label);
      assert.equal(existsSync(join(cacheDir, KEY_FILE)), false, `${label}: Next ne crea una nuova`);
      assert.equal(readFileSync(join(cacheDir, STAMP_FILE), "utf8"), "16.4.3\n", label);
      assert.equal(existsSync(join(cacheDir, ".tsbuildinfo")), true, `${label}: il resto della cache resta`);
    } finally {
      rmSync(join(cacheDir, ".."), { recursive: true, force: true });
    }
  }
});

test("chiave delle server action: la stessa con la stessa versione di Next, e niente da fare senza cache", () => {
  const cacheDir = cacheWith({ [KEY_FILE]: '{"encryption.key":"di 16.4.3"}', [STAMP_FILE]: "16.4.3\n" });
  try {
    assert.deepEqual(rotateServerActionKey({ cacheDir, nextVersion: "16.4.3" }), { rotated: false, previous: "16.4.3" });
    assert.equal(readFileSync(join(cacheDir, KEY_FILE), "utf8"), '{"encryption.key":"di 16.4.3"}', "le schede aperte continuano a funzionare");
  } finally {
    rmSync(join(cacheDir, ".."), { recursive: true, force: true });
  }
  const fresh = join(mkdtempSync(join(tmpdir(), "uc-rscinfo-")), "cache");
  try {
    assert.deepEqual(rotateServerActionKey({ cacheDir: fresh, nextVersion: "16.4.3" }), { rotated: true, previous: null });
    assert.equal(readFileSync(join(fresh, STAMP_FILE), "utf8"), "16.4.3\n", "la prossima build della stessa versione la tiene");
  } finally {
    rmSync(join(fresh, ".."), { recursive: true, force: true });
  }
});
