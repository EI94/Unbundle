import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// «Pre-genera da documenti» senza l'ok ai fornitori di AI (rilascio 9a, RILASCIO-9a-COSTRUZIONE.md §6.2): l'azione si
// ferma prima del modello e risponde `consentMissing`; il pulsante lo dice con la riga dell'ok, non con «Non ho trovato
// attività», che direbbe una cosa falsa.

const source = readFileSync(new URL("./activity-pre-generator.tsx", import.meta.url), "utf8");

test("senza l'ok il pulsante dice che serve l'ok ai fornitori, prima di guardare le attività", () => {
  assert.match(source, /import \{ CONTEXT_TEXT \} from "@\/lib\/context\/text";/);
  assert.match(source, /if \(result\.consentMissing\) \{\s*(?:\/\/[^\n]*\n\s*)?toast\.info\(CONTEXT_TEXT\.consent\.title\);\s*setProposals\(null\);\s*\} else if \(result\.activities\.length === 0\) \{/);
});
