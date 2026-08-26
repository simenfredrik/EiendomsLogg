-- ============================================================
-- EiendomsLogg — legg til Stripe-felter på profiles
-- Kjøres ÉN gang i SQL Editor, etter at supabase-setup.sql
-- allerede er kjørt fra før.
-- ============================================================

alter table public.profiles
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text;
