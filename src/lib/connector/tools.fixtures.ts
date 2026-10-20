/**
 * Dati e dipendenze finte per i test dei tool e della rotta del connettore (WP5).
 * Tutto sintetico: workspace, guida, profilo e segnalazioni inventati.
 */
import { readFileSync } from "node:fs";
import type { NewUseCase, UseCase } from "../db/schema.ts";
import { CONNECTOR_DEFAULT_LIMITS } from "../db/connector-ddl.ts";
import type { ClaimOutcome, SubmitContributionDeps } from "../portfolio/submit-contribution.ts";
import type { ConnectorPrincipal } from "./auth.ts";
import type { ConnectorRuntimeConfig } from "./config.ts";
import { EXAMPLE_CONNECTOR_PROFILE_INPUT, EXAMPLE_INSTRUCTIONS_TEMPLATE } from "./contract.fixtures.ts";
import { CONSUME_RATE_LIMITS_SQL, type SqlExecutor } from "./rate-limit.ts";
import type { ContributionStatusView, SimilarContribution } from "./tool-queries.ts";
import { parseConnectorProfile, type ConnectorProfile, type ConnectorToolDeps } from "./tools.ts";

export const WORKSPACE_A = "11111111-1111-4111-8111-111111111111";
export const TOKEN_ID_A = "22222222-2222-4222-8222-222222222222";

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * La guida sintetica dei test: `docs/connettore/guida-esempio.json`, l'unica guida d'esempio
 * del repository, valida per lo schema di K8 (`guide-schema.test.ts`). La usano i test dei
 * tool, le suite d'integrazione e lo smoke con `next start` (`smoke-run.mjs`).
 */
export const EXAMPLE_GUIDE_PATH = new URL("../../../docs/connettore/guida-esempio.json", import.meta.url);
export const EXAMPLE_GUIDE: Readonly<Record<string, unknown>> = deepFreeze(JSON.parse(readFileSync(EXAMPLE_GUIDE_PATH, "utf8")) as Record<string, unknown>);

export const EXAMPLE_CONNECTOR_PROFILE: ConnectorProfile = (() => {
  const parsed = parseConnectorProfile(EXAMPLE_CONNECTOR_PROFILE_INPUT);
  if (!parsed.ok) throw new Error("Profilo d'esempio non valido");
  return parsed.profile;
})();

export function exampleRuntimeConfig(patch: Partial<ConnectorRuntimeConfig> = {}): ConnectorRuntimeConfig {
  return {
    workspaceId: WORKSPACE_A,
    slug: "prova-a",
    enabled: true,
    codePrefix: "XA",
    identityMode: "dichiarata",
    authMode: "header",
    workspaceDisplayName: "Alfa e Beta",
    guide: { ...EXAMPLE_GUIDE },
    guideVersion: "2026-10.1",
    allowedOrigins: [],
    limits: { ...CONNECTOR_DEFAULT_LIMITS },
    esgEnabled: false,
    profile: EXAMPLE_CONNECTOR_PROFILE,
    instructionsTemplate: EXAMPLE_INSTRUCTIONS_TEMPLATE,
    profileProblems: [],
    ...patch,
  };
}

export function examplePrincipal(patch: Partial<ConnectorPrincipal> = {}): ConnectorPrincipal {
  return {
    workspaceId: WORKSPACE_A,
    slug: "prova-a",
    principalKey: `token:${TOKEN_ID_A}`,
    identityMode: "dichiarata",
    scopes: ["connector:read", "connector:submit"],
    tokenId: TOKEN_ID_A,
    identityId: null,
    ...patch,
  };
}

/**
 * Limite di richieste in memoria: emula lo statement di `rate-limit.ts` (controllo e
 * consumo di tutti i secchi insieme). `consumed` dice quante unità ha ogni secchio.
 */
export function memoryRateLimiter() {
  const consumed = new Map<string, number>();
  const statements: string[] = [];
  const exec: SqlExecutor = async (text, params) => {
    statements.push(text);
    if (text !== CONSUME_RATE_LIMITS_SQL) return [];
    const rules = JSON.parse(String(params[0])) as Array<{ bucket: string; lim: number; cost: number }>;
    const allowed = rules.every((r) => (consumed.get(r.bucket) ?? 0) + r.cost <= r.lim);
    return rules.map((r) => {
      const used = consumed.get(r.bucket) ?? 0;
      if (allowed) consumed.set(r.bucket, used + r.cost);
      return { bucket: r.bucket, lim: r.lim, used, cost: r.cost, after_count: allowed ? used + r.cost : null, allowed, retry_after: 1800 };
    });
  };
  const total = (kind: "read" | "submit") =>
    [...consumed.entries()].filter(([bucket]) => bucket.endsWith(`:${kind}`)).reduce((sum, [, n]) => sum + n, 0);
  return { exec, consumed, statements, total };
}

