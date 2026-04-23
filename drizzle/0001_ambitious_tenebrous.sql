CREATE TABLE "conversation_memory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"content" text NOT NULL,
	"role" varchar(50) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"content" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"slack_team_id" varchar(100) NOT NULL,
	"slack_team_name" varchar(255),
	"bot_token" text NOT NULL,
	"notify_channel_id" varchar(100),
	"installed_by" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "slack_installations_slack_team_id_unique" UNIQUE("slack_team_id")
);
--> statement-breakpoint
CREATE TABLE "slack_use_case_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"slack_user_id" varchar(100) NOT NULL,
	"slack_thread_ts" varchar(100),
	"slack_team_id" varchar(100) NOT NULL,
	"status" varchar(50) DEFAULT 'drafting' NOT NULL,
	"title" varchar(500),
	"problem" text,
	"flow_description" text,
	"human_in_the_loop" text,
	"guardrails" text,
	"expected_impact" text,
	"data_requirements" text,
	"urgency" varchar(50),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"submitted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "uploaded_documents" ADD COLUMN "department_id" uuid;--> statement-breakpoint
ALTER TABLE "use_cases" ADD COLUMN "source" varchar(50);--> statement-breakpoint
ALTER TABLE "use_cases" ADD COLUMN "proposed_by" varchar(255);--> statement-breakpoint
ALTER TABLE "use_cases" ADD COLUMN "flow_description" text;--> statement-breakpoint
ALTER TABLE "use_cases" ADD COLUMN "human_in_the_loop" text;--> statement-breakpoint
ALTER TABLE "use_cases" ADD COLUMN "guardrails" text;--> statement-breakpoint
ALTER TABLE "use_cases" ADD COLUMN "data_requirements" text;--> statement-breakpoint
ALTER TABLE "use_cases" ADD COLUMN "esg_environmental" real;--> statement-breakpoint
ALTER TABLE "use_cases" ADD COLUMN "esg_social" real;--> statement-breakpoint
ALTER TABLE "use_cases" ADD COLUMN "esg_governance" real;--> statement-breakpoint
ALTER TABLE "use_cases" ADD COLUMN "overall_esg_score" real;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "unit_terminology" jsonb;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "esg_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_memory" ADD CONSTRAINT "conversation_memory_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_memory" ADD CONSTRAINT "conversation_memory_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_uploaded_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."uploaded_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_installations" ADD CONSTRAINT "slack_installations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_use_case_drafts" ADD CONSTRAINT "slack_use_case_drafts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_memory_workspace_idx" ON "conversation_memory" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "document_chunks_workspace_idx" ON "document_chunks" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "uploaded_documents" ADD CONSTRAINT "uploaded_documents_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;