create table if not exists public.smartlearn_bank_transfer_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text,
  amount_ngn integer not null check (amount_ngn = 2500),
  transfer_reference text not null unique,
  sender_name text not null,
  receipt_url text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id)
);

alter table public.smartlearn_bank_transfer_requests enable row level security;

-- Students must not be able to read or change payment requests directly.
revoke all on public.smartlearn_bank_transfer_requests from anon, authenticated;
grant all on public.smartlearn_bank_transfer_requests to service_role;
