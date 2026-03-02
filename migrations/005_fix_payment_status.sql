-- Migration 005: Fix payment status mismatch
-- recordPayment() was inserting with status='verified' but getPaymentStats() 
-- queries WHERE status='completed'. This fixes existing rows and aligns the statuses.
--
-- Run: psql $DATABASE_URL -f migrations/005_fix_payment_status.sql

UPDATE payments SET status = 'completed' WHERE status = 'verified';
