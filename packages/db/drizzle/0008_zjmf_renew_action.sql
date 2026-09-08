ALTER TABLE `provision_tasks` MODIFY `action` enum('provision','suspend','unsuspend','terminate','change_package','sync','renew') NOT NULL;
