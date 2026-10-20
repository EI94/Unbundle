import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";
import { ASSIGN_USE_CASE_CODE_SQL } from "../../portfolio/use-case-code.ts";
import { CONNECTOR_TOKEN_PREFIX, hashIntegrationToken } from "../auth.ts";
import { EXAMPLE_CONNECTOR_PROFILE_INPUT, EXAMPLE_INSTRUCTIONS_TEMPLATE, EXAMPLE_PROFILE, EXAMPLE_PROFILE_FILE } from "../contract.fixtures.ts";
import { MISSING_CODES_SQL } from "./backfill-codes.ts";
import type { AdminDb, AdminOutput, AdminRow, AdminStatement } from "./cli.ts";
import { INSERT_CONFIG_SQL, planConfig, SLUG_OWNER_SQL, connectorConfigFileSchema } from "./config.ts";
import { UPDATE_GUIDE_SQL } from "./guide.ts";
import { runConnectorAdmin } from "./main.ts";
import { UPDATE_PROFILE_AND_GUIDE_SQL, UPDATE_PROFILE_SQL } from "./profile.ts";
import { ACTIVE_TOKENS_SQL, CONFIG_ROW_SQL, SCHEMA_READY_SQL, WORKSPACE_SQL } from "./state.ts";
import { INSERT_TOKEN_SQL } from "./token.ts";

// I comandi di `connector-admin` (prompt WP8, K8) con un database finto: la prova a secco
// non scrive mai, `--apply` scrive solo ciò che il piano dice. La stessa cosa sul database
// locale è in `admin.integration.test.ts`. Dati sintetici.

const WS = "11111111-1111-4111-8111-111111111111";
const DB_URL = "postgresql://uc_test@127.0.0.1:55469/conn_k8";
const ENV = { CONNECTOR_ADMIN_DATABASE_URL: DB_URL };
const APPLY = ["--apply", "--confirm-authorized", "--confirm-database", "127.0.0.1:55469/conn_k8", "--environment", "local"];
const SECRET = `${CONNECTOR_TOKEN_PREFIX}${"s".repeat(43)}`;

