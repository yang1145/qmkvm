CREATE TABLE `zjmf_upstream_products` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`supplier_code` varchar(50) NOT NULL,
	`up_product_id` bigint NOT NULL,
	`name` varchar(200) NOT NULL DEFAULT '',
	`description` text,
	`currency` varchar(10) NOT NULL DEFAULT '',
	`agent_price_cents` bigint NOT NULL DEFAULT 0,
	`cycles` json,
	`module` varchar(100) NOT NULL DEFAULT '',
	`server_group` varchar(100) NOT NULL DEFAULT '',
	`synced_at` date NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `zjmf_upstream_products_id` PRIMARY KEY(`id`),
	CONSTRAINT `zjmf_up_product_uq` UNIQUE(`supplier_code`,`up_product_id`)
);
--> statement-breakpoint
CREATE INDEX `zjmf_up_supplier_idx` ON `zjmf_upstream_products` (`supplier_code`);
