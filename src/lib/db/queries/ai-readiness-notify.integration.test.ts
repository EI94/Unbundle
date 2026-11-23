import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

// (Rilascio 10, ondata 7b) Le nuove risposte all'AI Readiness in campanella, sul database del pacchetto
// (`ai-readiness-notify.ts` e `signals.ts`, accanto): una riga per rilevazione aggiornata sul posto, che torna non letta
// e in cima; la riga della soglia una volta sola; la vede solo chi gestisce il workspace, mai chi valuta o contribuisce;
// (revisione 7b) il numero è sempre quello dei questionari inviati, anche con invii nello stesso istante e con un numero
// già superato; una rilevazione eliminata porta via le sue righe.
// Con scripts/use-case-test/run-db-tests.mjs. Dati inventati, creati e cancellati qui. Nessuna email.

const url = process.env.DATABASE_URL;
const enabled = process.env.HUB_TEST_ISOLATED === "true" && Boolean(url) && new URL(url!).hostname === "127.0.0.1";
const opts = { skip: !enabled };

type Row = Record<string, unknown>;
const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), lead: randomUUID() };
let q: (text: string, params?: unknown[]) => Promise<Row[]>;
let notify: typeof import("./ai-readiness-notify.ts");
let signals: typeof import("./signals.ts");
let first = "";
let second = "";