const dir = mkdtempSync(join(tmpdir(), "connector-admin-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const fileWith = (name: string, value: unknown) => {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(value));
  return path;
};
const CONFIG_FILE = new URL("../../../../docs/connettore/config-esempio.json", import.meta.url).pathname;
const GUIDE_FILE = new URL("../../../../docs/connettore/guida-esempio.json", import.meta.url).pathname;
const exampleGuide = () => JSON.parse(readFileSync(GUIDE_FILE, "utf8")) as Record<string, unknown>;
// Il file d'esempio del repository (uguale a EXAMPLE_PROFILE_FILE: profile.test.ts).
const PROFILE_FILE = new URL("../../../../docs/connettore/profilo-esempio.json", import.meta.url).pathname;

function configRow(patch: Record<string, unknown> = {}): AdminRow {
  return {
    slug: "alfa-beta",
    code_prefix: "AB",
    next_code_seq: 0,
    enabled: false,
    identity_mode: "dichiarata",
    auth_mode: "header",
    workspace_display_name: "Alfa e Beta",
    allowed_domains: ["alfa.test", "beta.test"],
    allowed_origins: [],
    limits: { submitsPerHour: 200, readsPerHour: 3000, submitsPerDayWorkspace: 1000, submitsPerHourPerUser: 10 },
    guide: null,
    guide_version: null,
    profile: null,
    instructions_template: null,
    guide_md5: "g",
    profile_md5: "p",
    template_md5: "t",
    ...patch,
  };
}

interface FakeState {
  schemaReady?: boolean;
  workspace?: { esgEnabled: boolean } | null;
  config?: AdminRow | null;
  slugOwner?: string | null;
  missing?: AdminRow[];
  activeTokens?: number;
  /** Ogni lettura dopo la prima scrittura fallisce (rete o database che cade dopo il commit). */
  failReadsAfterWrite?: boolean;
}

function fakeDb(state: FakeState) {
  const writes: AdminStatement[][] = [];
  const reads: string[] = [];
  const db: AdminDb = {
    async read(text) {
      reads.push(text);
      if (state.failReadsAfterWrite && writes.length > 0) throw new Error("connessione interrotta");
      if (text === SCHEMA_READY_SQL) return [{ ready: state.schemaReady ?? true }];
      if (text === WORKSPACE_SQL) return state.workspace === null ? [] : [{ id: WS, name: "Workspace di prova", esg_enabled: state.workspace?.esgEnabled ?? false }];
      if (text === CONFIG_ROW_SQL) return state.config ? [state.config] : [];
      if (text === ACTIVE_TOKENS_SQL) return [{ active: state.activeTokens ?? 0 }];
      if (text === SLUG_OWNER_SQL) return state.slugOwner ? [{ workspace_id: state.slugOwner }] : [];
      if (text === MISSING_CODES_SQL) return state.missing ?? [];
      throw new Error(`SQL inattesa: ${text.slice(0, 40)}`);
    },
    async write(statements) {
      writes.push([...statements]);
      return statements.map((s) => {
        if (s.text === INSERT_TOKEN_SQL) return [{ id: "22222222-2222-4222-8222-222222222222", expires_at: "2027-01-17T10:00:00Z" }];
        if (s.text === ASSIGN_USE_CASE_CODE_SQL) return [{ code: `AB-${String(writes.length).padStart(4, "0")}` }];
        return [{ workspace_id: WS }];
      });
    },
  };
  return { db, writes, reads };
}

async function run(argv: string[], state: FakeState, opts: { secret?: () => string } = {}) {
  const fake = fakeDb(state);
  const printed: AdminOutput[] = [];
  const outcome = await runConnectorAdmin(argv, { env: ENV, db: () => fake.db, print: (o) => printed.push(o), newTokenSecret: opts.secret ?? (() => SECRET) });
  return { ...outcome, ...fake, printed };
}

const withProfile = (patch: Record<string, unknown> = {}) =>
  configRow({ profile: JSON.parse(JSON.stringify(EXAMPLE_CONNECTOR_PROFILE_INPUT)), instructions_template: EXAMPLE_INSTRUCTIONS_TEMPLATE, ...patch });

test("prova a secco: nessun comando scrive, e il segreto del token non si genera", async () => {
  let generated = 0;
  const secret = () => {
    generated++;
    return SECRET;
  };
  const cases: Array<[string[], FakeState]> = [
    [["config", "--workspace", WS, "--file", CONFIG_FILE], { config: null }],
    [["config", "--workspace", WS, "--file", CONFIG_FILE], { config: configRow({ slug: "altro-slug", workspace_display_name: null }) }],
    [["profile", "--workspace", WS, "--file", PROFILE_FILE], { config: configRow() }],
    [["guide", "--workspace", WS, "--file", GUIDE_FILE], { config: withProfile() }],
    [["token", "--workspace", WS], { config: withProfile() }],
    [["backfill-codes", "--workspace", WS], { config: configRow(), missing: [{ id: "a", title: "Prima", source: "web", month: "2026-09" }] }],
  ];
  for (const [argv, state] of cases) {
    const out = await run(argv, state, { secret });
    assert.equal(out.output.status, "DRY_RUN", `${argv[0]}: ${JSON.stringify(out.output)}`);
    assert.equal(out.exitCode, 0);
    assert.equal(out.writes.length, 0, argv[0]);
    assert.equal(out.printed.length, 0, "nessun piano senza --apply");
    assert.equal(out.output.database, "127.0.0.1:55469/conn_k8");
  }
  assert.equal(generated, 0);
});

test("schema o workspace mancanti: si ferma e lo dice", async () => {
  const noSchema = await run(["config", "--workspace", WS, "--file", CONFIG_FILE], { schemaReady: false });
  assert.equal(noSchema.output.code, "schema");
  assert.equal(noSchema.exitCode, 1);
  const noWorkspace = await run(["config", "--workspace", WS, "--file", CONFIG_FILE], { workspace: null });
  assert.equal(noWorkspace.output.code, "workspace");
  const noRow = await run(["token", "--workspace", WS], { config: null });
  assert.equal(noRow.output.code, "config_mancante");
});

test("config: riga nuova, sempre spenta, con i valori del file e i predefiniti", async () => {
  const out = await run(["config", "--workspace", WS, "--file", CONFIG_FILE, ...APPLY], { config: null });
  assert.equal(out.output.status, "APPLIED", JSON.stringify(out.output));
  assert.equal(out.printed[0].status, "PLAN");
  assert.equal(out.printed[0].ambiente, "local");
  assert.equal(out.writes.length, 1);
  const [insert] = out.writes[0];
  assert.equal(insert.text, INSERT_CONFIG_SQL);
  assert.match(insert.text, /false, 0\)\nON CONFLICT \(workspace_id\) DO NOTHING/);
  assert.deepEqual(insert.params, [
    WS,
    "alfa-beta",
    "AB",
    "Alfa e Beta",
    "dichiarata",
    "header",
    JSON.stringify(["alfa.test", "beta.test"]),
    "[]",
    JSON.stringify({ submitsPerHour: 200, readsPerHour: 3000, submitsPerDayWorkspace: 1000, submitsPerHourPerUser: 10 }),
  ]);
});

