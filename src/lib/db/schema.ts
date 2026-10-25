import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  real,
  integer,
  pgEnum,
  boolean,
  primaryKey,
  index,
  uniqueIndex,
  char,
  customType,
  date,
  numeric,
  smallint,
  unique,
} from "drizzle-orm/pg-core";
import type { Approval, Fallback, PartialNa, Waiver } from "../uc/types.ts";
import { CONNECTOR_DEFAULT_LIMITS, type ConnectorLimits } from "./connector-ddl.ts";
import type {
  UseCaseEventAction,
  UseCaseEventActorKind,
  UseCaseEventChannel,
  UseCaseEventField,
  UseCaseMcpRequestStatus,
} from "./use-case-hub-ddl.ts";
import type {
  UseCaseNeedAvailability,
  UseCaseNeedKind,
  UseCaseNeedOwnerSide,
  UseCaseNeedStatus,
  UseCaseNeedType,
} from "./use-case-hub-value-ddl.ts";
import type { Origin as UseCaseOrigin } from "../use-cases/types.ts";
import type { ValueModel as UseCaseValueModel } from "../use-cases/value-model.ts";
import type {
  AnswerDevice,
  AnswerKind,
  BlockerStatus,
  CaseRole,
  CaseStatus,
  CatalogVersionReason,
  CommentKind,
  CommentVisibility,
  Confidence,
  ContactChannel,
  DataMode,
  DatasetStatus,
  EventActorType,
  FilePersonalData,
  GateDecision,
  GateKey,
  ItemBlockerOrigin,
  ItemKind,
  ItemSection,
  ItemStatus,
  KpiPhase,
  Lever,
  LinkRelation,
  MapKind,
  MapSource,
  ModelRunKind,
  NotificationChannel,
  NotificationStatus,
  Perimeter,
  Phase,
  Priority,
  PrivacyClass,
  ProvisionalStatus,
  RecordedBy,
  RequestChannel,
  RequestItemState,
  RequestPurpose,
  RequestStatus,
  ResponseType,
  RoiScenario,
  RoiStatus,
  ScanStatus,
  SourceBasis,
  SourceKind,
  StorageZone,
  TemplateStatus,
  TestCaseKind,
  TestCaseResult,
  TokenIssuedFor,
  ValidationKind,
  ValidationOutcome,
  ValueVisibility,
} from "../uc/vocab.ts";

// ─── Enums ──────────────────────────────────────────────────────────

export const memberRoleEnum = pgEnum("member_role", [
  "exec_sponsor",
  "transformation_lead",
  "function_lead",
  "contributor",
  "analyst",
  // Appeso in coda: l'ordine deve combaciare con l'ALTER TYPE della
  // migrazione 0013. Chi entra da un link di corso ottiene solo questo, e
  // `isLearnerOnly` lo tiene dentro la sola area Formazione.
  "learner",
]);

export const workspaceStatusEnum = pgEnum("workspace_status", [
  "setup",
  "mapping",
  "analysis",
  "complete",
]);

export const goalTypeEnum = pgEnum("goal_type", [
  "goal",
  "objective",
  "key_result",
]);

export const goalDirectionEnum = pgEnum("goal_direction", [
  "increase",
  "decrease",
  "maintain",
]);

export const departmentStatusEnum = pgEnum("department_mapping_status", [
  "not_started",
  "in_progress",
  "mapped",
  "validated",
]);

export const workTypeEnum = pgEnum("work_type", [
  "enrichment",
  "detection",
  "interpretation",
  "delivery",
]);

export const classificationEnum = pgEnum("classification", [
  "automate",
  "differentiate",
  "innovate",
  "automatable",
  "augmentable",
  "differentiating",
  "emerging_opportunity",
  "blocked_by_system",
  "blocked_by_governance",
]);

export const portfolioCategoryDbEnum = pgEnum("use_case_category", [
  "quick_win",
  "strategic_bet",
  "capability_builder",
  "not_yet",
]);

export const portfolioStatusDbEnum = pgEnum("use_case_status", [
  "draft",
  "proposed",
  "accepted",
  "in_progress",
  "implemented",
  "rejected",
]);

export const portfolioReviewStatusEnum = pgEnum("portfolio_review_status", [
  "needs_inputs",
  "in_review",
  "scored",
  "archived",
]);

export const conversationTypeEnum = pgEnum("conversation_type", [
  "leadership_setup",
  "context_setup",
  "activity_mapping",
  "analysis",
  "general",
]);

export const conversationStatusEnum = pgEnum("conversation_status", [
  "active",
  "paused",
  "completed",
]);

export const reportTypeEnum = pgEnum("report_type", [
  "executive_summary",
  "value_thesis",
  "activity_map",
  "value_map",
  "use_case_portfolio",
  "unbundle_plan",
  "full_report",
]);

export type AiReadinessTemplateJson = {
  pillars: unknown[];
  sections: unknown[];
  questions: unknown[];
  scoringSchema: unknown;
};

// ─── Auth.js required tables ────────────────────────────────────────

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  firebaseUid: varchar("firebase_uid", { length: 128 }).unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 255 }).notNull().unique(),
  emailVerified: timestamp("email_verified", { mode: "date" }),
  image: text("image"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 255 }).notNull(),
    provider: varchar("provider", { length: 255 }).notNull(),
    providerAccountId: varchar("provider_account_id", {
      length: 255,
    }).notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: varchar("token_type", { length: 255 }),
    scope: varchar("scope", { length: 255 }),
    id_token: text("id_token"),
    session_state: varchar("session_state", { length: 255 }),
  },
  (account) => [
    primaryKey({ columns: [account.provider, account.providerAccountId] }),
  ]
);

export const sessions = pgTable("sessions", {
  sessionToken: varchar("session_token", { length: 255 })
    .notNull()
    .primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: varchar("identifier", { length: 255 }).notNull(),
    token: varchar("token", { length: 255 }).notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })]
);

// ─── Organizations ──────────────────────────────────────────────────