before(async () => {
  if (!enabled) return;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Row[]>;
  const { ensureDbSchema } = await import("../ensure-schema.ts");
  await ensureDbSchema();
  notify = await import("./ai-readiness-notify.ts");
  signals = await import("./signals.ts");
  const air = await import("./ai-readiness.ts");
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova AI Readiness', $2)`, [ids.org, `org-air-${suffix}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Cliente di prova AI Readiness')`, [ids.ws, ids.org]);
  await q(`INSERT INTO users (id, email, name) VALUES ($1, $2, 'Prova Responsabile')`, [ids.lead, `prova-air-${suffix}@esempio.test`]);
  const template = await air.ensureAiReadinessSystemTemplate();
  const make = async (name: string) =>
    (await air.createAiReadinessAssessment({ organizationId: ids.org, workspaceId: ids.ws, templateId: template.id, name, status: "open" })).id;
  first = await make("Rilevazione di prova");
  second = await make("Seconda rilevazione di prova");
});

after(async () => {
  if (!enabled) return;
  await q(`DELETE FROM workspaces WHERE id = $1`, [ids.ws]);
  await q(`DELETE FROM organizations WHERE id = $1`, [ids.org]);
  await q(`DELETE FROM users WHERE id = $1`, [ids.lead]);
});

/** `n` questionari inviati in più sulla rilevazione (persone e risposte inventate). */
async function submit(assessmentId: string, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    const pseudo = randomBytes(12).toString("hex");
    const [respondent] = await q(
      `INSERT INTO ai_readiness_respondents (assessment_id, organization_id, workspace_id, invite_token_hash, invite_status, survey_track, pseudonymous_id)
       VALUES ($1, $2, $3, $4, 'completed', 'everyone', $5) RETURNING id`,
      [assessmentId, ids.org, ids.ws, randomBytes(32).toString("hex"), pseudo],
    );
    await q(`INSERT INTO ai_readiness_responses (assessment_id, respondent_id, pseudonymous_id, status, answers, submitted_at) VALUES ($1, $2, $3, 'submitted', '[]'::jsonb, now())`, [
      assessmentId,
      respondent.id,
      pseudo,
    ]);
  }
}

const notice = (assessmentId: string, responses: number) => ({ workspaceId: ids.ws, assessmentId, name: "Rilevazione di prova", responses, expected: 40, threshold: 5 });

async function rows(assessmentId: string): Promise<Row[]> {
  return q(
    `SELECT id, signal_type, title, description, is_read, created_at FROM weekly_signals
     WHERE workspace_id = $1 AND related_entity_type = 'ai_readiness_assessment' AND related_entity_id = $2 ORDER BY signal_type`,
    [ids.ws, assessmentId],
  );
}

test("one row per assessment, updated in place: today's number, back on top and unread; the threshold row once", opts, async () => {
  await submit(first, 4);
  await notify.notifyReadinessResponse(notice(first, 4));
  let got = await rows(first);
  assert.deepEqual(got.map((r) => [r.signal_type, r.description]), [["ai_readiness_risposte", "«Rilevazione di prova»: 4 risposte su 40 attese."]]);
  const answersId = got[0].id as string;
  const firstAt = new Date(String(got[0].created_at)).getTime();
  // Chi gestisce l'ha letta.
  await q(`INSERT INTO weekly_signal_reads (signal_id, user_id, workspace_id) VALUES ($1, $2, $3)`, [answersId, ids.lead, ids.ws]);
  await new Promise((resolve) => setTimeout(resolve, 20));

  await submit(first, 1);
  await notify.notifyReadinessResponse(notice(first, 5));
  got = await rows(first);
  assert.deepEqual(
    got.map((r) => [r.signal_type, r.description]),
    [
      ["ai_readiness_risposte", "«Rilevazione di prova»: 5 risposte su 40 attese."],
      ["ai_readiness_soglia", "«Rilevazione di prova»: 5 risposte, abbastanza per i risultati per area e per la sintesi."],
    ],
  );
  assert.equal(got[0].id, answersId, "la stessa riga");
  assert.ok(new Date(String(got[0].created_at)).getTime() >= firstAt, "torna in cima");
  assert.equal((await q(`SELECT count(*)::int AS n FROM weekly_signal_reads WHERE signal_id = $1`, [answersId]))[0].n, 0, "torna non letta");

  await submit(first, 1);
  await notify.notifyReadinessResponse(notice(first, 6));
  got = await rows(first);
  assert.equal(got.length, 2, "la soglia non si ripete");
  assert.equal(got[1].description, "«Rilevazione di prova»: 5 risposte, abbastanza per i risultati per area e per la sintesi.", "la soglia resta quella del momento in cui è arrivata");
  assert.equal(got[0].description, "«Rilevazione di prova»: 6 risposte su 40 attese.");
});

test("(revisione 7b) answers at the same instant: one row, and its number is the final count, never a stale one", opts, async () => {
  // Dieci questionari inviati; gli avvisi arrivano insieme e in disordine, ognuno con il numero che ha visto.
  await submit(second, 10);
  const seen = [3, 10, 7, 1, 9, 10, 2, 8, 5, 6, 4];
  await Promise.all(seen.map((n) => notify.notifyReadinessResponse(notice(second, n))));
  let got = await rows(second);
  assert.deepEqual(got.map((r) => r.signal_type), ["ai_readiness_risposte", "ai_readiness_soglia"], "mai una riga per risposta");
  assert.equal(got[0].description, "«Rilevazione di prova»: 10 risposte su 40 attese.");
  // Un avviso arrivato tardi con un numero già superato non scrive niente: «9» non copre «10».
  await notify.notifyReadinessResponse(notice(second, 9));
  got = await rows(second);
  assert.equal(got[0].description, "«Rilevazione di prova»: 10 risposte su 40 attese.");
  // Due invii, poi i loro avvisi insieme: scrive solo quello che porta il totale.
  await submit(second, 2);
  await Promise.all([notify.notifyReadinessResponse(notice(second, 11)), notify.notifyReadinessResponse(notice(second, 12))]);
  got = await rows(second);
  assert.equal(got[0].description, "«Rilevazione di prova»: 12 risposte su 40 attese.");
});

test("only whoever manages the workspace sees them; reviewers, contributors and nobody else do not", opts, async () => {
  const types = async (role: string | null) =>
    new Set((await signals.getSignalsForBell({ workspaceId: ids.ws, role, userId: ids.lead, limit: 50 })).map((s) => s.signalType));
  for (const role of ["exec_sponsor", "transformation_lead"]) {
    const seen = await types(role);
    assert.ok(seen.has("ai_readiness_risposte") && seen.has("ai_readiness_soglia"), role);
  }
  for (const role of ["function_lead", "analyst", "contributor", "learner", null]) {
    const seen = await types(role);
    assert.ok(!seen.has("ai_readiness_risposte") && !seen.has("ai_readiness_soglia"), String(role));
  }
  // Chi non le vede non le segna nemmeno lette.
  const [answers] = await rows(first);
  assert.equal(await signals.markSignalsReadForUser({ workspaceId: ids.ws, userId: ids.lead, role: "analyst", signalIds: [answers.id as string] }), 0);
  assert.equal(await signals.markSignalsReadForUser({ workspaceId: ids.ws, userId: ids.lead, role: "transformation_lead", signalIds: [answers.id as string] }), 1);
});

test("a deleted assessment takes its rows away, and only its own", opts, async () => {
  await notify.deleteReadinessBell({ workspaceId: ids.ws, assessmentId: first });
  assert.deepEqual(await rows(first), []);
  assert.equal((await rows(second)).length, 2);
});
