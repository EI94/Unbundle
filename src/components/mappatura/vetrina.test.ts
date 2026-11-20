import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// La vetrina della board (scripts/mappatura-test/vetrina.mjs), che screens-board.mjs fotografa: si costruisce con i
// componenti di oggi, senza browser e senza server. Un pezzo tolto o rinominato (come `BoardBrand` nel rilascio 10) la
// fa fallire qui, non solo quando qualcuno prova a fare le foto.

const { PAGES, buildVetrina } = await import("../../../scripts/mappatura-test/vetrina.mjs");

test("la vetrina della board si costruisce: una pagina per voce, ognuna con il suo contenuto; la testata con il percorso", async () => {
  const out = mkdtempSync(join(tmpdir(), "vetrina-board-"));
  try {
    const pages = await buildVetrina(out);
    assert.equal(pages.length, PAGES.length);
    assert.ok(pages.length >= 20, `${pages.length} pagine`);
    for (const page of pages) {
      const html = readFileSync(page.file, "utf8");
      assert.match(html, /<div data-board-root="" style="--board-shell-top: 0px; min-height: 100vh"><[a-z]/, page.name);
      assert.doesNotMatch(html, />undefined</, page.name);
    }
    assert.equal(PAGES.some((page: { name: string }) => page.name.startsWith("00-unita")), false, "l'elenco delle unità è in «Contesto › Processi»");
    const saved = readFileSync(join(out, "status/1-salvato.html"), "utf8");
    assert.match(saved, /<nav class="b-brand b-path" aria-label="Percorso" data-b="path">/);
    assert.match(saved, /<span class="b-path-here" aria-current="page">Ufficio acquisti<\/span>/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