export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  industry: varchar("industry", { length: 255 }),
  size: varchar("size", { length: 100 }),
  companyValueThesis: jsonb("company_value_thesis"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const memberships = pgTable("memberships", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  role: memberRoleEnum("role").notNull().default("contributor"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

// ─── Workspaces ─────────────────────────────────────────────────────

export const workspaces = pgTable("workspaces", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  status: workspaceStatusEnum("status").notNull().default("setup"),
  systemBoundary: jsonb("system_boundary"),
  unitTerminology: jsonb("unit_terminology").$type<{
    singular: string;
    plural: string;
  }>(),
  esgEnabled: boolean("esg_enabled").notNull().default(false),
  /**
   * Nome del team che valuta gli use case, scelto dal workspace (es. «CoE AI»).
   * Vuoto: vale `DEFAULT_REVIEW_TEAM_NAME` di `src/lib/review-team.ts`, l'unico posto
   * con il valore predefinito (docs/use-case/DESIGN.md §14.2); lo legge `reviewTeamName()`.
   * Usato in copy UI e notifiche Slack, senza articolo né «team» davanti.
   * La colonna non si rinomina.
   */
  aiTransformationTeamName: varchar("ai_transformation_team_name", {
    length: 255,
  }),
  /**
   * URL di webhook generico per inoltrare le notifiche sul gruppo/team
   * (es. relay WhatsApp via Zapier / Make / Twilio / endpoint custom).
   * Se impostato, Unbundle POSTa un JSON `{ text, link, event }`.
   */
  whatsappWebhookUrl: varchar("whatsapp_webhook_url", { length: 1000 }),
  /** Contatore di revoca dei link pubblici del portfolio (src/lib/portfolio/share-link.ts). */
  portfolioShareEpoch: integer("portfolio_share_epoch").notNull().default(0),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

// ─── Workspace Collaboration ────────────────────────────────────────

export const workspaceMemberships = pgTable(
  "workspace_memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: memberRoleEnum("role").notNull().default("contributor"),
    source: varchar("source", { length: 50 }).notNull().default("direct"),
    invitedByUserId: uuid("invited_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("workspace_memberships_workspace_user_idx").on(
      t.workspaceId,
      t.userId
    ),
    index("workspace_memberships_user_idx").on(t.userId),
  ]
);

export const workspaceInvitations = pgTable(
  "workspace_invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 255 }),
    role: memberRoleEnum("role").notNull().default("contributor"),
    tokenHash: varchar("token_hash", { length: 128 }).notNull().unique(),
    maxUses: integer("max_uses").notNull().default(1),
    usedCount: integer("used_count").notNull().default(0),
    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
    revokedAt: timestamp("revoked_at", { mode: "date" }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    index("workspace_invitations_workspace_idx").on(t.workspaceId),
    index("workspace_invitations_token_hash_idx").on(t.tokenHash),
  ]
);

export const workspaceInvitationAcceptances = pgTable(
  "workspace_invitation_acceptances",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    invitationId: uuid("invitation_id")
      .notNull()
      .references(() => workspaceInvitations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    emailSnapshot: varchar("email_snapshot", { length: 255 }),
    acceptedAt: timestamp("accepted_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("workspace_invitation_acceptances_invite_user_idx").on(
      t.invitationId,
      t.userId
    ),
    index("workspace_invitation_acceptances_workspace_idx").on(t.workspaceId),
  ]
);

// ─── Workspace Integration Tokens ───────────────────────────────────

export const workspaceIntegrationTokens = pgTable(
  "workspace_integration_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    label: varchar("label", { length: 255 }).notNull(),
    provider: varchar("provider", { length: 50 }).notNull().default("claude_mcp"),
    tokenHash: varchar("token_hash", { length: 128 }).notNull().unique(),
    tokenPrefix: varchar("token_prefix", { length: 32 }).notNull(),
    scopes: jsonb("scopes").$type<string[]>().notNull().default(["portfolio:submit"]),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    lastUsedAt: timestamp("last_used_at", { mode: "date" }),
    expiresAt: timestamp("expires_at", { mode: "date" }),
    revokedAt: timestamp("revoked_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
    /** Token arrivato dentro un indirizzo: «esposto, da revocare» (coda della 0019, connettore WP4). */
    exposedAt: timestamp("exposed_at", { mode: "date" }),
    /**
     * Token personale del MCP del team (drizzle/0020): la persona che lo possiede.
     * Vale esattamente quanto lei e sparisce con lei. NULL per i token di workspace
     * di oggi. Indice parziale `workspace_integration_tokens_owner_idx` nella migrazione.
     */
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [
    index("workspace_integration_tokens_workspace_idx").on(t.workspaceId),
    index("workspace_integration_tokens_hash_idx").on(t.tokenHash),
  ]
);

// ─── Workspace Scoring Model (ranking configurabile) ─────────────────

export const workspaceScoringModels = pgTable("workspace_scoring_models", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" })
    .unique(),
  /**
   * Se ON, l'Impact Flag (opzionale sul singolo use case) entra nel motore e,
   * quando true, abilita l'inclusione ESG nel calcolo impatto/ranking.
   */
  impactFlagEnabled: boolean("impact_flag_enabled").notNull().default(false),
  /**
   * Pesi e soglie del modello.
   * - weights: pesi per dimensione (impact/feasibility/esg) + aggregazione
   * - thresholds: soglie matrice (highImpact, highFeasibility, midImpact)
   */
  /**
   * Configurazione del modello di ranking.
   *
   * `dimensions` è il cuore editabile: l'azienda definisce quali KPI compongono
   * Impatto / Fattibilità / ESG (id, label, description, peso). ESG è inclusa nel
   * ranking solo se `workspaces.esg_enabled = true`.
   *
   * I campi `weights` (legacy, sub-criteri fissi) restano opzionali per retrocompatibilità;
   * `dimensions` ha priorità quando presente.
   */
  config: jsonb("config").$type<{
    dimensions?: {
      impact: Array<{
        id: string;
        label: string;
        description?: string;
        weight: number;
        direction?: "higher_better" | "lower_better";
      }>;
      feasibility: Array<{
        id: string;
        label: string;
        description?: string;
        weight: number;
        direction?: "higher_better" | "lower_better";
      }>;
      esg: Array<{
        id: string;
        label: string;
        description?: string;
        weight: number;
        direction?: "higher_better" | "lower_better";
      }>;
    };
    weights?: {
      impact?: Record<string, number>;
      feasibility?: Record<string, number>;
      esg?: Record<string, number>;
      /** Peso relativo dell'asse impatto vs fattibilità vs ESG nel ranking finale. */
      overall: { impact: number; feasibility: number; esg?: number; esgWhenEnabled?: number };
    };
    thresholds: {
      highImpact: number;
      highFeasibility: number;
      midImpact: number;
    };
  }>(),
  updatedByUserId: uuid("updated_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

// ─── Strategic Goals (OKR hierarchy) ────────────────────────────────

export const strategicGoals = pgTable("strategic_goals", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  parentId: uuid("parent_id"),
  type: goalTypeEnum("type").notNull(),
  title: varchar("title", { length: 500 }).notNull(),
  description: text("description"),
  direction: goalDirectionEnum("direction"),
  targetValue: real("target_value"),
  currentValue: real("current_value"),
  owner: varchar("owner", { length: 255 }),
  timeframe: varchar("timeframe", { length: 100 }),
  kpiName: varchar("kpi_name", { length: 255 }),
  kpiUnit: varchar("kpi_unit", { length: 100 }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

// ─── Departments ────────────────────────────────────────────────────

export const departments = pgTable("departments", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  headName: varchar("head_name", { length: 255 }),
  mappingStatus: departmentStatusEnum("mapping_status")
    .notNull()
    .default("not_started"),
  teamSize: integer("team_size"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

// ─── Activities ─────────────────────────────────────────────────────

export const activities = pgTable("activities", {
  id: uuid("id").defaultRandom().primaryKey(),
  departmentId: uuid("department_id")
    .notNull()
    .references(() => departments.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 500 }).notNull(),
  description: text("description"),
  workType: workTypeEnum("work_type"),
  classification: classificationEnum("classification"),
  confidenceScore: real("confidence_score"),
  frequency: varchar("frequency", { length: 100 }),
  timeSpentHoursWeek: real("time_spent_hours_week"),
  toolsUsed: jsonb("tools_used").$type<string[]>(),
  inputDescription: text("input_description"),
  outputDescription: text("output_description"),
  decisionPoints: text("decision_points"),
  dependencies: jsonb("dependencies").$type<string[]>(),
  painPoints: text("pain_points"),
  dataRequired: text("data_required"),
  qualityPerceived: varchar("quality_perceived", { length: 100 }),
  onetTaskId: varchar("onet_task_id", { length: 50 }),
  onetMatchScore: real("onet_match_score"),
  aiExposureScore: real("ai_exposure_score"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

// ─── Activity Dependencies ──────────────────────────────────────────

export const activityDependencies = pgTable(
  "activity_dependencies",
  {
    sourceActivityId: uuid("source_activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    targetActivityId: uuid("target_activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    dependencyType: varchar("dependency_type", { length: 100 }),
  },
  (t) => [primaryKey({ columns: [t.sourceActivityId, t.targetActivityId] })]
);

// ─── Use Cases ──────────────────────────────────────────────────────

export const useCases = pgTable("use_cases", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 500 }).notNull(),
  description: text("description"),
  businessCase: text("business_case"),
  /**
   * Tipologia “portfolio” per contributi bottom-up (spec Slack):
   * - best_practice
   * - use_case_ai
   *
   * Separata da `category` (wave / priorità) per non rompere scoring e UI esistenti.
   */
  portfolioKind: varchar("portfolio_kind", { length: 50 }),
  category: portfolioCategoryDbEnum("category"),
  status: portfolioStatusDbEnum("status").notNull().default("draft"),
  source: varchar("source", { length: 50 }),
  proposedBy: varchar("proposed_by", { length: 255 }),
  /**
   * Flag opzionale a livello use case. Entra nel motore solo se
   * `workspace_scoring_models.impact_flag_enabled` è ON.
   */
  impactFlag: boolean("impact_flag"),
  /**
   * Stato di triage/review (governance) per i contributi bottom-up (Slack/web).
   * Indipendente da `status` (lifecycle delivery).
   */
  portfolioReviewStatus: portfolioReviewStatusEnum("portfolio_review_status")
    .notNull()
    .default("needs_inputs"),
  submittedAt: timestamp("submitted_at", { mode: "date" }),
  reviewedAt: timestamp("reviewed_at", { mode: "date" }),
  reviewedBy: uuid("reviewed_by").references(() => users.id, {
    onDelete: "set null",
  }),
  reviewNotes: text("review_notes"),
  flowDescription: text("flow_description"),
  humanInTheLoop: text("human_in_the_loop"),
  guardrails: text("guardrails"),
  dataRequirements: text("data_requirements"),
  sustainabilityImpact: text("sustainability_impact"),
  impactEconomic: real("impact_economic"),
  impactTime: real("impact_time"),
  impactQuality: real("impact_quality"),
  impactCoordination: real("impact_coordination"),
  impactSocial: real("impact_social"),
  feasibilityData: real("feasibility_data"),
  feasibilityWorkflow: real("feasibility_workflow"),
  feasibilityRisk: real("feasibility_risk"),
  feasibilityTech: real("feasibility_tech"),
  feasibilityTeam: real("feasibility_team"),
  esgEnvironmental: real("esg_environmental"),
  esgSocial: real("esg_social"),
  esgGovernance: real("esg_governance"),
  /**
   * Punteggi 0–5 per i KPI **custom** definiti dal workspace.
   * Chiave = KPI id (stesso id usato nel `workspace_scoring_models.config.dimensions`),
   * Valore = numero in [0,5]. Si appoggia a questa colonna quando il cliente
   * ha personalizzato i KPI (oltrepassa le 13 sub-dimensioni storiche).
   *
   * Formato:
   * { impact: { [kpiId]: number }, feasibility: { [kpiId]: number }, esg?: { [kpiId]: number } }
   */
  customScores: jsonb("custom_scores").$type<{
    impact?: Record<string, number>;
    feasibility?: Record<string, number>;
    esg?: Record<string, number>;
  }>(),
  overallEsgScore: real("overall_esg_score"),
  overallImpactScore: real("overall_impact_score"),
  overallFeasibilityScore: real("overall_feasibility_score"),
  overallScore: real("overall_score"),
  sequenceOrder: integer("sequence_order"),
  timeline: varchar("timeline", { length: 255 }),
  requirements: jsonb("requirements").$type<string[]>(),
  dataDependencies: jsonb("data_dependencies").$type<string[]>(),
  relatedActivityIds: jsonb("related_activity_ids").$type<string[]>(),
  /**
   * Connettore MCP (drizzle/0019): codice leggibile per workspace (es. TJ-0012),
   * assegnato da `assignUseCaseCode` a ogni nuovo use case (la riga di
   * `workspace_connector_configs`, se manca, nasce lì, con il connettore spento).
   * Indice unico parziale (workspace_id, code) e CHECK sul formato nella migrazione.
   */
  code: varchar("code", { length: 20 }),
  /** Campi raccolti dal connettore (area, strumenti, stima di chi propone, flag…). */
  intake: jsonb("intake").$type<Record<string, unknown>>(),
  /** Nota visibile tramite Claude a chi conosce il codice (max 1.000 caratteri). */
  publicNote: text("public_note"),
  /** Ultimo cambio di `status` o `portfolio_review_status` (trigger in drizzle/0019). */
  statusChangedAt: timestamp("status_changed_at", { mode: "date", withTimezone: true }).defaultNow(),
  /** Identità verificata di chi propone (fase 2, OAuth). */
  submittedByUserId: uuid("submitted_by_user_id").references(() => connectorIdentities.id, {
    onDelete: "set null",
  }),
  /*
   * Area «Use case» (drizzle/0020, docs/use-case/DESIGN.md §3.1 e §10.1). Ogni colonna
   * è nullable o ha un default: il codice di oggi inserisce ancora senza nominarle.
   * CHECK, indici delle viste e trigger stanno solo nella migrazione e in
   * src/lib/db/use-case-hub-ddl.ts (self-heal): mai drizzle-kit su queste colonne.
   */
  /** «AI Adoption · dal basso» (`adoption`) o «AI Transformation · dall'alto» (`transformation`). */
  origin: varchar("origin", { length: 20 })
    .$type<UseCaseOrigin>()
    .notNull()
    .default("adoption"),
  /** Nome dell'AI Lab da cui nasce, es. «AI Lab Finanza · 12 ott». */
  aiLab: varchar("ai_lab", { length: 120 }),
  /** «Quando», solo per gli approvati: trimestre `2027-Q1`; NULL = «Più avanti». */
  targetQuarter: varchar("target_quarter", { length: 7 }),
  /** Data di revisione `AAAA-MM-GG`, solo per i rimandati. */
  reviewBy: date("review_by", { mode: "string" }),
  /** Valore stimato dal team, euro all'anno. */
  valueEurYear: integer("value_eur_year"),
  /** Costo di realizzazione del team, importo una tantum. Mai insieme a `costBand` (CHECK). */
  costEurOnce: integer("cost_eur_once"),
  /**
   * Costo di realizzazione del team come fascia, indice 1-5. Le fasce (confini ed
   * etichette) sono del workspace, in `workspace_scoring_models.config.costBands` (D15):
   * un cambio di fasce non riscrive questo indice, che si rilegge con l'etichetta nuova.
   */
  costBand: smallint("cost_band"),
  /** Punteggi e motivazione dell'AI. Lo scrive solo l'AI; non fa salire `version`. */
  aiSuggestion: jsonb("ai_suggestion").$type<UseCaseAiSuggestion>(),
  /**
   * Controllo di versione delle scritture: lo alza il trigger `use_cases_bump_version`
   * solo quando cambia una colonna che una persona modifica. Chi lo scrive a mano non lo cambia.
   */
  version: integer("version").notNull().default(1),
  /**
   * Modello dei benefici (drizzle/0022): voci, costi, facilità e piano, nella forma di
   * `valueModelSchema` (src/lib/use-cases/value-model.ts); NULL = nessun modello. Valore e
   * costo si calcolano in lettura. Un cambio alza `version` (trigger `use_cases_value_model_version`).
   */
  valueModel: jsonb("value_model").$type<UseCaseValueModel>(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

/** Punteggi 0–5 per KPI, divisi per dimensione: la stessa forma di `useCases.customScores`. */
export type UseCaseKpiScores = {
  impact?: Record<string, number>;
  feasibility?: Record<string, number>;
  esg?: Record<string, number>;
};

/**
 * `use_cases.ai_suggestion` (docs/use-case/DESIGN.md §7.6): punteggi dell'AI per KPI e
 * motivazione. `v1Backup` è la copia che `use-case-admin scoring-v2` salva prima del
 * passaggio alla v2, per poter tornare indietro.
 */
export type UseCaseAiSuggestion = {
  scores?: UseCaseKpiScores;
  rationale?: string | null;
  model?: string | null;
  /** Istante ISO della stima. */
  at?: string;
  kind?: "auto" | "suggerimento" | "ricalibrazione";
  /**
   * Copia della v1 salvata da `scoring-v2 --apply` (§7.6 punto 4): `--revert` rimette
   * `custom_scores` e `review_notes` da qui (punto 5).
   */
  v1Backup?: {
    customScores: UseCaseKpiScores | null;
    reviewNotes: string | null;
    /** Istante ISO della copia. */
    at: string;
  };
};

// ─── Area «Use case» (drizzle/0020) ──────────────────────────────────
// CHECK, indici parziali e trigger stanno solo nella migrazione e in
// src/lib/db/use-case-hub-ddl.ts (self-heal): mai drizzle-kit su queste tabelle.

/**
 * Storia di uno use case, senza testi (docs/use-case/DESIGN.md §10.3): chi del team ha
 * agito, canale, azione e nomi dei campi da un elenco chiuso. La creazione la scrive il
 * trigger `use_cases_created_event` con `actorUserId` NULL: la Storia non registra chi
 * propone. Nessun indice su `actor_user_id`: niente viste aggregate per persona.
 */
export const useCaseEvents = pgTable(
  "use_case_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    useCaseId: uuid("use_case_id")
      .notNull()
      .references(() => useCases.id, { onDelete: "cascade" }),
    at: timestamp("at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    /** Solo per le azioni di persone del team (`actorKind = 'persona'`, CHECK). */
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorKind: varchar("actor_kind", { length: 12 }).$type<UseCaseEventActorKind>().notNull(),
    channel: varchar("channel", { length: 20 }).$type<UseCaseEventChannel>().notNull(),
    action: varchar("action", { length: 30 }).$type<UseCaseEventAction>().notNull(),
    /** Nomi dei campi toccati, mai i testi (CHECK sull'elenco chiuso). */
    fields: text("fields").array().$type<UseCaseEventField[]>().notNull().default([]),
    /** Codici di fase, es. `da_valutare.nuova`, `approvato.trimestre`. */
    phaseBefore: varchar("phase_before", { length: 40 }),
    phaseAfter: varchar("phase_after", { length: 40 }),
  },
  (t) => [index("use_case_events_use_case_idx").on(t.useCaseId, t.at.desc())]
);

/**
 * Richieste idempotenti del MCP del team: una riga per (workspace, principal, chiave).
 * `result` tiene solo id, codici e versioni; `reservedIds` gli id decisi alla presa in
 * carico di `create_use_cases`, riusati a ogni ripresa.
 */
export const useCaseMcpRequests = pgTable(
  "use_case_mcp_requests",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    principalKey: varchar("principal_key", { length: 80 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    tool: varchar("tool", { length: 40 }).notNull(),
    requestHash: varchar("request_hash", { length: 128 }).notNull(),
    status: varchar("status", { length: 20 }).$type<UseCaseMcpRequestStatus>().notNull().default("pending"),
    result: jsonb("result").$type<Record<string, unknown>>(),
    reservedIds: uuid("reserved_ids").array(),
    attempt: integer("attempt").notNull().default(1),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({
      name: "use_case_mcp_requests_pkey",
      columns: [t.workspaceId, t.principalKey, t.idempotencyKey],
    }),
  ]
);

// ─── Benefici e «Cosa serve» (drizzle/0022) ──────────────────────────
// CHECK e trigger stanno solo nella migrazione e in src/lib/db/use-case-hub-value-ddl.ts
// (self-heal): mai drizzle-kit su queste tabelle.

/**
 * Esigenze del workspace: requisiti per far avanzare gli use case (gli 8 stati delle voci) e
 * prossimi passi (proposta, confermata, fatta). Non si cancellano: si archiviano
 * (`archivedAt`, `archiveReason`). `importKey` è unica per workspace (upsert del MCP).
 */
export const useCaseNeeds = pgTable(
  "use_case_needs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 12 }).$type<UseCaseNeedType>().notNull(),
    kind: varchar("kind", { length: 20 }).$type<UseCaseNeedKind>().notNull().default("altro"),
    title: varchar("title", { length: 300 }).notNull(),
    detail: varchar("detail", { length: 4000 }),
    /** Chi se ne occupa, a parole (testo libero). */
    ownerLabel: varchar("owner_label", { length: 120 }),
    ownerSide: varchar("owner_side", { length: 20 }).$type<UseCaseNeedOwnerSide>(),
    /** Stato secondo il tipo (CHECK `use_case_needs_status_check`). */
    status: varchar("status", { length: 20 }).$type<UseCaseNeedStatus>().notNull(),
    availability: varchar("availability", { length: 12 }).$type<UseCaseNeedAvailability>(),
    dueOn: date("due_on", { mode: "string" }),
    dueLabel: varchar("due_label", { length: 80 }),
    /** Vero se la data è una proposta, non ancora confermata. */
    dueIsProposal: boolean("due_is_proposal").notNull().default(false),
    forLabel: varchar("for_label", { length: 200 }),
    sortOrder: integer("sort_order").notNull().default(0),
    version: integer("version").notNull().default(1),
    importKey: varchar("import_key", { length: 128 }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    doneAt: timestamp("done_at", { mode: "date", withTimezone: true }),
    archivedAt: timestamp("archived_at", { mode: "date", withTimezone: true }),
    archiveReason: varchar("archive_reason", { length: 300 }),
  },
  (t) => [
    index("use_case_needs_workspace_idx").on(t.workspaceId, t.type, t.sortOrder),
    unique("use_case_needs_import_key_unique").on(t.workspaceId, t.importKey),
  ]
);

/** Per quali schede serve un'esigenza. Sparisce con l'esigenza o con la scheda. */
export const useCaseNeedLinks = pgTable(
  "use_case_need_links",
  {
    needId: uuid("need_id")
      .notNull()
      .references(() => useCaseNeeds.id, { onDelete: "cascade" }),
    useCaseId: uuid("use_case_id")
      .notNull()
      .references(() => useCases.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ name: "use_case_need_links_pkey", columns: [t.needId, t.useCaseId] }),
    index("use_case_need_links_use_case_idx").on(t.useCaseId),
  ]
);

export const externalContributionSubmissions = pgTable(
  "external_contribution_submissions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Token di workspace che ha inviato (fase 1); null per le identità di fase 2. */
    integrationTokenId: uuid("integration_token_id").references(
      () => workspaceIntegrationTokens.id,
      { onDelete: "cascade" }
    ),
    /** Chi invia: `token:<tokenId>` oppure, in fase 2, `user:<identityId>`. */
    principalKey: varchar("principal_key", { length: 80 }).notNull(),
    /**
     * Id della segnalazione deciso alla prima presa in carico e riusato da ogni
     * ripresa: un nuovo tentativo ritrova la segnalazione già creata (nessuna FK:
     * la segnalazione può non esistere ancora). Il codice nuovo lo scrive sempre;
     * NULL = riga del codice precedente alla 0019, che non si riprende mai.
     */
    reservedUseCaseId: uuid("reserved_use_case_id"),
    /** Numero del tentativo che possiede la riga; sale a ogni ripresa. */
    attempt: integer("attempt").notNull().default(1),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    requestHash: varchar("request_hash", { length: 128 }).notNull(),
    status: varchar("status", { length: 50 }).notNull().default("pending"),
    useCaseId: uuid("use_case_id").references(() => useCases.id, {
      onDelete: "set null",
    }),
    errorCode: varchar("error_code", { length: 100 }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("external_contribution_idempotency_idx").on(
      t.workspaceId,
      t.integrationTokenId,
      t.idempotencyKey
    ),
    uniqueIndex("external_contribution_principal_idempotency_idx").on(
      t.workspaceId,
      t.principalKey,
      t.idempotencyKey
    ),
    index("external_contribution_workspace_idx").on(t.workspaceId),
  ]
);

// ─── Connettore MCP organizzativo (drizzle/0019) ─────────────────────
// CHECK, indice full-text e trigger stanno solo nella migrazione e in
// src/lib/db/connector-ddl.ts (self-heal): mai drizzle-kit su queste tabelle.

/** Identità solo MCP di fase 2 (login Microsoft, claim oid): vuota in fase 1. */
export const connectorIdentities = pgTable(
  "connector_identities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 40 }).notNull(),
    subject: varchar("subject", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }),
    displayName: varchar("display_name", { length: 255 }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { mode: "date", withTimezone: true }),
    disabledAt: timestamp("disabled_at", { mode: "date", withTimezone: true }),
  },
  (t) => [
    uniqueIndex("connector_identities_workspace_provider_subject_key").on(
      t.workspaceId,
      t.provider,
      t.subject
    ),
  ]
);

/** Configurazione del connettore, una riga per workspace. */
export const workspaceConnectorConfigs = pgTable("workspace_connector_configs", {
  workspaceId: uuid("workspace_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  slug: varchar("slug", { length: 40 }).notNull().unique("workspace_connector_configs_slug_key"),
  /** Interruttore di sospensione: false → ogni tool risponde `connector_disabled`. */
  enabled: boolean("enabled").notNull().default(false),
  codePrefix: varchar("code_prefix", { length: 4 }).notNull(),
  /** Ultimo numero assegnato: il prossimo codice usa next_code_seq + 1. */
  nextCodeSeq: integer("next_code_seq").notNull().default(0),
  identityMode: varchar("identity_mode", { length: 20 })
    .$type<"dichiarata" | "verificata">()
    .notNull()
    .default("dichiarata"),
  authMode: varchar("auth_mode", { length: 20 }).$type<"header" | "oauth">().notNull().default("header"),
  workspaceDisplayName: varchar("workspace_display_name", { length: 120 }),
  guide: jsonb("guide").$type<Record<string, unknown>>(),
  guideVersion: varchar("guide_version", { length: 20 }),
  /** Domini EMAIL ammessi al login di fase 2. */
  allowedDomains: jsonb("allowed_domains").$type<string[]>().notNull().default([]),
  /** Header `Origin` HTTP ammessi (elenco distinto da allowedDomains). */
  allowedOrigins: jsonb("allowed_origins").$type<string[]>().notNull().default([]),
  limits: jsonb("limits").$type<ConnectorLimits>().notNull().default({ ...CONNECTOR_DEFAULT_LIMITS }),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  // Coda della 0019 (K8, decisione 1 dell'arresto B): profilo del cliente e modello
  // delle istruzioni del server, scritti solo da `scripts/connector-admin.ts profile`.
  profile: jsonb("profile").$type<Record<string, unknown>>(),
  instructionsTemplate: text("instructions_template"),
});

/** Contatori del limite di richieste del connettore (come uc_rate_limits). */
export const connectorRateLimits = pgTable(
  "connector_rate_limits",
  {
    bucket: varchar("bucket", { length: 120 }).notNull(),
    windowStart: timestamp("window_start", { mode: "date", withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [
    primaryKey({ name: "connector_rate_limits_pkey", columns: [t.bucket, t.windowStart] }),
    index("connector_rate_limits_window_idx").on(t.windowStart),
  ]
);

// ─── Use Case <-> Key Result Links ─────────────────────────────────

export const useCaseKrLinks = pgTable(
  "use_case_kr_links",
  {
    useCaseId: uuid("use_case_id")
      .notNull()
      .references(() => useCases.id, { onDelete: "cascade" }),
    keyResultId: uuid("key_result_id")
      .notNull()
      .references(() => strategicGoals.id, { onDelete: "cascade" }),
    contributionDescription: text("contribution_description"),
    leverType: varchar("lever_type", { length: 100 }),
  },
  (t) => [primaryKey({ columns: [t.useCaseId, t.keyResultId] })]
);

// ─── Conversations ──────────────────────────────────────────────────

export const conversations = pgTable("conversations", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  departmentId: uuid("department_id").references(() => departments.id, {
    onDelete: "set null",
  }),
  type: conversationTypeEnum("type").notNull(),
  status: conversationStatusEnum("status").notNull().default("active"),
  title: varchar("title", { length: 500 }),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: varchar("role", { length: 50 }).notNull(),
  content: text("content").notNull(),
  toolInvocations: jsonb("tool_invocations"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

// ─── Reports ────────────────────────────────────────────────────────

export const reports = pgTable("reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  type: reportTypeEnum("type").notNull(),
  title: varchar("title", { length: 500 }),
  content: jsonb("content"),
  generatedAt: timestamp("generated_at", { mode: "date" })
    .defaultNow()
    .notNull(),
});

// ─── Value Map Nodes ────────────────────────────────────────────────

export const valueMapNodes = pgTable("value_map_nodes", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  activityId: uuid("activity_id")
    .notNull()
    .references(() => activities.id, { onDelete: "cascade" }),
  xMaturity: real("x_maturity").notNull(),
  yStrategicValue: real("y_strategic_value").notNull(),
  layerData: jsonb("layer_data"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

// ─── Invitations ────────────────────────────────────────────────────

export const invitations = pgTable("invitations", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  email: varchar("email", { length: 255 }).notNull(),
  role: memberRoleEnum("role").notNull().default("contributor"),
  token: varchar("token", { length: 255 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
  acceptedAt: timestamp("accepted_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

// ─── Weekly Signals (Phase 2) ───────────────────────────────────────

export const weeklySignals = pgTable("weekly_signals", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  signalType: varchar("signal_type", { length: 100 }).notNull(),
  title: varchar("title", { length: 500 }).notNull(),
  description: text("description"),
  relatedEntityType: varchar("related_entity_type", { length: 100 }),
  relatedEntityId: uuid("related_entity_id"),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

// ─── Uploaded Documents ──────────────────────────────────────────────

export const uploadedDocuments = pgTable("uploaded_documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  departmentId: uuid("department_id").references(() => departments.id, {
    onDelete: "set null",
  }),
  fileName: varchar("file_name", { length: 500 }).notNull(),
  fileType: varchar("file_type", { length: 100 }).notNull(),
  fileSize: integer("file_size").notNull(),
  blobUrl: text("blob_url").notNull(),
  extractedText: text("extracted_text"),
  summary: text("summary"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

// ─── Agent Blueprints (persisted) ────────────────────────────────────

export const agentBlueprints = pgTable("agent_blueprints", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  content: jsonb("content").notNull(),
  generatedAt: timestamp("generated_at", { mode: "date" })
    .defaultNow()
    .notNull(),
});

// ─── Simulations (persisted) ─────────────────────────────────────────

export const simulations = pgTable("simulations", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  content: jsonb("content").notNull(),
  generatedAt: timestamp("generated_at", { mode: "date" })
    .defaultNow()
    .notNull(),
});

// ─── RAG: Document Chunks ────────────────────────────────────────────

export const documentChunks = pgTable(
  "document_chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => uploadedDocuments.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [index("document_chunks_workspace_idx").on(t.workspaceId)]
);

// ─── RAG: Conversation Memory ────────────────────────────────────────

export const conversationMemory = pgTable(
  "conversation_memory",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    role: varchar("role", { length: 50 }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [index("conversation_memory_workspace_idx").on(t.workspaceId)]
);

// ─── Slack Installations (multi-tenant OAuth) ──────────────────────

export const slackInstallations = pgTable("slack_installations", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  slackTeamId: varchar("slack_team_id", { length: 100 }).notNull().unique(),
  slackTeamName: varchar("slack_team_name", { length: 255 }),
  botToken: text("bot_token").notNull(),
  notifyChannelId: varchar("notify_channel_id", { length: 100 }),
  installedBy: varchar("installed_by", { length: 100 }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

// ─── Slack Use Case Drafts ──────────────────────────────────────────

export const slackUseCaseDrafts = pgTable("slack_use_case_drafts", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  slackUserId: varchar("slack_user_id", { length: 100 }).notNull(),
  slackThreadTs: varchar("slack_thread_ts", { length: 100 }),
  /** Canale Slack (C… / D…) per reminder/cron; valorizzato dall'agente quando disponibile. */
  slackChannelId: varchar("slack_channel_id", { length: 50 }),
  slackTeamId: varchar("slack_team_id", { length: 100 }).notNull(),
  /**
   * Tipo di contributo raccolto via Slack.
   * - best_practice: adozione già avvenuta
   * - use_case_ai: idea / candidato trasformazione
   */
  contributionKind: varchar("contribution_kind", { length: 50 }),
  status: varchar("status", { length: 50 }).notNull().default("drafting"),
  title: varchar("title", { length: 500 }),
  problem: text("problem"),
  flowDescription: text("flow_description"),
  humanInTheLoop: text("human_in_the_loop"),
  guardrails: text("guardrails"),
  expectedImpact: text("expected_impact"),
  dataRequirements: text("data_requirements"),
  sustainabilityImpact: text("sustainability_impact"),
  urgency: varchar("urgency", { length: 255 }),
  /** Un solo promemoria dopo ~24h di inattività sul draft (fase 2 cron). */
  reminder24hSentAt: timestamp("reminder_24h_sent_at", { mode: "date" }),
  /** Chiusura automatica draft dopo ~48h senza aggiornamenti. */
  abandonedAt: timestamp("abandoned_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  submittedAt: timestamp("submitted_at", { mode: "date" }),
});

// ─── AI Readiness OS (Assessment Core) ──────────────────────────────

export const aiReadinessAssessmentTemplates = pgTable(
  "ai_readiness_assessment_templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    version: varchar("version", { length: 50 }).notNull(),
    language: varchar("language", { length: 20 }).notNull().default("it"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    isSystemTemplate: boolean("is_system_template").notNull().default(false),
    status: varchar("status", { length: 50 }).notNull().default("draft"),
    pillars: jsonb("pillars").$type<unknown[]>().notNull(),
    sections: jsonb("sections").$type<unknown[]>().notNull(),
    questions: jsonb("questions").$type<unknown[]>().notNull(),
    scoringSchema: jsonb("scoring_schema").$type<unknown>().notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("ai_readiness_templates_name_version_idx").on(
      t.name,
      t.version,
      t.language
    ),
  ]
);

export const aiReadinessAssessments = pgTable(
  "ai_readiness_assessments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    templateId: uuid("template_id")
      .notNull()
      .references(() => aiReadinessAssessmentTemplates.id, {
        onDelete: "restrict",
      }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    status: varchar("status", { length: 50 }).notNull().default("draft"),
    language: varchar("language", { length: 20 }).notNull().default("it"),
    brandConfig: jsonb("brand_config").$type<Record<string, unknown>>(),
    terminologyConfig: jsonb("terminology_config").$type<Record<string, unknown>>(),
    privacyConfig: jsonb("privacy_config").$type<Record<string, unknown>>(),
    scoringConfig: jsonb("scoring_config").$type<Record<string, unknown>>(),
    modulesEnabled: jsonb("modules_enabled").$type<Record<string, boolean>>(),
    anonymousMode: boolean("anonymous_mode").notNull().default(true),
    aggregationThreshold: integer("aggregation_threshold").notNull().default(5),
    opensAt: timestamp("opens_at", { mode: "date" }),
    closesAt: timestamp("closes_at", { mode: "date" }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    index("ai_readiness_assessments_workspace_idx").on(t.workspaceId),
    index("ai_readiness_assessments_org_idx").on(t.organizationId),
  ]
);

export const aiReadinessRespondents = pgTable(
  "ai_readiness_respondents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => aiReadinessAssessments.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 255 }),
    name: varchar("name", { length: 255 }),
    surname: varchar("surname", { length: 255 }),
    role: varchar("role", { length: 255 }),
    seniority: varchar("seniority", { length: 255 }),
    organizationUnit: varchar("organization_unit", { length: 255 }),
    country: varchar("country", { length: 100 }),
    locale: varchar("locale", { length: 20 }),
    inviteTokenHash: varchar("invite_token_hash", { length: 128 }).notNull().unique(),
    inviteStatus: varchar("invite_status", { length: 50 }).notNull().default("invited"),
    surveyTrack: varchar("survey_track", { length: 20 }).notNull().default("everyone"),
    questionScope: jsonb("question_scope").$type<Record<string, unknown>>(),
    pseudonymousId: varchar("pseudonymous_id", { length: 64 }).notNull(),
    hasAcceptedPrivacyNotice: boolean("has_accepted_privacy_notice")
      .notNull()
      .default(false),
    hasMarketingConsent: boolean("has_marketing_consent").notNull().default(false),
    hasBenchmarkConsent: boolean("has_benchmark_consent").notNull().default(false),
    startedAt: timestamp("started_at", { mode: "date" }),
    completedAt: timestamp("completed_at", { mode: "date" }),
    lastSeenAt: timestamp("last_seen_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    index("ai_readiness_respondents_assessment_idx").on(t.assessmentId),
    index("ai_readiness_respondents_workspace_idx").on(t.workspaceId),
    index("ai_readiness_respondents_pseudo_idx").on(t.pseudonymousId),
  ]
);

export const aiReadinessResponses = pgTable(
  "ai_readiness_responses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => aiReadinessAssessments.id, { onDelete: "cascade" }),
    respondentId: uuid("respondent_id")
      .notNull()
      .references(() => aiReadinessRespondents.id, { onDelete: "cascade" }),
    pseudonymousId: varchar("pseudonymous_id", { length: 64 }).notNull(),
    status: varchar("status", { length: 50 }).notNull().default("draft"),
    answers: jsonb("answers").$type<unknown[]>().notNull().default([]),
    derivedScores: jsonb("derived_scores").$type<Record<string, unknown>>(),
    freeTextAnswers: jsonb("free_text_answers").$type<Record<string, unknown>>(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    submittedAt: timestamp("submitted_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("ai_readiness_responses_respondent_assessment_idx").on(
      t.assessmentId,
      t.respondentId
    ),
    index("ai_readiness_responses_assessment_idx").on(t.assessmentId),
    index("ai_readiness_responses_pseudo_idx").on(t.pseudonymousId),
  ]
);

export const aiReadinessUseCaseSubmissions = pgTable(
  "ai_readiness_use_case_submissions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => aiReadinessAssessments.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    respondentId: uuid("respondent_id").references(() => aiReadinessRespondents.id, {
      onDelete: "set null",
    }),
    pseudonymousId: varchar("pseudonymous_id", { length: 64 }),
    title: varchar("title", { length: 500 }).notNull(),
    currentProcess: text("current_process"),
    painPoint: text("pain_point"),
    desiredOutcome: text("desired_outcome"),
    frequency: varchar("frequency", { length: 255 }),
    affectedUsers: integer("affected_users"),
    estimatedBeneficiaries: integer("estimated_beneficiaries"),
    dataNeeded: text("data_needed"),
    toolsUsed: text("tools_used"),
    peopleInvolved: text("people_involved"),
    humanInLoop: text("human_in_loop"),
    riskLevel: varchar("risk_level", { length: 50 }),
    riskReasoning: text("risk_reasoning"),
    impactEstimate: text("impact_estimate"),
    efficiencyScore: real("efficiency_score"),
    effortScore: real("effort_score"),
    feasibilityScore: real("feasibility_score"),
    strategicValueScore: real("strategic_value_score"),
    aiSolutionHypothesis: text("ai_solution_hypothesis"),
    promptOrSnippet: text("prompt_or_snippet"),
    status: varchar("status", { length: 50 }).notNull().default("submitted"),
    source: varchar("source", { length: 50 }).notNull().default("assessment"),
    aiSuggested: boolean("ai_suggested").notNull().default(false),
    humanValidated: boolean("human_validated").notNull().default(false),
    reviewerUserId: uuid("reviewer_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { mode: "date" }),
    linkedUseCaseId: uuid("linked_use_case_id").references(() => useCases.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    index("ai_readiness_use_cases_assessment_idx").on(t.assessmentId),
    index("ai_readiness_use_cases_workspace_idx").on(t.workspaceId),
  ]
);

export const aiReadinessScores = pgTable(
  "ai_readiness_scores",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => aiReadinessAssessments.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    scopeType: varchar("scope_type", { length: 50 }).notNull(),
    scopeKey: varchar("scope_key", { length: 255 }).notNull(),
    pillarScores: jsonb("pillar_scores").$type<Record<string, unknown>>(),
    sectionScores: jsonb("section_scores").$type<Record<string, unknown>>(),
    overallScore: real("overall_score"),
    bottleneckPillar: varchar("bottleneck_pillar", { length: 100 }),
    confidence: real("confidence"),
    respondentCount: integer("respondent_count").notNull().default(0),
    aggregationThresholdMet: boolean("aggregation_threshold_met")
      .notNull()
      .default(false),
    generatedAt: timestamp("generated_at", { mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    index("ai_readiness_scores_assessment_idx").on(t.assessmentId),
    index("ai_readiness_scores_workspace_idx").on(t.workspaceId),
    index("ai_readiness_scores_scope_idx").on(t.assessmentId, t.scopeType, t.scopeKey),
  ]
);

export const aiReadinessExports = pgTable(
  "ai_readiness_exports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => aiReadinessAssessments.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    exportType: varchar("export_type", { length: 100 }).notNull(),
    requestedByUserId: uuid("requested_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    fileUrl: text("file_url"),
    status: varchar("status", { length: 50 }).notNull().default("pending"),
    includedPersonalData: boolean("included_personal_data").notNull().default(false),
    anonymized: boolean("anonymized").notNull().default(true),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { mode: "date" }),
  },
  (t) => [
    index("ai_readiness_exports_assessment_idx").on(t.assessmentId),
    index("ai_readiness_exports_workspace_idx").on(t.workspaceId),
  ]
);

export const aiReadinessAuditEvents = pgTable(
  "ai_readiness_audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    assessmentId: uuid("assessment_id").references(() => aiReadinessAssessments.id, {
      onDelete: "cascade",
    }),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    respondentId: uuid("respondent_id").references(() => aiReadinessRespondents.id, {
      onDelete: "set null",
    }),
    eventType: varchar("event_type", { length: 100 }).notNull(),
    eventPayload: jsonb("event_payload").$type<Record<string, unknown>>(),
    ipHash: varchar("ip_hash", { length: 128 }),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    index("ai_readiness_audit_workspace_idx").on(t.workspaceId),
    index("ai_readiness_audit_assessment_idx").on(t.assessmentId),
    index("ai_readiness_audit_event_type_idx").on(t.eventType),
  ]
);

export const aiReadinessInsights = pgTable(
  "ai_readiness_insights",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => aiReadinessAssessments.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    scopeType: varchar("scope_type", { length: 50 }).notNull().default("company"),
    scopeKey: varchar("scope_key", { length: 255 }).notNull().default("company"),
    insightType: varchar("insight_type", { length: 100 }).notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    body: text("body").notNull(),
    evidence: jsonb("evidence").$type<Record<string, unknown>>(),
    aiGenerated: boolean("ai_generated").notNull().default(true),
    humanValidated: boolean("human_validated").notNull().default(false),
    validatedByUserId: uuid("validated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    validationStatus: varchar("validation_status", { length: 50 })
      .notNull()
      .default("draft"),
    model: varchar("model", { length: 255 }),
    promptVersion: varchar("prompt_version", { length: 100 }),
    inputScope: jsonb("input_scope").$type<Record<string, unknown>>(),
    generatedAt: timestamp("generated_at", { mode: "date" }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    index("ai_readiness_insights_assessment_idx").on(t.assessmentId),
    index("ai_readiness_insights_workspace_idx").on(t.workspaceId),
    index("ai_readiness_insights_scope_idx").on(t.assessmentId, t.scopeType, t.scopeKey),
    index("ai_readiness_insights_type_idx").on(t.assessmentId, t.insightType),
  ]
);

// ─── Type exports ───────────────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type Membership = typeof memberships.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
export type WorkspaceMembership = typeof workspaceMemberships.$inferSelect;
export type NewWorkspaceMembership = typeof workspaceMemberships.$inferInsert;
export type WorkspaceInvitation = typeof workspaceInvitations.$inferSelect;
export type NewWorkspaceInvitation = typeof workspaceInvitations.$inferInsert;
export type WorkspaceInvitationAcceptance =
  typeof workspaceInvitationAcceptances.$inferSelect;
export type WorkspaceIntegrationToken =
  typeof workspaceIntegrationTokens.$inferSelect;
export type NewWorkspaceIntegrationToken =
  typeof workspaceIntegrationTokens.$inferInsert;
export type ExternalContributionSubmission =
  typeof externalContributionSubmissions.$inferSelect;
export type NewExternalContributionSubmission =
  typeof externalContributionSubmissions.$inferInsert;
export type WorkspaceScoringModel = typeof workspaceScoringModels.$inferSelect;
export type ConnectorIdentity = typeof connectorIdentities.$inferSelect;
export type WorkspaceConnectorConfig = typeof workspaceConnectorConfigs.$inferSelect;
export type NewWorkspaceConnectorConfig = typeof workspaceConnectorConfigs.$inferInsert;
export type NewWorkspaceScoringModel = typeof workspaceScoringModels.$inferInsert;
export type StrategicGoal = typeof strategicGoals.$inferSelect;
export type NewStrategicGoal = typeof strategicGoals.$inferInsert;
export type Department = typeof departments.$inferSelect;
export type NewDepartment = typeof departments.$inferInsert;
export type Activity = typeof activities.$inferSelect;
export type NewActivity = typeof activities.$inferInsert;
export type UseCase = typeof useCases.$inferSelect;
export type NewUseCase = typeof useCases.$inferInsert;
export type UseCaseEvent = typeof useCaseEvents.$inferSelect;
export type NewUseCaseEvent = typeof useCaseEvents.$inferInsert;
export type UseCaseMcpRequest = typeof useCaseMcpRequests.$inferSelect;
export type NewUseCaseMcpRequest = typeof useCaseMcpRequests.$inferInsert;
export type UseCaseNeed = typeof useCaseNeeds.$inferSelect;
export type NewUseCaseNeed = typeof useCaseNeeds.$inferInsert;
export type UseCaseNeedLink = typeof useCaseNeedLinks.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Report = typeof reports.$inferSelect;
export type ValueMapNode = typeof valueMapNodes.$inferSelect;
export type Invitation = typeof invitations.$inferSelect;
export type WeeklySignal = typeof weeklySignals.$inferSelect;
export type UploadedDocument = typeof uploadedDocuments.$inferSelect;
export type AgentBlueprint = typeof agentBlueprints.$inferSelect;
export type Simulation = typeof simulations.$inferSelect;
export type DocumentChunk = typeof documentChunks.$inferSelect;
export type ConversationMemory = typeof conversationMemory.$inferSelect;
export type SlackInstallation = typeof slackInstallations.$inferSelect;
export type NewSlackInstallation = typeof slackInstallations.$inferInsert;
export type SlackUseCaseDraft = typeof slackUseCaseDrafts.$inferSelect;
export type NewSlackUseCaseDraft = typeof slackUseCaseDrafts.$inferInsert;
export type AiReadinessAssessmentTemplate =
  typeof aiReadinessAssessmentTemplates.$inferSelect;
export type NewAiReadinessAssessmentTemplate =
  typeof aiReadinessAssessmentTemplates.$inferInsert;
export type AiReadinessAssessment = typeof aiReadinessAssessments.$inferSelect;
export type NewAiReadinessAssessment = typeof aiReadinessAssessments.$inferInsert;
export type AiReadinessRespondent = typeof aiReadinessRespondents.$inferSelect;
export type NewAiReadinessRespondent = typeof aiReadinessRespondents.$inferInsert;
export type AiReadinessResponse = typeof aiReadinessResponses.$inferSelect;
export type NewAiReadinessResponse = typeof aiReadinessResponses.$inferInsert;
export type AiReadinessUseCaseSubmission =
  typeof aiReadinessUseCaseSubmissions.$inferSelect;
export type NewAiReadinessUseCaseSubmission =
  typeof aiReadinessUseCaseSubmissions.$inferInsert;
export type AiReadinessScore = typeof aiReadinessScores.$inferSelect;
export type NewAiReadinessScore = typeof aiReadinessScores.$inferInsert;
export type AiReadinessExport = typeof aiReadinessExports.$inferSelect;
export type NewAiReadinessExport = typeof aiReadinessExports.$inferInsert;
export type AiReadinessAuditEvent = typeof aiReadinessAuditEvents.$inferSelect;
export type NewAiReadinessAuditEvent =
  typeof aiReadinessAuditEvents.$inferInsert;
export type AiReadinessInsight = typeof aiReadinessInsights.$inferSelect;
export type NewAiReadinessInsight = typeof aiReadinessInsights.$inferInsert;

// ── Casi d'uso (uc_*) ───────────────────────────────────────────────
//
// Fonte di verità: il DDL di `src/lib/uc/ddl.ts` (migrazione 0018 e self-heal
// `ensureUcSchema()`). Qui solo colonne e chiavi primarie, per le query tipizzate:
// CHECK dei vocabolari, FK, indici e trigger vivono solo nel DDL.
// MAI `db:push`/`db:generate` su queste tabelle: toglierebbero vincoli e trigger.
// `src/lib/uc/schema-sync.test.ts` controlla che colonne, tipi, NOT NULL e
// default coincidano con il DDL.

const ucTimestamp = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
/** Byte grezzi (valori cifrati della zona personale). */
const ucBytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const ucTemplates = pgTable(
  "uc_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: varchar("key", { length: 120 }).notNull(),
    version: varchar("version", { length: 20 }).notNull(),
    language: varchar("language", { length: 10 }).notNull().default("it"),
    name: varchar("name", { length: 255 }).notNull(),
    archetype: varchar("archetype", { length: 80 }).notNull(),
    industry: varchar("industry", { length: 80 }),
    functionArea: varchar("function_area", { length: 80 }),
    status: text("status").$type<TemplateStatus>().notNull().default("bozza"),
    definition: jsonb("definition").$type<Record<string, unknown>>().notNull(),
    definitionHash: char("definition_hash", { length: 64 }).notNull(),
    restrictedToWorkspaceId: uuid("restricted_to_workspace_id"),
    parentTemplateId: uuid("parent_template_id"),
    changelog: text("changelog"),
    createdByUserId: uuid("created_by_user_id"),
    publishedByUserId: uuid("published_by_user_id"),
    publishedAt: ucTimestamp("published_at"),
    createdAt: ucTimestamp("created_at").notNull().defaultNow(),
    updatedAt: ucTimestamp("updated_at").notNull().defaultNow(),
  }
);

export const ucContacts = pgTable(
  "uc_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    displayName: varchar("display_name", { length: 255 }).notNull(),
    roleLabel: varchar("role_label", { length: 255 }),
    templateRoleKey: varchar("template_role_key", { length: 80 }),
    email: varchar("email", { length: 320 }),
    phoneE164: varchar("phone_e164", { length: 32 }),
    userId: uuid("user_id"),
    preferredChannel: text("preferred_channel").$type<ContactChannel>().notNull().default("email"),
    locale: varchar("locale", { length: 10 }).notNull().default("it"),
    isActive: boolean("is_active").notNull().default(true),
    privacyNoticeVersion: varchar("privacy_notice_version", { length: 20 }),
    privacyNoticeSeenAt: ucTimestamp("privacy_notice_seen_at"),
    digestOptOut: boolean("digest_opt_out").notNull().default(false),
    anonymizedAt: ucTimestamp("anonymized_at"),
    createdByUserId: uuid("created_by_user_id"),
    createdAt: ucTimestamp("created_at").notNull().defaultNow(),
    updatedAt: ucTimestamp("updated_at").notNull().defaultNow(),
  }
);

export const ucCases = pgTable(
  "uc_cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    portfolioUseCaseId: uuid("portfolio_use_case_id"),
    templateId: uuid("template_id").notNull(),
    templateVersion: varchar("template_version", { length: 20 }).notNull(),
    code: varchar("code", { length: 40 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    oneLiner: varchar("one_liner", { length: 500 }),
    description: jsonb("description").$type<Record<string, unknown>>().notNull().default({}),
    descriptionHistory: jsonb("description_history").$type<unknown[]>().notNull().default([]),
    status: text("status").$type<CaseStatus>().notNull().default("bozza"),
    statusBeforeSuspension: text("status_before_suspension").$type<CaseStatus>(),
    suspensionReason: text("suspension_reason"),
    closedReason: text("closed_reason"),
    statusChangedAt: ucTimestamp("status_changed_at"),
    perimeterLabel: varchar("perimeter_label", { length: 255 }),
    contractRefs: jsonb("contract_refs").$type<string[]>().notNull().default([]),
    specDocumentRef: varchar("spec_document_ref", { length: 255 }),
    levers: jsonb("levers").$type<Lever[]>().notNull().default([]),
    lsLeadUserId: uuid("ls_lead_user_id"),
    clientOwnerContactId: uuid("client_owner_contact_id"),
    clientOwnerRoleLabel: varchar("client_owner_role_label", { length: 255 }),
    clientPrivacyApproverContactId: uuid("client_privacy_approver_contact_id"),
    signersDesignation: jsonb("signers_designation").$type<Record<string, unknown>>().notNull().default({}),
    dataMode: text("data_mode").$type<DataMode>().notNull().default("solo_sintetici"),
    aiEnvironmentApproved: boolean("ai_environment_approved").notNull().default(false),
    dataControllerLabel: varchar("data_controller_label", { length: 255 }),
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
    readiness: jsonb("readiness").$type<Record<string, unknown>>(),
    catalogVersion: integer("catalog_version").notNull().default(0),
    catalogRevision: integer("catalog_revision").notNull().default(0),
    shareEpoch: integer("share_epoch").notNull().default(0),
    setupCompletedAt: ucTimestamp("setup_completed_at"),
    createdByUserId: uuid("created_by_user_id"),
    createdAt: ucTimestamp("created_at").notNull().defaultNow(),
    updatedAt: ucTimestamp("updated_at").notNull().defaultNow(),
    archivedAt: ucTimestamp("archived_at"),
    closedAt: ucTimestamp("closed_at"),
  }
);

export const ucCaseMembers = pgTable(
  "uc_case_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").notNull(),
    userId: uuid("user_id").notNull(),
    role: text("role").$type<CaseRole>().notNull(),
    personalZoneAccess: boolean("personal_zone_access").notNull().default(false),
    personalZoneGrant: jsonb("personal_zone_grant").$type<Record<string, unknown>>(),
    addedByUserId: uuid("added_by_user_id"),
    createdAt: ucTimestamp("created_at").notNull().defaultNow(),
  }
);

export const ucBlockers = pgTable(
  "uc_blockers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    caseId: uuid("case_id"),
    key: varchar("key", { length: 60 }).notNull(),
    label: text("label").notNull(),
    status: text("status").$type<BlockerStatus>().notNull().default("attivo"),
    scope: jsonb("scope").$type<Record<string, unknown>>().notNull().default({}),
    fallbackAllowed: text("fallback_allowed"),
    evidence: jsonb("evidence").$type<Record<string, unknown>>(),
    approvals: jsonb("approvals").$type<Approval[]>().notNull().default([]),
    resolvedByUserId: uuid("resolved_by_user_id"),
    resolvedAt: ucTimestamp("resolved_at"),
    notes: text("notes"),
    createdAt: ucTimestamp("created_at").notNull().defaultNow(),
    updatedAt: ucTimestamp("updated_at").notNull().defaultNow(),
  }
);

export const ucItems = pgTable(
  "uc_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").notNull(),
    key: varchar("key", { length: 160 }).notNull(),
    templateItemKey: varchar("template_item_key", { length: 160 }),
    kind: text("kind").$type<ItemKind>().notNull(),
    section: text("section").$type<ItemSection>().notNull(),
    parentItemId: uuid("parent_item_id"),
    title: text("title").notNull(),
    explanation: text("explanation"),
    why: text("why"),
    example: text("example"),
    help: text("help"),
    spec: jsonb("spec").$type<Record<string, unknown>>().notNull().default({}),
    priority: text("priority").$type<Priority>(),
    servesFor: jsonb("serves_for").$type<Phase[]>().notNull().default([]),
    privacyClass: text("privacy_class").$type<PrivacyClass>().notNull().default("riservato_azienda"),
    valueVisibility: text("value_visibility").$type<ValueVisibility>().notNull().default("owner_e_ls"),
    availability: jsonb("availability").$type<string[]>().notNull().default([]),
    perimeter: text("perimeter").$type<Perimeter>(),
    levers: jsonb("levers").$type<Lever[]>().notNull().default([]),
    responseType: text("response_type").$type<ResponseType>(),
    responseConfig: jsonb("response_config").$type<Record<string, unknown>>().notNull().default({}),
    requestModuleKey: varchar("request_module_key", { length: 80 }),
    inGateScope: boolean("in_gate_scope").notNull().default(false),
    status: text("status").$type<ItemStatus>().notNull().default("da_chiedere"),
    statusReason: varchar("status_reason", { length: 500 }),
    statusChangedAt: ucTimestamp("status_changed_at"),
    assigneeContactId: uuid("assignee_contact_id"),
    ownerRoleKey: varchar("owner_role_key", { length: 80 }),
    lsOwnerUserId: uuid("ls_owner_user_id"),
    dueAt: ucTimestamp("due_at"),
    dueIsProposal: boolean("due_is_proposal").notNull().default(false),
    currentAnswerId: uuid("current_answer_id"),
    validatedAnswerId: uuid("validated_answer_id"),
    validatedByUserId: uuid("validated_by_user_id"),
    validatedAt: ucTimestamp("validated_at"),
    confirmedByContactId: uuid("confirmed_by_contact_id"),
    naReason: text("na_reason"),
    naProposedAt: ucTimestamp("na_proposed_at"),
    naProposedByUserId: uuid("na_proposed_by_user_id"),
    naProposedByContactId: uuid("na_proposed_by_contact_id"),
    naApprovedByUserId: uuid("na_approved_by_user_id"),
    naClientApprovedByUserId: uuid("na_client_approved_by_user_id"),
    naApprovedByContactId: uuid("na_approved_by_contact_id"),
    naApprovedAt: ucTimestamp("na_approved_at"),
    waiver: jsonb("waiver").$type<Waiver>(),
    waiverApprovedAt: ucTimestamp("waiver_approved_at"),
    fallback: jsonb("fallback").$type<Fallback>(),
    fallbackApprovedAt: ucTimestamp("fallback_approved_at"),
    partialNa: jsonb("partial_na").$type<PartialNa>(),
    freshnessDays: integer("freshness_days"),
    staleAt: ucTimestamp("stale_at"),
    requiresValidityPeriod: boolean("requires_validity_period").notNull().default(false),
    sourceRefs: jsonb("source_refs").$type<string[]>().notNull().default([]),
    aiProposed: boolean("ai_proposed").notNull().default(false),
    sharedItemId: uuid("shared_item_id"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdByUserId: uuid("created_by_user_id"),
    createdAt: ucTimestamp("created_at").notNull().defaultNow(),
    updatedAt: ucTimestamp("updated_at").notNull().defaultNow(),
    deletedAt: ucTimestamp("deleted_at"),
  }
);

export const ucItemBlockers = pgTable(
  "uc_item_blockers",
  {
    itemId: uuid("item_id").notNull(),
    blockerId: uuid("blocker_id").notNull(),
    origin: text("origin").$type<ItemBlockerOrigin>().notNull(),
    createdAt: ucTimestamp("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: "uc_item_blockers_pkey", columns: [t.itemId, t.blockerId] })]
);

export const ucItemLinks = pgTable(
  "uc_item_links",
  {
    caseId: uuid("case_id").notNull(),
    fromItemId: uuid("from_item_id").notNull(),
    toItemId: uuid("to_item_id").notNull(),
    relation: text("relation").$type<LinkRelation>().notNull(),
    cardinality: varchar("cardinality", { length: 40 }),
    note: text("note"),
  },
  (t) => [primaryKey({ name: "uc_item_links_pkey", columns: [t.fromItemId, t.toItemId, t.relation] })]
);

export const ucRequests = pgTable(
  "uc_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    purpose: text("purpose").$type<RequestPurpose>().notNull().default("raccolta"),
    shareEpoch: integer("share_epoch").notNull(),
    actingRoleKey: varchar("acting_role_key", { length: 80 }),
    status: text("status").$type<RequestStatus>().notNull().default("bozza"),
    message: text("message"),
    channel: text("channel").$type<RequestChannel>().notNull().default("email"),
    delegatedFromRequestId: uuid("delegated_from_request_id"),
    delegatedByContactId: uuid("delegated_by_contact_id"),
    delegationDepth: smallint("delegation_depth").notNull().default(0),
    otpRequired: boolean("otp_required").notNull().default(false),
    expiresAt: ucTimestamp("expires_at"),
    sentAt: ucTimestamp("sent_at"),
    firstOpenedAt: ucTimestamp("first_opened_at"),
    completedAt: ucTimestamp("completed_at"),
    privacyAckAt: ucTimestamp("privacy_ack_at"),
    privacyNoticeVersion: varchar("privacy_notice_version", { length: 20 }),
    reminderCount: integer("reminder_count").notNull().default(0),
    lastReminderAt: ucTimestamp("last_reminder_at"),
    nextReminderAt: ucTimestamp("next_reminder_at"),
    escalatedAt: ucTimestamp("escalated_at"),
    revokedAt: ucTimestamp("revoked_at"),
    revokedReason: text("revoked_reason"),
    createdByUserId: uuid("created_by_user_id"),
    createdAt: ucTimestamp("created_at").notNull().defaultNow(),
    updatedAt: ucTimestamp("updated_at").notNull().defaultNow(),
  }
);

export const ucRequestTokens = pgTable(
  "uc_request_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").notNull(),
    requestId: uuid("request_id").notNull(),
    tokenHash: char("token_hash", { length: 64 }).notNull(),
    tokenPrefix: varchar("token_prefix", { length: 12 }).notNull(),
    issuedFor: text("issued_for").$type<TokenIssuedFor>().notNull(),
    issuedByUserId: uuid("issued_by_user_id"),
    createdAt: ucTimestamp("created_at").notNull().defaultNow(),
    revokedAt: ucTimestamp("revoked_at"),
  }
);

export const ucRequestItems = pgTable(
  "uc_request_items",
  {
    caseId: uuid("case_id").notNull(),
    requestId: uuid("request_id").notNull(),
    itemId: uuid("item_id").notNull(),
    state: text("state").$type<RequestItemState>().notNull().default("da_fare"),
    draft: jsonb("draft").$type<Record<string, unknown>>(),
    draftUpdatedAt: ucTimestamp("draft_updated_at"),
  },
  (t) => [primaryKey({ name: "uc_request_items_pkey", columns: [t.requestId, t.itemId] })]
);

export const ucAnswers = pgTable(
  "uc_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").notNull(),
    itemId: uuid("item_id").notNull(),
    version: integer("version").notNull(),
    kind: text("kind").$type<AnswerKind>().notNull(),
    value: jsonb("value").$type<Record<string, unknown>>(),
    valueNormalized: jsonb("value_normalized").$type<Record<string, unknown>>(),
    valueEncrypted: ucBytea("value_encrypted"),
    validFrom: date("valid_from", { mode: "string" }),
    validTo: date("valid_to", { mode: "string" }),
    confidence: text("confidence").$type<Confidence>(),
    note: text("note"),
    sourceKind: text("source_kind").$type<SourceKind>().notNull(),
    sourceRef: varchar("source_ref", { length: 500 }),
    sourceBasis: text("source_basis").$type<SourceBasis>(),
    responderContactId: uuid("responder_contact_id"),
    responderUserId: uuid("responder_user_id"),
    requestId: uuid("request_id"),
    supersedesAnswerId: uuid("supersedes_answer_id"),
    fileIds: jsonb("file_ids").$type<string[]>().notNull().default([]),
    textHash: char("text_hash", { length: 64 }),
    ipHash: varchar("ip_hash", { length: 64 }),
    userAgent: varchar("user_agent", { length: 300 }),
    device: text("device").$type<AnswerDevice>(),
    createdAt: ucTimestamp("created_at").notNull().defaultNow(),
    erasedAt: ucTimestamp("erased_at"),
    erasureReason: varchar("erasure_reason", { length: 120 }),
  }
);

export const ucFiles = pgTable(
  "uc_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    caseId: uuid("case_id").notNull(),
    itemId: uuid("item_id"),
    answerId: uuid("answer_id"),
    requestId: uuid("request_id"),
    uploadedByContactId: uuid("uploaded_by_contact_id"),
    uploadedByUserId: uuid("uploaded_by_user_id"),
    fileName: varchar("file_name", { length: 255 }).notNull(),
    mime: varchar("mime", { length: 150 }),
    sizeBytes: integer("size_bytes"),
    sha256: char("sha256", { length: 64 }),
    storageZone: text("storage_zone").$type<StorageZone>().notNull().default("standard"),
    blobPath: text("blob_path"),
    quarantinePath: text("quarantine_path"),
    encryptionKeyRef: varchar("encryption_key_ref", { length: 120 }),
    personalData: text("personal_data").$type<FilePersonalData>().notNull().default("sconosciuto"),
    privacyClass: text("privacy_class").$type<PrivacyClass>().notNull(),
    maxSizeBytes: integer("max_size_bytes").notNull(),
    scanStatus: text("scan_status").$type<ScanStatus>().notNull().default("in_quarantena"),
    scanFindings: jsonb("scan_findings").$type<Record<string, unknown>>(),
    preview: jsonb("preview").$type<Record<string, unknown>>(),
    contentScanned: boolean("content_scanned").notNull().default(false),
    uploaderDeclaration: boolean("uploader_declaration").notNull().default(false),
    reviewedByUserId: uuid("reviewed_by_user_id"),
    reviewedAt: ucTimestamp("reviewed_at"),
    extractedText: text("extracted_text"),
    aiProcessingAllowed: boolean("ai_processing_allowed").notNull().default(false),
    retentionUntil: date("retention_until", { mode: "string" }),
    deletedAt: ucTimestamp("deleted_at"),
    deletionReason: varchar("deletion_reason", { length: 120 }),
    createdAt: ucTimestamp("created_at").notNull().defaultNow(),
  }
);

export const ucDatasets = pgTable(
  "uc_datasets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").notNull(),
    itemId: uuid("item_id"),
    fileId: uuid("file_id"),
    sourceKey: varchar("source_key", { length: 160 }).notNull(),
    datasetVersion: integer("dataset_version").notNull(),
    periodFrom: date("period_from", { mode: "string" }),
    periodTo: date("period_to", { mode: "string" }),
    extractedAt: ucTimestamp("extracted_at"),
    extractionMethod: text("extraction_method"),
    timezone: varchar("timezone", { length: 64 }),
    currency: char("currency", { length: 3 }),
    rowCount: integer("row_count"),
    columnMapping: jsonb("column_mapping").$type<Record<string, unknown>>(),
    schema: jsonb("schema").$type<Record<string, unknown>>(),
    pseudonymized: boolean("pseudonymized").notNull().default(false),
    pseudonymizationMethod: varchar("pseudonymization_method", { length: 120 }),
    personalData: text("personal_data").$type<FilePersonalData>(),
    piiColumns: jsonb("pii_columns").$type<string[]>().notNull().default([]),
    dataControllerLabel: varchar("data_controller_label", { length: 255 }).notNull(),
    quality: jsonb("quality").$type<Record<string, unknown>>(),
    status: text("status").$type<DatasetStatus>().notNull().default("ricevuto"),
    validatedByUserId: uuid("validated_by_user_id"),
    validatedAt: ucTimestamp("validated_at"),
    retentionUntil: date("retention_until", { mode: "string" }),
    createdAt: ucTimestamp("created_at").notNull().defaultNow(),
    updatedAt: ucTimestamp("updated_at").notNull().defaultNow(),
    deletedAt: ucTimestamp("deleted_at"),
  }
);

export const ucValidations = pgTable(
  "uc_validations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").notNull(),
    itemId: uuid("item_id").notNull(),
    answerId: uuid("answer_id"),
    datasetId: uuid("dataset_id"),
    checkKey: varchar("check_key", { length: 160 }).notNull(),
    kind: text("kind").$type<ValidationKind>().notNull(),
    outcome: text("outcome").$type<ValidationOutcome>().notNull(),
    message: text("message").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>(),
    byUserId: uuid("by_user_id"),
    createdAt: ucTimestamp("created_at").notNull().defaultNow(),
  }
);

export const ucComments = pgTable(
  "uc_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").notNull(),
    itemId: uuid("item_id").notNull(),
    authorUserId: uuid("author_user_id"),
    authorContactId: uuid("author_contact_id"),
    parentCommentId: uuid("parent_comment_id"),
    body: text("body").notNull(),
    visibility: text("visibility").$type<CommentVisibility>().notNull().default("interno_ls"),
    kind: text("kind").$type<CommentKind>().notNull().default("commento"),
    resolvedAt: ucTimestamp("resolved_at"),
    resolvedByUserId: uuid("resolved_by_user_id"),
    createdAt: ucTimestamp("created_at").notNull().defaultNow(),
  }
);

export const ucMaps = pgTable(
  "uc_maps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").notNull(),
    version: integer("version").notNull(),
    kind: text("kind").$type<MapKind>().notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    graph: jsonb("graph").$type<Record<string, unknown>>().notNull(),
    artifactBlobPath: text("artifact_blob_path"),
    artifactSha256: char("artifact_sha256", { length: 64 }),
    source: text("source").$type<MapSource>().notNull(),
    isCurrent: boolean("is_current").notNull().default(true),
    createdByUserId: uuid("created_by_user_id"),
    createdAt: ucTimestamp("created_at").notNull().defaultNow(),
  }
);

export const ucGateReviews = pgTable(
  "uc_gate_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").notNull(),
    gateKey: text("gate_key").$type<GateKey>().notNull(),
    computed: jsonb("computed").$type<Record<string, unknown>>().notNull(),
    catalogRevision: integer("catalog_revision").notNull(),
    summaryTextHash: char("summary_text_hash", { length: 64 }).notNull(),
    catalogVersion: integer("catalog_version"),
    catalogSnapshotPath: text("catalog_snapshot_path"),
    catalogSnapshotHash: char("catalog_snapshot_hash", { length: 64 }),
    decision: text("decision").$type<GateDecision>().notNull().default("proposto"),
    waivers: jsonb("waivers").$type<unknown[]>().notNull().default([]),
    approvals: jsonb("approvals").$type<Approval[]>().notNull().default([]),
    writtenEvidenceFileId: uuid("written_evidence_file_id"),
    notes: text("notes"),
    proposedByUserId: uuid("proposed_by_user_id"),
    proposedAt: ucTimestamp("proposed_at"),
    decidedAt: ucTimestamp("decided_at"),
    createdAt: ucTimestamp("created_at").notNull().defaultNow(),
  }
);

export const ucCatalogVersions = pgTable(
  "uc_catalog_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").notNull(),
    version: integer("version").notNull(),
    reason: text("reason").$type<CatalogVersionReason>().notNull(),
    gateReviewId: uuid("gate_review_id"),
    changeNote: text("change_note"),
    diff: jsonb("diff").$type<Record<string, unknown>>().notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    snapshotHash: char("snapshot_hash", { length: 64 }).notNull(),
    snapshotPath: text("snapshot_path"),
    approvedBy: jsonb("approved_by").$type<unknown[]>().notNull(),
    createdByUserId: uuid("created_by_user_id"),
    createdAt: ucTimestamp("created_at").notNull().defaultNow(),
  }
);

export const ucModelRuns = pgTable(
  "uc_model_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").notNull(),
    kind: text("kind").$type<ModelRunKind>().notNull(),
    catalogVersion: integer("catalog_version").notNull(),
    datasetVersions: jsonb("dataset_versions").$type<unknown[]>().notNull().default([]),
    codeRef: varchar("code_ref", { length: 120 }),
    parametersHash: varchar("parameters_hash", { length: 64 }),
    periodFrom: date("period_from", { mode: "string" }),
    periodTo: date("period_to", { mode: "string" }),
    summary: jsonb("summary").$type<Record<string, unknown>>(),
    status: text("status").$type<ProvisionalStatus>().notNull().default("provvisorio"),
    recordedBy: text("recorded_by").$type<RecordedBy>().notNull(),
    recordedByUserId: uuid("recorded_by_user_id"),
    integrationTokenId: uuid("integration_token_id"),
    confirmedByContactId: uuid("confirmed_by_contact_id"),
    confirmedAt: ucTimestamp("confirmed_at"),
    createdAt: ucTimestamp("created_at").notNull().defaultNow(),
  }
);

