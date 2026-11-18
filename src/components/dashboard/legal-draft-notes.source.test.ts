import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// (Ondata 0, docs/ui-10/PROPOSTA-10.md §6.2 voce 0.5) Le pagine legali non mostrano più al pubblico le note di lavoro
// della bozza. Gli indirizzi e-mail restano quelli di oggi: quelli veri li conferma il titolare.

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

test("no draft note on the legal pages, and the e-mail addresses are the same as before", () => {
  const pages = ["src/app/legal/privacy/page.tsx", "src/app/legal/terms/page.tsx", "src/app/legal/support/page.tsx"].map((path) => [path, read(path)] as const);
  for (const [path, source] of pages) {
    assert.doesNotMatch(source, /sostituisc|integralo|Bozza di riferimento|contenuti\s+legali definitivi/i, path);
  }
  const [privacy, terms, support] = pages.map(([, source]) => source);
  assert.match(privacy, /<p className="text-muted-foreground">Ultimo aggiornamento: aprile 2026\.<\/p>/);
  assert.match(terms, /<p className="text-muted-foreground">Ultimo aggiornamento: aprile 2026\.<\/p>/);
  assert.match(privacy, /href="mailto:privacy@theunbundle\.com"/);
  assert.match(support, /href="mailto:support@theunbundle\.com"/);
});
