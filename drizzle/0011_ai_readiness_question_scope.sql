ALTER TABLE "ai_readiness_respondents"
  ADD COLUMN IF NOT EXISTS "question_scope" jsonb;