export function fakeUseCase(data: Partial<UseCase> = {}): UseCase {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    workspaceId: WORKSPACE_A,
    title: "Riconciliazione automatica delle fatture fornitori",
    portfolioKind: "use_case_ai",
    status: "proposed",
    portfolioReviewStatus: "needs_inputs",
    reviewedBy: null,
    publicNote: null,
    intake: { contractVersion: 2 },
    code: "XA-0001",
    submittedAt: new Date("2026-10-14T08:00:00.000Z"),
    createdAt: new Date("2026-10-14T08:00:00.000Z"),
    ...data,
  } as UseCase;
}

export interface ToolHarnessOptions {
  claimOutcome?: ClaimOutcome;
  completedUseCaseId?: string | null;
  relatedCodes?: string[];
  search?: SimilarContribution[];
  statusByCode?: Record<string, ContributionStatusView>;
  recent?: ContributionStatusView[];
  /** Codice del dossier per id della segnalazione (invio ritrovato). */
  linkedCases?: Record<string, string>;
  createThrows?: Error;
  searchThrows?: Error;
  submit?: Partial<SubmitContributionDeps>;
}

/** Dipendenze finte dei tool, con i registri delle chiamate. */
export function toolHarness(opts: ToolHarnessOptions = {}) {
  const limiter = memoryRateLimiter();
  const calls: Record<string, unknown[]> = {};
  const record = (name: string, value: unknown) => {
    (calls[name] ??= []).push(value);
  };
  const logs: string[] = [];
  const tasks: Array<() => Promise<void>> = [];
  const created: Array<NewUseCase & { id: string }> = [];
  const submit: SubmitContributionDeps = {
    async claim(params) {
      record("claim", params);
      return (
        opts.claimOutcome ?? {
          status: "claimed",
          submission: { id: "sub-1", useCaseId: null, attempt: 1, reservedUseCaseId: "44444444-4444-4444-8444-444444444444" },
          takeover: false,
        }
      );
    },
    async complete(params) {
      record("complete", params);
      return true;
    },
    async fail(params) {
      record("fail", params);
      return true;
    },
    async readSubmission(id) {
      record("readSubmission", id);
      return { status: "pending", attempt: 1, useCaseId: null };
    },
    async createUseCase(data) {
      record("createUseCase", data);
      if (opts.createThrows) throw opts.createThrows;
      created.push(data);
      return {
        useCase: fakeUseCase({
          id: data.id,
          title: data.title,
          portfolioKind: data.portfolioKind ?? null,
          intake: (data.intake ?? null) as UseCase["intake"],
          reviewNotes: data.reviewNotes ?? null,
          submittedAt: data.submittedAt ?? null,
        }),
        created: true,
      };
    },
    async getUseCaseById(id) {
      record("getUseCaseById", id);
      return fakeUseCase({ id, code: "XA-0007" });
    },
    async autoScore(params) {
      record("autoScore", params);
      return fakeUseCase();
    },
    async notify(params) {
      record("notify", params);
    },
    async wasAnnounced(params) {
      record("wasAnnounced", params);
      return false;
    },
    ...opts.submit,
  };
  const deps: ConnectorToolDeps = {
    rateLimitExec: limiter.exec,
    async relatedCodeExists(workspaceId, code) {
      record("relatedCodeExists", { workspaceId, code });
      return (opts.relatedCodes ?? []).includes(code);
    },
    async findCompletedSubmission(params) {
      record("findCompletedSubmission", params);
      return opts.completedUseCaseId ?? null;
    },
    async searchContributions(params) {
      record("searchContributions", params);
      if (opts.searchThrows) throw opts.searchThrows;
      return opts.search ?? [];
    },
    async contributionStatusByCode(params) {
      record("contributionStatusByCode", params);
      return opts.statusByCode?.[params.code] ?? null;
    },
    async recentContributionsOfIdentity(params) {
      record("recentContributionsOfIdentity", params);
      return opts.recent ?? [];
    },
    async linkedCaseCode(params) {
      record("linkedCaseCode", params);
      return opts.linkedCases?.[params.useCaseId] ?? null;
    },
    submit,
    schedule: (task) => {
      tasks.push(task);
    },
    log: { error: (...args: unknown[]) => logs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")) },
    random: () => 0.5,
  };
  return { deps, calls, logs, tasks, created, limiter };
}