export const ucKpiMeasurements = pgTable(
  "uc_kpi_measurements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").notNull(),
    itemId: uuid("item_id").notNull(),
    phase: text("phase").$type<KpiPhase>().notNull(),
    periodStart: date("period_start", { mode: "string" }).notNull(),
    periodEnd: date("period_end", { mode: "string" }).notNull(),
    value: numeric("value"),
    unit: varchar("unit", { length: 40 }),
    intervalLow: numeric("interval_low"),
    intervalHigh: numeric("interval_high"),
    sampleSize: integer("sample_size").notNull(),
    suppressed: boolean("suppressed").notNull().default(false),
    dimensionValues: jsonb("dimension_values").$type<Record<string, unknown>>().notNull().default({}),
    method: text("method"),
    sourceRef: varchar("source_ref", { length: 500 }),
    datasetId: uuid("dataset_id"),
    modelRunId: uuid("model_run_id"),
    catalogVersion: integer("catalog_version"),
    recordedBy: text("recorded_by").$type<RecordedBy>().notNull(),
    recordedByUserId: uuid("recorded_by_user_id"),
    integrationTokenId: uuid("integration_token_id"),
    status: text("status").$type<ProvisionalStatus>().notNull().default("provvisorio"),
    confirmedByContactId: uuid("confirmed_by_contact_id"),
    confirmedAt: ucTimestamp("confirmed_at"),
    createdAt: ucTimestamp("created_at").notNull().defaultNow(),
  }
);

