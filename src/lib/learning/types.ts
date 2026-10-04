/** Private pack types are server input only. Client components use the explicit DTOs below. */
export interface TrainingCohort { id: string; start_local: string; end_local: string; timezone: string }
export interface TrainingAgendaBlock { from_minute: number; to_minute: number; title: string; detail?: string }
export interface TrainingModule {
  id: string; title: string; subtitle: string; objective: string; cohorts: TrainingCohort[]; duration_minutes: number;
  agenda?: TrainingAgendaBlock[]; takeaways?: string[]; next_steps?: string[];
}
export interface TrainingTextField { id: string; label: string; min_chars: number; max_chars: number; grading?: "unscored_reflection" }
export interface TrainingActivity {
  id: string; module_id: string; type: "knowledge_check" | "case_review" | "prompt_lab" | "skill_blueprint";
  title: string; item_ids?: string[]; case_id?: string; purpose: "formative" | "practice" | "post_module" | "retake";
  ai_assistance: "not_allowed" | "allowed_after_individual_decisions" | "declared_allowed";
  completion_gate: boolean; estimated_minutes: number; pass_min_correct?: number; required_critical_correct?: boolean;
  required_text_fields?: TrainingTextField[]; allowed_modes?: string[]; retake_activity_id?: string;
  parallel_form_status?: string; rubric_id?: string; grading?: "human_rubric"; retake_policy?: string;
  opens_after_minutes?: number;
}
export interface TrainingItem {
  id: string; module_id: string; activity_id: string; type: "single_choice"; prompt: string;
  options: { id: string; text: string }[]; correct_option_ids: string[]; points: number; critical: boolean;
  competency_id: string; feedback: string; evidence_refs: string[]; version: number;
}
export interface TrainingMovement { id: string; origin: string; destination: string; day: string; time: string }
export interface TrainingCase {
  id: string; title: string; source: string; synthetic: true; text?: string; facts?: { id: string; text: string }[];
  prepared_bad_output?: string; reference_output: string; task?: string; prompt?: string; boundaries: string[];
  request?: { outbound_origin: string; outbound_destination: string; outbound_day: string; return_origin: string; return_destination: string; return_day: string; passengers: number };
  movements?: TrainingMovement[];
  test_variants?: { id: string; expected_direct_candidates: string[]; add_movement?: TrainingMovement; meaning?: string }[];
  missing?: string[];
  rows?: { id: string; supplier: string; document: string; order: string | null; amount_cents: number }[];
  orders?: { id: string; amount_cents: number }[]; change_note?: string;
}
export interface TrainingRubric {
  id: string; max_points: number; minimum_points: number; critical_criterion_ids: string[]; require_critical_minimum: number;
  criteria: { id: string; label: string; anchors: { "0": string; "1": string; "2": string } }[]; review_rules: string[];
}
export interface PrivateTrainingPack {
  schema_version: "1.0.0"; content_version: string; status: string; visibility: string; language: string; client_pack: string; source_snapshot_sha: string;
  modules: TrainingModule[]; competencies: { id: string; label: string }[]; cases: TrainingCase[];
  activities: TrainingActivity[]; items: TrainingItem[]; rubrics: TrainingRubric[]; sources: Record<string, string>;
  policy: {
    graded_answers_authority: "server_only"; survey_linking: "forbidden_for_anonymous_responses";
    confidence: "separate_optional_not_scored"; public_leaderboard: false; first_attempt_preserved: true;
    completion_not_certification: true; llm_grade_is_final: false; m1_has_no_llm_dependency: true; raw_answers_in_analytics: false;
  };
}
export interface AttemptOrder { itemIds: string[]; optionIds: Record<string, string[]> }
export interface AttemptResponses { answers: Record<string, string>; fields: Record<string, string>; mode?: string }
export interface LearnerActivityDTO {
  id: string; moduleId: string; title: string; type: TrainingActivity["type"]; purpose: TrainingActivity["purpose"];
  aiAssistance: TrainingActivity["ai_assistance"]; estimatedMinutes: number; completionGate: boolean;
  passMinCorrect: number | null; requiresCriticalCorrect: boolean; allowedModes: string[];
  requiredTextFields: { id: string; label: string; minChars: number; maxChars: number }[];
  items: { id: string; prompt: string; options: { id: string; text: string }[] }[];
  case: { id: string; title: string; synthetic: true; text: string | null; preparedBadOutput: string | null; task: string | null } | null;
}
export interface ObjectiveGrade {
  correct: number; total: number; essential_errors: string[];
  status: "formative_completed" | "consolidated" | "needs_practice";
  items: { itemId: string; selectedOptionId: string; correct: boolean; critical: boolean; feedback: string; evidence: string[] }[];
}
