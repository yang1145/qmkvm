CREATE TABLE `worker_heartbeats` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`group` varchar(20) NOT NULL,
	`pid` bigint NOT NULL,
	`host` varchar(100) NOT NULL,
	`version` varchar(50),
	`queues` json,
	`last_seen_at` datetime NOT NULL,
	`started_at` datetime NOT NULL,
	`created_at` datetime NOT NULL DEFAULT (now()),
	CONSTRAINT `worker_heartbeats_id` PRIMARY KEY(`id`),
	CONSTRAINT `worker_heartbeats_uq` UNIQUE(`group`,`pid`,`host`)
);