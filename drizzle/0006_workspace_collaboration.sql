CREATE TABLE IF NOT EXISTS "workspace_memberships" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" "member_role" NOT NULL DEFAULT 'contributor',
  "source" varchar(50) NOT NULL DEFAULT 'direct',
  "invited_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_memberships_workspace_user_idx"
  ON "workspace_memberships" ("workspace_id", "user_id");
CREATE INDEX IF NOT EXISTS "workspace_memberships_user_idx"
  ON "workspace_memberships" ("user_id");

CREATE TABLE IF NOT EXISTS "workspace_invitations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "email" varchar(255),
  "role" "member_role" NOT NULL DEFAULT 'contributor',
  "token_hash" varchar(128) NOT NULL UNIQUE,
  "max_uses" integer NOT NULL DEFAULT 1,
  "used_count" integer NOT NULL DEFAULT 0,
  "expires_at" timestamp NOT NULL,
  "revoked_at" timestamp,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "workspace_invitations_workspace_idx"
  ON "workspace_invitations" ("workspace_id");
CREATE INDEX IF NOT EXISTS "workspace_invitations_token_hash_idx"
  ON "workspace_invitations" ("token_hash");

CREATE TABLE IF NOT EXISTS "workspace_invitation_acceptances" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "invitation_id" uuid NOT NULL REFERENCES "workspace_invitations"("id") ON DELETE CASCADE,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "email_snapshot" varchar(255),
  "accepted_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_invitation_acceptances_invite_user_idx"
  ON "workspace_invitation_acceptances" ("invitation_id", "user_id");
CREATE INDEX IF NOT EXISTS "workspace_invitation_acceptances_workspace_idx"
  ON "workspace_invitation_acceptances" ("workspace_id");
