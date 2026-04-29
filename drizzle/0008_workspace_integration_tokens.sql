CREATE TABLE IF NOT EXISTS "workspace_integration_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "label" varchar(255) NOT NULL,
  "provider" varchar(50) NOT NULL DEFAULT 'claude_mcp',
  "token_hash" varchar(128) NOT NULL UNIQUE,
  "token_prefix" varchar(32) NOT NULL,
  "scopes" jsonb NOT NULL DEFAULT '["portfolio:submit"]'::jsonb,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "last_used_at" timestamp,
  "expires_at" timestamp,
  "revoked_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_integration_tokens_workspace_idx"
  ON "workspace_integration_tokens" ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_integration_tokens_hash_idx"
  ON "workspace_integration_tokens" ("token_hash");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "external_contribution_submissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "integration_token_id" uuid NOT NULL REFERENCES "workspace_integration_tokens"("id") ON DELETE CASCADE,
  "idempotency_key" varchar(128) NOT NULL,
  "request_hash" varchar(128) NOT NULL,
  "status" varchar(50) NOT NULL DEFAULT 'pending',
  "use_case_id" uuid REFERENCES "use_cases"("id") ON DELETE SET NULL,
  "error_code" varchar(100),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "external_contribution_idempotency_idx"
  ON "external_contribution_submissions" ("workspace_id", "integration_token_id", "idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "external_contribution_workspace_idx"
  ON "external_contribution_submissions" ("workspace_id");
