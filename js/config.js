/* =====================================================================
   Configuração do Supabase (usada pelo site e pelo painel /admin)

   Preencha os 2 campos abaixo com os dados do SEU projeto:
   Supabase > Project Settings > API (ou "Data API" / "API Keys").

   - SUPABASE_URL      : começa com https:// e termina com .supabase.co
   - SUPABASE_ANON_KEY : chave "anon" / "public" / "publishable".

   NUNCA cole aqui a chave "service_role" nem "secret": ela dá poder total
   sobre o banco e este arquivo é público. O site e o painel recusam
   funcionar se detectarem essa chave. A chave anon é segura aqui porque
   quem protege os dados são as regras RLS do banco (arquivo 01_estrutura.sql).
   ===================================================================== */
window.TF_CONFIG = {
  SUPABASE_URL: "https://skvsruoupwrtbprcchzf.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_b4yNI9AZMn9TDwR78Yy1zA_Gx1lpbUj",
  BUCKET: "imoveis"
};
