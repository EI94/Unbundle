import { z } from "zod";

const workspace = { workspaceId: z.uuid() };
const scope = { ...workspace, programId: z.uuid() };
const settings = { title: z.string().trim().min(1).max(250), visibilityPolicy: z.string().trim().min(20).max(10_000), retentionDays: z.number().int().min(1).max(3650) };
// The snapshot is compared byte-for-byte with the stored values. Never trim it.
export const adminSettingsSnapshotSchema = z.object({ title: z.string().min(1).max(250), visibilityPolicy: z.string().min(20).max(10_000), retentionDays: z.number().int().min(1).max(3650) }).strict();
export type AdminSettingsSnapshot = z.infer<typeof adminSettingsSnapshotSchema>;
const cohort = z.string().min(1).max(100);
export const learningAdminRequestSchema = z.discriminatedUnion("operation", [
  z.object({ expectedUserId: z.uuid(), operation: z.literal("catalog"), input: z.object(workspace).strict() }).strict(),
  z.object({ expectedUserId: z.uuid(), operation: z.literal("detail"), input: z.object(scope).strict() }).strict(),
  z.object({ expectedUserId: z.uuid(), operation: z.literal("inspectPack"), input: z.object({ ...workspace, pack: z.unknown() }).strict() }).strict(),
  z.object({ expectedUserId: z.uuid(), operation: z.literal("importPack"), input: z.object({ ...workspace, pack: z.unknown(), ...settings }).strict() }).strict(),
  z.object({ expectedUserId: z.uuid(), operation: z.literal("settings"), input: z.object({ ...scope, ...settings, expectedSettings: adminSettingsSnapshotSchema }).strict() }).strict(),
  z.object({ expectedUserId: z.uuid(), operation: z.literal("lifecycle"), input: z.object({ ...scope, action: z.enum(["enable", "disable", "close", "reopen"]) }).strict() }).strict(),
  z.object({ expectedUserId: z.uuid(), operation: z.literal("session"), input: z.object({ ...scope, sessionId: z.uuid(), status: z.enum(["scheduled", "open", "closed"]) }).strict() }).strict(),
  z.object({ expectedUserId: z.uuid(), operation: z.literal("enroll"), input: z.object({ ...scope, userIds: z.array(z.uuid()).min(1).max(100).refine(ids => new Set(ids.map(id=>id.toLowerCase())).size === ids.length), cohortId: cohort }).strict() }).strict(),
  z.object({ expectedUserId: z.uuid(), operation: z.literal("enrollment"), input: z.object({ ...scope, enrollmentId: z.uuid(), status: z.enum(["active", "revoked"]), cohortId: cohort }).strict() }).strict(),
  z.object({ expectedUserId: z.uuid(), operation: z.literal("grant"), input: z.object({ ...scope, userId: z.uuid(), capability: z.enum(["manage", "review", "aggregate", "export"]), cohortId: cohort.nullable() }).strict() }).strict(),
  z.object({ expectedUserId: z.uuid(), operation: z.literal("revokeGrant"), input: z.object({ ...scope, grantId: z.uuid() }).strict() }).strict(),
  z.object({ expectedUserId: z.uuid(), operation: z.literal("joinLink"), input: z.object({ ...scope, cohortId: cohort, label: z.string().trim().max(120).optional(), maxUses: z.number().int().min(1).max(500), expiresInHours: z.number().int().min(1).max(720), idempotencyKey: z.uuid() }).strict() }).strict(),
  z.object({ expectedUserId: z.uuid(), operation: z.literal("joinLinkDoor"), input: z.object({ ...scope, linkId: z.uuid(), doorOpen: z.boolean() }).strict() }).strict(),
  z.object({ expectedUserId: z.uuid(), operation: z.literal("joinLinkSeats"), input: z.object({ ...scope, linkId: z.uuid(), maxUses: z.number().int().min(1).max(500) }).strict() }).strict(),
  z.object({ expectedUserId: z.uuid(), operation: z.literal("deleteMaterial"), input: z.object({ ...scope, materialId: z.uuid() }).strict() }).strict(),
  z.object({ expectedUserId: z.uuid(), operation: z.literal("revokeJoinLink"), input: z.object({ ...scope, linkId: z.uuid() }).strict() }).strict(),
  z.object({ expectedUserId: z.uuid(), operation: z.literal("purge"), input: z.object({ ...scope, confirmProgramId: z.uuid(), confirmTitle: z.string().min(1).max(250) }).strict() }).strict(),
]);
export type LearningAdminRequest = z.infer<typeof learningAdminRequestSchema>;
export type AdminCapability = "manage" | "review" | "aggregate" | "export";
export type AdminProgramDTO = {
  id: string; title: string; version: string; status: string; featureEnabled: boolean;
  visibilityPolicy: string; retentionDays: number; publishedAt: string; closedAt: string | null;
  canManageAll: boolean; managedCohorts: string[];
};
export type AdminCatalogDTO = { userId: string; canCreate: boolean; canManage: boolean; programs: AdminProgramDTO[] };
export type AdminPackDTO = {
  version: string; hash: string; modules: { id: string; title: string; sessions: { cohortId: string; startsAt: string; endsAt: string; timezone: string }[] }[];
  activityCount: number; itemCount: number; sessionCount: number;
};
export type AdminDetailDTO = {
  userId: string;
  program: AdminProgramDTO;
  members: { id: string; name: string | null; email: string; role: string; source: "organization" | "workspace" }[];
  sessions: { id: string; moduleId: string; cohortId: string; startsAt: string; endsAt: string; timezone: string; status: string }[];
  enrollments: { id: string; userId: string; name: string | null; email: string; moduleId: string; cohortId: string; status: string; hasWork: boolean }[];
  grants: { id: string; userId: string; name: string | null; email: string; capability: AdminCapability; cohortId: string | null; grantedAt: string; revokedAt: string | null }[];
  audit: { id: string; eventType: string; actorName: string | null; resourceId: string; createdAt: string; cohortId: string | null }[];
  retention: { eligible: boolean; purgeAfter: string | null; attempts: number; ideaDrafts: number } | null;
  materials: {
    id: string; moduleId: string | null; title: string; description: string | null; kind: string; audience: string;
    downloadBefore: boolean; availableAfterSession: boolean; fileName: string; sizeBytes: number;
    /** Persone che l'hanno scaricato almeno una volta, e iscritti attivi: per sapere chi è pronto. */
    downloads: number; enrolled: number;
  }[];
  joinLinks: {
    id: string; cohortId: string; label: string | null; maxUses: number; usedCount: number;
    doorOpen: boolean; expiresAt: string; revokedAt: string | null; createdAt: string;
    /** Quante persone sono entrate davvero: contate sulle riscossioni, non su used_count. */
    joined: number;
    /** Chi ha gia' del lavoro su un altro turno e chiede che venga riaperto. */
    reopenRequests: { cohortId: string; count: number }[];
  }[];
};
export type AdminMutationDTO = { programId: string; changed: number; message: string };
/**
 * Il link appena creato. Il token in chiaro vive solo in questa risposta: non
 * viene ripersistito, quindi se il formatore lo perde si rigenera.
 */
export type AdminJoinLinkDTO = AdminMutationDTO & { linkId: string; token: string; url: string; qrSvg: string };
export type AdminResponseMap = { catalog: AdminCatalogDTO; detail: AdminDetailDTO; inspectPack: AdminPackDTO; joinLink: AdminJoinLinkDTO }
  & Record<Exclude<LearningAdminRequest["operation"], "catalog" | "detail" | "inspectPack" | "joinLink">, AdminMutationDTO>;
export type LearningAdminResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string; fieldErrors?: Record<string, string> };
