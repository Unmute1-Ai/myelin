CREATE TABLE "session_materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"content_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tutoring_sessions" ADD COLUMN "pending_action" text;--> statement-breakpoint
ALTER TABLE "tutoring_sessions" ADD COLUMN "pending_check_line" text;--> statement-breakpoint
ALTER TABLE "session_materials" ADD CONSTRAINT "session_materials_session_id_tutoring_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."tutoring_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_materials" ADD CONSTRAINT "session_materials_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_materials_session_idx" ON "session_materials" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "session_materials_student_idx" ON "session_materials" USING btree ("student_id");