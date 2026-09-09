CREATE TABLE `production_files` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_production_files_project` ON `production_files` (`project_id`);--> statement-breakpoint
CREATE TABLE `project_members` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`call_time` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_project_members_project_email` ON `project_members` (`project_id`,`email`);--> statement-breakpoint
CREATE INDEX `idx_project_members_email` ON `project_members` (`email`);--> statement-breakpoint
ALTER TABLE `images` ADD `project_id` text;