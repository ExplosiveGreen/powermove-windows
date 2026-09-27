CREATE TABLE "admins" (
	"user_id" text PRIMARY KEY NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by" text
);
--> statement-breakpoint
ALTER TABLE "moderation_log" ALTER COLUMN "repo_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "moderation_log" ADD COLUMN "publisher_id" uuid;--> statement-breakpoint
ALTER TABLE "moderation_log" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "admins" ADD CONSTRAINT "admins_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admins" ADD CONSTRAINT "admins_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_log" ADD CONSTRAINT "moderation_log_publisher_id_publishers_id_fk" FOREIGN KEY ("publisher_id") REFERENCES "public"."publishers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_log" ADD CONSTRAINT "moderation_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "moderation_log_created_idx" ON "moderation_log" USING btree ("created_at");