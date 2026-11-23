import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

// (Rilascio 10, ondata 7b) Il link per tutti sul database del pacchetto (`ai-readiness.ts`, accanto): «Copia il link per
// tutti» aggiunge un token che vale insieme al link creato, «Crea un link nuovo» li ritira tutti, senza link non si copia
// niente; le altre chiavi di `scoringConfig` (le risposte attese, le domande modificate) non si perdono mai, anche
// scritte nello stesso istante. (Revisione 7b) Oltre `OPEN_LINK_COPIES_MAX` esce la copia meno usata di recente, prima
// quelle che nessuno ha usato: la copia mandata a tutti il primo giorno, che le persone usano, resta valida dopo molte
// copie nuove, e il link creato non esce mai.
// Con scripts/use-case-test/run-db-tests.mjs. Dati inventati, creati e cancellati qui.

const url = process.env.DATABASE_URL;
const enabled = process.env.HUB_TEST_ISOLATED === "true" && Boolean(url) && new URL(url!).hostname === "127.0.0.1";
const opts = { skip: !enabled };

type Row = Record<string, unknown>;
const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID() };
let q: (text: string, params?: unknown[]) => Promise<Row[]>;
let air: typeof import("./ai-readiness.ts");
let assessmentId = "";

const hash = (n: number) => n.toString(16).padStart(64, "0");
const DAY = 86_400_000;
const day = (n: number) => new Date(Date.UTC(2026, 10, 1) + n * DAY);
const valid = async (h: string) => (await air.getAssessmentByOpenLinkTokenHash(h))?.assessment.id === assessmentId;
const copies = async () => ((await air.getAssessmentBundleById(assessmentId))!.assessment.scoringConfig as { openLinkCopies: Array<{ h: string; c: string; u: string | null }> }).openLinkCopies;

