import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import type { NewUseCase } from "../db/schema.ts";
import type { ExternalContributionPayload } from "./external-submission.ts";
import type { Participation } from "./participation.ts";

// «Partecipazione per area» sul database locale di prova, con i moduli veri dell'app
// (createUseCase, buildUseCaseDataFromExternalContribution, la query della pagina):
//   node scripts/connettore-test/run-db-tests.mjs
// Stesse condizioni della suite dell'invio (submission.integration.test.ts):
// CONN_TEST_ISOLATED=true, DATABASE_URL di loopback uguale a UC_TEST_DATABASE_URL, il
// trasporto locale scripts/uc-test/local-neon.cjs e il resolver dell'app. Dati sintetici,
// creati e cancellati dalla suite.
const url = process.env.DATABASE_URL;
const enabled = process.env.CONN_TEST_ISOLATED === "true" && Boolean(url);
if (enabled) {
  const parsed = new URL(url!);
  if (parsed.hostname !== "127.0.0.1" || process.env.UC_TEST_DATABASE_URL !== url) {
    throw new Error("Participation DB tests need a loopback DATABASE_URL equal to UC_TEST_DATABASE_URL");
  }
  if ((globalThis.fetch as { name?: string }).name !== "localNeonFetch") {
    throw new Error("Preload scripts/uc-test/local-neon.cjs to reach the local test database");
  }
}
const opts = { skip: !enabled };

type App = {
  createUseCase: typeof import("../db/queries/use-cases.ts").createUseCase;
  build: typeof import("./external-submission.ts").buildUseCaseDataFromExternalContribution;
  participation: typeof import("../db/queries/portfolio-participation.ts").getPortfolioParticipation;
  countsSql: typeof import("../db/queries/portfolio-participation.ts").participationCountsSql;
  q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
};
let app: App;

const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), wsA: randomUUID(), wsB: randomUUID(), wsC: randomUUID() };
/** Dati di chi propone: nessuno deve uscire dalla query né dalle props della scheda. */
const PROPOSER_NAME = `Persona Inventata ${suffix}`;
const PROPOSER_EMAIL = `persona.inventata.${suffix}@example.test`;
const FORM_EMAIL = `modulo.${suffix}@cliente.test`;
const SLACK_USER = `U${suffix.toUpperCase()}SLACK`;
const PROPOSER_VALUES = [PROPOSER_NAME, PROPOSER_EMAIL, FORM_EMAIL, SLACK_USER, suffix];

const GUIDE = {
  guideVersion: "1.0",
  workspace: { nome: "TopJet e Aliserio", società: ["topjet", "aliserio", "entrambe"], esgEnabled: false },
  areas: [
    { id: "operazioni", label: "Operazioni" },
    { id: "vendite", label: "Vendite" },
    { id: "persone", label: "Persone" },
    { id: "legale", label: "Legale" },
  ],
};

type Kind = "best_practice" | "use_case_ai";
type Spec = {
  via: "connector" | "rest" | "web_proposed" | "slack_proposed" | "learning" | "ai_readiness_assessment" | "generated";
  kind?: Kind | null;
  area?: string;
  company?: string;
  review?: NewUseCase["portfolioReviewStatus"];
  status?: NewUseCase["status"];
  intake?: Record<string, unknown>;
};

let seq = 0;
/** Una proposta con i campi che ogni canale scrive davvero. */
async function proposal(workspaceId: string, spec: Spec) {
  seq += 1;
  const kind = spec.kind === undefined ? "use_case_ai" : spec.kind;
  let data: NewUseCase;
  if (spec.via === "connector" || spec.via === "rest") {
    const payload = {
      idempotencyKey: `partecipazione-${suffix}-${seq}`,
      confirmedByUser: true,
      contributionKind: kind ?? "use_case_ai",
      submittedBy: { name: PROPOSER_NAME, email: PROPOSER_EMAIL },
      title: `Proposta sintetica ${seq}`,
      problem: "Oggi il lavoro si fa a mano e arriva tardi.",
      flowDescription: "Un assistente prepara la bozza e la persona la rivede.",
      humanInTheLoop: "Chi chiede approva prima dell'invio.",
      guardrails: "Nessun invio automatico.",
      expectedImpact: "Meno tempo speso e meno ritardi.",
      dataRequirements: "Documenti del processo.",
      ...(spec.area ? { area: spec.area } : {}),
      ...(spec.company ? { company: spec.company } : {}),
    } as ExternalContributionPayload;
    data = app.build({ payload, workspaceId, esgEnabled: false, channel: spec.via });
  } else {
    data = {
      workspaceId,
      title: `Proposta sintetica ${seq}`,
      portfolioKind: kind,
      status: "proposed",
      source: spec.via === "generated" ? null : spec.via,
      proposedBy:
        spec.via === "web_proposed" ? FORM_EMAIL
        : spec.via === "slack_proposed" ? SLACK_USER
        : spec.via === "generated" ? null
        : PROPOSER_NAME,
      portfolioReviewStatus: "needs_inputs",
    };
  }
  if (spec.review) data.portfolioReviewStatus = spec.review;
  if (spec.status) data.status = spec.status;
  if (spec.intake) data.intake = { ...(data.intake ?? {}), ...spec.intake };
  return app.createUseCase(data);
}