test("config su una riga esistente: riempie i vuoti, cambia i valori scritti solo con --overwrite, non tocca interruttore e contatore", async () => {
  // La riga di D6 (use-case-admin configs): spenta, slug e prefisso generati, nessun nome.
  const d6 = configRow({ slug: "workspace-di-prova-1111", code_prefix: "WDP", workspace_display_name: null, allowed_domains: [], next_code_seq: 3, enabled: false });
  const dry = await run(["config", "--workspace", WS, "--file", CONFIG_FILE], { config: d6 });
  const changes = dry.output.differenze as Array<{ campo: string; tipo: string }>;
  assert.deepEqual(
    changes.map((c) => [c.campo, c.tipo]),
    [
      ["slug", "cambia"],
      ["codePrefix", "cambia"],
      ["workspaceDisplayName", "riempie"],
      ["allowedDomains", "riempie"],
    ]
  );
  assert.deepEqual(dry.output.invariati, ["identityMode", "authMode", "allowedOrigins", "limits"]);
  assert.match(String(dry.output.message), /--overwrite/);
  assert.ok((dry.output.avvisi as string[]).some((a) => /dopo 3 codici/.test(a)));
  assert.ok((dry.output.avvisi as string[]).some((a) => /rimuovere e riaggiungere/.test(a)));

  const refused = await run(["config", "--workspace", WS, "--file", CONFIG_FILE, ...APPLY], { config: d6 });
  assert.equal(refused.output.code, "overwrite");
  assert.equal(refused.writes.length, 0);

  const applied = await run(["config", "--workspace", WS, "--file", CONFIG_FILE, "--overwrite", ...APPLY], { config: d6 });
  assert.equal(applied.output.status, "APPLIED");
  const [update] = applied.writes[0];
  assert.match(update.text, /^UPDATE workspace_connector_configs SET slug = \$2, code_prefix = \$4, workspace_display_name = \$6, allowed_domains = \$8::jsonb, updated_at = now\(\)/);
  // Solo se la riga è ancora quella letta.
  assert.match(update.text, /slug IS NOT DISTINCT FROM \$3 AND code_prefix IS NOT DISTINCT FROM \$5 AND workspace_display_name IS NOT DISTINCT FROM \$7 AND allowed_domains IS NOT DISTINCT FROM \$9::jsonb/);
  assert.deepEqual(update.params, [WS, "alfa-beta", "workspace-di-prova-1111", "AB", "WDP", "Alfa e Beta", null, '["alfa.test","beta.test"]', "[]"]);
  assert.doesNotMatch(update.text, /enabled|next_code_seq|guide|profile|updated_by/);

  // Solo vuoti da riempire: niente --overwrite.
  const fill = await run(["config", "--workspace", WS, "--file", CONFIG_FILE, ...APPLY], { config: configRow({ workspace_display_name: null, allowed_domains: [] }) });
  assert.equal(fill.output.status, "APPLIED");
  // Già uguale: niente da fare.
  const same = await run(["config", "--workspace", WS, "--file", CONFIG_FILE, ...APPLY], { config: configRow() });
  assert.equal(same.output.status, "NOTHING_TO_DO");
  assert.equal(same.writes.length, 0);
});

