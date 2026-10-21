import test from "node:test";
import assert from "node:assert/strict";
import { USE_CASE_HUB_UC_INDEX_SQL } from "../../db/use-case-hub-ddl.ts";
import {
  DELETE_STALE_INCOMPLETE_SQL,
  DETACH_COMPLETE_SQL,
  DUPLICATE_CARDS_SQL,
  STALE_INCOMPLETE_INTERVAL_SQL,
  describeGroups,
  dossierRowFrom,
  duplicateRowsSql,
  groupDuplicates,
  parseDetachList,
  planDossierDups,
  type DossierRow,
} from "./dossier-dups.ts";

// use-case-admin dossier-dups (docs/use-case/DESIGN.md §10.4 punto 1). Id e codici inventati.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const WS = id(900);
const CARD_A = id(100);
const CARD_B = id(200);
const CARD_C = id(300);

function row(caseId: string, useCaseId: string, opts: Partial<DossierRow> = {}): DossierRow {
  return { caseId, workspaceId: WS, useCaseId, code: `XX-${caseId.slice(-4)}`, complete: true, stale: false, createdAt: "2026-10-01 09:00", ...opts };
}

const squash = (sql: string) => sql.replace(/\s+/g, " ").trim();

test("la condizione dei doppioni è quella della 0020: righe complete e incomplete", () => {
  const body = squash(DUPLICATE_CARDS_SQL);
  assert.equal(body, "SELECT portfolio_use_case_id FROM uc_cases WHERE portfolio_use_case_id IS NOT NULL GROUP BY portfolio_use_case_id HAVING count(*) > 1");
  assert.ok(squash(USE_CASE_HUB_UC_INDEX_SQL).includes(body.replace("SELECT portfolio_use_case_id", "SELECT 1")), "stessa condizione della migrazione");
  assert.doesNotMatch(body, /setup_completed_at/, "nessun filtro sui dossier completi");
});

test("cancella con la regola dell'app: incompleta e ferma da oltre 10 minuti", () => {
  assert.equal(STALE_INCOMPLETE_INTERVAL_SQL, "interval '10 minutes'");
  const del = squash(DELETE_STALE_INCOMPLETE_SQL);
  assert.match(del, /setup_completed_at IS NULL AND created_at < now\(\) - interval '10 minutes'/);
  assert.match(squash(duplicateRowsSql(true)), /AND c\.workspace_id = \$1::uuid ORDER BY/);
  assert.doesNotMatch(duplicateRowsSql(false), /\$1/);
});

test("righe del database: booleani solo se veri", () => {
  const parsed = dossierRowFrom({ case_id: id(1), workspace_id: WS, use_case_id: CARD_A, code: "XX-0001", complete: true, stale: "true", created_at: "2026-10-01 09:00" });
  assert.equal(parsed.complete, true);
  assert.equal(parsed.stale, false);
});

test("gruppi: solo le schede con almeno due dossier, in ordine di data", () => {
  const groups = groupDuplicates([
    row(id(3), CARD_A, { createdAt: "2026-10-02 10:00" }),
    row(id(1), CARD_B),
    row(id(2), CARD_A, { createdAt: "2026-10-01 10:00" }),
    row(id(4), CARD_C, { createdAt: "2026-09-01 10:00" }),
    row(id(5), CARD_C, { createdAt: "2026-09-01 10:00" }),
  ]);
  assert.deepEqual(
    groups.map((g) => [g.useCaseId, g.rows.map((r) => r.caseId)]),
    [
      [CARD_C, [id(4), id(5)]],
      [CARD_A, [id(2), id(3)]],
    ],
  );
});

test("--detach: uno o più id separati da virgole", () => {
  assert.deepEqual(parseDetachList(null), { ok: true, ids: [] });
  assert.deepEqual(parseDetachList(`${id(1).toUpperCase()}, ${id(2)},${id(1)}`), { ok: true, ids: [id(1), id(2)] });
  assert.equal(parseDetachList("").ok, false);
  assert.equal(parseDetachList("caso-1").ok, false);
});

