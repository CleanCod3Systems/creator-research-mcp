CREATE TABLE `content_ideas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer,
	`fingerprint` text NOT NULL,
	`platform` text NOT NULL,
	`format` text NOT NULL,
	`status` text DEFAULT 'idea' NOT NULL,
	`title_options` text NOT NULL,
	`problem` text NOT NULL,
	`why_now` text NOT NULL,
	`evidence_summary` text NOT NULL,
	`paraguayan_angle` text NOT NULL,
	`promise` text NOT NULL,
	`spoken_hook` text NOT NULL,
	`visual_hook` text NOT NULL,
	`script_beats` text NOT NULL,
	`visual_plan` text NOT NULL,
	`on_screen_text` text NOT NULL,
	`caption` text NOT NULL,
	`cta` text NOT NULL,
	`hashtags` text NOT NULL,
	`duration_sec` integer,
	`effort` text,
	`confidence` real DEFAULT 0 NOT NULL,
	`scores` text NOT NULL,
	`validation_metric` text NOT NULL,
	`source_creator_names` text NOT NULL,
	`source_urls` text NOT NULL,
	`source_content_ids` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `research_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_ideas_fingerprint` ON `content_ideas` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `content_ideas_platform_status` ON `content_ideas` (`platform`,`status`);--> statement-breakpoint
CREATE TABLE `experiments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`idea_id` integer NOT NULL,
	`platform` text NOT NULL,
	`format` text NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`published_at` text,
	`target_metric` text NOT NULL,
	`actual_metrics` text,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`idea_id`) REFERENCES `content_ideas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `experiments_idea_status` ON `experiments` (`idea_id`,`status`);--> statement-breakpoint
CREATE TABLE `idea_evidence` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`idea_id` integer NOT NULL,
	`content_item_id` integer,
	`analysis_id` integer,
	`evidence_type` text NOT NULL,
	`detail` text NOT NULL,
	`quote` text,
	`confidence` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`idea_id`) REFERENCES `content_ideas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_item_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`analysis_id`) REFERENCES `analyses`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idea_evidence_idea` ON `idea_evidence` (`idea_id`);--> statement-breakpoint
CREATE TABLE `learnings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fingerprint` text NOT NULL,
	`title` text NOT NULL,
	`statement` text NOT NULL,
	`evidence` text NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`source_idea_ids` text NOT NULL,
	`validated_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `learnings_fingerprint` ON `learnings` (`fingerprint`);--> statement-breakpoint
CREATE TABLE `research_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_key` text NOT NULL,
	`market` text DEFAULT 'Paraguay' NOT NULL,
	`language` text DEFAULT 'es' NOT NULL,
	`reference_scope` text DEFAULT 'global' NOT NULL,
	`input_urls` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`error` text,
	`started_at` text NOT NULL,
	`finished_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `research_runs_batch_key` ON `research_runs` (`batch_key`);