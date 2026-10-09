CREATE TABLE `chain_records` (
	`chain_id` text NOT NULL,
	`key` text NOT NULL,
	`hlc` text NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`ephemeral` integer DEFAULT false NOT NULL,
	`blob` text NOT NULL,
	`version` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`chain_id`, `key`),
	FOREIGN KEY (`chain_id`) REFERENCES `chains`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chain_records_version` ON `chain_records` (`chain_id`,`version`);--> statement-breakpoint
CREATE TABLE `chains` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`last_seen_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