test("piano: l'incompleta ferma si cancella, la recente attende, la completa resta", () => {
  const groups = groupDuplicates([
    row(id(1), CARD_A),
    row(id(2), CARD_A, { complete: false, stale: true, createdAt: "2026-10-01 09:05" }),
    row(id(3), CARD_B),
    row(id(4), CARD_B, { complete: false, stale: false, createdAt: "2026-10-01 09:05" }),
  ]);
  const planned = planDossierDups(groups);
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  assert.deepEqual(planned.plan.deletions, [id(2)]);
  assert.deepEqual(planned.plan.detaches, []);
  assert.equal(planned.plan.unresolved, 1, "la scheda B ha ancora un dossier in creazione");
  const described = describeGroups(planned.plan);
  assert.deepEqual(
    described.map((g) => g.dossier.map((d) => [d.codice, d.stato, d.azione])),
    [
      [
        ["XX-0001", "completo", "resta"],
        ["XX-0002", "incompleto", "cancella"],
      ],
      [
        ["XX-0003", "completo", "resta"],
        ["XX-0004", "incompleto", "attende"],
      ],
    ],
  );
  assert.deepEqual(described.map((g) => g.risolto), [true, false]);
});

test("piano: due completi, --detach ne stacca uno e il gruppo è risolto", () => {
  const groups = groupDuplicates([row(id(1), CARD_A), row(id(2), CARD_A, { createdAt: "2026-10-01 09:01" })]);
  const before = planDossierDups(groups);
  assert.equal(before.ok && before.plan.unresolved, 1, "senza --detach restano due dossier collegati");
  const planned = planDossierDups(groups, [id(2)]);
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  assert.deepEqual(planned.plan.detaches, [id(2)]);
  assert.equal(planned.plan.unresolved, 0);
});

test("--detach rifiutato fuori dai gruppi, su un incompleto o se la scheda resta senza dossier", () => {
  const groups = groupDuplicates([
    row(id(1), CARD_A),
    row(id(2), CARD_A, { createdAt: "2026-10-01 09:01" }),
    row(id(3), CARD_B),
    row(id(4), CARD_B, { complete: false, stale: true, createdAt: "2026-10-01 09:01" }),
  ]);
  assert.equal(planDossierDups(groups, [id(99)]).ok, false, "non è un doppione");
  assert.equal(planDossierDups(groups, [id(4)]).ok, false, "incompleto: si cancella da solo");
  assert.equal(planDossierDups(groups, [id(1), id(2)]).ok, false, "la scheda A resterebbe senza dossier");
  assert.equal(planDossierDups(groups, [id(3)]).ok, false, "la B ha solo un incompleto da cancellare oltre a lui");
  assert.equal(planDossierDups(groups, [id(1)]).ok, true);
});

test("--detach rifiutato se resta collegata solo un'incompleta recente: non è un dossier", () => {
  const groups = groupDuplicates([
    row(id(1), CARD_A),
    row(id(2), CARD_A, { complete: false, stale: false, createdAt: "2026-10-01 09:05" }),
  ]);
  const planned = planDossierDups(groups, [id(1)]);
  assert.equal(planned.ok, false, "l'incompleta poi si cancella e la scheda resterebbe senza dossier");
  if (!planned.ok) assert.match(planned.message, /senza un dossier completo collegato/);
  const waiting = planDossierDups(groups);
  assert.equal(waiting.ok && waiting.plan.unresolved, 1, "senza --detach si aspetta la creazione in corso");
});

test("SQL: si stacca solo se un altro dossier completo, non staccato, resta sulla scheda", () => {
  const sql = squash(DETACH_COMPLETE_SQL);
  assert.match(sql, /AND EXISTS \(SELECT 1 FROM uc_cases k WHERE k\.portfolio_use_case_id = c\.portfolio_use_case_id AND k\.setup_completed_at IS NOT NULL AND NOT \(k\.id = ANY\(\$1::uuid\[\]\)\)\)/);
});
