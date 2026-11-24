import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

// (0044) Le email dell'AI Readiness sul database del pacchetto, dalla risposta inviata all'invio con un mailer finto
// (nessuna email parte mai):
// - la 0044: il file due volte e il self-heal due volte non cambiano niente; la sonda;
// - la coda dalle risposte inviate: una riga per chi gestisce e può riceverle (il ruolo dell'organizzazione o del
//   workspace), mai per nessun altro; l'ok del cliente sui sub-responsabili per le persone del cliente; la scelta;
// - un'email al giorno per rilevazione e persona, anche con molte risposte, solo conteggi; il giorno dopo le nuove;
// - i risultati una volta, prima delle risposte nel giorno in cui partono tutte e due;
// - mai due volte: un esito incerto e un tentativo interrotto non si ripetono; un errore certo sì;
// - il cron dei giorni feriali (`use-case-referents`) le manda con il mailer finto.
// Con scripts/use-case-test/run-db-tests.mjs. Dati inventati, creati e cancellati qui.

const url = process.env.DATABASE_URL;
const enabled = process.env.HUB_TEST_ISOLATED === "true" && Boolean(url) && new URL(url!).hostname === "127.0.0.1";
const opts = { skip: !enabled };

type Row = Record<string, unknown>;
type Mail = import("../../uc/notify/dispatch.ts").OutgoingEmail;
type MailResult = import("../../uc/notify/dispatch.ts").MailResult;
let q: (text: string, params?: unknown[]) => Promise<Row[]>;
let air: typeof import("./ai-readiness.ts");
let notify: typeof import("./ai-readiness-notify.ts");
let mail: typeof import("./ai-readiness-email.ts");
let ensure: typeof import("../ensure-schema.ts");
let calendar: typeof import("../../uc/calendar.ts");
let ddl: typeof import("../ai-readiness-email-ddl.ts");
let referents: typeof import("./use-case-referents.ts");

const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID() };
type Person = "lead" | "wsLead" | "sponsor" | "unverified" | "off" | "analyst" | "functionLead" | "contributor" | "learner" | "caseOnly" | "outsider";
/** Chi c'è: il ruolo nell'organizzazione (`org`) o solo nel workspace (`ws`); `ls`: un'email di Lateral Space. */
const PEOPLE: Record<Person, { org?: string; ws?: string; ls: boolean; unverified?: boolean }> = {
  lead: { org: "transformation_lead", ls: true },
  wsLead: { ws: "transformation_lead", ls: true },
  sponsor: { org: "exec_sponsor", ls: false },
  unverified: { org: "transformation_lead", ls: true, unverified: true },
  off: { org: "exec_sponsor", ls: true },
  analyst: { org: "analyst", ls: true },
  functionLead: { org: "function_lead", ls: true },
  contributor: { ws: "contributor", ls: false },
  learner: { ws: "learner", ls: false },
  caseOnly: { ws: "esterno_caso", ls: false },
  outsider: { ls: true },
};
const userIds = Object.fromEntries(Object.keys(PEOPLE).map((p) => [p, randomUUID()])) as Record<Person, string>;
const emailOf = (p: Person) => `${p.toLowerCase()}.air.${suffix}@${PEOPLE[p].ls ? "ls.test" : "cliente.test"}`;
const SEND_ENV: Record<string, string | undefined> = {
  RESEND_API_KEY: "re_test_finto",
  UC_EMAIL_FROM: "Lateral Space via Unbundle <avvisi@notifiche.example.test>",
  UC_EMAIL_REPLY_TO: "persona@example.test",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  UC_LS_EMAIL_DOMAINS: "ls.test",
};
const envBefore = { UC_LS_EMAIL_DOMAINS: process.env.UC_LS_EMAIL_DOMAINS, VERCEL_ENV: process.env.VERCEL_ENV };
let templateId = "";