export const ucTestCases = pgTable(
  "uc_test_cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").notNull(),
    key: varchar("key", { length: 60 }).notNull(),
    kind: text("kind").$type<TestCaseKind>().notNull(),
    input: jsonb("input").$type<Record<string, unknown>>().notNull(),
    expected: jsonb("expected").$type<Record<string, unknown>>().notNull(),
    covers: jsonb("covers").$type<string[]>().notNull().default([]),
    servePer: jsonb("serve_per").$type<string[]>().notNull().default([]),
    lastResult: text("last_result").$type<TestCaseResult>().notNull().default("non_eseguito"),
    lastRunId: uuid("last_run_id"),
    approvedByContactId: uuid("approved_by_contact_id"),
    approvedAt: ucTimestamp("approved_at"),
    createdByUserId: uuid("created_by_user_id"),
    createdAt: ucTimestamp("created_at").notNull().defaultNow(),
    updatedAt: ucTimestamp("updated_at").notNull().defaultNow(),
  }
);

export const ucRoiModels = pgTable(
  "uc_roi_models",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").notNull(),
    version: integer("version").notNull(),
    status: text("status").$type<RoiStatus>().notNull().default("stima"),
    scenario: text("scenario").$type<RoiScenario>().notNull().default("base"),
    currency: char("currency", { length: 3 }).notNull().default("EUR"),
    implementationCost: numeric("implementation_cost"),
    annualRunCost: numeric("annual_run_cost"),
    annualBenefit: numeric("annual_benefit"),
    costLines: jsonb("cost_lines").$type<unknown[]>().notNull().default([]),
    benefitLines: jsonb("benefit_lines").$type<unknown[]>().notNull().default([]),
    breakEvenMonths: numeric("break_even_months"),
    value5y: numeric("value_5y"),
    discountRate: numeric("discount_rate"),
    horizonYears: integer("horizon_years").notNull().default(5),
    assumptions: jsonb("assumptions").$type<unknown[]>().notNull().default([]),
    attributionMethod: text("attribution_method"),
    baselinePeriod: jsonb("baseline_period").$type<Record<string, unknown>>(),
    adoptionRate: numeric("adoption_rate"),
    includesHumanReviewTime: boolean("includes_human_review_time").notNull().default(true),
    humanReviewHours: numeric("human_review_hours"),
    content: jsonb("content").$type<Record<string, unknown>>().notNull().default({}),
    approvedByContactId: uuid("approved_by_contact_id"),
    approvedAt: ucTimestamp("approved_at"),
    createdAt: ucTimestamp("created_at").notNull().defaultNow(),
    updatedAt: ucTimestamp("updated_at").notNull().defaultNow(),
  }
);

