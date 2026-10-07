CREATE TABLE `sync_records` (
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`type` text NOT NULL,
	`record_id` text NOT NULL,
	`data` text,
	`hlc` text NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`version` integer NOT NULL,
	PRIMARY KEY(`user_id`, `key`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sync_records_version` ON `sync_records` (`user_id`,`version`);