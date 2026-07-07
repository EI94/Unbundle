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
} from "drizzle-orm/pg-core";

// ─── Enums ──────────────────────────────────────────────────────────

export const memberRoleEnum = pgEnum("member_role", [
  "exec_sponsor",
  "transformation_lead",
  "function_lead",
  "contributor",
  "analyst",
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
   * Nome del team che governa triage e valutazione (es. "AI Transformation", "CoE AI").
   * Usato in copy UI e notifiche Slack.
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
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const externalContributionSubmissions = pgTable(
  "external_contribution_submissions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    integrationTokenId: uuid("integration_token_id")
      .notNull()
      .references(() => workspaceIntegrationTokens.id, { onDelete: "cascade" }),
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
    index("external_contribution_workspace_idx").on(t.workspaceId),
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
export type NewWorkspaceScoringModel = typeof workspaceScoringModels.$inferInsert;
export type StrategicGoal = typeof strategicGoals.$inferSelect;
export type NewStrategicGoal = typeof strategicGoals.$inferInsert;
export type Department = typeof departments.$inferSelect;
export type NewDepartment = typeof departments.$inferInsert;
export type Activity = typeof activities.$inferSelect;
export type NewActivity = typeof activities.$inferInsert;
export type UseCase = typeof useCases.$inferSelect;
export type NewUseCase = typeof useCases.$inferInsert;
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