export const ucMilestones = pgTable(
  "uc_milestones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").notNull(),
    key: varchar("key", { length: 60 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    plannedDate: date("planned_date", { mode: "string" }),
    plannedLabel: text("planned_label"),
    isProposal: boolean("is_proposal").notNull().default(false),
    toConfirm: boolean("to_confirm").notNull().default(false),
    ownerLabel: varchar("owner_label", { length: 255 }),
    doneAt: ucTimestamp("done_at"),
    notes: text("notes"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: ucTimestamp("created_at").notNull().defaultNow(),
    updatedAt: ucTimestamp("updated_at").notNull().defaultNow(),
  }
);

export const ucNotifications = pgTable(
  "uc_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    caseId: uuid("case_id"),
    requestId: uuid("request_id"),
    recipientContactId: uuid("recipient_contact_id"),
    recipientUserId: uuid("recipient_user_id"),
    channel: text("channel").$type<NotificationChannel>().notNull(),
    templateKey: varchar("template_key", { length: 80 }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").$type<NotificationStatus>().notNull().default("in_coda"),
    holdReason: varchar("hold_reason", { length: 60 }),
    attempts: integer("attempts").notNull().default(0),
    dedupeKey: varchar("dedupe_key", { length: 200 }).notNull(),
    scheduledAt: ucTimestamp("scheduled_at").notNull().defaultNow(),
    sentAt: ucTimestamp("sent_at"),
    readAt: ucTimestamp("read_at"),
    error: varchar("error", { length: 500 }),
    createdAt: ucTimestamp("created_at").notNull().defaultNow(),
  }
);

export const ucEvents = pgTable(
  "uc_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id"),
    caseId: uuid("case_id"),
    actorType: text("actor_type").$type<EventActorType>().notNull(),
    actorUserId: uuid("actor_user_id"),
    actorContactId: uuid("actor_contact_id"),
    integrationTokenId: uuid("integration_token_id"),
    eventType: varchar("event_type", { length: 100 }).notNull(),
    targetType: varchar("target_type", { length: 40 }),
    targetId: uuid("target_id"),
    fromState: varchar("from_state", { length: 40 }),
    toState: varchar("to_state", { length: 40 }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    ipHash: varchar("ip_hash", { length: 64 }),
    userAgent: varchar("user_agent", { length: 300 }),
    createdAt: ucTimestamp("created_at").notNull().defaultNow(),
  }
);

