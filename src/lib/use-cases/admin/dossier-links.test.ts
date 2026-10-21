import test from "node:test";
import assert from "node:assert/strict";
import { MOTHER_CARD, orphanDossiersSql, orphanFrom, planDossierLinks } from "./dossier-links.ts";

// use-case-admin dossier-links (docs/use-case/DESIGN.md §10.9). Dossier inventati.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("la scheda madre: approvata, dall'alto, manuale, nascosta alla ricerca", () => {
  assert.deepEqual(
    { ...MOTHER_CARD, intake: { ...MOTHER_CARD.intake } },
    { portfolioKind: "use_case_ai", status: "accepted", origin: "transformation", source: "manual", intake: { hiddenFromSearch: true } },
  );
  assert.ok(Object.isFrozen(MOTHER_CARD) && Object.isFrozen(MOTHER_CARD.intake));
});

test("solo i dossier completi senza scheda", () => {
  const sql = orphanDossiersSql(true);
  assert.match(sql, /c\.setup_completed_at IS NOT NULL AND c\.portfolio_use_case_id IS NULL AND c\.workspace_id = \$1::uuid/);
  assert.doesNotMatch(orphanDossiersSql(false), /\$1/);
});

test("piano: titolo del dossier, descrizione dalla frase breve, id deciso prima", () => {
  let n = 0;
  const newId = () => id(500 + ++n);
  const orphans = [
    orphanFrom({ case_id: id(1), workspace_id: id(900), code: "CASO-1", title: "Assistente per le note spese", one_liner: "Legge le ricevute e propone la nota." }),
    orphanFrom({ case_id: id(2), workspace_id: id(900), code: "CASO-2", title: "   ", one_liner: "  " }),
  ];
  assert.deepEqual(planDossierLinks(orphans, newId), [
    { caseId: id(1), workspaceId: id(900), caseCode: "CASO-1", useCaseId: id(501), title: "Assistente per le note spese", description: "Legge le ricevute e propone la nota." },
    { caseId: id(2), workspaceId: id(900), caseCode: "CASO-2", useCaseId: id(502), title: "CASO-2", description: null },
  ]);
});
