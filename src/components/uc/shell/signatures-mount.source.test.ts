import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// (Rilascio 10, §3.5) Il pannello delle firme (`?firma=1`) è montato una volta nel guscio della realizzazione: il passo
// «Firma», `/firme` e i link già salvati lo aprono su ogni pagina. Senza questo montaggio i link arrivano su una pagina
// senza pannello e nessun'altra prova se ne accorge.

const LAYOUT = fileURLToPath(new URL("../../../app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/layout.tsx", import.meta.url));

test("il guscio monta una volta il pannello delle firme, con i ruoli effettivi, lo stato e la sola lettura della stessa lettura", () => {
  const src = readFileSync(LAYOUT, "utf8");
  const mounts = src.match(/<CaseSignaturesPanel\b[^>]*\/>/g) ?? [];
  assert.equal(mounts.length, 1, "un solo pannello delle firme");
  const mount = mounts[0];
  assert.match(mount, /roles=\{roles\}/);
  assert.match(mount, /status=\{c\.status\}/);
  assert.match(mount, /readOnly=\{caseAccess\.readOnly\}/);
  assert.match(src, /const roles = caseAccess\.roles;/, "i ruoli effettivi della realizzazione");
  assert.match(src, /import \{ CaseSignaturesPanel \} from "@\/components\/uc\/approvals\/sign-panel";/);
});
