-- Arquivos recebidos pelos canais. O bucket e privado: nunca exponha URLs publicas.
insert into storage.buckets (id, name, public, file_size_limit)
values ('channel-media', 'channel-media', false, 10485760)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit;

-- O painel autenticado so pode ler arquivos de tenants dos quais e membro ativo.
drop policy if exists "channel_media_read_member" on storage.objects;
create policy "channel_media_read_member"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'channel-media'
  and exists (
    select 1
    from public.tenant_members tm
    join public.tenants t on t.id = tm.tenant_id
    where tm.user_id = auth.uid()
      and tm.status = 'active'
      and storage.objects.name like t.slug || '/%'
  )
);
