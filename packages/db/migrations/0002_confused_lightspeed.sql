CREATE TABLE `worker_heartbeats` (
	`id` integer PRIMARY KEY NOT NULL,
	`pid` integer NOT NULL,
	`current_job_id` text,
	`updated_at` text NOT NULL
);
