-- =====================================================================
-- Tiago Fernandes | Corretor de Imóveis
-- 01 - Estrutura do banco de dados (tabelas, segurança RLS e gatilhos)
--
-- Como usar: Supabase > SQL Editor > New query > cole TUDO > Run.
-- É seguro rodar mais de uma vez: usa "if not exists" e NÃO apaga dados.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Administradores
--    Só quem estiver nesta tabela pode alterar imóveis e arquivos.
--    Estar "logado" não basta: o usuário precisa ser administrador.
-- ---------------------------------------------------------------------
create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text,
  criado_em  timestamptz not null default now()
);

alter table public.admins enable row level security;

revoke all on public.admins from anon, authenticated;
grant select on public.admins to authenticated;

drop policy if exists admins_ler_proprio on public.admins;
create policy admins_ler_proprio on public.admins
  for select to authenticated
  using (user_id = auth.uid());
-- (não há policy de insert/update/delete: ninguém altera esta tabela pela API.
--  O primeiro administrador é criado pelo SQL Editor, no arquivo 04.)

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- ---------------------------------------------------------------------
-- 2) Imóveis
-- ---------------------------------------------------------------------
create sequence if not exists public.imoveis_codigo_seq start 104;

create table if not exists public.imoveis (
  id                uuid primary key default gen_random_uuid(),
  codigo            text unique,
  slug              text not null unique,
  titulo            text not null,
  subtitulo         text,
  tipo              text not null default 'Casa',
  finalidade        text not null default 'Venda',
  preco             numeric(14,2),
  cidade            text,
  bairro            text,
  localizacao       text,                       -- texto exibido (opcional); se vazio usa "bairro, cidade"
  endereco          text,                       -- PRIVADO: o público nunca lê esta coluna
  exibir_endereco   boolean not null default false,
  endereco_publico  text,                       -- preenchido por gatilho, só se exibir_endereco = true
  descricao         text,
  quartos           integer,
  banheiros         integer,
  vagas             integer,
  area_construida   numeric(10,2),
  area_terreno      numeric(12,2),
  caracteristicas   text[] not null default '{}',
  resumo_meta       text,                       -- linha curta do card (ex.: "3 quartos · 150 m²")
  fatos             jsonb,                      -- [["Quartos","3"], ...] (opcional)
  secoes            jsonb,                      -- [["Título",["item","item"]], ...] (opcional)
  fotos             jsonb not null default '[]'::jsonb,   -- [{url,thumb,path,thumb_path,legenda}]; a 1ª é a principal
  videos            jsonb not null default '[]'::jsonb,   -- [{url,path,titulo}]
  publicado         boolean not null default false,
  situacao          text not null default 'disponivel',
  destaque          boolean not null default false,
  origem            text not null default 'painel',
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now(),
  criado_por        uuid default auth.uid(),

  constraint imoveis_slug_ok       check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 120),
  constraint imoveis_titulo_ok     check (char_length(titulo) between 3 and 200),
  constraint imoveis_finalidade_ok check (finalidade in ('Venda', 'Aluguel')),
  constraint imoveis_situacao_ok   check (situacao in ('disponivel', 'vendido', 'alugado')),
  constraint imoveis_preco_ok      check (preco is null or preco >= 0),
  constraint imoveis_fotos_ok      check (jsonb_typeof(fotos) = 'array' and jsonb_array_length(fotos) <= 60),
  constraint imoveis_videos_ok     check (jsonb_typeof(videos) = 'array' and jsonb_array_length(videos) <= 20),
  constraint imoveis_fatos_ok      check (fatos is null or jsonb_typeof(fatos) = 'array'),
  constraint imoveis_secoes_ok     check (secoes is null or jsonb_typeof(secoes) = 'array'),
  constraint imoveis_desc_ok       check (descricao is null or char_length(descricao) <= 20000)
);

create index if not exists imoveis_pub_idx     on public.imoveis (publicado, situacao);
create index if not exists imoveis_destaque_ix on public.imoveis (destaque) where destaque;
create index if not exists imoveis_cidade_idx  on public.imoveis (cidade);
create index if not exists imoveis_tipo_idx    on public.imoveis (tipo);

-- Gatilho: gera o código (TF104, TF105...), mantém data de atualização,
-- impede trocar id/código e calcula o endereço que pode ser público.
create or replace function public.imoveis_antes_de_gravar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.codigo is null or btrim(new.codigo) = '' then
      new.codigo := 'TF' || lpad(nextval('public.imoveis_codigo_seq')::text, 3, '0');
    end if;
  else
    new.id     := old.id;
    new.codigo := old.codigo;
  end if;
  new.atualizado_em   := now();
  new.endereco_publico := case when new.exibir_endereco then nullif(btrim(new.endereco), '') else null end;
  return new;
end;
$$;

drop trigger if exists imoveis_antes_de_gravar on public.imoveis;
create trigger imoveis_antes_de_gravar
  before insert or update on public.imoveis
  for each row execute function public.imoveis_antes_de_gravar();

-- ---------------------------------------------------------------------
-- 3) Segurança (RLS) dos imóveis
--    * Visitante do site (anon): lê só imóveis publicados e SÓ as colunas
--      públicas. A coluna "endereco" (privada) não é liberada.
--    * Administrador: lê e altera tudo.
-- ---------------------------------------------------------------------
alter table public.imoveis enable row level security;

revoke all on public.imoveis from anon, authenticated;

grant select (
  id, codigo, slug, titulo, subtitulo, tipo, finalidade, preco, cidade, bairro,
  localizacao, endereco_publico, descricao, quartos, banheiros, vagas,
  area_construida, area_terreno, caracteristicas, resumo_meta, fatos, secoes,
  fotos, videos, publicado, situacao, destaque, origem, atualizado_em
) on public.imoveis to anon;

grant select, insert, update, delete on public.imoveis to authenticated;

drop policy if exists imoveis_publico_le on public.imoveis;
create policy imoveis_publico_le on public.imoveis
  for select to anon
  using (publicado = true);

drop policy if exists imoveis_admin_tudo on public.imoveis;
create policy imoveis_admin_tudo on public.imoveis
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------
-- 4) Configurações públicas (ex.: "os imóveis antigos já foram importados")
-- ---------------------------------------------------------------------
create table if not exists public.configuracoes (
  chave          text primary key,
  valor          jsonb not null default 'null'::jsonb,
  atualizado_em  timestamptz not null default now()
);

alter table public.configuracoes enable row level security;

revoke all on public.configuracoes from anon, authenticated;
grant select on public.configuracoes to anon;
grant select, insert, update, delete on public.configuracoes to authenticated;

drop policy if exists config_publica_le on public.configuracoes;
create policy config_publica_le on public.configuracoes
  for select to anon, authenticated
  using (chave in ('legado_importado'));

drop policy if exists config_admin_tudo on public.configuracoes;
create policy config_admin_tudo on public.configuracoes
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------
-- 5) Atualização em tempo real do painel (Realtime)
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'imoveis'
     ) then
    alter publication supabase_realtime add table public.imoveis;
  end if;
end
$$;
