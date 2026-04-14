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
  vector,
  index,
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

export const useCaseCategoryEnum = pgEnum("use_case_category", [
  "quick_win",
  "strategic_bet",
  "capability_builder",
  "not_yet",
]);

export const useCaseStatusEnum = pgEnum("use_case_status", [
  "draft",
  "proposed",
  "accepted",
  "in_progress",
  "implemented",
  "rejected",
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
  category: useCaseCategoryEnum("category"),
  status: useCaseStatusEnum("status").notNull().default("draft"),
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
    embedding: vector("embedding", { dimensions: 1536 }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [index("document_chunks_workspace_idx").on(t.workspaceId)]
);

// ─── RAG: Conversation Embeddings ────────────────────────────────────

export const conversationEmbeddings = pgTable(
  "conversation_embeddings",
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
    embedding: vector("embedding", { dimensions: 1536 }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [index("conversation_embeddings_workspace_idx").on(t.workspaceId)]
);

// ─── Type exports ───────────────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type Membership = typeof memberships.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
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
export type ConversationEmbedding = typeof conversationEmbeddings.$inferSelect;
