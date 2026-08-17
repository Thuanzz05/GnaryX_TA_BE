-- Migration: add persisted appearance/notification preferences to users
-- Run this against an existing gnaryx_ta database that predates these columns.
USE gnaryx_ta;

ALTER TABLE users
  ADD COLUMN theme ENUM('light', 'dark', 'system') NOT NULL DEFAULT 'system' AFTER daily_goal,
  ADD COLUMN notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE AFTER theme;
