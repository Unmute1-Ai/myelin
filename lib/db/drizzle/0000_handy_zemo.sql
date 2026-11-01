CREATE TYPE "public"."assessment_evidence_kind" AS ENUM('recall', 'application', 'explanation', 'transfer');--> statement-breakpoint
CREATE TYPE "public"."audit_decision" AS ENUM('allowed', 'denied');--> statement-breakpoint
CREATE TYPE "public"."consent_status" AS ENUM('pending', 'granted', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."consent_type" AS ENUM('guardian_access', 'learning_data');--> statement-breakpoint
CREATE TYPE "public"."mastery_level" AS ENUM('memorization', 'recognition', 'comprehension', 'application', 'mastery');--> statement-breakpoint
CREATE TYPE "public"."profile_entry_kind" AS ENUM('gap', 'misconception', 'successful_approach', 'preference', 'strategy_change');--> statement-breakpoint
CREATE TYPE "public"."progress_event_kind" AS ENUM('assessment_recorded', 'mastery_changed', 'strategy_changed', 'session_completed', 'milestone_reached');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('active', 'completed');--> statement-breakpoint
CREATE TYPE "public"."text_size" AS ENUM('small', 'medium', 'large', 'xlarge');--> statement-breakpoint
CREATE TYPE "public"."turn_author" AS ENUM('student', 'tutor');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('student', 'parent', 'educator', 'admin');--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guardian_link_id" uuid NOT NULL,
	"type" "consent_type" NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"terms_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guardian_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"status" "consent_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guardian_links_parent_student_unique" UNIQUE("parent_id","student_id"),
	CONSTRAINT "guardian_links_not_self" CHECK ("guardian_links"."parent_id" <> "guardian_links"."student_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'student' NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"session_id" uuid,
	"turn_id" uuid,
	"subject" text NOT NULL,
	"skill" text,
	"level" "mastery_level" NOT NULL,
	"evidence_kind" "assessment_evidence_kind" NOT NULL,
	"evidence_note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assessments_evidence_matches_level" CHECK (("assessments"."evidence_kind" = 'recall' AND "assessments"."level" IN ('memorization', 'recognition')) OR ("assessments"."evidence_kind" IN ('application', 'explanation', 'transfer') AND "assessments"."level" IN ('comprehension', 'application', 'mastery')))
);
--> statement-breakpoint
CREATE TABLE "session_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"author" "turn_author" NOT NULL,
	"content" text NOT NULL,
	"strategy_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_turns_session_seq_unique" UNIQUE("session_id","seq")
);
--> statement-breakpoint
CREATE TABLE "tutoring_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"title" text,
	"status" "session_status" DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_turn_at" timestamp with time zone,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "learning_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"subjects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preferred_strategy" text,
	"pacing" text DEFAULT 'standard' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_profiles_student_id_unique" UNIQUE("student_id")
);
--> statement-breakpoint
CREATE TABLE "profile_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"kind" "profile_entry_kind" NOT NULL,
	"subject" text,
	"detail" text NOT NULL,
	"why_changed" text,
	"source_assessment_id" uuid,
	"source_turn_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "progress_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"actor_id" uuid,
	"session_id" uuid,
	"kind" "progress_event_kind" NOT NULL,
	"summary" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accessibility_prefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tts_enabled" boolean DEFAULT false NOT NULL,
	"captions_enabled" boolean DEFAULT true NOT NULL,
	"high_contrast" boolean DEFAULT false NOT NULL,
	"text_size" text_size DEFAULT 'medium' NOT NULL,
	"reduced_motion" boolean DEFAULT false NOT NULL,
	"aac_input_enabled" boolean DEFAULT false NOT NULL,
	"allow_breaks" boolean DEFAULT true NOT NULL,
	"break_interval_minutes" integer DEFAULT 20 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accessibility_prefs_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "accessibility_break_interval_range" CHECK ("accessibility_prefs"."break_interval_minutes" BETWEEN 1 AND 240)
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid,
	"decision" "audit_decision" NOT NULL,
	"authorization_evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_guardian_link_id_guardian_links_id_fk" FOREIGN KEY ("guardian_link_id") REFERENCES "public"."guardian_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian_links" ADD CONSTRAINT "guardian_links_parent_id_users_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian_links" ADD CONSTRAINT "guardian_links_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_session_id_tutoring_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."tutoring_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_turn_id_session_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."session_turns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_turns" ADD CONSTRAINT "session_turns_session_id_tutoring_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."tutoring_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutoring_sessions" ADD CONSTRAINT "tutoring_sessions_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_profiles" ADD CONSTRAINT "learning_profiles_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_entries" ADD CONSTRAINT "profile_entries_profile_id_learning_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."learning_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_entries" ADD CONSTRAINT "profile_entries_source_assessment_id_assessments_id_fk" FOREIGN KEY ("source_assessment_id") REFERENCES "public"."assessments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_entries" ADD CONSTRAINT "profile_entries_source_turn_id_session_turns_id_fk" FOREIGN KEY ("source_turn_id") REFERENCES "public"."session_turns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_events" ADD CONSTRAINT "progress_events_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_events" ADD CONSTRAINT "progress_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_events" ADD CONSTRAINT "progress_events_session_id_tutoring_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."tutoring_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accessibility_prefs" ADD CONSTRAINT "accessibility_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consents_guardian_link_idx" ON "consents" USING btree ("guardian_link_id");--> statement-breakpoint
CREATE INDEX "guardian_links_student_idx" ON "guardian_links" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "assessments_student_subject_idx" ON "assessments" USING btree ("student_id","subject");--> statement-breakpoint
CREATE INDEX "session_turns_session_idx" ON "session_turns" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "tutoring_sessions_student_idx" ON "tutoring_sessions" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "tutoring_sessions_student_status_idx" ON "tutoring_sessions" USING btree ("student_id","status");--> statement-breakpoint
CREATE INDEX "profile_entries_profile_idx" ON "profile_entries" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "profile_entries_profile_kind_idx" ON "profile_entries" USING btree ("profile_id","kind");--> statement-breakpoint
CREATE INDEX "progress_events_student_created_idx" ON "progress_events" USING btree ("student_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_created_idx" ON "audit_log" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_resource_idx" ON "audit_log" USING btree ("resource_type","resource_id");