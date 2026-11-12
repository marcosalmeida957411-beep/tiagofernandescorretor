# Painel administrativo | Tiago Fernandes, Corretor de Imóveis

Este guia explica como ligar o painel do corretor ao Supabase e publicar a nova versão no GitHub Pages.
Você não precisa saber programar: é só seguir os passos, na ordem.

> **Resumo em uma frase:** o site continua igual (mesmo visual, textos e imóveis). Foi adicionado um painel em `/admin` onde o Tiago entra com e-mail e senha para cadastrar, editar, publicar, destacar e marcar imóveis como vendidos ou alugados, com fotos e vídeos, sem mexer em código.

---

## 0. O que foi criado e o que mudou

**Arquivos novos**

| Arquivo / pasta | Para que serve |
|---|---|
| `admin/` (`index.html`, `admin.css`, `admin.js`) | O painel do corretor (login, resumo, lista, formulário, fotos). |
| `js/config.js` | **Único arquivo que você preenche** (endereço e chave pública do Supabase). |
| `js/imoveis-db.js` | Faz o site público ler os imóveis do Supabase. |
| `_supabase/01_estrutura.sql` | Cria as tabelas e as regras de segurança (RLS). |
| `_supabase/02_armazenamento.sql` | Cria a pasta de fotos e vídeos (bucket `imoveis`). |
| `_supabase/03_importar_imoveis_atuais.sql` | Leva os 103 imóveis que já estão no site para o painel. |
| `_supabase/04_primeiro_admin.sql` | Torna o seu usuário administrador. |
| `_tools/gerar_importacao.py` | Gera o arquivo 03 de novo, se você quiser (opcional). |
| `_backup-original/index.html` | Cópia do `index.html` de antes da mudança (não aparece no Google). |

**Arquivo alterado: só o `index.html`**, com mudanças pequenas e aditivas:
- novos filtros: finalidade (comprar/alugar), cidade, bairro e valor mínimo (além do valor máximo, local e tipo que já existiam);
- seção "Imóveis em Destaque" (só aparece quando houver algum destaque);
- faixas "Vendido" / "Alugado" nos cards e aviso na página do imóvel;
- vídeos e endereço (quando liberado) na página do imóvel; "/mês" nos aluguéis;
- o link "Área do corretor" do rodapé agora abre o novo painel;
- as imagens, vídeos, textos, cores e o restante do site **não foram alterados**;
- duas frases da Política de Privacidade foram atualizadas, porque os anúncios agora ficam no Supabase (revise com quem cuida do jurídico do site).

**Nada foi apagado.** Fotos (`img/`, `th/`), vídeos (`media/`) e os 103 imóveis embutidos continuam no site. Se o Supabase não estiver configurado ou ficar fora do ar, o site funciona exatamente como antes.

---

## 1. Criar o projeto no Supabase

1. Acesse **supabase.com** → **Start your project** → entre com sua conta (pode ser pelo GitHub).
2. **New project**. Preencha:
   - **Name:** `tiago-imoveis`
   - **Database Password:** crie uma senha forte e **guarde** (gerenciador de senhas).
   - **Region:** *South America (São Paulo)*.
   - **Plan:** Free.
3. Aguarde uns 2 minutos até o projeto ficar pronto.
4. Pegue os dois dados que o site precisa: **Project Settings** (engrenagem) → **API** (ou *Data API* / *API Keys*):
   - **Project URL** → algo como `https://abcdefgh.supabase.co`
   - **anon public** (ou *publishable*) key → um texto longo.
   - ⚠️ **NÃO use a `service_role` (nem a `secret`).** Ela dá poder total sobre o banco e nunca deve ir para o GitHub. O site e o painel recusam funcionar se detectarem essa chave.
5. Abra o arquivo **`js/config.js`** e preencha:
   ```js
   window.TF_CONFIG = {
     SUPABASE_URL: "https://abcdefgh.supabase.co",
     SUPABASE_ANON_KEY: "cole-aqui-a-chave-anon-public",
     BUCKET: "imoveis"
   };
   ```
   A chave *anon* pode ficar pública: quem protege os dados são as regras RLS do passo 2.

## 2. Configurar o banco de dados

No Supabase: **SQL Editor** → **New query**. Para cada arquivo abaixo, abra-o em um editor de texto, copie **todo** o conteúdo, cole no SQL Editor e clique em **Run** (deve aparecer *Success*).

1. `_supabase/01_estrutura.sql`: tabelas, regras de segurança e gatilhos.
2. `_supabase/02_armazenamento.sql`: veja o passo 3.

Os arquivos podem ser rodados mais de uma vez sem apagar nada.

