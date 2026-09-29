-- Money Save production data foundation
-- Run through Supabase migrations/SQL editor.

create extension if not exists pgcrypto;

create type public.app_role as enum ('user','support','verification','owner');
create type public.subscription_tier as enum ('free','premium');
create type public.payment_status as enum ('submitted','automated_review','human_review','approved','rejected','restricted');
create type public.reward_status as enum ('submitted','verified','paid','rejected','payment_failed');
create type public.coin_source as enum ('saving','budget','challenge','checkin','manual_adjustment','other');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  user_id text unique not null default ('MS-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10))),
  display_name text,
  email text,
  role public.app_role not null default 'user',
  subscription_tier public.subscription_tier not null default 'free',
  premium_until timestamptz,
  coins integer not null default 0 check (coins >= 0),
  daily_ai_questions integer not null default 0,
  daily_ai_reset_date date not null default current_date,
  daily_live_minutes integer not null default 0,
  daily_live_reset_date date not null default current_date,
  restricted_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  merchant text not null,
  category text not null default 'Other',
  amount numeric(12,2) not null check (amount > 0),
  spent_at date not null default current_date,
  notes text,
  receipt_path text,
  created_at timestamptz not null default now()
);

create table public.incomes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  source text not null,
  amount numeric(12,2) not null check (amount > 0),
  received_at date not null default current_date,
  created_at timestamptz not null default now()
);

create table public.coin_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount integer not null,
  source public.coin_source not null,
  reason text not null,
  reference_id uuid,
  created_at timestamptz not null default now()
);

create table public.savings_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  target_amount numeric(12,2) not null check (target_amount > 0),
  current_amount numeric(12,2) not null default 0 check (current_amount >= 0),
  target_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payment_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan text not null,
  amount numeric(12,2) not null check (amount > 0),
  transaction_reference text,
  screenshot_path text,
  status public.payment_status not null default 'submitted',
  review_reason text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.reward_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  coin_threshold integer not null check (coin_threshold in (30000,50000)),
  reward_amount numeric(12,2) not null check (reward_amount in (10,30)),
  account_holder_name text,
  bank_account_last4 text,
  ifsc text,
  bank_proof_path text,
  status public.reward_status not null default 'submitted',
  review_reason text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.profiles(id),
  action text not null,
  target_user_id uuid references public.profiles(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index expenses_user_date_idx on public.expenses(user_id, spent_at desc);
create index incomes_user_date_idx on public.incomes(user_id, received_at desc);
create index coin_ledger_user_date_idx on public.coin_ledger(user_id, created_at desc);
create index payments_user_date_idx on public.payment_submissions(user_id, created_at desc);
create index rewards_user_date_idx on public.reward_claims(user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.expenses enable row level security;
alter table public.incomes enable row level security;
alter table public.coin_ledger enable row level security;
alter table public.savings_goals enable row level security;
alter table public.payment_submissions enable row level security;
alter table public.reward_claims enable row level security;
alter table public.audit_logs enable row level security;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.profiles where id = auth.uid() and role = 'owner') $$;

create policy "profiles_self_select" on public.profiles for select to authenticated using (id = auth.uid() or public.is_owner());
create policy "profiles_self_update" on public.profiles for update to authenticated using (id = auth.uid() or public.is_owner()) with check (id = auth.uid() or public.is_owner());

create policy "expenses_self_all" on public.expenses for all to authenticated using (user_id = auth.uid() or public.is_owner()) with check (user_id = auth.uid() or public.is_owner());
create policy "incomes_self_all" on public.incomes for all to authenticated using (user_id = auth.uid() or public.is_owner()) with check (user_id = auth.uid() or public.is_owner());
create policy "coins_self_select" on public.coin_ledger for select to authenticated using (user_id = auth.uid() or public.is_owner());
create policy "goals_self_all" on public.savings_goals for all to authenticated using (user_id = auth.uid() or public.is_owner()) with check (user_id = auth.uid() or public.is_owner());
create policy "payments_self_select_insert" on public.payment_submissions for select to authenticated using (user_id = auth.uid() or public.is_owner());
create policy "payments_self_insert" on public.payment_submissions for insert to authenticated with check (user_id = auth.uid());
create policy "rewards_self_select_insert" on public.reward_claims for select to authenticated using (user_id = auth.uid() or public.is_owner());
create policy "rewards_self_insert" on public.reward_claims for insert to authenticated with check (user_id = auth.uid());
create policy "audit_owner_select" on public.audit_logs for select to authenticated using (public.is_owner());

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles(id,email,display_name,role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(coalesce(new.email,''),'@',1)),
    case when lower(coalesce(new.email,'')) = 'skijajahmadstudio@gmail.com' then 'owner'::public.app_role else 'user'::public.app_role end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger profiles_updated_at before update on public.profiles for each row execute procedure public.touch_updated_at();
create trigger goals_updated_at before update on public.savings_goals for each row execute procedure public.touch_updated_at();
