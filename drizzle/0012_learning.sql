-- Additive, manually applied on an explicitly authorized database before enabling Learning.
-- No runtime DDL. IF NOT EXISTS and replaceable functions allow a second application.
CREATE TABLE IF NOT EXISTS learning_programs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 family_key text NOT NULL, title text NOT NULL, content_version text NOT NULL,
 pack_hash text NOT NULL CHECK (length(pack_hash) = 64), private_pack jsonb NOT NULL,
 status text NOT NULL DEFAULT 'published' CHECK (status IN ('published','closed','archived')),
 feature_enabled boolean NOT NULL DEFAULT false,
 visibility_policy text NOT NULL CHECK (length(trim(visibility_policy)) > 0),
 retention_days integer NOT NULL CHECK (retention_days BETWEEN 1 AND 3650),
 published_by uuid NOT NULL REFERENCES users(id), published_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,family_key,content_version)
);
ALTER TABLE learning_programs ADD COLUMN IF NOT EXISTS closed_at timestamptz;
CREATE TABLE IF NOT EXISTS learning_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, program_id uuid NOT NULL,
 module_id text NOT NULL, cohort_id text NOT NULL, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 timezone text NOT NULL DEFAULT 'Europe/Rome', status text NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','open','closed')),
 CHECK (ends_at > starts_at), UNIQUE(workspace_id,program_id,module_id,cohort_id),
 FOREIGN KEY(workspace_id,program_id) REFERENCES learning_programs(workspace_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS learning_enrollments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, program_id uuid NOT NULL,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, module_id text NOT NULL DEFAULT 'm1', cohort_id text NOT NULL,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
 assigned_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,program_id,user_id,module_id), UNIQUE(workspace_id,program_id,id,user_id),
 FOREIGN KEY(workspace_id,program_id,module_id,cohort_id) REFERENCES learning_sessions(workspace_id,program_id,module_id,cohort_id)
);
CREATE INDEX IF NOT EXISTS learning_enrollments_user_idx ON learning_enrollments(user_id,workspace_id,status);
CREATE TABLE IF NOT EXISTS learning_grants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, program_id uuid NOT NULL,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 capability text NOT NULL CHECK(capability IN ('manage','review','aggregate','export')),
 cohort_id text, granted_by uuid NOT NULL REFERENCES users(id), granted_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz,
 FOREIGN KEY(workspace_id,program_id) REFERENCES learning_programs(workspace_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS learning_grants_active_idx ON learning_grants(workspace_id,program_id,user_id,capability,COALESCE(cohort_id,'')) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS learning_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, program_id uuid NOT NULL,
 enrollment_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 activity_id text NOT NULL, attempt_number integer NOT NULL CHECK(attempt_number >= 1),
 parent_attempt_id uuid, status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted')),
 content_version text NOT NULL, pack_hash text NOT NULL,
 item_order jsonb NOT NULL, responses jsonb NOT NULL DEFAULT '{"answers":{},"fields":{}}'::jsonb,
 revision integer NOT NULL DEFAULT 1 CHECK(revision >= 1), result jsonb,
 idempotency_key uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), submitted_at timestamptz,
 CHECK ((status = 'draft' AND submitted_at IS NULL AND result IS NULL AND idempotency_key IS NULL) OR
        (status = 'submitted' AND submitted_at IS NOT NULL AND result IS NOT NULL AND idempotency_key IS NOT NULL)),
 UNIQUE(workspace_id,program_id,enrollment_id,activity_id,attempt_number),
 UNIQUE(workspace_id,program_id,enrollment_id,id), UNIQUE(workspace_id,program_id,user_id,idempotency_key),
 FOREIGN KEY(workspace_id,program_id,enrollment_id,user_id) REFERENCES learning_enrollments(workspace_id,program_id,id,user_id) ON DELETE CASCADE,
 FOREIGN KEY(workspace_id,program_id,enrollment_id,parent_attempt_id) REFERENCES learning_attempts(workspace_id,program_id,enrollment_id,id)
);
ALTER TABLE learning_attempts ADD COLUMN IF NOT EXISTS decisions_submitted_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS learning_attempts_parent_idx ON learning_attempts(parent_attempt_id) WHERE parent_attempt_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS learning_attempts_owner_idx ON learning_attempts(workspace_id,program_id,user_id,updated_at);
CREATE TABLE IF NOT EXISTS learning_audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, program_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES users(id), resource_id uuid NOT NULL,
 event_type text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,program_id) REFERENCES learning_programs(workspace_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS learning_idea_drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, program_id uuid NOT NULL,
 enrollment_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 fields jsonb NOT NULL DEFAULT '{}'::jsonb, revision integer NOT NULL DEFAULT 1 CHECK(revision >= 1),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','promoting','submitted')),
 idempotency_key uuid, resulting_use_case_id uuid REFERENCES use_cases(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,program_id,user_id,idempotency_key),
 FOREIGN KEY(workspace_id,program_id,enrollment_id,user_id) REFERENCES learning_enrollments(workspace_id,program_id,id,user_id) ON DELETE CASCADE,
 CHECK ((status = 'draft' AND resulting_use_case_id IS NULL) OR (status = 'promoting' AND idempotency_key IS NOT NULL) OR (status = 'submitted' AND resulting_use_case_id IS NOT NULL AND idempotency_key IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS learning_idea_single_draft_idx ON learning_idea_drafts(workspace_id,program_id,user_id);
CREATE OR REPLACE FUNCTION learning_preserve_program_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.workspace_id,NEW.family_key,NEW.content_version,NEW.pack_hash,NEW.private_pack,NEW.published_by,NEW.published_at)
 IS DISTINCT FROM ROW(OLD.workspace_id,OLD.family_key,OLD.content_version,OLD.pack_hash,OLD.private_pack,OLD.published_by,OLD.published_at)
 THEN RAISE EXCEPTION 'Published learning content is immutable'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS learning_program_content_immutable ON learning_programs;
CREATE TRIGGER learning_program_content_immutable BEFORE UPDATE ON learning_programs FOR EACH ROW EXECUTE FUNCTION learning_preserve_program_content();
CREATE OR REPLACE FUNCTION learning_preserve_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status = 'submitted' THEN RAISE EXCEPTION 'Submitted learning attempts are immutable'; END IF;
 IF ROW(NEW.workspace_id,NEW.program_id,NEW.enrollment_id,NEW.user_id,NEW.activity_id,NEW.attempt_number,NEW.parent_attempt_id,NEW.content_version,NEW.pack_hash,NEW.item_order,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.workspace_id,OLD.program_id,OLD.enrollment_id,OLD.user_id,OLD.activity_id,OLD.attempt_number,OLD.parent_attempt_id,OLD.content_version,OLD.pack_hash,OLD.item_order,OLD.created_at)
 THEN RAISE EXCEPTION 'Learning attempt identity and content are immutable'; END IF;
 IF OLD.decisions_submitted_at IS NOT NULL AND (NEW.decisions_submitted_at IS DISTINCT FROM OLD.decisions_submitted_at OR NEW.responses->'answers' IS DISTINCT FROM OLD.responses->'answers') THEN RAISE EXCEPTION 'Submitted individual decisions are immutable'; END IF;
 IF NEW.revision <> OLD.revision + 1 THEN RAISE EXCEPTION 'Learning revisions must advance by one'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS learning_attempt_immutable ON learning_attempts;
CREATE TRIGGER learning_attempt_immutable BEFORE UPDATE ON learning_attempts FOR EACH ROW EXECUTE FUNCTION learning_preserve_attempt();
CREATE OR REPLACE FUNCTION learning_preserve_idea() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.id,NEW.workspace_id,NEW.program_id,NEW.enrollment_id,NEW.user_id,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.workspace_id,OLD.program_id,OLD.enrollment_id,OLD.user_id,OLD.created_at)
 THEN RAISE EXCEPTION 'Learning idea identity is immutable'; END IF;
 IF OLD.status='submitted' THEN RAISE EXCEPTION 'Submitted learning ideas are immutable'; END IF;
 IF OLD.status='promoting' THEN
   IF NEW.fields IS DISTINCT FROM OLD.fields OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.revision<>OLD.revision OR NEW.status<>'submitted'
   THEN RAISE EXCEPTION 'Promoting learning ideas are frozen'; END IF;
 ELSE
   IF NEW.revision<>OLD.revision+1 OR NEW.status NOT IN ('draft','promoting') THEN RAISE EXCEPTION 'Invalid learning idea revision or transition'; END IF;
 END IF;
 IF NEW.resulting_use_case_id IS NOT NULL AND NEW.resulting_use_case_id<>NEW.id
 THEN RAISE EXCEPTION 'Learning idea portfolio target is outside its identity or workspace'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS learning_idea_immutable ON learning_idea_drafts;
CREATE TRIGGER learning_idea_immutable BEFORE UPDATE ON learning_idea_drafts FOR EACH ROW EXECUTE FUNCTION learning_preserve_idea();

CREATE OR REPLACE FUNCTION learning_validate_idea_target() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.resulting_use_case_id IS NOT NULL AND (NEW.resulting_use_case_id<>NEW.id OR NOT EXISTS(SELECT 1 FROM use_cases u WHERE u.id=NEW.resulting_use_case_id AND u.workspace_id=NEW.workspace_id))
 THEN RAISE EXCEPTION 'Learning idea portfolio target is outside its identity or workspace'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS learning_idea_target_scope ON learning_idea_drafts;
-- Deferred so an atomic portfolio INSERT + idea link CTE can be verified at commit.
CREATE CONSTRAINT TRIGGER learning_idea_target_scope AFTER INSERT OR UPDATE ON learning_idea_drafts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION learning_validate_idea_target();
