-- =====================================================================
-- Tiago Fernandes | Corretor de Imóveis
-- 04 - Tornar um usuário ADMINISTRADOR
--
-- Antes: crie o usuário em Authentication > Users > Add user
--        (marque "Auto Confirm User").
-- Depois: troque o e-mail abaixo pelo e-mail do usuário e rode.
-- =====================================================================

insert into public.admins (user_id, email)
select id, email
from auth.users
where lower(email) = lower('TROQUE-PELO-SEU-EMAIL@exemplo.com')
on conflict (user_id) do nothing;

-- Conferir (deve aparecer 1 linha com o seu e-mail):
select user_id, email from public.admins;
