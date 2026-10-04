CREATE TABLE `breakdowns` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`player` text NOT NULL,
	`goals` text NOT NULL,
	`footage` text,
	`file_key` text,
	`upload_id` text,
	`state` text NOT NULL,
	`call_addon` integer NOT NULL,
	`amount` integer NOT NULL,
	`mode` text NOT NULL,
	`session` text,
	`attempt` integer DEFAULT 0 NOT NULL,
	`paid_at` integer,
	`due` text,
	`started` integer,
	`completed` integer,
	`video` text,
	`priorities` text,
	`drills` text,
	`message` text,
	`call_booking` text,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `breakdowns_state_created` ON `breakdowns` (`state`,`created`);