test("config: file non valido, fase 2 non ancora ammessa, slug di un altro workspace", async () => {
  const oauth = await run(["config", "--workspace", WS, "--file", fileWith("oauth.json", { slug: "alfa-beta", codePrefix: "AB", workspaceDisplayName: "Alfa", authMode: "oauth" })], { config: null });
  assert.equal(oauth.output.code, "file");
  assert.match(JSON.stringify(oauth.output.problems), /authMode: Fase 1/);
  for (const bad of [
    { slug: "AB", codePrefix: "AB", workspaceDisplayName: "Alfa" },
    { slug: "alfa-beta", codePrefix: "ab", workspaceDisplayName: "Alfa" },
    { slug: "alfa-beta", codePrefix: "AB", workspaceDisplayName: "Alfa {{x}}" },
    { slug: "alfa-beta", codePrefix: "AB", workspaceDisplayName: "Alfa", allowedDomains: ["non un dominio"] },
    { slug: "alfa-beta", codePrefix: "AB", workspaceDisplayName: "Alfa", allowedOrigins: ["https://claude.ai/percorso"] },
    { slug: "alfa-beta", codePrefix: "AB", workspaceDisplayName: "Alfa", limits: { readsPerHour: -1 } },
    { slug: "alfa-beta", codePrefix: "AB", workspaceDisplayName: "Alfa", extra: true },
  ]) {
    assert.equal(connectorConfigFileSchema.safeParse(bad).success, false, JSON.stringify(bad));
  }
  const taken = await run(["config", "--workspace", WS, "--file", CONFIG_FILE, ...APPLY], { config: null, slugOwner: "33333333-3333-4333-8333-333333333333" });
  assert.equal(taken.output.code, "slug");
  assert.equal(taken.writes.length, 0);
  // Limiti parziali: le chiavi date sostituiscono, le altre restano.
  const partial = connectorConfigFileSchema.parse({ slug: "alfa-beta", codePrefix: "AB", workspaceDisplayName: "Alfa e Beta", limits: { readsPerHour: 5000 } });
  const plan = planConfig(partial, null);
  assert.deepEqual(plan.changes.find((c) => c.campo === "limits")?.nuovo, { submitsPerHour: 200, readsPerHour: 5000, submitsPerDayWorkspace: 1000, submitsPerHourPerUser: 10 });
});

test("profile: differenze per enum e testi; scrive profilo senza il modello e il modello a parte", async () => {
  const changed = { ...EXAMPLE_PROFILE_FILE, contract: { ...EXAMPLE_PROFILE, areas: [...EXAMPLE_PROFILE.areas, "qualita"], agents: ["atlante"] } };
  const dry = await run(["profile", "--workspace", WS, "--file", fileWith("profilo-2.json", changed)], { config: withProfile() });
  assert.equal(dry.output.status, "DRY_RUN", JSON.stringify(dry.output));
  const diff = dry.output.differenze as { enum: Record<string, { entrano: string[]; escono: string[] }>; istruzioni: unknown };
  assert.deepEqual(diff.enum, { areas: { entrano: ["qualita"], escono: [] }, agents: { entrano: [], escono: ["boreale"] } });
  assert.equal(diff.istruzioni, "invariate");

  const applied = await run(["profile", "--workspace", WS, "--file", PROFILE_FILE, ...APPLY], { config: configRow() });
  assert.equal(applied.output.status, "APPLIED");
  const [update] = applied.writes[0];
  assert.equal(update.text, UPDATE_PROFILE_SQL);
  assert.deepEqual(JSON.parse(String(update.params[1])), JSON.parse(JSON.stringify(EXAMPLE_CONNECTOR_PROFILE_INPUT)));
  assert.equal(update.params[2], EXAMPLE_INSTRUCTIONS_TEMPLATE);
  // Solo se profilo, modello e guida (con cui si è controllata la coerenza) sono quelli letti.
  assert.deepEqual(update.params.slice(3), ["p", "t", "g"]);

  const same = await run(["profile", "--workspace", WS, "--file", PROFILE_FILE, ...APPLY], { config: withProfile() });
  assert.equal(same.output.status, "NOTHING_TO_DO");
  const invalid = await run(["profile", "--workspace", WS, "--file", fileWith("rotto.json", { ...EXAMPLE_PROFILE_FILE, instructionsTemplate: "senza segnaposto" })], { config: configRow() });
  assert.equal(invalid.output.code, "profilo");
  assert.deepEqual(Object.keys(invalid.output.campi as object), ["instructionsTemplate"]);
  // Un profilo che toglie un valore usato dalla guida salvata si rifiuta.
  const guarded = await run(["profile", "--workspace", WS, "--file", fileWith("stretto.json", changed), ...APPLY], { config: withProfile({ guide: exampleGuide(), guide_version: "2026-10.1" }) });
  assert.equal(guarded.output.code, "guida_profilo");
  assert.match(JSON.stringify(guarded.output.problems), /agentCatalog: valori fuori dal contratto \(boreale\)/);
  assert.match(String(guarded.output.message), /--guide-file/);
  assert.equal(guarded.writes.length, 0);
});