before(async () => {
  if (!enabled) return;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Row[]>;
  process.env.UC_LS_EMAIL_DOMAINS = "ls.test";
  delete process.env.VERCEL_ENV;
  ensure = await import("../ensure-schema.ts");
  // Il modello ha la 0042: il codice di adesso applica la 0043 e la 0044 su questa copia.
  await ensure.ensureDbSchema();
  air = await import("./ai-readiness.ts");
  notify = await import("./ai-readiness-notify.ts");
  mail = await import("./ai-readiness-email.ts");
  calendar = await import("../../uc/calendar.ts");
  ddl = await import("../ai-readiness-email-ddl.ts");
  referents = await import("./use-case-referents.ts");
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova email AI Readiness', $2)`, [ids.org, `org-air-mail-${suffix}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Cliente Demo')`, [ids.ws, ids.org]);
  for (const [person, p] of Object.entries(PEOPLE) as [Person, (typeof PEOPLE)[Person]][]) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1, $2, 'Persona di prova', ${p.unverified ? "NULL" : "now()"})`, [userIds[person], emailOf(person)]);
    if (p.org) await q(`INSERT INTO memberships (user_id, organization_id, role) VALUES ($1, $2, $3::member_role)`, [userIds[person], ids.org, p.org]);
    if (p.ws) await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, $3::member_role)`, [ids.ws, userIds[person], p.ws]);
  }
  // Chi le ha spente dal suo account.
  assert.equal(await mail.setReadinessEmails(ids.ws, userIds.off, false), false);
  templateId = (await air.ensureAiReadinessSystemTemplate()).id;
});

after(async () => {
  if (!enabled) return;
  await q(`DELETE FROM workspaces WHERE id = $1`, [ids.ws]);
  await q(`DELETE FROM organizations WHERE id = $1`, [ids.org]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [Object.values(userIds)]);
  process.env.UC_LS_EMAIL_DOMAINS = envBefore.UC_LS_EMAIL_DOMAINS;
  if (envBefore.VERCEL_ENV === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = envBefore.VERCEL_ENV;
});

async function assessment(name: string, threshold: number): Promise<string> {
  const created = await air.createAiReadinessAssessment({
    organizationId: ids.org,
    workspaceId: ids.ws,
    templateId,
    name,
    status: "open",
    aggregationThreshold: threshold,
    scoringConfig: { expectedRespondents: 40 },
  });
  return created.id;
}

/**
 * Un questionario inviato, come lo scrive l'app (persona e risposte inventate, `submitted_at` in UTC come lo scrive
 * Drizzle), poi l'avviso come lo manda l'azione dopo la risposta: il numero ricontato, l'istante dell'invio.
 */
async function answer(assessmentId: string, threshold: number): Promise<void> {
  const submittedAt = new Date(Date.now() - 1000);
  const pseudo = randomBytes(12).toString("hex");
  const [respondent] = await q(
    `INSERT INTO ai_readiness_respondents (assessment_id, organization_id, workspace_id, invite_token_hash, invite_status, survey_track, pseudonymous_id)
     VALUES ($1, $2, $3, $4, 'completed', 'everyone', $5) RETURNING id`,
    [assessmentId, ids.org, ids.ws, randomBytes(32).toString("hex"), pseudo],
  );
  await q(
    `INSERT INTO ai_readiness_responses (assessment_id, respondent_id, pseudonymous_id, status, answers, submitted_at) VALUES ($1, $2, $3, 'submitted', '[]'::jsonb, now() AT TIME ZONE 'UTC')`,
    [assessmentId, respondent.id, pseudo],
  );
  // Il numero che l'azione ricalcola dopo l'invio: i questionari inviati della rilevazione.
  const [{ n }] = await q(`SELECT count(*)::int AS n FROM ai_readiness_responses WHERE assessment_id = $1 AND status = 'submitted'`, [assessmentId]);
  await notify.notifyReadinessResponse({ workspaceId: ids.ws, assessmentId, name: "Questionario per tutti", responses: Number(n), expected: 40, threshold, submittedAt });
}

async function rows(assessmentId: string): Promise<Array<{ person: Person; kind: string; status: string; reason: string | null }>> {
  const found = await q(
    `SELECT e.recipient_user_id, e.kind, e.status, e.cancel_reason FROM ai_readiness_alert_emails e WHERE e.assessment_id = $1 ORDER BY e.created_at, e.kind, e.recipient_user_id`,
    [assessmentId],
  );
  const byId = new Map(Object.entries(userIds).map(([person, id]) => [id, person as Person]));
  return found.map((r) => ({ person: byId.get(String(r.recipient_user_id))!, kind: String(r.kind), status: String(r.status), reason: r.cancel_reason === null ? null : String(r.cancel_reason) }));
}

const pending = async (assessmentId: string) => (await rows(assessmentId)).filter((r) => r.status === "in_coda" || r.status === "errore");
const people = (list: Array<{ person: Person }>) => [...new Set(list.map((r) => r.person))].sort();

/** Un istante nella finestra di Roma, adesso o all'inizio della prossima: le righe di adesso sono già dovute. */
function windowNow(): Date {
  const now = new Date();
  return calendar.inRomeSendWindow(now) ? now : new Date(calendar.nextRomeSendWindowStart(now).getTime() + 60_000);
}

function fakeMailer(results: MailResult[] = []) {
  const outbox: Array<{ mail: Mail; key: string }> = [];
  return {
    outbox,
    async send(m: Mail, options: { idempotencyKey: string }) {
      outbox.push({ mail: m, key: options.idempotencyKey });
      return results.shift() ?? ({ ok: true } as const);
    },
  };
}

/** Solo le email di questa prova (il giro manda tutta la coda del database). */
const ours = (outbox: Array<{ mail: Mail; key: string }>) => outbox.filter((o) => o.mail.to.endsWith(`.air.${suffix}@ls.test`) || o.mail.to.endsWith(`.air.${suffix}@cliente.test`));
const to = (p: Person) => emailOf(p);

/** «Ieri»: le email partite oggi diventano di ieri, così il limite del giorno lascia partire la prossima. */
async function nextDay(): Promise<void> {
  await q(`UPDATE ai_readiness_alert_emails SET sent_at = sent_at - interval '1 day' WHERE workspace_id = $1 AND status = 'inviata'`, [ids.ws]);
}

const dispatch = (mailer: ReturnType<typeof fakeMailer>, now = windowNow()) => mail.dispatchReadinessEmails({ env: SEND_ENV, now, mailer, sendIntervalMs: 0 });

test("0044: il file due volte e il self-heal due volte non cambiano niente; la sonda è vera, falsa senza un pezzo, di nuovo vera", opts, async () => {
  const probe = async () => (await q(`SELECT ${ddl.AIR_EMAIL_PROBE_SQL} AS ok`))[0].ok;
  const snapshot = async () =>
    JSON.stringify({
      columns: await q(`SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name IN ('ai_readiness_alert_emails', 'workspace_bell_state') ORDER BY table_name, ordinal_position`),
      constraints: await q(`SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'public.ai_readiness_alert_emails'::regclass ORDER BY 1`),
      indexes: await q(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'ai_readiness_alert_emails' ORDER BY 1`),
    });
  assert.equal(await probe(), true);
  const first = await snapshot();
  await ensure.runAirEmailDdl();
  await ensure.runAirEmailDdl();
  const migration = readFileSync(new URL("../../../../drizzle/0044_avvisi_ai_readiness.sql", import.meta.url), "utf8");
  await q(migration);
  await q(migration);
  assert.equal(await snapshot(), first);
  assert.equal(await probe(), true);
  // La colonna della scelta: accesa per default, in fondo alla tabella della 0024.
  const [column] = await q(`SELECT column_default, is_nullable FROM information_schema.columns WHERE table_name = 'workspace_bell_state' AND column_name = 'ai_readiness_emails'`);
  assert.deepEqual(column, { column_default: "true", is_nullable: "NO" });
  try {
    await q(`DROP INDEX ai_readiness_alert_emails_results_once`);
    assert.equal(await probe(), false, "senza l'indice dei risultati una volta");
    await ensure.runAirEmailDdl();
    assert.equal(await probe(), true, "di nuovo con l'indice");
  } finally {
    await ensure.runAirEmailDdl();
  }
});

