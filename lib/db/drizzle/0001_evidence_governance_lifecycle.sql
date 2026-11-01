ALTER TABLE "profile_entries" DROP CONSTRAINT "profile_entries_source_assessment_id_assessments_id_fk";
--> statement-breakpoint
ALTER TABLE "profile_entries" DROP CONSTRAINT "profile_entries_source_turn_id_session_turns_id_fk";
--> statement-breakpoint
ALTER TABLE "assessments" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "session_turns" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profile_entries" ADD COLUMN "invalidated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profile_entries" ADD COLUMN "invalidated_reason" text;--> statement-breakpoint
ALTER TABLE "profile_entries" ADD CONSTRAINT "profile_entries_source_assessment_id_assessments_id_fk" FOREIGN KEY ("source_assessment_id") REFERENCES "public"."assessments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_entries" ADD CONSTRAINT "profile_entries_source_turn_id_session_turns_id_fk" FOREIGN KEY ("source_turn_id") REFERENCES "public"."session_turns"("id") ON DELETE restrict ON UPDATE no action;