**Como a segurança funciona (o que o 01 faz):**
- O visitante do site só consegue **ler imóveis publicados** e **apenas as colunas públicas**. A coluna `endereco` (privada) nunca é entregue ao público; o site só recebe `endereco_publico`, que o banco preenche **somente** se você marcar "Exibir o endereço completo".
- Só quem estiver na tabela `admins` pode criar, editar ou excluir imóveis e arquivos. Estar logado não basta, e ninguém consegue se tornar admin pela internet (a tabela `admins` não tem permissão de escrita pela API).
- Código dos imóveis novos (TF104, TF105…) é gerado pelo banco e não pode ser trocado.

## 3. Configurar o armazenamento de fotos e vídeos

O arquivo `02_armazenamento.sql` (rodado no passo anterior) cria o bucket **`imoveis`**:
- público para **ver** os arquivos (necessário para o site mostrar as fotos);
- só administradores podem **enviar, trocar ou apagar**;
- aceita JPG, PNG, WebP, MP4, WebM e MOV, até **50 MB por arquivo**.

Confira em **Storage**: deve existir o bucket `imoveis` marcado como *Public*. Se o Supabase reclamar do limite de 50 MB, vá em *Storage → Settings* e confirme o limite global do projeto.

> As fotos enviadas pelo painel são reduzidas automaticamente (lado maior de 1600 px) e ganham uma miniatura, para o site carregar rápido e o espaço do plano gratuito (1 GB) render muito.

## 4. Criar o primeiro administrador

1. **Authentication → Users → Add user → Create new user**.
   - E-mail e senha do corretor (use uma senha forte, com 10 ou mais caracteres).
   - Marque **Auto Confirm User**. Clique em *Create user*.
2. Abra `_supabase/04_primeiro_admin.sql`, **troque** `TROQUE-PELO-SEU-EMAIL@exemplo.com` pelo e-mail que você acabou de criar, cole no SQL Editor e rode. O resultado deve mostrar 1 linha com o seu e-mail.
3. **Feche o cadastro aberto** (importante): *Authentication → Sign In / Providers* (ou *Settings*) → desligue **Allow new users to sign up**.
4. Configure os endereços permitidos para a recuperação de senha: *Authentication → URL Configuration*:
   - **Site URL:** o endereço do seu site (ex.: `https://tiagofernandes.com.br/` ou, por enquanto, `https://SEU-USUARIO.github.io/NOME-DO-REPOSITORIO/`).
   - **Redirect URLs:** adicione o endereço do painel (com `/admin/` no final), um para cada endereço do site que você usa:
     `https://SEU-USUARIO.github.io/NOME-DO-REPOSITORIO/admin/` e, quando tiver o domínio próprio, `https://tiagofernandes.com.br/admin/`.
5. (Recomendado) *Authentication → Policies / Sign In → Password*: exija senha mínima de 10 caracteres.

## 5. Importar os 103 imóveis que já estão no site (recomendado)

Para o Tiago poder **editar, despublicar, destacar e marcar como vendido** também os imóveis antigos:

1. No SQL Editor, rode `_supabase/03_importar_imoveis_atuais.sql`.
2. No fim deve aparecer `imoveis_no_banco = 103`.

O que isso faz: copia os 103 imóveis (mantendo o código TF001…TF103, textos, destaques e as fotos que já estão no site) para o banco e marca "importado". Daí em diante o **banco é a fonte única**: o site esconde a lista embutida e mostra só o que está no painel. Rodar duas vezes **não duplica** nada e não sobrescreve o que você editou.

> ⚠️ Cidade e bairro dos imóveis importados foram **deduzidos do texto antigo** (ex.: "Bairro Santa Luzia, Formiga - MG" → Santa Luzia / Formiga). Dê uma olhada e corrija o que estiver errado, principalmente imóveis fora de Formiga (a regra assume Formiga, exceto Pains e Pedra do Indaiá). Isso alimenta os filtros do site.

Se você **não** rodar o 03, nada quebra: os 103 antigos continuam aparecendo e os novos do painel aparecem junto.

## 6. Testar o painel (antes de entregar para o corretor)

Abra `https://SEU-SITE/admin/` (no computador e no celular) e confira:

- [ ] A tela de login aparece. Senha errada mostra "E-mail ou senha incorretos".
- [ ] Entrar com o e-mail/senha do passo 4 abre o **Resumo** com os contadores.
- [ ] **Esqueci minha senha** envia o e-mail; o link (aberto **no mesmo navegador**) abre "Nova senha".
- [ ] **Novo imóvel**: preencha título, tipo, finalidade, preço, cidade/bairro, descrição; adicione 2 ou 3 fotos (várias de uma vez); defina a principal (★), mude a ordem (◀ ▶ ou arrastando), exclua uma; clique em **Pré-visualizar**; depois **Publicar no site**.
- [ ] Abra o site (aba anônima): o imóvel aparece nos cards, na página individual (com galeria) e nos filtros. Quem já está com o site aberto vê a alteração em até ~2 minutos; ao recarregar a página, aparece na hora.
- [ ] **Destacar**: o imóvel aparece na seção "Imóveis em Destaque" da página inicial.
- [ ] **Vendido** / **Alugado**: o card ganha a faixa, vai para o fim da lista e a página mostra o aviso.
- [ ] **Despublicar**: o imóvel some do site e vira rascunho. **Salvar rascunho** não publica.
- [ ] Endereço: sem marcar "Exibir o endereço", ele **não** aparece no site; marcando, aparece.
- [ ] **Excluir** pede confirmação e remove o imóvel e os arquivos enviados.
- [ ] Apague o imóvel de teste ao terminar.

