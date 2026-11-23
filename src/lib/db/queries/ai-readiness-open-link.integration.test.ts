import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

// (Rilascio 10, ondata 7b) Il link per tutti sul database del pacchetto (`ai-readiness.ts`, accanto): «Copia il link per
// tutti» aggiunge un token che vale insieme a quelli di prima, «Crea un link nuovo» li ritira tutti, senza link non si
// copia niente; le copie restano al massimo `OPEN_LINK_COPIES_MAX`; le altre chiavi di `scoringConfig` (le risposte
// attese, le domande modificate) non si perdono mai, anche scritte nello stesso istante.
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
  for (const h of [hash(10), hash(11), hash(12)]) assert.equal((await air.getAssessmentByOpenLinkTokenHash(h))?.assessment.id, assessmentId, h.slice(-2));
  const config = (await air.getAssessmentBundleById(assessmentId))!.assessment.scoringConfig as Record<string, unknown>;
  assert.equal(config.expectedRespondents, 40, "le altre chiavi restano");
  assert.deepEqual(config.openLinkQuestionScope, { sectionIds: ["s1"] }, "le domande del link restano quelle scelte");

  await air.setAssessmentOpenLinkTokenHash(assessmentId, hash(20), null);
  for (const h of [hash(10), hash(11), hash(12)]) assert.equal(await air.getAssessmentByOpenLinkTokenHash(h), null, `${h.slice(-2)} ritirato`);
  assert.equal((await air.getAssessmentByOpenLinkTokenHash(hash(20)))?.assessment.id, assessmentId);
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
  for (const h of [hash(20), hash(31), hash(32), hash(33)]) assert.equal((await air.getAssessmentByOpenLinkTokenHash(h))?.assessment.id, assessmentId, h.slice(-2));
});

test(`at most ${100} copies stay valid: the oldest one goes first`, opts, async () => {
  await air.setAssessmentOpenLinkTokenHash(assessmentId, hash(1000), null);
  for (let i = 1; i <= air.OPEN_LINK_COPIES_MAX + 2; i++) await air.addAssessmentOpenLinkTokenHash(assessmentId, hash(1000 + i));
  const list = ((await air.getAssessmentBundleById(assessmentId))!.assessment.scoringConfig as { openLinkTokenHashes: string[] }).openLinkTokenHashes;
  assert.equal(list.length, air.OPEN_LINK_COPIES_MAX);
  assert.equal(list[0], hash(1003), "le due più vecchie sono uscite");
  assert.equal(list.at(-1), hash(1000 + air.OPEN_LINK_COPIES_MAX + 2), "l'ultima copia è in fondo");
  assert.equal(await air.getAssessmentByOpenLinkTokenHash(hash(1001)), null);
  assert.equal((await air.getAssessmentByOpenLinkTokenHash(hash(1000)))?.assessment.id, assessmentId, "il link creato resta valido");
});
