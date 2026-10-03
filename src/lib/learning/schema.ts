import { pgTable, uuid, text, timestamp, jsonb, boolean, integer, unique, foreignKey, index } from "drizzle-orm/pg-core";
import { users, workspaces, useCases } from "@/lib/db/schema";
import type { PrivateTrainingPack, AttemptOrder, AttemptResponses, ObjectiveGrade } from "./types";

const date = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
export const learningPrograms = pgTable("learning_programs", {
  id: uuid("id").primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  familyKey: text("family_key").notNull(), title: text("title").notNull(), contentVersion: text("content_version").notNull(),
  packHash: text("pack_hash").notNull(), privatePack: jsonb("private_pack").$type<PrivateTrainingPack>().notNull(),
  status: text("status").notNull().default("published"), closedAt: date("closed_at"), featureEnabled: boolean("feature_enabled").notNull().default(false),
  visibilityPolicy: text("visibility_policy").notNull(), retentionDays: integer("retention_days").notNull(),
  publishedBy: uuid("published_by").notNull().references(() => users.id), publishedAt: date("published_at").defaultNow().notNull(),
}, t => [unique().on(t.workspaceId,t.id), unique().on(t.workspaceId,t.familyKey,t.contentVersion)]);
export const learningSessions = pgTable("learning_sessions", {
  id: uuid("id").primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull(), programId: uuid("program_id").notNull(),
  moduleId: text("module_id").notNull(), cohortId: text("cohort_id").notNull(), startsAt: date("starts_at").notNull(), endsAt: date("ends_at").notNull(),
  timezone: text("timezone").notNull().default("Europe/Rome"), status: text("status").notNull().default("scheduled"),
}, t => [unique().on(t.workspaceId,t.programId,t.moduleId,t.cohortId), foreignKey({columns:[t.workspaceId,t.programId],foreignColumns:[learningPrograms.workspaceId,learningPrograms.id]})]);
export const learningEnrollments = pgTable("learning_enrollments", {
  id: uuid("id").primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull(), programId: uuid("program_id").notNull(),
  userId: uuid("user_id").notNull().references(() => users.id), moduleId: text("module_id").notNull().default("m1"), cohortId: text("cohort_id").notNull(),
  status: text("status").notNull().default("active"), assignedAt: date("assigned_at").defaultNow().notNull(),
}, t => [unique().on(t.workspaceId,t.programId,t.userId,t.moduleId),unique().on(t.workspaceId,t.programId,t.id,t.userId),foreignKey({columns:[t.workspaceId,t.programId,t.moduleId,t.cohortId],foreignColumns:[learningSessions.workspaceId,learningSessions.programId,learningSessions.moduleId,learningSessions.cohortId]})]);
export const learningGrants = pgTable("learning_grants", {
  id: uuid("id").primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull(), programId: uuid("program_id").notNull(),
  userId: uuid("user_id").notNull().references(() => users.id), capability: text("capability").notNull(), cohortId: text("cohort_id"),
  grantedBy: uuid("granted_by").notNull().references(() => users.id), grantedAt: date("granted_at").defaultNow().notNull(), revokedAt: date("revoked_at"),
}, t => [foreignKey({columns:[t.workspaceId,t.programId],foreignColumns:[learningPrograms.workspaceId,learningPrograms.id]})]);
export const learningAttempts = pgTable("learning_attempts", {
  id: uuid("id").primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull(), programId: uuid("program_id").notNull(),
  enrollmentId: uuid("enrollment_id").notNull(), userId: uuid("user_id").notNull().references(() => users.id), activityId: text("activity_id").notNull(),
  attemptNumber: integer("attempt_number").notNull(), parentAttemptId: uuid("parent_attempt_id"), status: text("status").notNull().default("draft"),
  contentVersion: text("content_version").notNull(), packHash: text("pack_hash").notNull(), itemOrder: jsonb("item_order").$type<AttemptOrder>().notNull(),
  responses: jsonb("responses").$type<AttemptResponses>().notNull(), revision: integer("revision").notNull().default(1), result: jsonb("result").$type<ObjectiveGrade>(),
  decisionsSubmittedAt: date("decisions_submitted_at"), idempotencyKey: uuid("idempotency_key"), createdAt: date("created_at").defaultNow().notNull(), updatedAt: date("updated_at").defaultNow().notNull(), submittedAt: date("submitted_at"),
}, t => [unique().on(t.workspaceId,t.programId,t.enrollmentId,t.activityId,t.attemptNumber),unique().on(t.workspaceId,t.programId,t.enrollmentId,t.id),unique().on(t.workspaceId,t.programId,t.userId,t.idempotencyKey),foreignKey({columns:[t.workspaceId,t.programId,t.enrollmentId,t.userId],foreignColumns:[learningEnrollments.workspaceId,learningEnrollments.programId,learningEnrollments.id,learningEnrollments.userId]}),index().on(t.workspaceId,t.programId,t.userId,t.updatedAt)]);
export const learningAuditEvents = pgTable("learning_audit_events", {
  id: uuid("id").primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull(), programId: uuid("program_id").notNull(),
  actorId: uuid("actor_id").notNull().references(() => users.id), resourceId: uuid("resource_id").notNull(), eventType: text("event_type").notNull(),
  metadata: jsonb("metadata").notNull().default({}), createdAt: date("created_at").defaultNow().notNull(),
}, t => [foreignKey({columns:[t.workspaceId,t.programId],foreignColumns:[learningPrograms.workspaceId,learningPrograms.id]})]);
export const learningIdeaDrafts = pgTable("learning_idea_drafts", {
  id: uuid("id").primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull(), programId: uuid("program_id").notNull(),
  enrollmentId: uuid("enrollment_id").notNull(), userId: uuid("user_id").notNull().references(() => users.id), fields: jsonb("fields").$type<Record<string,string>>().notNull().default({}),
  revision: integer("revision").notNull().default(1), status: text("status").notNull().default("draft"), idempotencyKey: uuid("idempotency_key"), resultingUseCaseId: uuid("resulting_use_case_id").references(() => useCases.id),
  createdAt: date("created_at").defaultNow().notNull(), updatedAt: date("updated_at").defaultNow().notNull(),
}, t => [unique().on(t.workspaceId,t.programId,t.userId),unique().on(t.workspaceId,t.programId,t.userId,t.idempotencyKey),foreignKey({columns:[t.workspaceId,t.programId,t.enrollmentId,t.userId],foreignColumns:[learningEnrollments.workspaceId,learningEnrollments.programId,learningEnrollments.id,learningEnrollments.userId]})]);