const choice = (person: Person, role: string | null) => mail.readinessEmailChoice({ workspaceId: ids.ws, userId: userIds[person], role });

test("(revisione) la coda dalle risposte: senza l'ok del cliente sui sub-responsabili nessuno, Lateral Space compreso; con l'ok chi gestisce e può riceverle, mai nessun altro", opts, async () => {
  const a = await assessment("Rilevazione di prova, la coda", 50);
  await answer(a, 50);
  assert.deepEqual(await rows(a), [], "senza l'ok: nessuna riga, per nessuno");
  for (const [person, role] of [["lead", "transformation_lead"], ["sponsor", "exec_sponsor"]] as Array<[Person, string]>) {
    assert.equal(await choice(person, role), null, `${person}: senza l'ok l'interruttore non si vede`);
  }
  const { SUBPROCESSORS_VERSION } = await import("../../uc/legal/subprocessors.ts");
  await q(
    `INSERT INTO uc_subprocessor_acks (workspace_id, list_version, statement_text, declared_by_user_id, declared_by_role) VALUES ($1, $2, 'Autorizzazione di prova.', $3, 'exec_sponsor')`,
    [ids.ws, SUBPROCESSORS_VERSION, userIds.sponsor],
  );
  for (let i = 0; i < 3; i++) await answer(a, 50);
  // Chi gestisce dall'organizzazione e dal solo workspace, di Lateral Space o del cliente, con l'email verificata.
  assert.deepEqual(people(await pending(a)), ["lead", "sponsor", "wsLead"]);
  assert.ok((await pending(a)).every((r) => r.kind === "risposte"), "sotto la soglia: solo le risposte");
  assert.equal((await rows(a)).length, 3, "tre risposte, una riga per persona");
  // Mai: l'email non verificata, chi le ha spente, chi valuta, chi contribuisce, chi segue un corso, «Solo questo use
  // case», chi non è nel workspace.
  for (const person of ["unverified", "off", "analyst", "functionLead", "contributor", "learner", "caseOnly", "outsider"] as Person[]) {
    assert.ok(!(await rows(a)).some((r) => r.person === person), person);
  }
  assert.deepEqual(await choice("lead", "transformation_lead"), { on: true });
  assert.deepEqual(await choice("sponsor", "exec_sponsor"), { on: true });
});

