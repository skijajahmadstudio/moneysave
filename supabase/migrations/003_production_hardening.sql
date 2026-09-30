-- Production hardening for Money Save
-- Apply after 001 and 002.

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
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if auth.uid() <> p_user_id and not public.is_owner() then
    raise exception 'Not authorized';
  end if;
  if p_amount = 0 or abs(p_amount) > 5000 then
    raise exception 'Invalid coin adjustment';
  end if;
  insert into public.coin_ledger(user_id, amount, source, reason, reference_id)
  values (p_user_id, p_amount, p_source, p_reason, p_reference_id);
  update public.profiles
  set coins = greatest(0, coins + p_amount), updated_at = now()
  where id = p_user_id
  returning coins into new_balance;
  return new_balance;
end;
$$;

revoke all on function public.apply_coin_ledger(uuid,integer,public.coin_source,text,uuid) from public;
grant execute on function public.apply_coin_ledger(uuid,integer,public.coin_source,text,uuid) to authenticated;

create or replace function public.reset_daily_limits()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.daily_ai_reset_date < current_date then
    new.daily_ai_questions := 0;
    new.daily_ai_reset_date := current_date;
  end if;
  if new.daily_live_reset_date < current_date then
    new.daily_live_minutes := 0;
    new.daily_live_reset_date := current_date;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_reset_daily_limits on public.profiles;
create trigger profiles_reset_daily_limits
before update on public.profiles
for each row execute procedure public.reset_daily_limits();

create or replace function public.claim_reward(
  p_threshold integer,
  p_account_holder_name text,
  p_bank_account_last4 text,
  p_ifsc text,
  p_bank_proof_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim uuid;
  v_coins integer;
  v_amount numeric(12,2);
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_threshold not in (30000,50000) then raise exception 'Invalid reward tier'; end if;
  if p_threshold = 30000 then v_amount := 10; else v_amount := 30; end if;
  select coins into v_coins from public.profiles where id = auth.uid();
  if coalesce(v_coins,0) < p_threshold then raise exception 'Insufficient coins'; end if;
  if length(trim(coalesce(p_account_holder_name,''))) < 2 then raise exception 'Account holder name required'; end if;
  if p_bank_account_last4 !~ '^[0-9]{4}$' then raise exception 'Last 4 digits required'; end if;
  if upper(trim(coalesce(p_ifsc,''))) !~ '^[A-Z]{4}0[A-Z0-9]{6}$' then raise exception 'Valid IFSC required'; end if;
  insert into public.reward_claims(user_id,coin_threshold,reward_amount,account_holder_name,bank_account_last4,ifsc,bank_proof_path)
  values(auth.uid(),p_threshold,v_amount,trim(p_account_holder_name),p_bank_account_last4,upper(trim(p_ifsc)),p_bank_proof_path)
  returning id into v_claim;
  return v_claim;
end;
$$;

revoke all on function public.claim_reward(integer,text,text,text,text) from public;
grant execute on function public.claim_reward(integer,text,text,text,text) to authenticated;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.profiles where id = auth.uid() and role = 'owner') $$;