/** Ogni chiave di un valore JSON, a qualunque profondità. */
function keysOf(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => keysOf(item, out));
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      out.add(key);
      keysOf(item, out);
    }
  }
  return out;
}

before(async () => {
  if (!enabled) return;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  const [useCases, external, participation] = await Promise.all([
    import("../db/queries/use-cases.ts"),
    import("./external-submission.ts"),
    import("../db/queries/portfolio-participation.ts"),
  ]);
  app = {
    createUseCase: useCases.createUseCase,
    build: external.buildUseCaseDataFromExternalContribution,
    participation: participation.getPortfolioParticipation,
    countsSql: participation.participationCountsSql,
    q: (text, params = []) => sql.query(text, params) as Promise<Record<string, unknown>[]>,
  };
  await app.q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova', $2)`, [ids.org, `org-aree-${suffix}`]);
  for (const [id, name] of [[ids.wsA, "A"], [ids.wsB, "B"], [ids.wsC, "C"]]) {
    await app.q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, $3)`, [id, ids.org, `Workspace ${name} ${suffix}`]);
  }
  // A e C: connettore con la guida (aree e società); C non ha proposte. B: nessuna guida.
  for (const [id, prefix] of [[ids.wsA, "TJ"], [ids.wsC, "TC"]]) {
    await app.q(
      `INSERT INTO workspace_connector_configs (workspace_id, slug, code_prefix, guide, guide_version) VALUES ($1, $2, $3, $4::jsonb, '1.0')`,
      [id, `aree-${prefix.toLowerCase()}-${suffix}`, prefix, JSON.stringify(GUIDE)]
    );
  }

  const A = ids.wsA;
  // Contano: connettore, REST, modulo, Slack, idea da un corso; anche una scartata.
  for (const kind of ["best_practice", "best_practice", "use_case_ai", "use_case_ai"] as const) {
    await proposal(A, { via: "connector", kind, area: "operazioni", company: "topjet" });
  }
  await proposal(A, { via: "rest", area: "operazioni", company: "topjet" });
  await proposal(A, { via: "connector", area: "operazioni", company: "topjet", status: "rejected" });
  for (const kind of ["best_practice", "use_case_ai", "use_case_ai"] as const) {
    await proposal(A, { via: "connector", kind, area: "vendite", company: "aliserio" });
  }
  await proposal(A, { via: "connector", area: "persone", company: "aliserio" });
  await proposal(A, { via: "connector", area: "persone", company: "aliserio" });
  await proposal(A, { via: "connector", kind: "best_practice", area: "legale", company: "entrambe" });
  await proposal(A, { via: "connector", area: "operazioni", company: "entrambe" });
  await proposal(A, { via: "connector", area: "operazioni", company: "entrambe" });
  await proposal(A, { via: "rest", area: "logistica", company: "topjet" }); // area fuori dalla guida
  await proposal(A, { via: "web_proposed", kind: "best_practice" });
  await proposal(A, { via: "slack_proposed" });
  await proposal(A, { via: "learning", status: "draft" });
  // Non contano: archiviate (anche un doppione), nascoste ai colleghi, generate dall'AI,
  // importate dalla diagnostica, fuori dalla raccolta.
  await proposal(A, { via: "connector", area: "operazioni", company: "topjet", review: "archived", intake: { archiveReason: "superato" } });
  await proposal(A, { via: "connector", area: "operazioni", company: "topjet", review: "archived", intake: { archiveReason: "duplicato", duplicateOfCode: "TJ-0001" } });
  await proposal(A, { via: "connector", area: "vendite", company: "aliserio", intake: { hiddenFromSearch: "true" } });
  await proposal(A, { via: "generated" });
  await proposal(A, { via: "ai_readiness_assessment" });
  await proposal(A, { via: "generated", kind: null });

  // B: stesse aree, nessuna guida; le sue proposte non entrano in A.
  for (let i = 0; i < 3; i++) await proposal(ids.wsB, { via: "connector", area: "operazioni", company: "topjet" });
});

after(async () => {
  if (!enabled) return;
  await app.q(`DELETE FROM organizations WHERE id = $1`, [ids.org]);
});

test("conta per area le proposte dei colleghi, con soglia, ordine ed esclusioni", opts, async () => {
  const result = await app.participation(ids.wsA);
  assert.deepEqual(result, {
    rows: [
      { label: "Operazioni", count: 8, bestPractices: 2 },
      { label: "Vendite", count: 3, bestPractices: 1 },
      { label: "Altre aree", count: 4, bestPractices: 1 },
      { label: "Area non indicata", count: 3, bestPractices: 1 },
    ],
    // La riga somma ogni proposta con una società (7 + 5 + 3 = 15 = 18 − 3 senza area):
    // per differenza non si ricava nulla. La grafia viene dal nome del workspace.
    companies: [
      { label: "TopJet", count: 7 },
      { label: "Aliserio", count: 5 },
      { label: "Entrambe le società", count: 3 },
    ],
  } satisfies Participation);
});

test("le righe salvate dal connettore portano area e società in intake, chi propone altrove", opts, async () => {
  const rows = await app.q(
    `SELECT source, intake ->> 'area' AS area, intake ->> 'company' AS company, proposed_by, intake ->> 'submitterEmail' AS email
       FROM use_cases WHERE workspace_id = $1 AND source = 'claude_connector' AND intake ->> 'area' = 'legale'`,
    [ids.wsA]
  );
  assert.deepEqual(rows, [{ source: "claude_connector", area: "legale", company: "entrambe", proposed_by: PROPOSER_NAME, email: PROPOSER_EMAIL }]);
});

test("nessun dato di chi propone nella query, nel risultato o nelle props della scheda", opts, async () => {
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const { sql: text, params } = new PgDialect().sqlToQuery(app.countsSql(ids.wsA));
  for (const forbidden of ["proposed_by", "submitted_by", "submitterEmail", "reviewed_by", "users", "principal", "email", "name"]) {
    assert.ok(!text.includes(forbidden), `la query non legge ${forbidden}`);
  }
  assert.deepEqual([...text.matchAll(/intake ->> '([A-Za-z]+)'/g)].map((m) => m[1]).sort(), ["area", "company", "hiddenFromSearch"]);
  assert.deepEqual(params, [ids.wsA, "claude_connector", "claude_mcp", "web_proposed", "slack_proposed", "learning"]);

  const participation = await app.participation(ids.wsA);
  assert.ok(participation);
  // Le props della scheda sono esattamente queste: si serializzano così nel payload RSC.
  const props = JSON.stringify({ participation });
  for (const value of PROPOSER_VALUES) assert.ok(!props.includes(value), "nessun dato di chi propone nelle props");
  assert.deepEqual([...keysOf(JSON.parse(props))].sort(), ["bestPractices", "companies", "count", "label", "participation", "rows"]);
  // Le righe di A hanno davvero quei dati: la query li lascia nel database.
  const [stored] = await app.q(`SELECT count(*)::int AS n FROM use_cases WHERE workspace_id = $1 AND proposed_by IN ($2, $3, $4)`, [
    ids.wsA,
    PROPOSER_NAME,
    FORM_EMAIL,
    SLACK_USER,
  ]);
  assert.ok(Number(stored.n) >= 10);
});

test("solo il proprio workspace: senza guida la scheda non c'è; con la guida e nessuna proposta è vuota", opts, async () => {
  assert.equal(await app.participation(ids.wsB), null);
  assert.deepEqual(await app.participation(ids.wsC), { rows: [], companies: [] });
});