test("(revisione) all'invio: senza l'ok la riga aspetta, per tutti; una lettura mancata dell'ok si riprova, mai annulla la riga", opts, async () => {
  // Righe messe in coda quando l'ok valeva, poi l'elenco dei sub-responsabili è cambiato (l'ok resta solo per la versione
  // di prima; le autorizzazioni non si cancellano mai): un secondo workspace dello stesso cliente.
  const ws2 = randomUUID();
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Cliente Demo')`, [ws2, ids.org]);
  try {
    await q(
      `INSERT INTO uc_subprocessor_acks (workspace_id, list_version, statement_text, declared_by_user_id, declared_by_role) VALUES ($1, '2000-01', 'Autorizzazione di prova, elenco di prima.', $2, 'exec_sponsor')`,
      [ws2, userIds.sponsor],
    );
    const a = (await air.createAiReadinessAssessment({ organizationId: ids.org, workspaceId: ws2, templateId, name: "Rilevazione di prova, l'ok all'invio", status: "open", aggregationThreshold: 50 })).id;
    // Una risposta inviata, come la scrive l'app.
    const pseudo = randomBytes(12).toString("hex");
    const [respondent] = await q(
      `INSERT INTO ai_readiness_respondents (assessment_id, organization_id, workspace_id, invite_token_hash, invite_status, survey_track, pseudonymous_id)
       VALUES ($1, $2, $3, $4, 'completed', 'everyone', $5) RETURNING id`,
      [a, ids.org, ws2, randomBytes(32).toString("hex"), pseudo],
    );
    await q(`INSERT INTO ai_readiness_responses (assessment_id, respondent_id, pseudonymous_id, status, answers, submitted_at) VALUES ($1, $2, $3, 'submitted', '[]'::jsonb, now() AT TIME ZONE 'UTC')`, [
      a,
      respondent.id,
      pseudo,
    ]);
    await q(
      `INSERT INTO ai_readiness_alert_emails (workspace_id, assessment_id, recipient_user_id, kind, counts_from, scheduled_at)
       SELECT $1, $2, u, 'risposte', now() - interval '1 minute', now() FROM unnest($3::uuid[]) AS u`,
      [ws2, a, [userIds.lead, userIds.sponsor]],
    );
    const named = (o: { mail: Mail }) => o.mail.text.includes("«Rilevazione di prova, l'ok all'invio»");
    const states = () => q(`SELECT status, hold_reason, cancel_reason, last_error_code, attempts FROM ai_readiness_alert_emails WHERE assessment_id = $1`, [a]);

    const waiting = fakeMailer();
    await dispatch(waiting);
    assert.equal(ours(waiting.outbox).filter(named).length, 0, "senza l'ok della versione di oggi non parte niente, nemmeno a Lateral Space");
    const held = await states();
    assert.ok(held.length === 2 && held.every((r) => r.status === "in_coda" && r.hold_reason === "sub_responsabili_mancanti" && r.cancel_reason === null), JSON.stringify(held));

    const { SUBPROCESSORS_VERSION } = await import("../../uc/legal/subprocessors.ts");
    await q(
      `INSERT INTO uc_subprocessor_acks (workspace_id, list_version, statement_text, declared_by_user_id, declared_by_role) VALUES ($1, $2, 'Autorizzazione di prova.', $3, 'exec_sponsor')`,
      [ws2, SUBPROCESSORS_VERSION, userIds.sponsor],
    );
    // L'ok non si legge (la tabella sparisce per un momento): la riga si riprova dopo 15 minuti, mai annullata.
    await q(`ALTER TABLE uc_subprocessor_acks RENAME TO uc_subprocessor_acks_prova_air`);
    try {
      const failed = fakeMailer();
      await dispatch(failed);
      assert.equal(ours(failed.outbox).filter(named).length, 0);
      const retried = await states();
      assert.ok(retried.length === 2 && retried.every((r) => r.status === "errore" && r.last_error_code === "errore_lettura" && r.cancel_reason === null && r.attempts === 0), JSON.stringify(retried));
    } finally {
      await q(`ALTER TABLE uc_subprocessor_acks_prova_air RENAME TO uc_subprocessor_acks`);
    }
    const later = fakeMailer();
    await dispatch(later, new Date(windowNow().getTime() + 20 * 60_000));
    assert.deepEqual(ours(later.outbox).filter(named).map((o) => o.mail.to).sort(), [to("lead"), to("sponsor")].sort(), "con l'ok parte a tutti");
  } finally {
    await q(`DELETE FROM workspaces WHERE id = $1`, [ws2]);
  }
});

