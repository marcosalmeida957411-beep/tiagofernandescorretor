-- =====================================================================
-- Tiago Fernandes | Corretor de Imóveis
-- 02 - Armazenamento de fotos e vídeos (Storage)
--
-- Cria o "bucket" público "imoveis": qualquer pessoa pode VER os arquivos
-- (é o que o site precisa), mas só administradores podem enviar, trocar
-- ou apagar. Seguro para rodar mais de uma vez.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'imoveis', 'imoveis', true,
  52428800,   -- 50 MB por arquivo (limite do plano gratuito)
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime']
)
on conflict (id) do nothing;

drop policy if exists "imoveis_admin_envia" on storage.objects;
create policy "imoveis_admin_envia" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'imoveis' and public.is_admin());

drop policy if exists "imoveis_admin_troca" on storage.objects;
create policy "imoveis_admin_troca" on storage.objects
  for update to authenticated
  using (bucket_id = 'imoveis' and public.is_admin())
  with check (bucket_id = 'imoveis' and public.is_admin());

drop policy if exists "imoveis_admin_apaga" on storage.objects;
create policy "imoveis_admin_apaga" on storage.objects
  for delete to authenticated
  using (bucket_id = 'imoveis' and public.is_admin());

drop policy if exists "imoveis_admin_lista" on storage.objects;
create policy "imoveis_admin_lista" on storage.objects
  for select to authenticated
  using (bucket_id = 'imoveis' and public.is_admin());
-- (visitantes abrem as fotos pelo endereço público do arquivo; não há
--  policy de listagem para eles, então não conseguem listar a pasta)
