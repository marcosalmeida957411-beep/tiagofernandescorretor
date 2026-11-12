/* =====================================================================
   Painel do corretor | Tiago Fernandes, Corretor de Imóveis
   Autenticação, banco e arquivos via Supabase (somente chave anon).
   A segurança real está nas regras RLS do banco (_supabase/01 e 02).
   ===================================================================== */
(function () {
  "use strict";
  var CFG = window.TF_CONFIG || {}, BUCKET = CFG.BUCKET || "imoveis", T = window.TFDB;
  var $ = function (i) { return document.getElementById(i); };
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  var TIPOS = ["Casa", "Apartamento", "Lote", "Sítio / Chácara", "Comercial"];
  var SUGESTOES = ["Piscina", "Churrasqueira", "Área gourmet", "Suíte", "Closet", "Garagem coberta", "Portaria 24h",
    "Condomínio fechado", "Armários planejados", "Energia solar", "Sauna", "Quintal", "Escritura em dia", "Aceita financiamento"];

  /* ------------------------- funções puras (testáveis) ------------------------- */
  function slugify(t) {
    return String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/, "") || "imovel";
  }
  function nz(v) { v = String(v == null ? "" : v).trim(); return v === "" ? null : v; }
  function parsePreco(v) { var d = String(v == null ? "" : v).replace(/\D/g, ""); return d ? Number(d) : null; }
  function parseDec(v) {
    v = String(v == null ? "" : v).trim(); if (!v) return null;
    var n = Number(v.replace(/\./g, "").replace(",", "."));
    return isFinite(n) && n >= 0 ? n : NaN;
  }
  function parseInt0(v) {
    v = String(v == null ? "" : v).trim(); if (!v) return null;
    var n = parseInt(v, 10);
    return isFinite(n) && n >= 0 && /^\d+$/.test(v) ? n : NaN;
  }
  function linhas(t) {
    var seen = {}, o = [];
    String(t || "").split(/\r?\n/).forEach(function (l) {
      l = l.trim(); var k = l.toLowerCase();
      if (l && !seen[k]) { seen[k] = 1; o.push(l.slice(0, 160)); }
    });
    return o.slice(0, 80);
  }
  function brl(n) { return n ? "R$ " + Number(n).toLocaleString("pt-BR") : "Consulte"; }
  function rand() {
    var a = new Uint8Array(8);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(a); else for (var i = 0; i < 8; i++) a[i] = Math.floor(Math.random() * 256);
    return Array.prototype.map.call(a, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var h = rand() + rand();
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-4" + h.slice(13, 16) + "-a" + h.slice(17, 20) + "-" + (h + rand()).slice(20, 32);
  }
  function absUrl(u) { u = String(u || ""); return /^(https?:)?\/\//i.test(u) || /^(blob|data):/i.test(u) ? u : "../" + u; }

  // Converte os campos do formulário em dados do banco. "base" é o registro atual (ao editar).
  function buildPayload(v, base) {
    var er = [], o = {};
    o.titulo = String(v.titulo || "").trim();
    if (o.titulo.length < 3) er.push("Informe o título do imóvel (mínimo 3 letras).");
    o.subtitulo = nz(v.subtitulo);
    o.tipo = String(v.tipo || "").trim();
    if (!o.tipo) er.push("Informe o tipo do imóvel.");
    o.finalidade = v.finalidade === "Aluguel" ? "Aluguel" : "Venda";
    o.preco = parsePreco(v.preco);
    o.cidade = nz(v.cidade); o.bairro = nz(v.bairro); o.localizacao = nz(v.localizacao);
    o.endereco = nz(v.endereco);
    o.exibir_endereco = !!v.exibir_endereco;
    if (o.exibir_endereco && !o.endereco) er.push("Você marcou para exibir o endereço, mas não informou o endereço.");
    o.descricao = nz(v.descricao);
    [["quartos", "Quartos"], ["banheiros", "Banheiros"], ["vagas", "Vagas de garagem"]].forEach(function (c) {
      o[c[0]] = parseInt0(v[c[0]]); if (o[c[0]] !== o[c[0]]) { er.push(c[1] + ": use apenas números inteiros."); o[c[0]] = null; }
    });
    [["area_construida", "Área construída"], ["area_terreno", "Área do terreno"]].forEach(function (c) {
      o[c[0]] = parseDec(v[c[0]]); if (o[c[0]] !== o[c[0]]) { er.push(c[1] + ": informe um número válido."); o[c[0]] = null; }
    });
    o.caracteristicas = linhas(v.caracteristicas);
    var temNum = ["quartos", "banheiros", "vagas", "area_construida", "area_terreno"].some(function (k) { return o[k] != null; });
    o.resumo_meta = temNum ? (T.buildMeta(o) || null) : ((base && base.resumo_meta) || null);
    o.fatos = temNum ? T.buildFacts(o) : ((base && base.fatos) || null);
    o.secoes = o.caracteristicas.length ? null : ((base && base.secoes) || null);
    o.situacao = v.situacao === "vendido" || v.situacao === "alugado" ? v.situacao : "disponivel";
    o.destaque = !!v.destaque;
    return { payload: o, erros: er };
  }
  function statusDe(r) {
    if (!r.publicado) return { k: "rasc", t: "Rascunho" };
    if (r.situacao === "vendido") return { k: "vd", t: "Vendido" };
    if (r.situacao === "alugado") return { k: "al", t: "Alugado" };
    return { k: "pub", t: "Publicado" };
  }
  function contar(items) {
    var c = { total: items.length, pub: 0, rasc: 0, vd: 0, al: 0, dq: 0 };
    items.forEach(function (r) {
      if (!r.publicado) c.rasc++; else if (r.situacao === "vendido") c.vd++; else if (r.situacao === "alugado") c.al++; else c.pub++;
      if (r.destaque) c.dq++;
    });
    return c;
  }
  if (window.__TF_TEST__) window.__TFADMIN_TEST__ = { getF: function () { return F; }, getS: function () { return S; }, slugify: slugify, parsePreco: parsePreco, parseDec: parseDec, parseInt0: parseInt0, linhas: linhas, buildPayload: buildPayload, contar: contar, statusDe: statusDe, absUrl: absUrl, esc: esc };

  /* ------------------------- estado e utilidades de tela ------------------------- */
  var sb = null, S = { user: null, items: [], filtro: { q: "", st: "", tipo: "" }, rt: null, recuperando: false }, F = null, lastHash = "";

  var toastT = null;
  function toast(msg, err) {
    var t = $("toast"); t.textContent = msg; t.className = "toast on" + (err ? " err" : "");
    clearTimeout(toastT); toastT = setTimeout(function () { t.className = "toast"; }, err ? 6500 : 3200);
  }
  function showOnly(id) { ["boot", "auth", "app"].forEach(function (k) { $(k).hidden = k !== id; }); }
  function setTitle(t) { $("pageTitle").textContent = t; document.title = t + " | Painel Tiago Fernandes"; }
  function errMsg(e) {
    var m = e && (e.message || e.error_description || e.msg) || String(e || "Erro");
    if (/Invalid login credentials/i.test(m)) return "E-mail ou senha incorretos.";
    if (/row-level security|permission denied|not authorized/i.test(m)) return "Sem permissão. Confirme que este usuário foi cadastrado como administrador (arquivo 04_primeiro_admin.sql).";
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "Sem conexão com o Supabase. Verifique a internet e a configuração.";
    if (/Email not confirmed/i.test(m)) return "E-mail ainda não confirmado no Supabase.";
    if (/rate limit|too many/i.test(m)) return "Muitas tentativas. Aguarde alguns minutos.";
    return m;
  }

  /* ------------------------- modal ------------------------- */
  function openModal(html, small) {
    var m = $("modal"); m.innerHTML = '<div class="modal-box' + (small ? " sm" : "") + '" role="dialog" aria-modal="true">' + html + "</div>"; m.hidden = false;
    var f = m.querySelector("input,button,select,textarea"); if (f) try { f.focus(); } catch (e) { }
  }
  function closeModal() { $("modal").hidden = true; $("modal").innerHTML = ""; }
  function confirmar(titulo, texto, rotulo, perigo) {
    return new Promise(function (res) {
      openModal('<div class="modal-head"><h2>' + esc(titulo) + '</h2></div><p style="color:var(--mut)">' + texto + '</p><div class="acts" style="margin-top:16px"><button class="btn ' + (perigo ? "danger" : "gold") + '" id="mcOk">' + esc(rotulo) + '</button><button class="btn ghost" id="mcNo">Cancelar</button></div>', true);
      $("mcOk").onclick = function () { closeModal(); res(true); };
      $("mcNo").onclick = function () { closeModal(); res(false); };
    });
  }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("modal").hidden) closeModal(); });
  $("modal").addEventListener("mousedown", function (e) { if (e.target === this) closeModal(); });

  /* ------------------------- configuração / inicialização ------------------------- */
  function faltaConfig(titulo, texto) {
    showOnly("auth");
    $("authBody").innerHTML = '<h2>' + esc(titulo) + '</h2><div class="msg err">' + texto + "</div>";
  }
  function init() {
    if (!T || !T.configurado()) {
      return faltaConfig("Painel ainda não configurado", 'Abra o arquivo <b>js/config.js</b> e preencha <b>SUPABASE_URL</b> e <b>SUPABASE_ANON_KEY</b> com os dados do seu projeto Supabase. O passo a passo está no arquivo <b>INSTRUCOES-ADMIN.md</b>.');
    }
    if (T.chaveInsegura(CFG.SUPABASE_ANON_KEY)) {
      return faltaConfig("Chave insegura detectada", 'O arquivo <b>js/config.js</b> contém uma chave <b>service_role/secret</b>. Ela dá poder total sobre o banco e <b>não pode</b> ficar em arquivo público. Troque pela chave <b>anon/public</b> e, por segurança, gere uma nova chave secreta no Supabase.');
    }
    if (!window.supabase || !window.supabase.createClient) {
      return faltaConfig("Não foi possível carregar o Supabase", "Verifique a conexão com a internet e recarregue a página.");
    }
    sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
      auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    sb.auth.onAuthStateChange(function (ev) {
      if (ev === "PASSWORD_RECOVERY") { S.recuperando = true; authView("recovery"); }
      else if (ev === "SIGNED_OUT") { S.user = null; stopRealtime(); authView("login"); }
    });
    sb.auth.getSession().then(function (r) {
      if (r.data && r.data.session) { if (S.recuperando) return; entrar(r.data.session.user); }
      else authView("login");
    }, function () { authView("login"); });
  }

  /* ------------------------- login, recuperação de senha ------------------------- */
  function authView(k, msg, tipo) {
    showOnly("auth");
    var m = msg ? '<div class="msg ' + (tipo || "") + '">' + esc(msg) + "</div>" : "", h = "";
    if (k === "login") {
      h = '<h2>Entrar</h2><p>Acesse com o e-mail e a senha do corretor.</p>' + m +
        '<form id="fLogin" novalidate><div class="fld"><label for="lEmail">E-mail</label><input id="lEmail" type="email" autocomplete="username" inputmode="email" required></div>' +
        '<div class="fld"><label for="lPass">Senha</label><input id="lPass" type="password" autocomplete="current-password" required></div>' +
        '<button class="btn gold" style="width:100%" id="bLogin" type="submit">Entrar</button></form>' +
        '<p style="margin-top:14px;text-align:center"><button class="link" id="bForgot" type="button">Esqueci minha senha</button></p>';
    } else if (k === "forgot") {
      h = '<h2>Recuperar senha</h2><p>Informe o e-mail do painel. Enviaremos um link para criar uma nova senha.</p>' + m +
        '<form id="fForgot" novalidate><div class="fld"><label for="rEmail">E-mail</label><input id="rEmail" type="email" autocomplete="username" inputmode="email" required></div>' +
        '<button class="btn gold" style="width:100%" id="bSend" type="submit">Enviar link</button></form>' +
        '<p style="margin-top:14px;text-align:center"><button class="link" id="bBack" type="button">Voltar ao login</button></p>';
    } else if (k === "recovery") {
      h = '<h2>Nova senha</h2><p>Crie uma nova senha para acessar o painel (mínimo 8 caracteres).</p>' + m +
        '<form id="fNew" novalidate><div class="fld"><label for="nPass">Nova senha</label><input id="nPass" type="password" autocomplete="new-password" required></div>' +
        '<div class="fld"><label for="nPass2">Repita a nova senha</label><input id="nPass2" type="password" autocomplete="new-password" required></div>' +
        '<button class="btn gold" style="width:100%" id="bNew" type="submit">Salvar nova senha</button></form>';
    } else if (k === "noaccess") {
      h = '<h2>Sem permissão</h2><div class="msg err">Este usuário entrou, mas <b>não é administrador</b> do painel. Peça para cadastrá-lo com o arquivo <b>04_primeiro_admin.sql</b> no Supabase.</div><button class="btn" id="bOut2" type="button">Sair</button>';
    }
    $("authBody").innerHTML = h;
    var f;
    if ((f = $("fLogin"))) {
      f.addEventListener("submit", async function (e) {
        e.preventDefault();
        var em = $("lEmail").value.trim(), pw = $("lPass").value;
        if (!em || !pw) return authView("login", "Informe e-mail e senha.", "err");
        $("bLogin").disabled = true; $("bLogin").textContent = "Entrando…";
        var r = await sb.auth.signInWithPassword({ email: em, password: pw });
        if (r.error) return authView("login", errMsg(r.error), "err");
        entrar(r.data.user);
      });
      $("bForgot").onclick = function () { authView("forgot"); };
    }
    if ((f = $("fForgot"))) {
      f.addEventListener("submit", async function (e) {
        e.preventDefault();
        var em = $("rEmail").value.trim(); if (!em) return authView("forgot", "Informe o e-mail.", "err");
        $("bSend").disabled = true; $("bSend").textContent = "Enviando…";
        var r = await sb.auth.resetPasswordForEmail(em, { redirectTo: location.origin + location.pathname });
        if (r.error && /rate limit|too many/i.test(r.error.message || "")) return authView("forgot", errMsg(r.error), "err");
        authView("login", "Se este e-mail estiver cadastrado, você receberá um link para criar uma nova senha. Abra o link neste mesmo navegador.", "ok");
      });
      $("bBack").onclick = function () { authView("login"); };
    }
    if ((f = $("fNew"))) {
      f.addEventListener("submit", async function (e) {
        e.preventDefault();
        var a = $("nPass").value, b = $("nPass2").value;
        if (a.length < 8) return authView("recovery", "A senha precisa ter pelo menos 8 caracteres.", "err");
        if (a !== b) return authView("recovery", "As senhas não conferem.", "err");
        $("bNew").disabled = true;
        var r = await sb.auth.updateUser({ password: a });
        if (r.error) return authView("recovery", errMsg(r.error), "err");
        S.recuperando = false;
        history.replaceState(null, "", location.pathname);
        entrar(r.data.user);
        toast("Senha alterada com sucesso.");
      });
    }
    if ((f = $("bOut2"))) f.onclick = function () { sb.auth.signOut(); };
  }

  async function entrar(user) {
    var r = await sb.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
    if (r.error || !r.data) return authView("noaccess");
    S.user = user;
    $("who").textContent = user.email || "";
    showOnly("app");
    await carregarTudo();
    iniciarRealtime();
    if (!location.hash || location.hash.indexOf("#/") !== 0) location.hash = "#/dashboard"; else { lastHash = location.hash; route(); }
  }

  /* ------------------------- dados ------------------------- */
  async function carregarTudo(silencioso) {
    var r = await sb.from("imoveis").select("*").order("atualizado_em", { ascending: false }).limit(2000);
    if (r.error) { toast(errMsg(r.error), true); return false; }
    S.items = r.data || [];
    if (silencioso) { var v = (location.hash.split("/")[1] || "dashboard"); if (v === "dashboard" || v === "imoveis") route(); }
    return true;
  }
  var rtT = null;
  function iniciarRealtime() {
    stopRealtime();
    try {
      S.rt = sb.channel("imoveis-painel").on("postgres_changes", { event: "*", schema: "public", table: "imoveis" }, function () {
        clearTimeout(rtT); rtT = setTimeout(function () { carregarTudo(true); }, 500);
      }).subscribe();
    } catch (e) { /* tempo real é opcional */ }
  }
  function stopRealtime() { try { if (S.rt) sb.removeChannel(S.rt); } catch (e) { } S.rt = null; }
  function achar(id) { for (var i = 0; i < S.items.length; i++) if (S.items[i].id === id) return S.items[i]; return null; }
  function capaDe(r) {
    var f = (r.fotos || [])[0]; return f ? absUrl(f.thumb || f.url) : "";
  }
  function caminhos(r) {
    var p = [];
    (r.fotos || []).forEach(function (f) { if (f.path) p.push(f.path); if (f.thumb_path) p.push(f.thumb_path); });
    (r.videos || []).forEach(function (v) { if (v.path) p.push(v.path); });
    return p;
  }
  async function removerArquivos(paths) {
    for (var i = 0; i < paths.length; i += 50) {
      try { await sb.storage.from(BUCKET).remove(paths.slice(i, i + 50)); } catch (e) { }
    }
  }
  async function alterar(id, campos, msg) {
    var r = await sb.from("imoveis").update(campos).eq("id", id).select("*").single();
    if (r.error) { toast(errMsg(r.error), true); return false; }
    for (var i = 0; i < S.items.length; i++) if (S.items[i].id === id) S.items[i] = r.data;
    if (msg) toast(msg);
    return true;
  }

  /* ------------------------- rotas ------------------------- */
  function route() {
    if (!S.user) return;
    var p = location.hash.replace(/^#\/?/, "").split("/"), r = p[0] || "dashboard";
    Array.prototype.forEach.call($("nav").querySelectorAll("a[data-r]"), function (a) {
      var on = a.getAttribute("data-r") === (r === "editar" ? "imoveis" : r); a.classList.toggle("on", on);
    });
    menu(false);
    if (r === "dashboard") vDash();
    else if (r === "imoveis") vList();
    else if (r === "novo") vForm(null);
    else if (r === "editar") vForm(p[1] || "");
    else location.hash = "#/dashboard";
  }
  window.addEventListener("hashchange", function () {
    if (!S.user) return;
    if (F && F.sujo && !F.saindo && lastHash && lastHash !== location.hash) {
      if (!window.confirm("Há alterações não salvas neste imóvel. Sair mesmo assim?")) { var h = lastHash; lastHash = ""; location.hash = h; lastHash = h; return; }
    }
    lastHash = location.hash; route();
  });
  function menu(o) {
    $("side").classList.toggle("open", o); $("scrim").classList.toggle("on", o);
    $("menuBtn").setAttribute("aria-expanded", o ? "true" : "false");
  }
  $("menuBtn").onclick = function () { menu(!$("side").classList.contains("open")); };
  $("scrim").onclick = function () { menu(false); };
  $("btnOut").onclick = function () { sb.auth.signOut(); };
  $("btnPass").onclick = function () {
    openModal('<div class="modal-head"><h2>Alterar senha</h2></div><div class="fld"><label for="pw1">Nova senha (mínimo 8)</label><input id="pw1" type="password" autocomplete="new-password"></div><div class="fld"><label for="pw2">Repita</label><input id="pw2" type="password" autocomplete="new-password"></div><div class="acts"><button class="btn gold" id="pwOk">Salvar</button><button class="btn ghost" id="pwNo">Cancelar</button></div>', true);
    $("pwNo").onclick = closeModal;
    $("pwOk").onclick = async function () {
      var a = $("pw1").value, b = $("pw2").value;
      if (a.length < 8) return toast("A senha precisa ter pelo menos 8 caracteres.", true);
      if (a !== b) return toast("As senhas não conferem.", true);
      var r = await sb.auth.updateUser({ password: a });
      if (r.error) return toast(errMsg(r.error), true);
      closeModal(); toast("Senha alterada.");
    };
  };

  /* ------------------------- Resumo (dashboard) ------------------------- */
  function limpaView() { var v = $("view"); v.onclick = null; v.oninput = null; v.onchange = null; }
  function vDash() {
    limpaView(); setTitle("Resumo"); F = null;
    var c = contar(S.items);
    var recentes = S.items.slice(0, 6);
    var card = function (n, l, st) { return '<a class="stat" href="#/imoveis" data-st="' + st + '"><b>' + n + "</b><span>" + l + "</span></a>"; };
    $("view").innerHTML =
      '<div class="cards">' + card(c.total, "Total de imóveis", "") + card(c.pub, "Publicados", "publicado") + card(c.rasc, "Rascunhos", "rascunho") +
      card(c.vd, "Vendidos", "vendido") + card(c.al, "Alugados", "alugado") + card(c.dq, "Em destaque", "destaque") + "</div>" +
      '<div class="panel"><h2>Atalhos</h2><div class="acts"><a class="btn gold" href="#/novo">+ Cadastrar imóvel</a><a class="btn" href="#/imoveis">Gerenciar imóveis</a><a class="btn ghost" href="../" target="_blank" rel="noopener">Ver o site</a></div></div>' +
      '<div class="panel"><h2>Últimas alterações</h2>' + (recentes.length ? recentes.map(function (r) {
        var st = statusDe(r), cv = capaDe(r);
        return '<a class="acts" style="align-items:center;padding:8px 0;border-bottom:1px solid var(--line);flex-wrap:nowrap" href="#/editar/' + esc(r.id) + '">' +
          (cv ? '<img class="thumb" style="width:48px;height:48px" alt="" loading="lazy" src="' + esc(cv) + '">' : "") +
          '<span style="flex:1;min-width:0"><span class="tt">' + esc(r.titulo) + '</span><span class="sub">' + esc(r.codigo || "") + " · " + esc(brl(r.preco)) + '</span></span><span class="chip ' + st.k + '">' + st.t + "</span></a>";
      }).join("") : '<p class="vazio">Nenhum imóvel cadastrado ainda. Use “Cadastrar imóvel” ou importe os imóveis atuais do site (arquivo 03 do Supabase).</p>') + "</div>";
    $("view").onclick = function (e) {
      var a = e.target.closest("a[data-st]"); if (a) S.filtro = { q: "", st: a.getAttribute("data-st"), tipo: "" };
    };
  }

  /* ------------------------- Lista de imóveis ------------------------- */
  function filtrados() {
    var f = S.filtro, q = String(f.q || "").toLowerCase();
    return S.items.filter(function (r) {
      if (f.st === "publicado" && !(r.publicado && r.situacao === "disponivel")) return false;
      if (f.st === "rascunho" && r.publicado) return false;
      if (f.st === "vendido" && r.situacao !== "vendido") return false;
      if (f.st === "alugado" && r.situacao !== "alugado") return false;
      if (f.st === "destaque" && !r.destaque) return false;
      if (f.tipo && r.tipo !== f.tipo) return false;
      if (q) { var h = [r.titulo, r.codigo, r.bairro, r.cidade, r.tipo, r.localizacao].join(" ").toLowerCase(); if (h.indexOf(q) < 0) return false; }
      return true;
    });
  }
  function linhaHtml(r) {
    var st = statusDe(r), cv = capaDe(r);
    var loc = r.localizacao || [r.bairro, r.cidade].filter(Boolean).join(", ");
    return '<tr data-id="' + esc(r.id) + '">' +
      '<td class="c-foto">' + (cv ? '<img class="thumb" alt="" loading="lazy" src="' + esc(cv) + '">' : '<span class="thumb"></span>') + "</td>" +
      '<td class="c-main" data-l="Imóvel"><span class="tt">' + esc(r.titulo) + '</span><span class="sub">' + esc(r.codigo || "") + (loc ? " · " + esc(loc) : "") + "</span></td>" +
      '<td data-l="Tipo">' + esc(r.tipo) + '<span class="sub">' + esc(r.finalidade) + "</span></td>" +
      '<td data-l="Preço">' + esc(brl(r.preco)) + (r.finalidade === "Aluguel" && r.preco ? " /mês" : "") + "</td>" +
      '<td data-l="Situação"><span class="chip ' + st.k + '">' + st.t + "</span>" + (!r.publicado && r.situacao !== "disponivel" ? ' <span class="chip">oculto</span>' : "") + (r.destaque ? ' <span class="chip dq">★ destaque</span>' : "") + "</td>" +
      '<td><div class="acts">' +
      '<button class="btn sm" data-act="edit">Editar</button>' +
      '<button class="btn sm ' + (r.publicado ? "ghost" : "gold") + '" data-act="pub">' + (r.publicado ? "Despublicar" : "Publicar") + "</button>" +
      '<button class="btn sm ghost" data-act="dest" title="Destacar na página inicial">' + (r.destaque ? "★ Tirar destaque" : "☆ Destacar") + "</button>" +
      '<button class="btn sm ghost" data-act="vd">' + (r.situacao === "vendido" ? "Desmarcar vendido" : "Vendido") + "</button>" +
      '<button class="btn sm ghost" data-act="al">' + (r.situacao === "alugado" ? "Desmarcar alugado" : "Alugado") + "</button>" +
      (r.publicado ? '<a class="btn sm ghost" target="_blank" rel="noopener" href="../#imovel-' + esc(r.slug) + '">Ver no site</a>' : "") +
      '<button class="btn sm danger" data-act="del">Excluir</button></div></td></tr>';
  }
  function vList() {
    limpaView(); setTitle("Imóveis"); F = null;
    var tipos = TIPOS.slice(); S.items.forEach(function (r) { if (r.tipo && tipos.indexOf(r.tipo) < 0) tipos.push(r.tipo); });
    var f = S.filtro;
    $("view").innerHTML =
      '<div class="panel"><div class="tools">' +
      '<div><label for="fq">Buscar</label><input id="fq" type="search" placeholder="Título, código, bairro…" value="' + esc(f.q) + '"></div>' +
      '<div><label for="fst">Situação</label><select id="fst">' + [["", "Todos"], ["publicado", "Publicados"], ["rascunho", "Rascunhos"], ["vendido", "Vendidos"], ["alugado", "Alugados"], ["destaque", "Em destaque"]].map(function (o) { return '<option value="' + o[0] + '"' + (f.st === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></div>" +
      '<div><label for="ftp">Tipo</label><select id="ftp"><option value="">Todos</option>' + tipos.map(function (t) { return '<option' + (f.tipo === t ? " selected" : "") + ">" + esc(t) + "</option>"; }).join("") + "</select></div></div>" +
      '<p class="hint" id="cnt"></p><table><thead><tr><th></th><th>Imóvel</th><th>Tipo</th><th>Preço</th><th>Situação</th><th>Ações</th></tr></thead><tbody id="tb"></tbody></table></div>';
    var pintar = function () {
      var L = filtrados();
      $("tb").innerHTML = L.length ? L.map(linhaHtml).join("") : '<tr><td colspan="6" class="vazio">Nenhum imóvel encontrado.</td></tr>';
      $("cnt").textContent = L.length + (L.length === 1 ? " imóvel" : " imóveis") + " (de " + S.items.length + ")";
    };
    pintar();
    var tq = null;
    $("fq").oninput = function () { var v = this.value; clearTimeout(tq); tq = setTimeout(function () { S.filtro.q = v; pintar(); }, 150); };
    $("fst").onchange = function () { S.filtro.st = this.value; pintar(); };
    $("ftp").onchange = function () { S.filtro.tipo = this.value; pintar(); };
    $("view").onclick = async function (e) {
      var b = e.target.closest("button[data-act]"); if (!b) return;
      var tr = b.closest("tr"), id = tr && tr.getAttribute("data-id"), r = achar(id); if (!r) return;
      var act = b.getAttribute("data-act");
      if (act === "edit") { location.hash = "#/editar/" + id; return; }
      b.disabled = true;
      var ok = false;
      if (act === "pub") {
        if (!r.publicado && !(r.fotos || []).length) { b.disabled = false; return toast("Adicione ao menos 1 foto antes de publicar.", true); }
        ok = await alterar(id, { publicado: !r.publicado }, r.publicado ? "Imóvel despublicado (saiu do site)." : "Imóvel publicado no site.");
      } else if (act === "dest") ok = await alterar(id, { destaque: !r.destaque }, r.destaque ? "Destaque removido." : "Imóvel em destaque na página inicial.");
      else if (act === "vd") ok = await alterar(id, { situacao: r.situacao === "vendido" ? "disponivel" : "vendido" }, r.situacao === "vendido" ? "Imóvel disponível novamente." : "Marcado como vendido.");
      else if (act === "al") ok = await alterar(id, { situacao: r.situacao === "alugado" ? "disponivel" : "alugado" }, r.situacao === "alugado" ? "Imóvel disponível novamente." : "Marcado como alugado.");
      else if (act === "del") {
        b.disabled = false;
        var sim = await confirmar("Excluir imóvel", "Excluir <b>" + esc(r.titulo) + "</b> definitivamente? As fotos e vídeos enviados pelo painel também serão apagados. Esta ação não pode ser desfeita.", "Excluir", true);
        if (!sim) return;
        var d = await sb.from("imoveis").delete().eq("id", id);
        if (d.error) return toast(errMsg(d.error), true);
        await removerArquivos(caminhos(r));
        S.items = S.items.filter(function (x) { return x.id !== id; });
        toast("Imóvel excluído."); ok = true;
      }
      if (ok) vList(); else b.disabled = false;
    };
  }

  /* ------------------------- Formulário (criar / editar) ------------------------- */
  function datalist(id, arr) { return '<datalist id="' + id + '">' + arr.map(function (v) { return '<option value="' + esc(v) + '">'; }).join("") + "</datalist>"; }
  function distintos(campo, base) {
    var o = (base || []).slice(); S.items.forEach(function (r) { if (r[campo] && o.indexOf(r[campo]) < 0) o.push(r[campo]); }); return o.sort();
  }
  function vForm(id) {
    limpaView();
    var row = null;
    if (id) { row = achar(id); if (!row) { toast("Imóvel não encontrado.", true); location.hash = "#/imoveis"; return; } }
    var r = row || {};
    F = {
      id: row ? row.id : uuid(), isNew: !row, row: row, sujo: false,
      fotos: ((row && row.fotos) || []).map(function (f) { return { ex: true, url: f.url, thumb: f.thumb || "", path: f.path || "", thumb_path: f.thumb_path || "", legenda: f.legenda || "" }; }),
      videos: ((row && row.videos) || []).map(function (v) { return { ex: true, url: v.url, path: v.path || "", titulo: v.titulo || "" }; }),
      remover: []
    };
    setTitle(row ? "Editar imóvel" : "Novo imóvel");
    var val = function (k) { return esc(r[k] == null ? "" : r[k]); };
    var pub = row ? row.publicado : false;
    $("view").innerHTML =
      (row ? '<p class="hint">Código <b>' + esc(row.codigo || "") + "</b> · " + (row.origem === "importado" ? "importado do site antigo" : "criado no painel") + "</p>" : "") +
      '<div class="panel"><h2>Dados do anúncio</h2>' +
      '<div class="fld"><label for="f_titulo">Título do imóvel *</label><input id="f_titulo" maxlength="200" value="' + val("titulo") + '" placeholder="Ex.: Casa com 3 quartos no Centro"></div>' +
      '<div class="fld"><label for="f_subtitulo">Resumo curto (frase abaixo do título)</label><input id="f_subtitulo" maxlength="200" value="' + val("subtitulo") + '"></div>' +
      '<div class="grid3"><div class="fld"><label for="f_tipo">Tipo *</label><input id="f_tipo" list="dlTipo" value="' + esc(r.tipo || "Casa") + '" autocomplete="off"></div>' +
      '<div class="fld"><label for="f_finalidade">Finalidade *</label><select id="f_finalidade"><option value="Venda"' + (r.finalidade !== "Aluguel" ? " selected" : "") + '>Venda</option><option value="Aluguel"' + (r.finalidade === "Aluguel" ? " selected" : "") + ">Aluguel</option></select></div>" +
      '<div class="fld"><label for="f_preco">Preço (R$)</label><input id="f_preco" inputmode="numeric" value="' + (r.preco ? Number(r.preco).toLocaleString("pt-BR") : "") + '" placeholder="Vazio = “Consulte”"></div></div>' +
      datalist("dlTipo", distintos("tipo", TIPOS)) +
      '<div class="grid2"><div class="fld"><label for="f_cidade">Cidade</label><input id="f_cidade" list="dlCid" value="' + val("cidade") + '" autocomplete="off" placeholder="Formiga"></div>' +
      '<div class="fld"><label for="f_bairro">Bairro</label><input id="f_bairro" list="dlBai" value="' + val("bairro") + '" autocomplete="off"></div></div>' +
      datalist("dlCid", distintos("cidade")) + datalist("dlBai", distintos("bairro")) +
      '<div class="fld"><label for="f_localizacao">Texto de localização exibido (opcional)</label><input id="f_localizacao" maxlength="200" value="' + val("localizacao") + '"><p class="hint">Se ficar vazio, o site mostra “Bairro, Cidade”.</p></div>' +
      '<div class="fld"><label for="f_endereco">Endereço completo (privado)</label><input id="f_endereco" maxlength="200" value="' + val("endereco") + '" placeholder="Rua, número, complemento"></div>' +
      '<label class="chk" for="f_exibir"><input type="checkbox" id="f_exibir"' + (r.exibir_endereco ? " checked" : "") + '> Exibir o endereço completo no site (se desmarcado, só aparece bairro e cidade)</label>' +
      '<div class="fld"><label for="f_descricao">Descrição completa</label><textarea id="f_descricao" style="min-height:160px">' + val("descricao") + "</textarea></div></div>" +

      '<div class="panel"><h2>Detalhes</h2><div class="grid5">' +
      '<div class="fld"><label for="f_quartos">Quartos</label><input id="f_quartos" inputmode="numeric" value="' + val("quartos") + '"></div>' +
      '<div class="fld"><label for="f_banheiros">Banheiros</label><input id="f_banheiros" inputmode="numeric" value="' + val("banheiros") + '"></div>' +
      '<div class="fld"><label for="f_vagas">Vagas</label><input id="f_vagas" inputmode="numeric" value="' + val("vagas") + '"></div>' +
      '<div class="fld"><label for="f_area_construida">Área constr. (m²)</label><input id="f_area_construida" inputmode="decimal" value="' + val("area_construida") + '"></div>' +
      '<div class="fld"><label for="f_area_terreno">Terreno (m²)</label><input id="f_area_terreno" inputmode="decimal" value="' + val("area_terreno") + '"></div></div>' +
      (row && row.origem === "importado" && !(row.quartos || row.banheiros || row.vagas || row.area_construida || row.area_terreno) ? '<p class="hint">Este anúncio foi importado com os destaques originais. Se você preencher algum número acima, ele passa a usar os números do painel.</p>' : "") +
      '<div class="fld" style="margin-top:12px"><label for="f_caracteristicas">Características e diferenciais (uma por linha)</label><textarea id="f_caracteristicas" placeholder="Piscina&#10;Churrasqueira&#10;Portaria 24h">' + esc((r.caracteristicas || []).join("\n")) + "</textarea>" +
      '<div class="tags" id="sug">' + SUGESTOES.map(function (s) { return '<button type="button" data-s="' + esc(s) + '">+ ' + esc(s) + "</button>"; }).join("") + "</div>" +
      (row && row.secoes && row.secoes.length && !(row.caracteristicas || []).length ? '<p class="hint">Este anúncio tem seções de detalhes originais. Se você escrever algo aqui, esta lista substitui essas seções.</p>' : "") + "</div></div>" +

      '<div class="panel"><h2>Fotos</h2><p class="hint" style="margin-top:-6px">A 1ª foto é a <b>principal</b> (aparece no card). Arraste para reordenar ou use as setas. As fotos são reduzidas automaticamente antes do envio.</p>' +
      '<label class="drop" id="drop" for="f_files">&#128247; Toque para escolher fotos (várias de uma vez) ou arraste para cá</label><input type="file" id="f_files" accept="image/*" multiple hidden>' +
      '<div class="ph-grid" id="phGrid"></div></div>' +

      '<div class="panel"><h2>Vídeos (opcional)</h2><p class="hint" style="margin-top:-6px">MP4 ou WebM, até 50 MB cada. Os vídeos aparecem na página do imóvel.</p>' +
      '<input type="file" id="f_vids" accept="video/mp4,video/webm,video/quicktime" multiple><div id="vidList" style="margin-top:12px"></div></div>' +

      '<div class="panel"><h2>Situação e destaque</h2><div class="grid2"><div class="fld"><label for="f_situacao">Situação do imóvel</label><select id="f_situacao">' +
      [["disponivel", "Disponível"], ["vendido", "Vendido"], ["alugado", "Alugado"]].map(function (o) { return '<option value="' + o[0] + '"' + ((r.situacao || "disponivel") === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") +
      '</select><p class="hint">Vendidos e alugados continuam no site com uma faixa de identificação, enquanto estiverem publicados.</p></div>' +
      '<div><label class="chk" for="f_destaque" style="margin-top:20px"><input type="checkbox" id="f_destaque"' + (r.destaque ? " checked" : "") + '> ★ Destacar na página inicial</label></div></div>' +
      '<p class="hint">Situação de publicação: <b id="stPub">' + (pub ? "publicado no site" : "rascunho (não aparece no site)") + "</b></p></div>" +

      '<div class="sticky-bar"><button class="btn gold" id="bPub">' + (pub ? "Salvar alterações" : "Publicar no site") + "</button>" +
      '<button class="btn" id="bDraft">' + (pub ? "Salvar e despublicar" : "Salvar rascunho") + '</button><button class="btn ghost" id="bPrev">Pré-visualizar</button>' +
      '<a class="btn ghost" href="#/imoveis">Cancelar</a><span class="hint" id="saveSt" style="align-self:center"></span></div>';

    renderFotos(); renderVideos();
    $("view").oninput = function () { F.sujo = true; };
    $("view").onchange = function () { F.sujo = true; };
    $("sug").onclick = function (e) {
      var b = e.target.closest("button[data-s]"); if (!b) return;
      var t = $("f_caracteristicas"), cur = linhas(t.value), s = b.getAttribute("data-s");
      if (cur.map(function (x) { return x.toLowerCase(); }).indexOf(s.toLowerCase()) < 0) { cur.push(s); t.value = cur.join("\n"); F.sujo = true; }
    };
    $("f_files").onchange = function () { addFotos(this.files); this.value = ""; };
    var drop = $("drop");
    ["dragenter", "dragover"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("over"); }); });
    ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("over"); }); });
    drop.addEventListener("drop", function (e) { if (e.dataTransfer && e.dataTransfer.files) addFotos(e.dataTransfer.files); });
    $("f_vids").onchange = function () { addVideos(this.files); this.value = ""; };
    $("bPub").onclick = function () { salvar(pub ? "manter" : "publicar"); };
    $("bDraft").onclick = function () { salvar("rascunho"); };
    $("bPrev").onclick = previsualizar;
  }

  function lerForm() {
    var g = function (i) { return $("f_" + i).value; };
    return {
      titulo: g("titulo"), subtitulo: g("subtitulo"), tipo: g("tipo"), finalidade: g("finalidade"), preco: g("preco"),
      cidade: g("cidade"), bairro: g("bairro"), localizacao: g("localizacao"), endereco: g("endereco"), exibir_endereco: $("f_exibir").checked,
      descricao: g("descricao"), quartos: g("quartos"), banheiros: g("banheiros"), vagas: g("vagas"),
      area_construida: g("area_construida"), area_terreno: g("area_terreno"), caracteristicas: g("caracteristicas"),
      situacao: g("situacao"), destaque: $("f_destaque").checked
    };
  }

  /* ----- fotos ----- */
  function loadImg(file) {
    return new Promise(function (res, rej) {
      var u = URL.createObjectURL(file), im = new Image();
      im.onload = function () { URL.revokeObjectURL(u); res(im); };
      im.onerror = function () { URL.revokeObjectURL(u); rej(new Error("Não foi possível ler a imagem " + file.name)); };
      im.src = u;
    });
  }
  function toBlob(im, max, q) {
    var w = im.naturalWidth, h = im.naturalHeight, s = Math.min(1, max / Math.max(w, h)), c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
    var x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height);
    return new Promise(function (res) { c.toBlob(res, "image/jpeg", q); });
  }
  async function addFotos(files) {
    files = Array.prototype.slice.call(files || []);
    if (!files.length) return;
    var st = $("saveSt"), ok = 0, falhas = [];
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (!/^image\//.test(f.type)) { falhas.push(f.name + " (não é imagem)"); continue; }
      if (f.size > 30 * 1024 * 1024) { falhas.push(f.name + " (maior que 30 MB)"); continue; }
      if (F.fotos.length >= 60) { falhas.push("limite de 60 fotos atingido"); break; }
      st.textContent = "Preparando foto " + (i + 1) + " de " + files.length + "…";
      try {
        var im = await loadImg(f), main = await toBlob(im, 1600, 0.82), th = await toBlob(im, 640, 0.78);
        if (!main || !th) throw new Error("falha ao reduzir " + f.name);
        F.fotos.push({ ex: false, main: main, th: th, preview: URL.createObjectURL(th), legenda: "" }); ok++;
      } catch (e) { falhas.push(f.name); }
    }
    st.textContent = "";
    if (ok) F.sujo = true;
    renderFotos();
    if (falhas.length) toast("Não foi possível usar: " + falhas.join(", "), true);
  }
  function fotoSrc(f) { return f.ex ? absUrl(f.thumb || f.url) : f.preview; }
  function renderFotos() {
    var g = $("phGrid"); if (!g) return;
    if (!F.fotos.length) { g.innerHTML = '<p class="hint" style="grid-column:1/-1">Nenhuma foto ainda. Adicione ao menos 1 para poder publicar.</p>'; return; }
    g.innerHTML = F.fotos.map(function (f, i) {
      return '<div class="ph-it" draggable="true" data-i="' + i + '"><img alt="Foto ' + (i + 1) + '" src="' + esc(fotoSrc(f)) + '" loading="lazy">' +
        (i === 0 ? '<span class="ph-main">Principal</span>' : "") + (f.ex ? "" : '<span class="ph-new">nova</span>') +
        '<div class="ph-bar"><button type="button" data-a="main" title="Definir como principal" aria-label="Definir como principal">★</button>' +
        '<button type="button" data-a="left" title="Mover para trás" aria-label="Mover para trás">◀</button>' +
        '<button type="button" data-a="right" title="Mover para frente" aria-label="Mover para frente">▶</button>' +
        '<button type="button" class="del" data-a="del" title="Excluir foto" aria-label="Excluir foto">✕</button></div>' +
        '<input data-a="cap" maxlength="80" placeholder="Legenda (ex.: Sala)" value="' + esc(f.legenda) + '"></div>';
    }).join("");
    g.onclick = function (e) {
      var b = e.target.closest("button[data-a]"); if (!b) return;
      var i = +b.closest(".ph-it").getAttribute("data-i"), a = b.getAttribute("data-a");
      if (a === "main" && i > 0) { F.fotos.unshift(F.fotos.splice(i, 1)[0]); }
      else if (a === "left" && i > 0) { F.fotos.splice(i - 1, 0, F.fotos.splice(i, 1)[0]); }
      else if (a === "right" && i < F.fotos.length - 1) { F.fotos.splice(i + 1, 0, F.fotos.splice(i, 1)[0]); }
      else if (a === "del") {
        var x = F.fotos.splice(i, 1)[0];
        if (x.ex) { if (x.path) F.remover.push(x.path); if (x.thumb_path) F.remover.push(x.thumb_path); } else if (x.preview) URL.revokeObjectURL(x.preview);
      } else return;
      F.sujo = true; renderFotos();
    };
    g.oninput = function (e) { if (e.target.getAttribute("data-a") === "cap") F.fotos[+e.target.closest(".ph-it").getAttribute("data-i")].legenda = e.target.value; };
    var drag = -1;
    g.ondragstart = function (e) { var it = e.target.closest(".ph-it"); if (!it) return; drag = +it.getAttribute("data-i"); it.classList.add("dragging"); try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(drag)); } catch (x) { } };
    g.ondragend = function () { drag = -1; renderFotos(); };
    g.ondragover = function (e) { if (drag < 0) return; e.preventDefault(); var it = e.target.closest(".ph-it"); Array.prototype.forEach.call(g.children, function (c) { c.classList.toggle("target", c === it); }); };
    g.ondrop = function (e) {
      if (drag < 0) return; e.preventDefault();
      var it = e.target.closest(".ph-it"); if (!it) return;
      var to = +it.getAttribute("data-i"); if (to !== drag) { F.fotos.splice(to, 0, F.fotos.splice(drag, 1)[0]); F.sujo = true; }
      drag = -1; renderFotos();
    };
  }

  /* ----- vídeos ----- */
  function addVideos(files) {
    files = Array.prototype.slice.call(files || []);
    files.forEach(function (f) {
      if (!/^video\//.test(f.type)) return toast(f.name + ": não é um vídeo.", true);
      if (f.size > 50 * 1024 * 1024) return toast(f.name + ": maior que 50 MB. Reduza o vídeo antes de enviar.", true);
      if (F.videos.length >= 20) return toast("Limite de 20 vídeos.", true);
      F.videos.push({ ex: false, file: f, titulo: f.name.replace(/\.[^.]+$/, "") }); F.sujo = true;
    });
    renderVideos();
  }
  function renderVideos() {
    var el = $("vidList"); if (!el) return;
    el.innerHTML = F.videos.length ? F.videos.map(function (v, i) {
      return '<div class="vid-it"><span>🎬 ' + esc(v.titulo || "Vídeo") + (v.ex ? "" : " (novo)") + '</span><input data-i="' + i + '" style="max-width:220px" maxlength="80" placeholder="Título do vídeo" value="' + esc(v.titulo) + '"><button type="button" class="btn sm danger" data-d="' + i + '">Excluir</button></div>';
    }).join("") : '<p class="hint">Nenhum vídeo.</p>';
    el.oninput = function (e) { var i = e.target.getAttribute("data-i"); if (i !== null) F.videos[+i].titulo = e.target.value; };
    el.onclick = function (e) {
      var b = e.target.closest("button[data-d]"); if (!b) return;
      var x = F.videos.splice(+b.getAttribute("data-d"), 1)[0];
      if (x.ex && x.path) F.remover.push(x.path);
      F.sujo = true; renderVideos();
    };
  }

  /* ----- pré-visualização ----- */
  function previsualizar() {
    var v = lerForm(), b = buildPayload(v, F.row), p = b.payload;
    var linha = T.rowToProp({ slug: "previa", titulo: p.titulo || "(sem título)", tipo: p.tipo, finalidade: p.finalidade, preco: p.preco, cidade: p.cidade, bairro: p.bairro, localizacao: p.localizacao,
      endereco_publico: p.exibir_endereco ? p.endereco : "", descricao: p.descricao, caracteristicas: p.caracteristicas, resumo_meta: p.resumo_meta, fatos: p.fatos, secoes: p.secoes, subtitulo: p.subtitulo,
      situacao: p.situacao, destaque: p.destaque, quartos: p.quartos, banheiros: p.banheiros, vagas: p.vagas, area_construida: p.area_construida, area_terreno: p.area_terreno, fotos: [], videos: [] });
    var fotos = F.fotos.map(function (f) { return { u: fotoSrc(f), l: f.legenda }; });
    var capa = fotos[0] ? fotos[0].u : "";
    var rib = p.situacao !== "disponivel" ? '<span class="rib ' + (p.situacao === "alugado" ? "al" : "vd") + '">' + (p.situacao === "alugado" ? "Alugado" : "Vendido") + "</span> " : "";
    openModal('<div class="modal-head"><h2>Pré-visualização</h2><button class="btn sm ghost" id="pvX">Fechar</button></div>' +
      '<p class="hint">É assim que o anúncio aparece no site (o layout real usa as cores e fontes do site).</p>' +
      (b.erros.length ? '<div class="msg err">' + b.erros.map(esc).join("<br>") + "</div>" : "") +
      '<div class="pv-card"><div class="pv-ph" style="' + (capa ? "background-image:url('" + esc(capa) + "')" : "") + '"></div><div class="pv-b"><span class="sub">' + esc(linha.tipo) + " · " + esc(linha.fin) + "</span><h3>" + esc(linha.t) + '</h3><span class="sub">' + esc(linha.loc) + '</span><span class="sub">' + esc(linha.meta) + '</span><b class="gold" style="font-size:1.4rem;font-family:Georgia,serif">' + esc(brl(linha.p)) + (linha.fin === "Aluguel" && linha.p ? " /mês" : "") + "</b></div></div>" +
      '<h3 style="color:var(--g2)">' + rib + esc(linha.t) + "</h3><p class=\"sub\">" + esc(linha.loc) + (linha.end ? " · " + esc(linha.end) : "") + "</p>" +
      (linha.sub ? "<p>" + esc(linha.sub) + "</p>" : "") +
      '<div class="pv-facts">' + linha.facts.map(function (f) { return "<div><small>" + esc(f[0]) + "</small>" + esc(f[1]) + "</div>"; }).join("") + "</div>" +
      (linha.desc ? '<p style="color:var(--mut);white-space:pre-line">' + esc(linha.desc) + "</p>" : "") +
      linha.secs.map(function (s) { return '<h3 style="color:var(--g2)">' + esc(s[0]) + '</h3><ul style="color:var(--mut)">' + s[1].map(function (i) { return "<li>" + esc(i) + "</li>"; }).join("") + "</ul>"; }).join("") +
      '<div class="pv-gal">' + fotos.map(function (f) { return '<img alt="' + esc(f.l) + '" src="' + esc(f.u) + '">'; }).join("") + "</div>" +
      (F.videos.length ? '<p class="hint">' + F.videos.length + " vídeo(s) serão exibidos na página do imóvel.</p>" : ""));
    $("pvX").onclick = closeModal;
  }

  /* ----- salvar ----- */
  async function enviar(path, blob, tipo, subidos) {
    var r = await sb.storage.from(BUCKET).upload(path, blob, { contentType: tipo, cacheControl: "31536000", upsert: false });
    if (r.error) throw r.error;
    subidos.push(path);
    return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }
  function ocupado(on, txt) {
    ["bPub", "bDraft", "bPrev"].forEach(function (i) { var b = $(i); if (b) b.disabled = on; });
    var s = $("saveSt"); if (s) s.textContent = txt || "";
  }
  async function salvar(modo) {
    var v = lerForm(), b = buildPayload(v, F.row), p = b.payload, er = b.erros.slice();
    var publicar = modo === "publicar" || modo === "manter";
    if (publicar && !F.fotos.length) er.push("Para publicar, adicione ao menos 1 foto.");
    if (er.length) { toast(er.join(" "), true); return; }
    ocupado(true, "Salvando…");
    var subidos = [];
    try {
      var fotos = [], videos = [], n = 0, tot = F.fotos.filter(function (f) { return !f.ex; }).length + F.videos.filter(function (x) { return !x.ex; }).length;
      for (var i = 0; i < F.fotos.length; i++) {
        var f = F.fotos[i];
        if (f.ex) { fotos.push({ url: f.url, thumb: f.thumb || null, path: f.path || null, thumb_path: f.thumb_path || null, legenda: (f.legenda || "").trim() }); continue; }
        ocupado(true, "Enviando arquivo " + (++n) + " de " + tot + "…");
        var k = rand(), pm = F.id + "/" + k + ".jpg", pt = F.id + "/" + k + "_t.jpg";
        var um = await enviar(pm, f.main, "image/jpeg", subidos), ut = await enviar(pt, f.th, "image/jpeg", subidos);
        fotos.push({ url: um, thumb: ut, path: pm, thumb_path: pt, legenda: (f.legenda || "").trim() });
      }
      for (var j = 0; j < F.videos.length; j++) {
        var vd = F.videos[j];
        if (vd.ex) { videos.push({ url: vd.url, path: vd.path || null, titulo: (vd.titulo || "").trim() }); continue; }
        ocupado(true, "Enviando arquivo " + (++n) + " de " + tot + " (vídeo, pode demorar)…");
        var ext = (/webm/.test(vd.file.type) ? "webm" : /quicktime/.test(vd.file.type) ? "mov" : "mp4"), pv = F.id + "/v_" + rand() + "." + ext;
        var uv = await enviar(pv, vd.file, vd.file.type || "video/mp4", subidos);
        videos.push({ url: uv, path: pv, titulo: (vd.titulo || "").trim() });
      }
      p.fotos = fotos; p.videos = videos;
      p.publicado = modo === "rascunho" ? false : true;
      ocupado(true, "Gravando dados…");
      var res;
      if (F.isNew) {
        p.id = F.id; p.slug = slugify(p.titulo);
        res = await sb.from("imoveis").insert(p).select("*").single();
        if (res.error && res.error.code === "23505") { p.slug = p.slug.slice(0, 70) + "-" + rand().slice(0, 4); res = await sb.from("imoveis").insert(p).select("*").single(); }
      } else {
        res = await sb.from("imoveis").update(p).eq("id", F.id).select("*").single();
      }
      if (res.error) throw res.error;
      await removerArquivos(F.remover);
      var novo = res.data, idx = -1;
      S.items.forEach(function (x, ix) { if (x.id === novo.id) idx = ix; });
      if (idx >= 0) S.items[idx] = novo; else S.items.unshift(novo);
      F.sujo = false; F.saindo = true;
      toast(modo === "rascunho" ? "Rascunho salvo." : (F.isNew || modo === "publicar" ? "Imóvel publicado no site." : "Alterações salvas."));
      location.hash = "#/imoveis";
    } catch (e) {
      if (subidos.length) removerArquivos(subidos);
      ocupado(false, "");
      toast("Não foi possível salvar: " + errMsg(e), true);
    }
  }

  window.addEventListener("beforeunload", function (e) { if (F && F.sujo) { e.preventDefault(); e.returnValue = ""; } });
  init();
})();
