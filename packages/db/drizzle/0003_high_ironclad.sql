CREATE TABLE `fapiao_requests` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`user_id` bigint NOT NULL,
	`title_id` bigint NOT NULL,
	`invoice_id` bigint NOT NULL,
	`amount` bigint NOT NULL,
	`type` enum('electronic','special') NOT NULL DEFAULT 'electronic',
	`status` enum('pending','approved','issued','rejected') NOT NULL DEFAULT 'pending',
	`remark` varchar(255),
	`reject_reason` varchar(255),
	`fapiao_no` varchar(50),
	`fapiao_url` varchar(500),
	`approved_by_id` bigint,
	`issued_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `fapiao_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `invoice_titles` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`user_id` bigint NOT NULL,
	`type` enum('personal','enterprise') NOT NULL,
	`name` varchar(200) NOT NULL,
	`tax_no` varchar(50),
	`email` varchar(255),
	`bank_name` varchar(200),
	`bank_account` varchar(64),
	`company_address` varchar(300),
	`company_phone` varchar(30),
	`is_default` boolean NOT NULL DEFAULT false,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `invoice_titles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `services` ADD `auto_renew` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `fapiao_requests` ADD CONSTRAINT `fapiao_requests_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `fapiao_requests` ADD CONSTRAINT `fapiao_requests_title_id_invoice_titles_id_fk` FOREIGN KEY (`title_id`) REFERENCES `invoice_titles`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `fapiao_requests` ADD CONSTRAINT `fapiao_requests_invoice_id_invoices_id_fk` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoice_titles` ADD CONSTRAINT `invoice_titles_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `fapiao_requests_user_idx` ON `fapiao_requests` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `fapiao_requests_status_idx` ON `fapiao_requests` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `fapiao_requests_invoice_idx` ON `fapiao_requests` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `invoice_titles_user_idx` ON `invoice_titles` (`user_id`);