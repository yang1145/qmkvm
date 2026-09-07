ALTER TABLE `user_profiles` ADD `id_front_path` varchar(500);--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `id_back_path` varchar(500);--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `id_handheld_path` varchar(500);--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `ocr_id_number` varchar(30);--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `ocr_status` enum('matched','unavailable');