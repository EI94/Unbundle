// La scelta del workspace in «Collega questa CLI»: solo dove la persona è nel team di un caso, mai come learner; voci
// sempre distinguibili (il 12/11 la pagina mostrava cinque «NATIVA · Supersapiens» uguali).
import test from "node:test";
import assert from "node:assert/strict";
import { cliWorkspaceChoices, type CliWorkspaceInput } from "./workspace-choices.ts";

const ws = (id: string, name: string, organization: string, created: string, accessRole = "transformation_lead"): CliWorkspaceInput => ({
  id,
  name,
  organization,
  createdAt: new Date(created),
  accessRole,
});

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";
const D = "dddddddd-0000-4000-8000-000000000004";

test("solo i workspace con un caso dove la persona è nel team, mai come learner, una volta sola", () => {
  const items = [ws(A, "Rosa", "Rosa", "2026-10-01T10:00:00Z"), ws(B, "Prova", "Lateral Space", "2026-11-04T10:00:00Z"), ws(C, "Corso", "Rosa", "2026-10-02T10:00:00Z", "learner"), ws(A, "Rosa", "Rosa", "2026-10-01T10:00:00Z")];
  assert.deepEqual(cliWorkspaceChoices(items, new Set([A, C])), [{ id: A, label: "Rosa" }]);
  assert.deepEqual(cliWorkspaceChoices(items, new Set()), []);
});

test("i nomi uguali si distinguono con la data e, se serve, con l'inizio dell'id", () => {
  const items = [
    ws(A, "NATIVA", "Supersapiens", "2026-04-14T09:00:00Z"),
    ws(B, "NATIVA", "Supersapiens", "2026-04-14T15:00:00Z"),
    ws(C, "NATIVA", "Supersapiens", "2026-04-10T09:00:00Z"),
    ws(D, "Supersapiens", "Supersapiens", "2026-04-10T09:00:00Z"),
  ];
  const choices = cliWorkspaceChoices(items, new Set([A, B, C, D]));
  assert.deepEqual(choices, [
    { id: C, label: "NATIVA · Supersapiens · creato il 10 apr 2026" },
    { id: A, label: "NATIVA · Supersapiens · creato il 14 apr 2026 · aaaaaaaa" },
    { id: B, label: "NATIVA · Supersapiens · creato il 14 apr 2026 · bbbbbbbb" },
    { id: D, label: "Supersapiens" },
  ]);
  assert.equal(new Set(choices.map((c) => c.label)).size, choices.length, "ogni voce si riconosce");
});

test("id in maiuscolo e spazi nei nomi non fanno doppioni", () => {
  const choices = cliWorkspaceChoices([ws(A.toUpperCase(), "  Rosa   blu ", "Rosa  blu", "2026-10-01T10:00:00Z")], new Set([A]));
  assert.deepEqual(choices, [{ id: A, label: "Rosa blu" }]);
});