test("(revisione) l'interruttore legge `users.email_verified`, come la coda e l'invio, mai la sessione", opts, async () => {
  assert.deepEqual(await choice("lead", "transformation_lead"), { on: true });
  await q(`UPDATE users SET email_verified = NULL WHERE id = $1`, [userIds.lead]);
  try {
    assert.equal(await choice("lead", "transformation_lead"), null, "non verificata nel database: niente interruttore, e niente email");
    const a = await assessment("Rilevazione di prova, l'email da verificare", 50);
    await answer(a, 50);
    assert.ok(!(await rows(a)).some((r) => r.person === "lead"), "la coda legge la stessa colonna");
  } finally {
    await q(`UPDATE users SET email_verified = now() WHERE id = $1`, [userIds.lead]);
  }
  assert.deepEqual(await choice("lead", "transformation_lead"), { on: true });
  assert.deepEqual(await choice("unverified", "transformation_lead"), null);
});

test("un'email al giorno per rilevazione e persona, solo conteggi; le risposte del giorno dopo nella prossima", opts, async () => {
  const a = await assessment("Rilevazione di prova, il giorno", 50);
  const named = (o: { mail: Mail }) => o.mail.text.includes("«Rilevazione di prova, il giorno»");
  for (let i = 0; i < 4; i++) await answer(a, 50);
  const first = fakeMailer();
  await dispatch(first);
  const sent = ours(first.outbox).filter(named);
  assert.deepEqual(sent.map((o) => o.mail.to).sort(), [to("lead"), to("sponsor"), to("wsLead")].sort(), "una a testa");
  for (const o of sent) {
    assert.equal(o.mail.subject, "Cliente Demo: 4 nuove risposte all'AI Readiness");
    assert.ok(o.mail.text.includes("«Rilevazione di prova, il giorno» ha 4 nuove risposte: ora sono 4 su 40 attese."), o.mail.text);
    assert.ok(o.mail.text.includes(`http://localhost:3000/dashboard/${ids.ws}/ai-readiness/aggiornamenti/${a}\n`), "il link pulito");
    assert.doesNotMatch(o.mail.text, /Persona di prova|pseudo|@cliente\.test|@ls\.test/, "mai una persona");
    assert.match(o.key, /^air:[0-9a-f-]{36}:a1$/);
  }
  // Altre due risposte nello stesso giorno: la riga c'è, ma oggi non parte niente.
  await answer(a, 50);
  await answer(a, 50);
  assert.deepEqual(people(await pending(a)), ["lead", "sponsor", "wsLead"]);
  const sameDay = fakeMailer();
  await dispatch(sameDay);
  assert.equal(ours(sameDay.outbox).filter(named).length, 0, "mai due email nello stesso giorno");
  // Il giorno dopo: una a testa, con le sole due risposte nuove.
  await nextDay();
  const tomorrow = fakeMailer();
  await dispatch(tomorrow);
  const next = ours(tomorrow.outbox).filter(named);
  assert.equal(next.length, 3);
  for (const o of next) assert.ok(o.mail.text.includes("ha 2 nuove risposte: ora sono 6 su 40 attese."), o.mail.text);
  assert.equal((await pending(a)).length, 0);
});