test("profile --guide-file: un cambio che tocca guida e profilo (beneficiariesMax 50 → 80) si carica in un solo UPDATE", async () => {
  const saved = { config: withProfile({ guide: exampleGuide(), guide_version: "2026-10.1" }) };
  const profile80 = fileWith("profilo-80.json", { ...EXAMPLE_PROFILE_FILE, contract: { ...EXAMPLE_PROFILE, beneficiariesMax: 80 } });
  const guide80 = (version: string, cap = 80) => {
    const guide = exampleGuide();
    guide.guideVersion = version;
    guide.beneficiaryCap = cap;
    guide.fields = (guide.fields as Array<Record<string, unknown>>).map((f) => (f.name === "beneficiaries" ? { ...f, max: cap } : f));
    return guide;
  };
  const guideFile = fileWith("guida-80.json", guide80("2026-10.2"));

  // Da soli si rifiutano a vicenda, e il messaggio dice come uscirne.
  const profileAlone = await run(["profile", "--workspace", WS, "--file", profile80, ...APPLY], saved);
  assert.equal(profileAlone.output.code, "guida_profilo");
  assert.match(JSON.stringify(profileAlone.output.problems), /beneficiaryCap: 50/);
  assert.match(String(profileAlone.output.message), /profile --file <profilo\.json> --guide-file <guida\.json>/);
  const guideAlone = await run(["guide", "--workspace", WS, "--file", guideFile, ...APPLY], saved);
  assert.equal(guideAlone.output.code, "guida_profilo");
  assert.match(String(guideAlone.output.message), /--guide-file/);
  assert.equal(profileAlone.writes.length + guideAlone.writes.length, 0);

  const dry = await run(["profile", "--workspace", WS, "--file", profile80, "--guide-file", guideFile], saved);
  assert.equal(dry.output.status, "DRY_RUN", JSON.stringify(dry.output));
  assert.deepEqual((dry.output.differenze as { beneficiariesMax: unknown }).beneficiariesMax, { attuale: 50, nuovo: 80 });
  assert.deepEqual((dry.output.guida as { versione: unknown }).versione, { attuale: "2026-10.1", nuova: "2026-10.2" });
  assert.equal(dry.writes.length, 0);

  const applied = await run(["profile", "--workspace", WS, "--file", profile80, "--guide-file", guideFile, ...APPLY], saved);
  assert.equal(applied.output.status, "APPLIED", JSON.stringify(applied.output));
  assert.equal(applied.writes.length, 1, "una sola transazione");
  const [[update]] = applied.writes;
  assert.equal(update.text, UPDATE_PROFILE_AND_GUIDE_SQL);
  assert.equal(JSON.parse(String(update.params[1])).contract.beneficiariesMax, 80);
  assert.equal(update.params[2], EXAMPLE_INSTRUCTIONS_TEMPLATE);
  assert.equal(JSON.parse(String(update.params[3])).beneficiaryCap, 80);
  assert.equal(update.params[4], "2026-10.2");
  assert.deepEqual(update.params.slice(5), ["p", "t", "g"], "vale solo se profilo, modello e guida sono quelli letti");
  assert.match(UPDATE_PROFILE_AND_GUIDE_SQL, /md5\(coalesce\(profile::text, ''\)\) = \$6\s+AND md5\(coalesce\(instructions_template, ''\)\) = \$7\s+AND md5\(coalesce\(guide::text, ''\)\) = \$8/);

  // La guida nuova si controlla contro il profilo nuovo, con le regole di guide.
  const stale = await run(["profile", "--workspace", WS, "--file", profile80, "--guide-file", fileWith("guida-50.json", guide80("2026-10.2", 50)), ...APPLY], saved);
  assert.equal(stale.output.code, "guida_profilo");
  assert.match(JSON.stringify(stale.output.problems), /beneficiaryCap: 50, ma il contratto ammette al massimo 80/);
  const sameVersion = await run(["profile", "--workspace", WS, "--file", profile80, "--guide-file", fileWith("guida-stessa.json", guide80("2026-10.1")), ...APPLY], saved);
  assert.equal(sameVersion.output.code, "versione");
  const esg = await run(["profile", "--workspace", WS, "--file", profile80, "--guide-file", guideFile, ...APPLY], { ...saved, workspace: { esgEnabled: true } });
  assert.equal(esg.output.code, "guida_profilo");
  assert.match(JSON.stringify(esg.output.problems), /esgEnabled/);
  const invalid = await run(["profile", "--workspace", WS, "--file", profile80, "--guide-file", fileWith("guida-rotta-2.json", { ...guide80("2026-10.2"), beneficiaryCap: "molti" }), ...APPLY], saved);
  assert.equal(invalid.output.code, "guida");
  assert.equal(stale.writes.length + sameVersion.writes.length + esg.writes.length + invalid.writes.length, 0);

  // Già caricati entrambi: niente da fare.
  const after = { config: withProfile({ profile: { ...JSON.parse(JSON.stringify(EXAMPLE_CONNECTOR_PROFILE_INPUT)), contract: { ...EXAMPLE_PROFILE, beneficiariesMax: 80 } }, guide: guide80("2026-10.2"), guide_version: "2026-10.2" }) };
  const nothing = await run(["profile", "--workspace", WS, "--file", profile80, "--guide-file", guideFile, ...APPLY], after);
  assert.equal(nothing.output.status, "NOTHING_TO_DO", JSON.stringify(nothing.output));
  assert.equal(nothing.writes.length, 0);
});

