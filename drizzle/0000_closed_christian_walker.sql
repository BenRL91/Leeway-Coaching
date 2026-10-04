CREATE TABLE `bookings` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`fingerprint` text NOT NULL,
	`type` text NOT NULL,
	`start` integer NOT NULL,
	`end` integer NOT NULL,
	`minutes` integer NOT NULL,
	`amount` integer NOT NULL,
	`payload` text NOT NULL,
	`state` text NOT NULL,
	`session` text,
	`checkout_url` text,
	`event` text,
	`expires` integer NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `bookings_state_start` ON `bookings` (`state`,`start`);--> statement-breakpoint
CREATE TABLE `slot_locks` (
	`slot` integer PRIMARY KEY NOT NULL,
	`booking` text NOT NULL,
	FOREIGN KEY (`booking`) REFERENCES `bookings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `locks_booking` ON `slot_locks` (`booking`);