test("i risultati: un'email, una volta, quando nasce la soglia; nel giorno della soglia parte prima e le risposte aspettano", opts, async () => {
  const a = await assessment("Rilevazione di prova, la soglia", 3);
  await answer(a, 3);
  await answer(a, 3);
  assert.ok(!(await rows(a)).some((r) => r.kind === "risultati"), "sotto la soglia nessuna email dei risultati");
  await answer(a, 3);
  const results = async () => (await rows(a)).filter((r) => r.kind === "risultati");
  assert.deepEqual(people(await results()), ["lead", "sponsor", "wsLead"]);
  // (Revisione) Una scrittura persa (un errore passeggero all'invio che ha fatto nascere la soglia): la risposta dopo la
  // rimette, finché c'è la riga della soglia in campanella.
  await q(`DELETE FROM ai_readiness_alert_emails WHERE assessment_id = $1 AND kind = 'risultati'`, [a]);
  await answer(a, 3);
  assert.deepEqual(people(await results()), ["lead", "sponsor", "wsLead"], "di nuovo in coda, una a testa");
  assert.equal((await results()).length, 3, "e la quarta risposta non ne aggiunge altre");
  const day = fakeMailer();
  await dispatch(day);
  const named = (o: { mail: Mail }) => o.mail.text.includes("«Rilevazione di prova, la soglia»");
  const mine = ours(day.outbox).filter(named);
  assert.deepEqual(mine.map((o) => o.mail.subject), Array(3).fill("Cliente Demo: i risultati dell'AI Readiness ci sono"), "una a testa, solo i risultati");
  for (const o of mine) {
    assert.ok(o.mail.text.includes("«Rilevazione di prova, la soglia» ha 4 risposte su 40 attese: bastano per leggere i risultati per area e per preparare la sintesi."));
    assert.ok(o.mail.text.includes(`/ai-readiness/aggiornamenti/${a}/risultati\n`));
  }
  assert.deepEqual(people((await pending(a)).filter((r) => r.kind === "risposte")), ["lead", "sponsor", "wsLead"], "le risposte aspettano domani");
  // Una risposta dopo i risultati: mai un'altra email dei risultati.
  await answer(a, 3);
  assert.equal((await results()).length, 3);
  await nextDay();
  const tomorrow = fakeMailer();
  await dispatch(tomorrow);
  const answers = ours(tomorrow.outbox).filter(named);
  assert.equal(answers.length, 3);
  for (const o of answers) assert.ok(o.mail.text.includes("ha 1 nuova risposta: ora sono 5 su 40 attese."), o.mail.text);
  assert.equal((await results()).filter((r) => r.status === "inviata").length, 3);
});

