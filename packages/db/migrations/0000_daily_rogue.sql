CREATE TABLE `analyses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`content_item_id` integer NOT NULL,
	`schema_version` integer NOT NULL,
	`pipeline_version` text NOT NULL,
	`depth` text NOT NULL,
	`ai_engine` text,
	`ai_model` text,
	`document` text,
	`status` text NOT NULL,
	`error` text,
	`started_at` text,
	`finished_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`content_item_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `analyses_content_pipeline` ON `analyses` (`content_item_id`,`pipeline_version`);--> statement-breakpoint
CREATE TABLE `cache_entries` (
	`key` text PRIMARY KEY NOT NULL,
	`analysis_id` integer NOT NULL,
	`pipeline_version` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`analysis_id`) REFERENCES `analyses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `channels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`creator_id` integer,
	`platform` text NOT NULL,
	`external_id` text NOT NULL,
	`title` text NOT NULL,
	`url` text,
	`stats` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`creator_id`) REFERENCES `creators`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `channels_platform_external` ON `channels` (`platform`,`external_id`);--> statement-breakpoint
CREATE TABLE `comparisons` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`subject_ids` text NOT NULL,
	`dimensions` text,
	`result` text,
	`ai_engine` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `content_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`channel_id` integer,
	`creator_id` integer,
	`source_type` text NOT NULL,
	`provider` text NOT NULL,
	`url` text,
	`file_path` text,
	`canonical_url` text,
	`content_hash` text NOT NULL,
	`title` text,
	`description` text,
	`duration_sec` real,
	`published_at` text,
	`language` text,
	`raw_metadata` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`creator_id`) REFERENCES `creators`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_items_hash` ON `content_items` (`content_hash`);--> statement-breakpoint
CREATE TABLE `courses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`source_analysis_ids` text NOT NULL,
	`level` text,
	`structure` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `creators` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`handle` text NOT NULL,
	`platform` text NOT NULL,
	`url` text,
	`bio` text,
	`metrics` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `creators_platform_handle` ON `creators` (`platform`,`handle`);--> statement-breakpoint
CREATE TABLE `facets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`analysis_id` integer NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`detail` text,
	`confidence` real,
	FOREIGN KEY (`analysis_id`) REFERENCES `analyses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `facets_kind_value` ON `facets` (`kind`,`value`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`status` text NOT NULL,
	`progress` text,
	`checkpoints` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`result_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text
);
--> statement-breakpoint
CREATE TABLE `roadmaps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`domain` text NOT NULL,
	`source_analysis_ids` text,
	`graph` text NOT NULL,
	`rendered` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transcripts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`content_item_id` integer NOT NULL,
	`source` text NOT NULL,
	`language` text,
	`text` text NOT NULL,
	`segments` text,
	`whisper_model` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`content_item_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE no action
);
