CREATE TABLE `comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`content_item_id` integer NOT NULL,
	`author` text NOT NULL,
	`text` text NOT NULL,
	`likes` integer,
	`replied_to` text,
	`posted_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`content_item_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE no action
);
