CREATE TABLE `metric_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`content_item_id` integer NOT NULL,
	`observed_at` text NOT NULL,
	`view_count` integer,
	`like_count` integer,
	`comment_count` integer,
	`source` text NOT NULL,
	FOREIGN KEY (`content_item_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `metric_snapshots_content_item` ON `metric_snapshots` (`content_item_id`,`observed_at`);