test("guide: serve il profilo; coerenza con profilo e ESG; versione da alzare se il contenuto cambia", async () => {
  const noProfile = await run(["guide", "--workspace", WS, "--file", GUIDE_FILE], { config: configRow() });
  assert.equal(noProfile.output.code, "profilo_mancante");
  const esg = await run(["guide", "--workspace", WS, "--file", GUIDE_FILE], { config: withProfile(), workspace: { esgEnabled: true } });
  assert.equal(esg.output.code, "guida_profilo");
  assert.match(JSON.stringify(esg.output.problems), /esgEnabled/);
  const invalid = await run(["guide", "--workspace", WS, "--file", fileWith("guida-rotta.json", { ...exampleGuide(), beneficiaryCap: "molti" })], { config: withProfile() });
  assert.equal(invalid.output.code, "guida");

  const applied = await run(["guide", "--workspace", WS, "--file", GUIDE_FILE, ...APPLY], { config: withProfile() });
  assert.equal(applied.output.status, "APPLIED", JSON.stringify(applied.output));
  const [update] = applied.writes[0];
  assert.equal(update.text, UPDATE_GUIDE_SQL);
  assert.equal(update.params[2], "2026-10.1");
  // Solo se guida e profilo (con cui si è controllata la coerenza) sono quelli letti.
  assert.deepEqual(update.params.slice(3), ["g", "p"]);
  assert.equal(JSON.parse(String(update.params[1])).agentCatalog.length, 2);

  // Stessa guida (con le chiavi in un altro ordine, come le rilegge jsonb): niente da fare.
  const stored = Object.fromEntries(Object.entries(exampleGuide()).reverse());
  const same = await run(["guide", "--workspace", WS, "--file", GUIDE_FILE, ...APPLY], { config: withProfile({ guide: stored, guide_version: "2026-10.1" }) });
  assert.equal(same.output.status, "NOTHING_TO_DO", JSON.stringify(same.output));
  const edited = { ...exampleGuide(), privacyRules: ["Mai dati sanitari."] };
  const sameVersion = await run(["guide", "--workspace", WS, "--file", fileWith("guida-2.json", edited), ...APPLY], { config: withProfile({ guide: stored, guide_version: "2026-10.1" }) });
  assert.equal(sameVersion.output.code, "versione");
  const bumped = await run(["guide", "--workspace", WS, "--file", fileWith("guida-3.json", { ...edited, guideVersion: "2026-10.2" })], { config: withProfile({ guide: stored, guide_version: "2026-10.1" }) });
  assert.equal(bumped.output.status, "DRY_RUN");
  assert.deepEqual(bumped.output.sezioni, { aggiunte: [], cambiate: ["guideVersion", "privacyRules"], tolte: [] });
});

