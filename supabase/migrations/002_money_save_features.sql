create table if not exists public.daily_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  spent_amount numeric(12,2) not null check (spent_amount >= 0),
  purpose text not null,
  was_needed boolean not null default true,
  could_save numeric(12,2) not null default 0,
  intention text,
  created_at timestamptz not null default now()
);

create table if not exists public.savings_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  duration_days integer not null check (duration_days between 1 and 90),
  completed_days integer not null default 0,
  status text not null default 'active' check (status in ('active','completed','expired')),
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.live_sessions (
  id uuid primary key default gen_random_uuid(),
  host_user_id uuid references public.profiles(id) on delete set null,
  room_name text not null unique,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled','live','ended','cancelled')),
  created_at timestamptz not null default now()
);

create table if not exists public.moderation_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid references public.profiles(id) on delete set null,
  target_user_id uuid references public.profiles(id) on delete set null,
  session_id uuid references public.live_sessions(id) on delete set null,
  reason text not null,
  status text not null default 'open' check (status in ('open','reviewing','resolved','dismissed')),
  moderator_user_id uuid references public.profiles(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists checkins_user_date_idx on public.daily_checkins(user_id, created_at desc);
create index if not exists challenges_user_idx on public.savings_challenges(user_id, created_at desc);
create index if not exists live_sessions_time_idx on public.live_sessions(starts_at);
create index if not exists moderation_status_idx on public.moderation_reports(status, created_at desc);

alter table public.daily_checkins enable row level security;
alter table public.savings_challenges enable row level security;
alter table public.live_sessions enable row level security;
alter table public.moderation_reports enable row level security;

do $$ begin
  create policy "checkins_self_all" on public.daily_checkins for all to authenticated
  using (user_id = auth.uid() or public.is_owner())
  with check (user_id = auth.uid() or public.is_owner());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "challenges_self_all" on public.savings_challenges for all to authenticated
  using (user_id = auth.uid() or public.is_owner())
  with check (user_id = auth.uid() or public.is_owner());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "live_sessions_authenticated_select" on public.live_sessions for select to authenticated using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "moderation_owner_select" on public.moderation_reports for select to authenticated using (public.is_owner());
exception when duplicate_object then null; end $$;

create or replace function public.apply_coin_ledger(
  p_user_id uuid,
  p_amount integer,
  p_source public.coin_source,
  p_reason text,
  p_reference_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare new_balance integer;
begin
  insert into public.coin_ledger(user_id, amount, source, reason, reference_id)
  values (p_user_id, p_amount, p_source, p_reason, p_reference_id);
  update public.profiles
  set coins = greatest(0, coins + p_amount), updated_at = now()
  where id = p_user_id
  returning coins into new_balance;
  return new_balance;
end;
$$;
