import test from "node:test";
import assert from "node:assert/strict";
import type { CostInput, NewUseCaseInput } from "./types.ts";

// Il costo del team è un importo una tantum oppure una fascia, mai entrambi
// (docs/use-case/DESIGN.md §5.4, criterio di accettazione 6). Le righe con
// `@ts-expect-error` le controlla `npm run typecheck`: se un oggetto con importo e fascia
// tornasse a compilare, la direttiva resterebbe senza errore e tsc fallirebbe.

const amount: CostInput = { eurOnce: 40000 };
const band: CostInput = { band: 3 };
const none: CostInput = null;

// @ts-expect-error importo e fascia insieme
const both: CostInput = { eurOnce: 40000, band: 3 };

const input: NewUseCaseInput = {
  source: "web_proposed",
  kind: "da_costruire",
  title: "Titolo di prova",
  description: null,
  // @ts-expect-error importo e fascia insieme, dentro l'input di creazione
  cost: { eurOnce: 1, band: 5 },
};

/** Come si legge il costo: con `!== undefined`, che con le due varianti esclusive restringe il tipo. */
function costLabel(cost: CostInput): string {
  if (cost === null) return "nessun costo";
  if (cost.eurOnce !== undefined) return `importo ${cost.eurOnce}`;
  return `fascia ${cost.band}`;
}

test("il costo è un importo oppure una fascia, mai entrambi", () => {
  assert.equal(costLabel(amount), "importo 40000");
  assert.equal(costLabel(band), "fascia 3");
  assert.equal(costLabel(none), "nessun costo");
  // Gli oggetti rifiutati da tsc esistono solo per la prova di tipo.
  assert.ok(both && input);
});
