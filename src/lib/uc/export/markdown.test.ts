import test from "node:test";
import assert from "node:assert/strict";
import { buildCatalogSnapshot, snapshotForViewer, type CatalogSnapshot } from "../snapshot.ts";
import { answer, item, sampleInput } from "../snapshot.fixtures.ts";
import { catalogToMarkdown, mdCell } from "./markdown.ts";
import { catalogToSheets } from "./sheets.ts";

function snap(over: Parameters<typeof sampleInput>[0] = {}): CatalogSnapshot {
  const r = buildCatalogSnapshot(sampleInput(over));
  assert.ok(r.ok);
  return r.value;
}

test("markdown cells cannot break the table or inject HTML", () => {
  assert.equal(mdCell("a|b\nc"), "a\\|b c");
  assert.equal(mdCell("<script>x</script>"), "&lt;script&gt;x&lt;/script&gt;");
  assert.equal(mdCell(null), "");
});

test("markdown export has the dictionary, the catalog and never personal values", () => {
  const md = catalogToMarkdown(snap());
  assert.match(md, /^# Catalogo · ES-UC-01 · Gestione richieste d'esempio\n/);
  assert.match(md, /Versione: \*\*v1\*\*, congelata il 2026-10-01/);
  assert.match(md, /## Dizionario dati/);
  assert.match(md, /### ent\.richiesta · Titolo di ent\.richiesta/);
  assert.match(md, /\| richiesta\.durata \| Titolo di richiesta\.durata \| numero \| min \| sì \| nessuna \| A posto \|/);
  assert.match(md, /### Domande \(5\)/);
  assert.match(md, /\| q\.esempio\.01 \|[^\n]*\| 120 EUR, IVA esclusa, per ora \| referente \| v1 \|/);
  assert.match(md, /\| q\.esempio\.02 \|[^\n]*\| non applicabile \|/);
  assert.ok(!md.includes("dato personale inventato"));
  assert.ok(!md.includes("non validata"), "a frozen version has no draft markers");
  assert.match(md, /3 collegamenti tra voci/);
});

test("the markdown draft marks items that are not in place", () => {
  const md = catalogToMarkdown(snap({ version: "bozza", frozenAt: null }));
  assert.match(md, /Versione: \*\*bozza\*\*/);
  assert.match(md, /\| q\.esempio\.03 \|[^\n]*Da verificare \(non validata\)[^\n]*\| Valore d'esempio \| dichiarato in call · F001 \|/);
  assert.ok(!/\| q\.esempio\.01 \|[^\n]*non validata/.test(md));
});

test("exports respect the role filter applied before them", () => {
  const forClient = snapshotForViewer(snap(), { roles: ["owner_cliente"] });
  const md = catalogToMarkdown(forClient);
  assert.ok(!md.includes("=SOMMA"));
  assert.match(md, /nascosto per il tuo ruolo/);
  const sheets = catalogToSheets(forClient);
  assert.ok(!JSON.stringify(sheets).includes("SOMMA"));
});

test("an injected title with markdown and formula prefixes stays inert", () => {
  const input = sampleInput();
  const s = snap({ items: [...input.items, item({ key: "q.esempio.09", title: "=HYPERLINK(\"x\") | # titolo", status: "validata", validatedAt: "2026-09-30T00:00:00Z", validatedAnswer: answer() })] });
  const md = catalogToMarkdown(s);
  assert.match(md, /\| q\.esempio\.09 \| =HYPERLINK\("x"\) \\\| # titolo \|/);
  const sheets = catalogToSheets(s);
  assert.equal(sheets[0].rows.find((r) => r.ID === "q.esempio.09")?.Titolo, "'=HYPERLINK(\"x\") | # titolo");
});