test("token: stampato solo dopo --apply; in tabella hash e inizio, mai il segreto", async () => {
  const out = await run(["token", "--workspace", WS, "--label", "Connettore di prova", ...APPLY], { config: withProfile() });
  assert.equal(out.output.status, "APPLIED");
  assert.equal(out.output.token, SECRET);
  assert.equal(out.output.inizio, `${SECRET.slice(0, 14)}...`);
  const [insert] = out.writes[0];
  assert.equal(insert.text, INSERT_TOKEN_SQL);
  assert.deepEqual(insert.params, [WS, "Connettore di prova", "claude_connector", hashIntegrationToken(SECRET), `${SECRET.slice(0, 14)}...`, '["connector:read","connector:submit"]', 90]);
  assert.ok(insert.params.every((p) => p !== SECRET));
  assert.equal(JSON.stringify(out.printed).includes(SECRET), false, "il piano non contiene il token");
  // Senza guida e profilo il piano lo dice.
  const bare = await run(["token", "--workspace", WS], { config: configRow() });
  assert.ok((bare.output.avvisi as string[]).some((a) => /guida/.test(a)));
  assert.ok((bare.output.avvisi as string[]).some((a) => /profilo del cliente/.test(a)));
  const badLabel = await run(["token", "--workspace", WS, "--label", "x"], { config: configRow() });
  assert.equal(badLabel.output.code, "label");
});

test("token: se la rilettura dopo l'INSERT fallisce, il token esce lo stesso (prontezza null con un avviso)", async () => {
  const out = await run(["token", "--workspace", WS, ...APPLY], { config: withProfile(), failReadsAfterWrite: true });
  assert.equal(out.output.status, "APPLIED", JSON.stringify(out.output));
  assert.equal(out.exitCode, 0);
  assert.equal(out.output.token, SECRET);
  assert.equal(out.output.tokenId, "22222222-2222-4222-8222-222222222222");
  assert.equal(out.output.scadenza, "2027-01-17T10:00:00Z");
  assert.equal(out.output.prontezza, null);
  assert.match((out.output.avvisi as string[]).join(" "), /rilancia a secco/);
  assert.equal(out.writes.length, 1, "un solo token creato");
});

test("backfill-codes: codici previsti dal contatore, in ordine d'invio; --limit; oltre 99.999 si ferma", async () => {
  const missing = [
    { id: "a", title: "Prima segnalazione", source: "web_proposed", month: "2026-09" },
    { id: "b", title: "x".repeat(90), source: null, month: "2026-10" },
    { id: "c", title: "Terza", source: "slack", month: "2026-10" },
  ];
  const dry = await run(["backfill-codes", "--workspace", WS], { config: configRow({ next_code_seq: 41 }), missing });
  assert.equal(dry.output.prossimoCodice, "AB-0042");
  assert.deepEqual((dry.output.elenco as Array<{ codice: string }>).map((e) => e.codice), ["AB-0042", "AB-0043", "AB-0044"]);
  assert.equal((dry.output.elenco as Array<{ titolo: string }>)[1].titolo.length, 60);
  const limited = await run(["backfill-codes", "--workspace", WS, "--limit", "2", ...APPLY], { config: configRow(), missing });
  assert.equal(limited.output.status, "APPLIED");
  assert.equal(limited.writes.length, 2, "una transazione per riga");
  assert.deepEqual(limited.writes.map((w) => w[0].params), [[WS, "a"], [WS, "b"]]);
  assert.equal(limited.output.restanoSenzaCodice, 1);
  const none = await run(["backfill-codes", "--workspace", WS], { config: configRow(), missing: [] });
  assert.equal(none.output.status, "NOTHING_TO_DO");
  const full = await run(["backfill-codes", "--workspace", WS, ...APPLY], { config: configRow({ next_code_seq: 99998 }), missing });
  assert.equal(full.output.code, "oltre_99999");
  assert.equal(full.writes.length, 0);
  assert.equal((await run(["backfill-codes", "--workspace", WS, "--limit", "0"], { config: configRow(), missing })).output.code, "limit");
});
