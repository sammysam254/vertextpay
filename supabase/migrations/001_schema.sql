-- =============================================
-- VERTEXT PAY — Database Schema (idempotent)
-- Safe to run multiple times — uses IF NOT EXISTS
-- and DROP IF EXISTS on policies/triggers
-- =============================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ─── PROFILES ────────────────────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text,
  created_at  timestamptz default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Users can view own profile"   on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;
drop policy if exists "Users can insert own profile" on public.profiles;

create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- ─── WALLETS ─────────────────────────────────
create table if not exists public.wallets (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  balance     numeric(14,2) not null default 0.00,
  currency    text not null default 'KES',
  updated_at  timestamptz default now(),
  created_at  timestamptz default now(),
  constraint wallets_balance_non_negative check (balance >= 0)
);

alter table public.wallets enable row level security;

drop policy if exists "Users can view own wallet"      on public.wallets;
drop policy if exists "Service role can update wallets" on public.wallets;

create policy "Users can view own wallet"
  on public.wallets for select
  using (auth.uid() = user_id);

create policy "Service role can update wallets"
  on public.wallets for update
  using (true);

-- ─── TRANSACTION TYPES ────────────────────────
do $$ begin
  create type public.transaction_type as enum ('deposit', 'withdrawal');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.transaction_status as enum ('pending', 'success', 'failed');
exception when duplicate_object then null;
end $$;

-- ─── TRANSACTIONS ─────────────────────────────
create table if not exists public.transactions (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  type          public.transaction_type not null,
  amount        numeric(14,2) not null,
  status        public.transaction_status not null default 'pending',
  reference     text unique,
  transfer_code text,
  description   text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

alter table public.transactions enable row level security;

drop policy if exists "Users can view own transactions"     on public.transactions;
drop policy if exists "Service role can manage transactions" on public.transactions;

create policy "Users can view own transactions"
  on public.transactions for select
  using (auth.uid() = user_id);

create policy "Service role can manage transactions"
  on public.transactions for all
  using (true);

-- ─── BANK ACCOUNTS ────────────────────────────
create table if not exists public.bank_accounts (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  bank_name       text not null,
  bank_code       text not null,
  account_number  text not null,
  account_name    text not null,
  recipient_code  text,
  is_default      boolean default false,
  created_at      timestamptz default now()
);

alter table public.bank_accounts enable row level security;

drop policy if exists "Users can manage own bank accounts" on public.bank_accounts;

create policy "Users can manage own bank accounts"
  on public.bank_accounts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─── AUTO-CREATE PROFILE + WALLET ON SIGNUP ───
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;

  insert into public.wallets (user_id)
  values (new.id)
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ─── UPDATE updated_at TRIGGER ─────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists wallets_updated_at     on public.wallets;
drop trigger if exists transactions_updated_at on public.transactions;

create trigger wallets_updated_at
  before update on public.wallets
  for each row execute procedure public.set_updated_at();

create trigger transactions_updated_at
  before update on public.transactions
  for each row execute procedure public.set_updated_at();
