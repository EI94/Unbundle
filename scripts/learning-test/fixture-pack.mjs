import { createGenericTrainingPack } from "../../src/lib/learning/test-fixture.ts";

// Operational activity identifiers are public; all prompts, cases and options
// remain the generic fixture. No private customer package is read.
export function createOperationalTestPack() {
  const pack = createGenericTrainingPack();
  const ids = { check: "m1-check", case: "m1-case", exit: "m1-exit-a", retake: "m1-exit-b" };
  for (const activity of pack.activities) {
    activity.id = ids[activity.id];
    if (activity.retake_activity_id) activity.retake_activity_id = ids[activity.retake_activity_id];
  }
  for (const item of pack.items) item.activity_id = ids[item.activity_id];
  pack.content_version = "2026-10-01.2";
  pack.modules[0].cohorts.push({ ...pack.modules[0].cohorts[0], id: "m1-cohort-2", start_local: "2026-10-07T14:30:00", end_local: "2026-10-07T16:30:00" });
  return pack;
}