export const ucRateLimits = pgTable(
  "uc_rate_limits",
  {
    bucket: varchar("bucket", { length: 120 }).notNull(),
    windowStart: ucTimestamp("window_start").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ name: "uc_rate_limits_pkey", columns: [t.bucket, t.windowStart] })]
);

/** Autorizzazione ai sub-responsabili (GDPR art. 28, par. 2), a sola aggiunta. */
export const ucSubprocessorAcks = pgTable(
  "uc_subprocessor_acks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    listVersion: text("list_version").notNull(),
    statementText: text("statement_text").notNull(),
    declaredByUserId: uuid("declared_by_user_id").notNull(),
    declaredByRole: text("declared_by_role").notNull(),
    declaredAt: ucTimestamp("declared_at").notNull().defaultNow(),
  }
);

export type UcTemplate = typeof ucTemplates.$inferSelect;
export type UcContact = typeof ucContacts.$inferSelect;
export type UcCase = typeof ucCases.$inferSelect;
export type UcCaseMember = typeof ucCaseMembers.$inferSelect;
export type UcBlocker = typeof ucBlockers.$inferSelect;
export type UcItem = typeof ucItems.$inferSelect;
export type UcItemBlocker = typeof ucItemBlockers.$inferSelect;
export type UcItemLink = typeof ucItemLinks.$inferSelect;
export type UcRequest = typeof ucRequests.$inferSelect;
export type UcRequestToken = typeof ucRequestTokens.$inferSelect;
export type UcRequestItem = typeof ucRequestItems.$inferSelect;
export type UcAnswer = typeof ucAnswers.$inferSelect;
export type UcFile = typeof ucFiles.$inferSelect;
export type UcDataset = typeof ucDatasets.$inferSelect;
export type UcValidation = typeof ucValidations.$inferSelect;
export type UcComment = typeof ucComments.$inferSelect;
export type UcMap = typeof ucMaps.$inferSelect;
export type UcGateReview = typeof ucGateReviews.$inferSelect;
export type UcCatalogVersion = typeof ucCatalogVersions.$inferSelect;
export type UcModelRun = typeof ucModelRuns.$inferSelect;
export type UcKpiMeasurement = typeof ucKpiMeasurements.$inferSelect;
export type UcTestCase = typeof ucTestCases.$inferSelect;
export type UcRoiModel = typeof ucRoiModels.$inferSelect;
export type UcMilestone = typeof ucMilestones.$inferSelect;
export type UcNotification = typeof ucNotifications.$inferSelect;
export type UcEvent = typeof ucEvents.$inferSelect;
export type UcRateLimit = typeof ucRateLimits.$inferSelect;
export type UcSubprocessorAck = typeof ucSubprocessorAcks.$inferSelect;