test("la scelta: spenta dopo la coda, la riga si annulla e niente parte; si riaccende dal suo account", opts, async () => {
  const a = await assessment("Rilevazione di prova, la scelta", 50);
  await answer(a, 50);
  assert.ok((await pending(a)).some((r) => r.person === "lead"));
  assert.equal(await mail.setReadinessEmails(ids.ws, userIds.lead, false), false);
  assert.deepEqual(await choice("lead", "transformation_lead"), { on: false });
  const run = fakeMailer();
  await dispatch(run);
  assert.ok(!ours(run.outbox).some((o) => o.mail.to === to("lead")));
  assert.deepEqual((await rows(a)).filter((r) => r.person === "lead").map((r) => [r.status, r.reason]), [["annullata", "email_spenta"]]);
  // Spenta: le risposte nuove non mettono più righe per lei.
  await answer(a, 50);
  assert.ok(!(await pending(a)).some((r) => r.person === "lead"));
  assert.equal(await mail.setReadinessEmails(ids.ws, userIds.lead, true), true);
  // Chi non le riceverebbe non vede l'interruttore.
  for (const [person, role] of [["analyst", "analyst"], ["contributor", "contributor"], ["caseOnly", "esterno_caso"], ["learner", "learner"]] as Array<[Person, string]>) {
    assert.equal(await choice(person, role), null, person);
  }
  assert.equal(await choice("unverified", "transformation_lead"), null);
});