before(async () => {
  if (!enabled) return;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Row[]>;
  air = await import("./ai-readiness.ts");
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova link per tutti', $2)`, [ids.org, `org-air-link-${suffix}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Cliente di prova link per tutti')`, [ids.ws, ids.org]);
  const template = await air.ensureAiReadinessSystemTemplate();
  const created = await air.createAiReadinessAssessment({
    organizationId: ids.org,
    workspaceId: ids.ws,
    templateId: template.id,
    name: "Rilevazione di prova",
    status: "open",
    scoringConfig: { version: "ai-readiness-core-1", expectedRespondents: 40 },
  });
  assessmentId = created.id;
});

after(async () => {
  if (!enabled) return;
  await q(`DELETE FROM workspaces WHERE id = $1`, [ids.ws]);
  await q(`DELETE FROM organizations WHERE id = $1`, [ids.org]);
});

test("without a link nothing is copied; a copy is one more token for the same link; a new link retires them all", opts, async () => {
  assert.equal(await air.addAssessmentOpenLinkTokenHash(assessmentId, hash(1)), false, "senza link niente copia");
  assert.equal(await air.getAssessmentByOpenLinkTokenHash(hash(1)), null);

  await air.setAssessmentOpenLinkTokenHash(assessmentId, hash(10), { sectionIds: ["s1"] });
  assert.equal(await air.addAssessmentOpenLinkTokenHash(assessmentId, hash(11)), true);
  assert.equal(await air.addAssessmentOpenLinkTokenHash(assessmentId, hash(12)), true);
  for (const h of [hash(10), hash(11), hash(12)]) assert.ok(await valid(h), h.slice(-2));
  const config = (await air.getAssessmentBundleById(assessmentId))!.assessment.scoringConfig as Record<string, unknown>;
  assert.equal(config.expectedRespondents, 40, "le altre chiavi restano");
  assert.deepEqual(config.openLinkQuestionScope, { sectionIds: ["s1"] }, "le domande del link restano quelle scelte");
  assert.deepEqual((await copies()).map((c) => [c.h, c.u]), [[hash(11), null], [hash(12), null]], "una copia nasce mai usata");

  await air.setAssessmentOpenLinkTokenHash(assessmentId, hash(20), null);
  for (const h of [hash(10), hash(11), hash(12)]) assert.equal(await valid(h), false, `${h.slice(-2)} ritirato`);
  assert.ok(await valid(hash(20)));
  assert.deepEqual(await copies(), []);
});

test("copies, the expected answers and the edited questions written at the same instant: none is lost", opts, async () => {
  await Promise.all([
    air.addAssessmentOpenLinkTokenHash(assessmentId, hash(31)),
    air.mergeAssessmentScoringConfig(assessmentId, { expectedRespondents: 55 }),
    air.addAssessmentOpenLinkTokenHash(assessmentId, hash(32)),
    air.setAssessmentTemplateOverrides(assessmentId, { removed: ["q1"], edited: {}, added: [] }),
    air.addAssessmentOpenLinkTokenHash(assessmentId, hash(33)),
  ]);
  const config = (await air.getAssessmentBundleById(assessmentId))!.assessment.scoringConfig as Record<string, unknown>;
  assert.equal(config.expectedRespondents, 55);
  assert.deepEqual((config.templateOverrides as { removed: string[] }).removed, ["q1"]);
  for (const h of [hash(20), hash(31), hash(32), hash(33)]) assert.ok(await valid(h), h.slice(-2));
});

test("(revisione 7b) the day-1 copy that respondents use survives many new copies; the unused ones go first", opts, async () => {
  await air.setAssessmentOpenLinkTokenHash(assessmentId, hash(1000), null);
  // Giorno 1: la copia mandata a tutti, e una copia che nessuno usa.
  await air.addAssessmentOpenLinkTokenHash(assessmentId, hash(1001), day(1));
  await air.addAssessmentOpenLinkTokenHash(assessmentId, hash(1002), day(1));
  assert.equal(await air.touchAssessmentOpenLinkCopy(assessmentId, hash(1001), day(1)), true);
  assert.equal(await air.touchAssessmentOpenLinkCopy(assessmentId, hash(1000), day(1)), false, "il link creato non è una copia: non esce mai");
  assert.equal(await air.touchAssessmentOpenLinkCopy(assessmentId, hash(9999), day(1)), false, "un hash che non c'è non scrive niente");
  // Poi, per settimane, molte copie nuove che nessuno usa; la copia del primo giorno serve una volta sola, all'inizio.
  for (let i = 0; i < air.OPEN_LINK_COPIES_MAX + 30; i++) {
    await air.addAssessmentOpenLinkTokenHash(assessmentId, hash(2000 + i), new Date(day(2).getTime() + i * 3_600_000));
  }
  const list = await copies();
  assert.equal(list.length, air.OPEN_LINK_COPIES_MAX);
  assert.ok(await valid(hash(1001)), "la copia usata dalle persone resta valida");
  assert.ok(await valid(hash(1000)), "il link creato resta valido");
  assert.equal(await valid(hash(1002)), false, "la copia mai usata del primo giorno è uscita per prima");
  assert.equal(await valid(hash(2000)), false, "poi le copie mai usate più vecchie");
  assert.ok(await valid(hash(2000 + air.OPEN_LINK_COPIES_MAX + 29)), "l'ultima copia c'è");
  assert.equal(list.find((c) => c.h === hash(1001))?.u, day(1).toISOString());
});

test("(revisione 7b) among used copies, the least recently used one goes: a copy still in use stays", opts, async () => {
  await air.setAssessmentOpenLinkTokenHash(assessmentId, hash(3000), null);
  for (let i = 1; i <= air.OPEN_LINK_COPIES_MAX; i++) {
    await air.addAssessmentOpenLinkTokenHash(assessmentId, hash(3000 + i), day(1));
    await air.touchAssessmentOpenLinkCopy(assessmentId, hash(3000 + i), new Date(day(1).getTime() + i * 60_000));
  }
  // La prima copia torna a servire oggi: è la più recente, non la più vecchia.
  await air.touchAssessmentOpenLinkCopy(assessmentId, hash(3001), day(30));
  await air.addAssessmentOpenLinkTokenHash(assessmentId, hash(3999), day(31));
  assert.ok(await valid(hash(3001)), "usata di recente: resta");
  assert.equal(await valid(hash(3002)), false, "la meno usata di recente è uscita");
  assert.ok(await valid(hash(3999)));
});
