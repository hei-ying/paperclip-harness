CREATE TABLE "spec_dod_checklist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spec_package_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"item_key" text NOT NULL,
	"label" text NOT NULL,
	"checked" integer DEFAULT 0 NOT NULL,
	"checked_by_user_id" text,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spec_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spec_package_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"template_type" text NOT NULL,
	"file_name" text NOT NULL,
	"content" text,
	"file_status" text DEFAULT 'missing' NOT NULL,
	"priority" integer DEFAULT 5 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spec_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spec_package_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_type" text NOT NULL,
	"source" text NOT NULL,
	"severity" text DEFAULT 'blocking' NOT NULL,
	"related_files" jsonb,
	"title" text NOT NULL,
	"description" text,
	"suggestion" text,
	"resolution" text,
	"resolution_note" text,
	"resolved_by_user_id" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spec_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"gate1_status" text DEFAULT 'pending' NOT NULL,
	"gate2_status" text DEFAULT 'pending' NOT NULL,
	"gate3_status" text DEFAULT 'pending' NOT NULL,
	"gate1_result" jsonb,
	"gate2_result" jsonb,
	"gate3_result" jsonb,
	"approved_by_user_id" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "spec_dod_checklist" ADD CONSTRAINT "spec_dod_checklist_spec_package_id_spec_packages_id_fk" FOREIGN KEY ("spec_package_id") REFERENCES "public"."spec_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_dod_checklist" ADD CONSTRAINT "spec_dod_checklist_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_files" ADD CONSTRAINT "spec_files_spec_package_id_spec_packages_id_fk" FOREIGN KEY ("spec_package_id") REFERENCES "public"."spec_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_files" ADD CONSTRAINT "spec_files_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_issues" ADD CONSTRAINT "spec_issues_spec_package_id_spec_packages_id_fk" FOREIGN KEY ("spec_package_id") REFERENCES "public"."spec_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_issues" ADD CONSTRAINT "spec_issues_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_packages" ADD CONSTRAINT "spec_packages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_packages" ADD CONSTRAINT "spec_packages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "spec_dod_checklist_spec_package_idx" ON "spec_dod_checklist" USING btree ("spec_package_id");--> statement-breakpoint
CREATE UNIQUE INDEX "spec_dod_checklist_spec_package_key_uq" ON "spec_dod_checklist" USING btree ("spec_package_id","item_key");--> statement-breakpoint
CREATE INDEX "spec_files_spec_package_idx" ON "spec_files" USING btree ("spec_package_id");--> statement-breakpoint
CREATE UNIQUE INDEX "spec_files_spec_package_type_uq" ON "spec_files" USING btree ("spec_package_id","template_type");--> statement-breakpoint
CREATE INDEX "spec_issues_spec_package_idx" ON "spec_issues" USING btree ("spec_package_id");--> statement-breakpoint
CREATE INDEX "spec_issues_company_status_idx" ON "spec_issues" USING btree ("company_id","resolution");--> statement-breakpoint
CREATE INDEX "spec_packages_company_idx" ON "spec_packages" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "spec_packages_project_idx" ON "spec_packages" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "spec_packages_project_version_uq" ON "spec_packages" USING btree ("project_id","version");