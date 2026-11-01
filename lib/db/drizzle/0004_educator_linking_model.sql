CREATE TYPE "public"."assignment_status" AS ENUM('open', 'completed');--> statement-breakpoint
CREATE TABLE "educator_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"educator_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"subject" text,
	"status" "assignment_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "educator_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"educator_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"status" "consent_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "educator_links_educator_student_unique" UNIQUE("educator_id","student_id"),
	CONSTRAINT "educator_links_not_self" CHECK ("educator_links"."educator_id" <> "educator_links"."student_id")
);
--> statement-breakpoint
CREATE TABLE "educator_supports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"supports" text[] DEFAULT '{}' NOT NULL,
	"notes" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "educator_supports_student_id_unique" UNIQUE("student_id")
);
--> statement-breakpoint
ALTER TABLE "educator_assignments" ADD CONSTRAINT "educator_assignments_educator_id_users_id_fk" FOREIGN KEY ("educator_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "educator_assignments" ADD CONSTRAINT "educator_assignments_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "educator_links" ADD CONSTRAINT "educator_links_educator_id_users_id_fk" FOREIGN KEY ("educator_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "educator_links" ADD CONSTRAINT "educator_links_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "educator_supports" ADD CONSTRAINT "educator_supports_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "educator_supports" ADD CONSTRAINT "educator_supports_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "educator_assignments_student_idx" ON "educator_assignments" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "educator_assignments_educator_idx" ON "educator_assignments" USING btree ("educator_id");--> statement-breakpoint
CREATE INDEX "educator_links_student_idx" ON "educator_links" USING btree ("student_id");