-- Payment verification storage and reviewer access
insert into storage.buckets (id, name, public)
values ('payment-proofs', 'payment-proofs', false)
on conflict (id) do update set public = false;

drop policy if exists "payment_proofs_insert_own" on storage.objects;
create policy "payment_proofs_insert_own" on storage.objects
for insert to authenticated
with check (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "payment_proofs_select_owner_or_verifier" on storage.objects;
create policy "payment_proofs_select_owner_or_verifier" on storage.objects
for select to authenticated
using (
  bucket_id = 'payment-proofs'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (select 1 from public.profiles where id = auth.uid() and role in ('owner','verification'))
  )
);

drop policy if exists "payments_reviewer_select" on public.payment_submissions;
create policy "payments_reviewer_select" on public.payment_submissions
for select to authenticated
using (
  user_id = auth.uid()
  or exists (select 1 from public.profiles where id = auth.uid() and role in ('owner','verification'))
);

drop policy if exists "payments_reviewer_update" on public.payment_submissions;
create policy "payments_reviewer_update" on public.payment_submissions
for update to authenticated
using (exists (select 1 from public.profiles where id = auth.uid() and role in ('owner','verification')))
with check (exists (select 1 from public.profiles where id = auth.uid() and role in ('owner','verification')));
