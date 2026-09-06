CREATE TABLE `password_reset_tokens` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`user_id` bigint NOT NULL,
	`token_hash` varchar(128) NOT NULL,
	`expires_at` datetime NOT NULL,
	`used_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `password_reset_tokens_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` varchar(64) NOT NULL,
	`user_id` bigint NOT NULL,
	`ip` varchar(64),
	`user_agent` varchar(255),
	`expires_at` datetime NOT NULL,
	`revoked_at` datetime,
	`last_seen_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sms_codes` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`phone` varchar(20) NOT NULL,
	`purpose` enum('login','reset','bind') NOT NULL,
	`code_hash` varchar(128) NOT NULL,
	`expires_at` datetime NOT NULL,
	`used_at` datetime,
	`attempts` int NOT NULL DEFAULT 0,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `sms_codes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `user_identities` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`user_id` bigint NOT NULL,
	`type` enum('phone','email','wechat') NOT NULL,
	`identifier` varchar(255) NOT NULL,
	`meta` json,
	`verified_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `user_identities_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_identities_uq` UNIQUE(`type`,`identifier`)
);
--> statement-breakpoint
CREATE TABLE `user_profiles` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`user_id` bigint NOT NULL,
	`type` enum('personal','enterprise') NOT NULL,
	`real_name` varchar(100),
	`id_number_enc` text,
	`company_name` varchar(200),
	`credit_code` varchar(50),
	`status` enum('unverified','pending','verified','rejected') NOT NULL DEFAULT 'unverified',
	`verified_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `user_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_profiles_user_uq` UNIQUE(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`phone` varchar(20),
	`email` varchar(255),
	`password_hash` varchar(255),
	`name` varchar(100),
	`credit_balance` bigint NOT NULL DEFAULT 0,
	`status` enum('active','disabled') NOT NULL DEFAULT 'active',
	`created_ip` varchar(64),
	`last_login_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_phone_uq` UNIQUE(`phone`),
	CONSTRAINT `users_email_uq` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `config_groups` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`product_id` bigint NOT NULL,
	`name` varchar(100) NOT NULL,
	`type` enum('select','radio','checkbox','quantity') NOT NULL,
	`required` boolean NOT NULL DEFAULT true,
	`sort_order` int NOT NULL DEFAULT 0,
	CONSTRAINT `config_groups_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `config_options` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`group_id` bigint NOT NULL,
	`label` varchar(100) NOT NULL,
	`value` varchar(100) NOT NULL,
	`price_delta` bigint NOT NULL DEFAULT 0,
	`setup_delta` bigint NOT NULL DEFAULT 0,
	`is_default` boolean NOT NULL DEFAULT false,
	`sort_order` int NOT NULL DEFAULT 0,
	CONSTRAINT `config_options_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `product_groups` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`slug` varchar(100) NOT NULL,
	`description` text,
	`sort_order` int NOT NULL DEFAULT 0,
	`hidden` boolean NOT NULL DEFAULT false,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `product_groups_id` PRIMARY KEY(`id`),
	CONSTRAINT `product_groups_slug_uq` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `product_pricing` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`product_id` bigint NOT NULL,
	`cycle` enum('onetime','monthly','quarterly','semiannually','annually','biennially','triennially') NOT NULL,
	`first_price` bigint NOT NULL,
	`renewal_price` bigint NOT NULL,
	`setup_fee` bigint NOT NULL DEFAULT 0,
	`currency` varchar(3) NOT NULL DEFAULT 'CNY',
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `product_pricing_id` PRIMARY KEY(`id`),
	CONSTRAINT `product_pricing_uq` UNIQUE(`product_id`,`cycle`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`group_id` bigint NOT NULL,
	`name` varchar(150) NOT NULL,
	`slug` varchar(100) NOT NULL,
	`tagline` varchar(255),
	`description_html` text,
	`module_code` varchar(50) NOT NULL DEFAULT 'manual',
	`module_config` json,
	`stock_total` int,
	`stock_used` int NOT NULL DEFAULT 0,
	`hidden` boolean NOT NULL DEFAULT false,
	`requires_identity` boolean NOT NULL DEFAULT false,
	`allow_upgrade` boolean NOT NULL DEFAULT true,
	`allow_downgrade` boolean NOT NULL DEFAULT false,
	`sort_order` int NOT NULL DEFAULT 0,
	`status` enum('active','inactive') NOT NULL DEFAULT 'inactive',
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `products_id` PRIMARY KEY(`id`),
	CONSTRAINT `products_slug_uq` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`order_id` bigint NOT NULL,
	`product_id` bigint,
	`service_id` bigint,
	`description` varchar(255) NOT NULL,
	`qty` int NOT NULL DEFAULT 1,
	`unit_price` bigint NOT NULL DEFAULT 0,
	`amount` bigint NOT NULL DEFAULT 0,
	`meta` json,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `order_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`user_id` bigint NOT NULL,
	`type` enum('new','renewal','upgrade','recharge','manual') NOT NULL,
	`status` enum('pending','paid','processing','completed','cancelled','failed') NOT NULL DEFAULT 'pending',
	`subtotal` bigint NOT NULL DEFAULT 0,
	`discount` bigint NOT NULL DEFAULT 0,
	`total` bigint NOT NULL DEFAULT 0,
	`currency` varchar(3) NOT NULL DEFAULT 'CNY',
	`promo_id` bigint,
	`promo_code` varchar(50),
	`balance_used` bigint NOT NULL DEFAULT 0,
	`paid_at` datetime,
	`cancelled_at` datetime,
	`note` varchar(500),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `orders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `provision_tasks` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`service_id` bigint NOT NULL,
	`order_id` bigint,
	`action` enum('provision','suspend','unsuspend','terminate','change_package','sync') NOT NULL,
	`status` enum('queued','processing','succeeded','failed','dead','skipped') NOT NULL DEFAULT 'queued',
	`attempts` bigint NOT NULL DEFAULT 0,
	`max_attempts` bigint NOT NULL DEFAULT 5,
	`payload` json,
	`result` json,
	`last_error` text,
	`created_by_id` bigint,
	`executed_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `provision_tasks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `services` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`user_id` bigint NOT NULL,
	`product_id` bigint NOT NULL,
	`order_id` bigint,
	`name` varchar(150) NOT NULL,
	`status` enum('pending','active','suspended_overdue','suspended_manual','terminated','cancelled') NOT NULL DEFAULT 'pending',
	`config` json,
	`cycle` enum('onetime','monthly','quarterly','semiannually','annually','biennially','triennially') NOT NULL,
	`first_amount` bigint NOT NULL DEFAULT 0,
	`renewal_amount` bigint NOT NULL DEFAULT 0,
	`next_due_date` date,
	`module_code` varchar(50) NOT NULL DEFAULT 'manual',
	`module_config` json,
	`deliver_info` json,
	`suspended_at` datetime,
	`terminated_at` datetime,
	`cancelled_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `services_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `credit_ledger` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`user_id` bigint NOT NULL,
	`type` enum('recharge','payment','refund','adjustment','upgrade_refund','promo_bonus') NOT NULL,
	`amount` bigint NOT NULL,
	`balance_after` bigint NOT NULL,
	`ref_type` varchar(30),
	`ref_id` bigint,
	`remark` varchar(255),
	`admin_id` bigint,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `credit_ledger_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `gateway_events` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`gateway_code` varchar(30) NOT NULL,
	`event_id` varchar(128) NOT NULL,
	`type` varchar(50) NOT NULL,
	`payload` json,
	`status` enum('received','processed','failed','duplicate') NOT NULL,
	`error` text,
	`received_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`processed_at` datetime,
	CONSTRAINT `gateway_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `gateway_events_uq` UNIQUE(`gateway_code`,`event_id`)
);
--> statement-breakpoint
CREATE TABLE `invoice_items` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`invoice_id` bigint NOT NULL,
	`description` varchar(255) NOT NULL,
	`qty` int NOT NULL DEFAULT 1,
	`unit_price` bigint NOT NULL DEFAULT 0,
	`amount` bigint NOT NULL DEFAULT 0,
	`meta` json,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `invoice_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`user_id` bigint NOT NULL,
	`invoice_no` varchar(32) NOT NULL,
	`type` enum('order','renewal','upgrade','recharge','manual') NOT NULL,
	`status` enum('unpaid','paid','void','refunded','partially_refunded') NOT NULL,
	`order_id` bigint,
	`subtotal` bigint NOT NULL DEFAULT 0,
	`discount` bigint NOT NULL DEFAULT 0,
	`total` bigint NOT NULL DEFAULT 0,
	`balance_used` bigint NOT NULL DEFAULT 0,
	`paid_at` datetime,
	`due_at` datetime,
	`void_reason` varchar(255),
	`voided_by_admin_id` bigint,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `invoices_id` PRIMARY KEY(`id`),
	CONSTRAINT `invoices_no_uq` UNIQUE(`invoice_no`)
);
--> statement-breakpoint
CREATE TABLE `refunds` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`transaction_id` bigint NOT NULL,
	`invoice_id` bigint,
	`amount` bigint NOT NULL,
	`status` enum('pending','succeeded','failed') NOT NULL DEFAULT 'pending',
	`reason` varchar(255),
	`gateway_refund_id` varchar(64),
	`admin_id` bigint,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `refunds_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`user_id` bigint NOT NULL,
	`invoice_id` bigint,
	`payment_intent_id` bigint,
	`gateway_code` varchar(30) NOT NULL,
	`gateway_txn_id` varchar(64) NOT NULL,
	`type` enum('payment','refund') NOT NULL,
	`amount` bigint NOT NULL,
	`fee` bigint NOT NULL DEFAULT 0,
	`currency` varchar(3) NOT NULL DEFAULT 'CNY',
	`status` enum('pending','success','failed','refunded') NOT NULL,
	`raw` json,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `transactions_id` PRIMARY KEY(`id`),
	CONSTRAINT `transactions_gateway_uq` UNIQUE(`gateway_code`,`gateway_txn_id`)
);
--> statement-breakpoint
CREATE TABLE `payment_intents` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`user_id` bigint NOT NULL,
	`invoice_id` bigint NOT NULL,
	`gateway_code` varchar(30) NOT NULL,
	`amount` bigint NOT NULL,
	`status` enum('created','paying','success','failed','expired','canceled') NOT NULL DEFAULT 'created',
	`gateway_prepay_id` varchar(128),
	`pay_url` text,
	`qr_code` text,
	`expires_at` datetime NOT NULL,
	`paid_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `payment_intents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `promotion_usages` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`promotion_id` bigint NOT NULL,
	`user_id` bigint NOT NULL,
	`order_id` bigint NOT NULL,
	`discount_amount` bigint NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `promotion_usages_id` PRIMARY KEY(`id`),
	CONSTRAINT `promotion_usages_order_uq` UNIQUE(`promotion_id`,`order_id`)
);
--> statement-breakpoint
CREATE TABLE `promotions` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`code` varchar(50) NOT NULL,
	`name` varchar(100) NOT NULL,
	`type` enum('percent','fixed') NOT NULL,
	`value` bigint NOT NULL,
	`scope` enum('all','products','groups') NOT NULL DEFAULT 'all',
	`scope_ids` json,
	`min_amount` bigint NOT NULL DEFAULT 0,
	`max_uses` bigint,
	`per_user_limit` bigint NOT NULL DEFAULT 1,
	`new_customer_only` boolean NOT NULL DEFAULT false,
	`starts_at` datetime,
	`ends_at` datetime,
	`active` boolean NOT NULL DEFAULT true,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `promotions_id` PRIMARY KEY(`id`),
	CONSTRAINT `promotions_code_uq` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`ticket_id` bigint,
	`reply_id` bigint,
	`filename` varchar(255) NOT NULL,
	`stored_path` varchar(500) NOT NULL,
	`mime` varchar(100) NOT NULL,
	`size` bigint NOT NULL,
	`created_by_type` enum('customer','staff') NOT NULL,
	`created_by_user_id` bigint,
	`created_by_admin_id` bigint,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `attachments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `kb_articles` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`category_id` bigint NOT NULL,
	`title` varchar(200) NOT NULL,
	`slug` varchar(200) NOT NULL,
	`content_html` text NOT NULL,
	`visibility` enum('public','login') NOT NULL DEFAULT 'public',
	`views` int NOT NULL DEFAULT 0,
	`published` boolean NOT NULL DEFAULT false,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `kb_articles_id` PRIMARY KEY(`id`),
	CONSTRAINT `kb_articles_slug_uq` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `kb_categories` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`slug` varchar(100) NOT NULL,
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `kb_categories_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ticket_departments` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`email_to` varchar(255),
	`sort_order` int NOT NULL DEFAULT 0,
	`hidden` boolean NOT NULL DEFAULT false,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `ticket_departments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ticket_replies` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`ticket_id` bigint NOT NULL,
	`author_user_id` bigint,
	`author_admin_id` bigint,
	`author_type` enum('customer','staff','system') NOT NULL,
	`content_html` text NOT NULL,
	`internal_note` boolean NOT NULL DEFAULT false,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `ticket_replies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tickets` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`user_id` bigint NOT NULL,
	`department_id` bigint NOT NULL,
	`service_id` bigint,
	`subject` varchar(200) NOT NULL,
	`status` enum('open','answered','customer_reply','in_progress','resolved','closed') NOT NULL DEFAULT 'open',
	`priority` enum('low','medium','high','urgent') NOT NULL DEFAULT 'medium',
	`last_reply_at` datetime,
	`last_reply_by` enum('customer','staff'),
	`closed_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `tickets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notification_logs` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`user_id` bigint,
	`channel` enum('email','sms','inapp','webhook') NOT NULL,
	`event` varchar(50) NOT NULL,
	`target` varchar(255) NOT NULL,
	`status` enum('sent','failed') NOT NULL,
	`error` text,
	`provider` varchar(30),
	`provider_message_id` varchar(128),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `notification_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notification_templates` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`channel` enum('email','sms','inapp') NOT NULL,
	`event` varchar(50) NOT NULL,
	`subject` varchar(255),
	`body` text NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `notification_templates_id` PRIMARY KEY(`id`),
	CONSTRAINT `notification_templates_uq` UNIQUE(`channel`,`event`)
);
--> statement-breakpoint
CREATE TABLE `user_notifications` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`user_id` bigint NOT NULL,
	`title` varchar(200) NOT NULL,
	`body` varchar(1000),
	`link` varchar(500),
	`read_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `user_notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `admin_roles` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`name` varchar(50) NOT NULL,
	`permissions` json,
	`is_super` boolean NOT NULL DEFAULT false,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `admin_roles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `admin_sessions` (
	`id` varchar(64) NOT NULL,
	`admin_id` bigint NOT NULL,
	`ip` varchar(64),
	`user_agent` varchar(255),
	`expires_at` datetime NOT NULL,
	`revoked_at` datetime,
	`last_seen_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `admin_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `admin_users` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`username` varchar(50) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`name` varchar(100),
	`role_id` bigint,
	`status` enum('active','disabled') NOT NULL DEFAULT 'active',
	`last_login_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `admin_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `admin_users_username_uq` UNIQUE(`username`)
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`actor_type` enum('admin','user','system') NOT NULL,
	`actor_id` bigint,
	`actor_name` varchar(100),
	`action` varchar(100) NOT NULL,
	`target_type` varchar(50),
	`target_id` varchar(64),
	`before` json,
	`after` json,
	`ip` varchar(64),
	`user_agent` varchar(255),
	`request_id` varchar(64),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `job_runs` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`task_name` varchar(50) NOT NULL,
	`status` enum('success','partial','failed') NOT NULL,
	`result` json,
	`error` text,
	`started_at` datetime NOT NULL,
	`finished_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `job_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` varchar(100) NOT NULL,
	`value` json NOT NULL,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `settings_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`endpoint_id` bigint NOT NULL,
	`event` varchar(50) NOT NULL,
	`payload` json NOT NULL,
	`status` enum('pending','delivered','failed') NOT NULL DEFAULT 'pending',
	`attempts` bigint NOT NULL DEFAULT 0,
	`response_status` bigint,
	`last_error` text,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `webhook_deliveries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `webhook_endpoints` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`url` varchar(500) NOT NULL,
	`secret` varchar(128) NOT NULL,
	`events` json,
	`active` enum('0','1') NOT NULL DEFAULT '1',
	`description` varchar(255),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `webhook_endpoints_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `password_reset_tokens` ADD CONSTRAINT `password_reset_tokens_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_identities` ADD CONSTRAINT `user_identities_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_profiles` ADD CONSTRAINT `user_profiles_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `config_groups` ADD CONSTRAINT `config_groups_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `config_options` ADD CONSTRAINT `config_options_group_id_config_groups_id_fk` FOREIGN KEY (`group_id`) REFERENCES `config_groups`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_pricing` ADD CONSTRAINT `product_pricing_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_group_id_product_groups_id_fk` FOREIGN KEY (`group_id`) REFERENCES `product_groups`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `provision_tasks` ADD CONSTRAINT `provision_tasks_service_id_services_id_fk` FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `services` ADD CONSTRAINT `services_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `services` ADD CONSTRAINT `services_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `services` ADD CONSTRAINT `services_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `credit_ledger` ADD CONSTRAINT `credit_ledger_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoice_items` ADD CONSTRAINT `invoice_items_invoice_id_invoices_id_fk` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `refunds` ADD CONSTRAINT `refunds_transaction_id_transactions_id_fk` FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `refunds` ADD CONSTRAINT `refunds_invoice_id_invoices_id_fk` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_invoice_id_invoices_id_fk` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payment_intents` ADD CONSTRAINT `payment_intents_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payment_intents` ADD CONSTRAINT `payment_intents_invoice_id_invoices_id_fk` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `promotion_usages` ADD CONSTRAINT `promotion_usages_promotion_id_promotions_id_fk` FOREIGN KEY (`promotion_id`) REFERENCES `promotions`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `promotion_usages` ADD CONSTRAINT `promotion_usages_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `attachments` ADD CONSTRAINT `attachments_ticket_id_tickets_id_fk` FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `kb_articles` ADD CONSTRAINT `kb_articles_category_id_kb_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `kb_categories`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ticket_replies` ADD CONSTRAINT `ticket_replies_ticket_id_tickets_id_fk` FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ticket_replies` ADD CONSTRAINT `ticket_replies_author_user_id_users_id_fk` FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tickets` ADD CONSTRAINT `tickets_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tickets` ADD CONSTRAINT `tickets_department_id_ticket_departments_id_fk` FOREIGN KEY (`department_id`) REFERENCES `ticket_departments`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tickets` ADD CONSTRAINT `tickets_service_id_services_id_fk` FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notification_logs` ADD CONSTRAINT `notification_logs_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_notifications` ADD CONSTRAINT `user_notifications_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `admin_sessions` ADD CONSTRAINT `admin_sessions_admin_id_admin_users_id_fk` FOREIGN KEY (`admin_id`) REFERENCES `admin_users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `admin_users` ADD CONSTRAINT `admin_users_role_id_admin_roles_id_fk` FOREIGN KEY (`role_id`) REFERENCES `admin_roles`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `prt_token_idx` ON `password_reset_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sms_codes_phone_idx` ON `sms_codes` (`phone`,`created_at`);--> statement-breakpoint
CREATE INDEX `config_groups_product_idx` ON `config_groups` (`product_id`);--> statement-breakpoint
CREATE INDEX `config_options_group_idx` ON `config_options` (`group_id`);--> statement-breakpoint
CREATE INDEX `products_group_idx` ON `products` (`group_id`);--> statement-breakpoint
CREATE INDEX `order_items_order_idx` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE INDEX `orders_user_idx` ON `orders` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `orders_status_idx` ON `orders` (`status`);--> statement-breakpoint
CREATE INDEX `provision_tasks_status_idx` ON `provision_tasks` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `provision_tasks_service_idx` ON `provision_tasks` (`service_id`);--> statement-breakpoint
CREATE INDEX `services_user_idx` ON `services` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `services_due_idx` ON `services` (`next_due_date`);--> statement-breakpoint
CREATE INDEX `services_status_idx` ON `services` (`status`);--> statement-breakpoint
CREATE INDEX `credit_ledger_user_idx` ON `credit_ledger` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `invoice_items_invoice_idx` ON `invoice_items` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `invoices_user_idx` ON `invoices` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `invoices_status_idx` ON `invoices` (`status`);--> statement-breakpoint
CREATE INDEX `refunds_invoice_idx` ON `refunds` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `transactions_user_idx` ON `transactions` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `transactions_status_idx` ON `transactions` (`status`);--> statement-breakpoint
CREATE INDEX `payment_intents_invoice_idx` ON `payment_intents` (`invoice_id`,`status`);--> statement-breakpoint
CREATE INDEX `payment_intents_status_idx` ON `payment_intents` (`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `promotion_usages_user_idx` ON `promotion_usages` (`user_id`);--> statement-breakpoint
CREATE INDEX `attachments_ticket_idx` ON `attachments` (`ticket_id`);--> statement-breakpoint
CREATE INDEX `ticket_replies_ticket_idx` ON `ticket_replies` (`ticket_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `tickets_user_idx` ON `tickets` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `tickets_status_idx` ON `tickets` (`status`,`last_reply_at`);--> statement-breakpoint
CREATE INDEX `tickets_dept_idx` ON `tickets` (`department_id`,`status`);--> statement-breakpoint
CREATE INDEX `notification_logs_user_idx` ON `notification_logs` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `user_notifications_user_idx` ON `user_notifications` (`user_id`,`read_at`);--> statement-breakpoint
CREATE INDEX `admin_sessions_admin_idx` ON `admin_sessions` (`admin_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_action_idx` ON `audit_logs` (`action`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_actor_idx` ON `audit_logs` (`actor_type`,`actor_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_created_idx` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `webhook_deliveries_status_idx` ON `webhook_deliveries` (`status`,`created_at`);