test("mai due volte: un esito incerto e un tentativo interrotto non si ripetono; un errore certo si riprova con una chiave nuova", opts, async () => {
  const leadRows = async (a: string) =>
    q(`SELECT id, status, cancel_reason, attempts, attempt_started_at FROM ai_readiness_alert_emails WHERE assessment_id = $1 AND recipient_user_id = $2 ORDER BY created_at`, [a, userIds.lead]);
  // Un esito incerto: annullata, mai ripetuta, nemmeno il giorno dopo.
  const unsure = await assessment("Rilevazione di prova, esito incerto", 50);
  await answer(unsure, 50);
  await dispatch(fakeMailer(Array(50).fill({ ok: false, code: "timeout", ambiguous: true })));
  const [r1] = await leadRows(unsure);
  assert.deepEqual([r1.status, r1.cancel_reason, r1.attempts], ["annullata", "esito_incerto", 1]);
  await nextDay();
  const later = fakeMailer();
  await dispatch(later);
  assert.ok(!ours(later.outbox).some((o) => o.mail.text.includes("«Rilevazione di prova, esito incerto»")), "la riga incerta non riparte");
  assert.equal((await leadRows(unsure)).length, 1);

  // Un errore certo: si riprova dopo 15 minuti, con il tentativo 2 e la sua chiave.
  const failing = await assessment("Rilevazione di prova, errore certo", 50);
  await answer(failing, 50);
  await dispatch(fakeMailer(Array(50).fill({ ok: false, code: "validation_error", ambiguous: false })));
  const [failed] = await leadRows(failing);
  assert.deepEqual([failed.status, failed.attempts, failed.attempt_started_at], ["errore", 1, null]);
  const retry = fakeMailer();
  await dispatch(retry, new Date(windowNow().getTime() + 20 * 60_000));
  const again = ours(retry.outbox).find((o) => o.mail.to === to("lead") && o.mail.text.includes("«Rilevazione di prova, errore certo»"));
  assert.ok(again, "riparte");
  assert.equal(again.key, `air:${String(failed.id)}:a2`);
  assert.equal((await leadRows(failing))[0].status, "inviata");

  // Un tentativo interrotto a metà (il segno c'è, il lease è finito): annullato al prossimo giro, mai mandato.
  const cutA = await assessment("Rilevazione di prova, interrotta", 50);
  await answer(cutA, 50);
  const [cut] = await q(`SELECT id FROM ai_readiness_alert_emails WHERE assessment_id = $1 AND recipient_user_id = $2 AND status = 'in_coda'`, [cutA, userIds.wsLead]);
  await q(
    `UPDATE ai_readiness_alert_emails SET attempt_started_at = now() - interval '10 minutes', attempts = 1, counted_until = now() - interval '10 minutes', lease_until = now() - interval '5 minutes' WHERE id = $1`,
    [cut.id],
  );
  const run = fakeMailer();
  await dispatch(run);
  assert.ok(!ours(run.outbox).some((o) => o.mail.to === to("wsLead") && o.mail.text.includes("«Rilevazione di prova, interrotta»")), "mai mandato");
  assert.ok(ours(run.outbox).some((o) => o.mail.to === to("lead") && o.mail.text.includes("«Rilevazione di prova, interrotta»")), "gli altri sì");
  const [state] = await q(`SELECT status, cancel_reason FROM ai_readiness_alert_emails WHERE id = $1`, [cut.id]);
  assert.deepEqual(state, { status: "annullata", cancel_reason: "esito_incerto" });
});

test("il cron dei giorni feriali (`use-case-referents`) le manda con il mailer finto", opts, async () => {
  await nextDay();
  const a = await assessment("Rilevazione di prova, il cron", 50);
  await answer(a, 50);
  const mailer = fakeMailer();
  const counts = await referents.runReferentCron({ env: SEND_ENV, now: windowNow(), mailer });
  assert.ok(counts.readinessAlertsSent >= 3, `${counts.readinessAlertsSent}`);
  const mine = ours(mailer.outbox).filter((o) => o.mail.text.includes("«Rilevazione di prova, il cron»"));
  assert.ok(mine.every((o) => o.mail.subject === "Cliente Demo: 1 nuova risposta all'AI Readiness"));
  assert.deepEqual(mine.map((o) => o.mail.to).sort(), [to("lead"), to("sponsor"), to("wsLead")].sort());
  assert.equal((await pending(a)).length, 0);
});

test("una rilevazione eliminata porta via le sue righe", opts, async () => {
  const a = await assessment("Rilevazione di prova, eliminata", 50);
  await answer(a, 50);
  assert.ok((await rows(a)).length > 0);
  await q(`DELETE FROM ai_readiness_assessments WHERE id = $1`, [a]);
  assert.equal((await q(`SELECT count(*)::int AS n FROM ai_readiness_alert_emails WHERE assessment_id = $1`, [a]))[0].n, 0);
});
