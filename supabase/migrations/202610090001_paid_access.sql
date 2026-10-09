-- SmartLearn paid access: apply this migration in Supabase SQL Editor.
create table if not exists public.smartlearn_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'inactive' check (status in ('inactive','active','past_due','cancelled')),
  provider text not null default 'paystack' check (provider = 'paystack'),
  paystack_customer_code text,
  paystack_subscription_code text,
  paystack_plan_code text,
  current_period_end timestamptz,
  last_payment_reference text,
  updated_at timestamptz not null default now()
);

create table if not exists public.smartlearn_payment_transactions (
  reference text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','success','failed')),
  amount_kobo bigint,
  currency text,
  paystack_customer_code text,
  paystack_subscription_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.smartlearn_entitlements enable row level security;
alter table public.smartlearn_payment_transactions enable row level security;

-- Signed-in users can only read their own entitlement; all writes are server-side.
drop policy if exists "Users read own SmartLearn entitlement" on public.smartlearn_entitlements;
create policy "Users read own SmartLearn entitlement"
on public.smartlearn_entitlements for select to authenticated
using (auth.uid() = user_id);

-- Transactions intentionally have no client-side policies. Edge Functions use service credentials.
revoke all on public.smartlearn_payment_transactions from anon, authenticated;
grant select on public.smartlearn_entitlements to authenticated;
revoke insert, update, delete on public.smartlearn_entitlements from anon, authenticated;

create index if not exists smartlearn_transactions_user_idx
on public.smartlearn_payment_transactions(user_id);
create index if not exists smartlearn_entitlements_customer_idx
on public.smartlearn_entitlements(paystack_customer_code);
create index if not exists smartlearn_entitlements_subscription_idx
on public.smartlearn_entitlements(paystack_subscription_code);
