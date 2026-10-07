CREATE TABLE `article_states` (
	`user_id` text NOT NULL,
	`feed_id` text NOT NULL,
	`article_id` text NOT NULL,
	`read` integer DEFAULT false NOT NULL,
	`starred` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `feed_id`, `article_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `article_states_starred` ON `article_states` (`user_id`,`starred`);--> statement-breakpoint
CREATE UNIQUE INDEX `article_states_lookup` ON `article_states` (`feed_id`,`article_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `articles` (
	`feed_id` text NOT NULL,
	`id` text NOT NULL,
	`guid` text,
	`url` text,
	`title` text NOT NULL,
	`author` text,
	`published_at` integer NOT NULL,
	`updated_at` integer,
	`summary_html` text,
	`content_html` text,
	`enclosures` text DEFAULT '[]' NOT NULL,
	`fetched_at` integer NOT NULL,
	`search_text` text DEFAULT '' NOT NULL,
	PRIMARY KEY(`feed_id`, `id`),
	FOREIGN KEY (`feed_id`) REFERENCES `feeds`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `articles_feed_published` ON `articles` (`feed_id`,`published_at`);--> statement-breakpoint
CREATE INDEX `articles_published` ON `articles` (`published_at`);--> statement-breakpoint
CREATE TABLE `categories` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`collapsed` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`user_id`, `id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `feeds` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`site_url` text,
	`icon_url` text,
	`etag` text,
	`last_modified` text,
	`last_fetched_at` integer,
	`last_error` text,
	`error_count` integer DEFAULT 0 NOT NULL,
	`next_fetch_at` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `feeds_next_fetch` ON `feeds` (`next_fetch_at`);--> statement-breakpoint
CREATE TABLE `invites` (
	`code` text PRIMARY KEY NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`used_by` text,
	`used_at` integer,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`used_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`user_id` text NOT NULL,
	`device_name` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`last_seen_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`user_id` text NOT NULL,
	`feed_id` text NOT NULL,
	`category_id` text DEFAULT 'uncategorized' NOT NULL,
	`custom_title` text,
	`added_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`user_id`, `feed_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`feed_id`) REFERENCES `feeds`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `subscriptions_feed` ON `subscriptions` (`feed_id`);--> statement-breakpoint
CREATE TABLE `user_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`auth_hash` text NOT NULL,
	`kdf_salt` text NOT NULL,
	`kdf_params` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`email` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);