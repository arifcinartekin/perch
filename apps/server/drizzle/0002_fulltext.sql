CREATE TABLE `fulltext_cache` (
	`feed_id` text NOT NULL,
	`article_id` text NOT NULL,
	`html` text NOT NULL,
	`title` text,
	`byline` text,
	`excerpt` text,
	`extracted_at` integer NOT NULL,
	PRIMARY KEY(`feed_id`, `article_id`),
	FOREIGN KEY (`feed_id`,`article_id`) REFERENCES `articles`(`feed_id`,`id`) ON UPDATE no action ON DELETE cascade
);
