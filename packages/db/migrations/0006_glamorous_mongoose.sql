CREATE TABLE `creator_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`creator_id` integer NOT NULL,
	`platform` text NOT NULL,
	`handle` text NOT NULL,
	`url` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`followers` integer,
	`last_synced_at` text,
	`metadata` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`creator_id`) REFERENCES `creators`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `creator_profiles_platform_handle` ON `creator_profiles` (`platform`,`handle`);--> statement-breakpoint
ALTER TABLE `creators` ADD `identity_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `creators` ADD `status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `creators` ADD `archived_at` text;--> statement-breakpoint
ALTER TABLE `creators` ADD `updated_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `creators` SET `identity_key` = lower(`platform` || '::' || `handle`) WHERE `identity_key` = '';--> statement-breakpoint
UPDATE `creators` SET `updated_at` = `created_at` WHERE `updated_at` = '';--> statement-breakpoint
INSERT OR IGNORE INTO `creator_profiles` (`creator_id`, `platform`, `handle`, `url`, `metadata`)
SELECT `id`, `platform`, `handle`, COALESCE(`url`, 'https://' || `platform` || '.com/' || `handle`), `metrics`
FROM `creators`;--> statement-breakpoint
CREATE UNIQUE INDEX `creators_identity_key` ON `creators` (`identity_key`);
