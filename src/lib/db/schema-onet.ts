import { pgTable, uuid, varchar, text, real, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const onetTaskStatements = pgTable("onet_task_statements", {
  id: uuid("id").defaultRandom().primaryKey(),
  onetSocCode: varchar("onet_soc_code", { length: 20 }).notNull(),
  occupationTitle: varchar("occupation_title", { length: 500 }),
  taskId: varchar("task_id", { length: 20 }).notNull(),
  task: text("task").notNull(),
  taskType: varchar("task_type", { length: 50 }),
  incumbentsResponding: integer("incumbents_responding"),
  relevanceScore: real("relevance_score"),
  dwaTitle: varchar("dwa_title", { length: 500 }),
  aiExposureTheoretical: real("ai_exposure_theoretical"),
  aiExposureObserved: real("ai_exposure_observed"),
});

export const onetOccupations = pgTable("onet_occupations", {
  id: uuid("id").defaultRandom().primaryKey(),
  onetSocCode: varchar("onet_soc_code", { length: 20 }).notNull().unique(),
  title: varchar("title", { length: 500 }).notNull(),
  description: text("description"),
  category: varchar("category", { length: 255 }),
  averageAiExposure: real("average_ai_exposure"),
  medianSalary: real("median_salary"),
  employmentCount: integer("employment_count"),
  projectedGrowth: real("projected_growth"),
});

export const benchmarkData = pgTable("benchmark_data", {
  id: uuid("id").defaultRandom().primaryKey(),
  industry: varchar("industry", { length: 255 }).notNull(),
  functionArea: varchar("function_area", { length: 255 }).notNull(),
  activityPattern: varchar("activity_pattern", { length: 500 }).notNull(),
  automationRate: real("automation_rate"),
  avgTimeSaved: real("avg_time_saved"),
  adoptionPercentage: real("adoption_percentage"),
  source: varchar("source", { length: 255 }),
  dataDate: timestamp("data_date", { mode: "date" }),
  metadata: jsonb("metadata"),
});

export type OnetTaskStatement = typeof onetTaskStatements.$inferSelect;
export type OnetOccupation = typeof onetOccupations.$inferSelect;
export type BenchmarkData = typeof benchmarkData.$inferSelect;
