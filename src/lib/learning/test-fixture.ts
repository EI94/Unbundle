import type { PrivateTrainingPack, TrainingActivity, TrainingItem } from "./types.ts";

/** Deliberately generic public fixture. No client content or private bank keys. */
export function createGenericTrainingPack(): PrivateTrainingPack {
  const makeActivity = (id: string, count: number, extra: Partial<TrainingActivity>): TrainingActivity => ({
    id, module_id: "m1", type: "knowledge_check", title: `Generic ${id}`, item_ids: Array.from({ length: count }, (_, index) => `${id}-q${index}`),
    purpose: "post_module", ai_assistance: "not_allowed", completion_gate: true, estimated_minutes: 8, pass_min_correct: count - 2, required_critical_correct: true, ...extra,
  });
  const activities = [
    makeActivity("check", 3, { purpose: "formative", completion_gate: false }),
    makeActivity("case", 6, { type: "case_review", purpose: "practice", pass_min_correct: 5, case_id: "generic-case", ai_assistance: "allowed_after_individual_decisions", required_text_fields: [{ id: "reflection", label: "Explain a correction", min_chars: 15, max_chars: 1000, grading: "unscored_reflection" }], allowed_modes: ["review_reference_output", "execute_authorized_assistant"] }),
    makeActivity("exit", 8, { retake_activity_id: "retake" }),
    makeActivity("retake", 8, { purpose: "retake" }),
  ];
  const items: TrainingItem[] = activities.flatMap((activity) => activity.item_ids!.map((itemId, index) => ({
    id: itemId, module_id: "m1", activity_id: activity.id, type: "single_choice", prompt: `Generic prompt ${index}`,
    options: [...Array.from({ length: 4 }, (_, option) => ({ id: `option-${option}`, text: `Generic option ${option}` })), { id: "unsure", text: "Not sure yet" }],
    correct_option_ids: [`option-${index % 4}`], points: 1, critical: index >= (activity.item_ids!.length - (activity.id === "case" ? 1 : 2)), competency_id: "competency",
    feedback: "PRIVATE_FEEDBACK_MARKER", evidence_refs: activity.id === "case" ? ["generic-case:fact"] : ["SOURCE"], version: 1,
  })));
  return {
    schema_version: "1.0.0", content_version: "2026-10-01.1", status: "draft", visibility: "INSTRUCTOR_PRIVATE", language: "it", client_pack: "generic-test", source_snapshot_sha: "a".repeat(40),
    modules: ["m1", "m2", "m3"].map((id, index) => ({ id, title: `Generic module ${index}`, subtitle: "Training", objective: "A generic learning objective", duration_minutes: 120,
      cohorts: [{ id: `${id}-cohort`, start_local: index === 0 ? "2026-10-05T14:30:00" : "2026-10-27T10:00:00", end_local: index === 0 ? "2026-10-05T16:30:00" : "2026-10-27T12:00:00", timezone: "Europe/Rome" }],
    })),
    competencies: [{ id: "competency", label: "Generic competency" }],
    cases: [{ id: "generic-case", title: "Generic exercise", synthetic: true, source: "SOURCE", text: "A fictional request for a blue card.", prepared_bad_output: "A green card has been issued.", task: "Read and correct the summary.",
      reference_output: "PRIVATE_REFERENCE_MARKER", facts: [{ id: "fact", text: "PRIVATE_FACT_MARKER" }], prompt: "PRIVATE_PROMPT_MARKER", boundaries: ["PRIVATE_BOUNDARY_MARKER"] }],
    activities, items, sources: { SOURCE: "PRIVATE_SOURCE_MARKER" },
    rubrics: [{ id: "generic-rubric", max_points: 10, minimum_points: 8, critical_criterion_ids: ["criterion-0", "criterion-1"], require_critical_minimum: 1,
      criteria: Array.from({ length: 5 }, (_, index) => ({ id: `criterion-${index}`, label: `Criterion ${index}`, anchors: { "0": "Absent", "1": "Partial", "2": "Complete" } })), review_rules: ["Human evidence required"] }],
    policy: { graded_answers_authority: "server_only", survey_linking: "forbidden_for_anonymous_responses", confidence: "separate_optional_not_scored", public_leaderboard: false, first_attempt_preserved: true, completion_not_certification: true, llm_grade_is_final: false, m1_has_no_llm_dependency: true, raw_answers_in_analytics: false },
  };
}