## 7. Publicar a nova versão no GitHub Pages

Você **não** precisa mexer em *Settings → Pages* nem no domínio: só envie os arquivos para o repositório (a publicação continua igual).

Dois pacotes foram entregues:
- **`site_tiago_admin_atualizacao.zip`** (pequeno): só o que mudou. **É o recomendado.**
- **`site_tiago_admin_completo.zip`**: o site inteiro (fotos e vídeos incluídos).

Passo a passo (pelo navegador, sem instalar nada):

1. Extraia `site_tiago_admin_atualizacao.zip` no computador e **preencha o `js/config.js`** (passo 1).
2. No GitHub, abra o repositório do site → **Add file → Upload files**.
3. Arraste **todo o conteúdo extraído** (`index.html`, e as pastas `admin`, `js`, `_supabase`, `_tools`, `_backup-original`, mais `INSTRUCOES-ADMIN.md`). O GitHub vai substituir o `index.html` e criar as pastas novas; `img`, `th` e `media` não são tocadas.
4. Em *Commit changes*, escreva "Painel administrativo" e confirme.
5. Aguarde 1 a 2 minutos (aba **Actions** mostra a publicação) e abra o site e o `/admin/`.

> Dica: se preferir, as pastas `_supabase`, `_tools` e `_backup-original` podem ficar só no seu computador (não são necessárias no ar). O site funciona sem elas.

**Domínio próprio (depois):** nada muda no painel. Ele passa a abrir em `https://seu-dominio.com.br/admin/`. Só lembre de adicionar essa URL em *Authentication → URL Configuration → Redirect URLs* (passo 4).

---

## Rotina do corretor no dia a dia

1. Abrir `…/admin/` e entrar (no celular dá para "Adicionar à tela inicial").
2. **Novo imóvel** → preencher → adicionar fotos → **Publicar no site**.
3. Para vender/alugar: na lista, botão **Vendido** ou **Alugado**. Para tirar do ar: **Despublicar**.
4. Para mostrar na página inicial: **☆ Destacar**.

Campos que o painel gera sozinho: código do imóvel (TF104, TF105…), endereço da página (slug), linha resumida do card (ex.: "3 quartos · 2 banheiros · 150 m²") e miniaturas das fotos.

---

## Avisos importantes

- **Plano gratuito do Supabase pausa o projeto após ~1 semana sem uso.** Nesse caso o site continua no ar mostrando os imóveis embutidos (os cadastrados só no painel somem até você reativar em *Restore project*). Entrar no painel de vez em quando evita a pausa; o plano pago elimina o risco.
- **Backup:** o plano gratuito não tem backup automático. De tempos em tempos, exporte a tabela: *Table Editor → imoveis → Export → CSV*. As fotos antigas estão no seu repositório; as novas ficam no Supabase Storage.
- **Excluir um imóvel importado** apaga o registro, mas as fotos dele continuam na pasta `img/` do repositório (são arquivos do site).
- **Vídeos:** até 50 MB cada. Vídeos maiores precisam ser comprimidos antes (ex.: pelo próprio celular em "720p").
- **Recuperar senha:** abra o link do e-mail no **mesmo navegador** em que pediu a recuperação.
- O painel antigo de "Área do corretor" (que gravava só no navegador, sem senha) **não está mais linkado** no rodapé. O código dele foi mantido no `index.html` para não remover nada, mas não é mais necessário.
- **Reverter tudo:** troque o `index.html` pelo de `_backup-original/index.html` (ou deixe `js/config.js` vazio: o site volta a funcionar só com os imóveis embutidos).
- Nunca envie ao GitHub: a senha do banco, a chave `service_role`/`secret` ou qualquer chave que não seja a *anon/public*.

## Como foi verificado

Foram executados testes automatizados do código do site e do painel contra um Supabase **simulado** (login, permissão de admin, criar/editar/excluir, upload, destaque, vendido/alugado, filtros, proteção contra HTML malicioso, recusa da chave `service_role`). O SQL foi conferido por leitura e verificação estrutural (103 inserts, 20 colunas, regras de integridade).
**Não foi possível** rodar os SQLs em um Supabase de verdade nem abrir o painel em navegadores reais neste ambiente. Por isso o passo **6 (Testar o painel)** é obrigatório antes de usar no dia a dia. Se algum passo der erro, copie a mensagem exibida e peça ajuda.
