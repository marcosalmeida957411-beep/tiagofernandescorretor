/* =====================================================================
   Tiago Fernandes | Corretor de Imóveis
   Integração do site público com o Supabase (SOMENTE LEITURA).
   Usa apenas a chave anon e as regras RLS do banco. Sem bibliotecas.
   Também é usado pelo painel (/admin) para montar a pré-visualização.
   ===================================================================== */
(function (root) {
  "use strict";
  var CFG = root.TF_CONFIG || {};

  var COLS = "id,codigo,slug,titulo,subtitulo,tipo,finalidade,preco,cidade,bairro,localizacao," +
    "endereco_publico,descricao,quartos,banheiros,vagas,area_construida,area_terreno," +
    "caracteristicas,resumo_meta,fatos,secoes,fotos,videos,publicado,situacao,destaque,origem,atualizado_em";

  /* ---------- segurança da chave ---------- */
  function jwtRole(k) {
    try {
      var p = String(k).split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      while (p.length % 4) p += "=";
      var txt = typeof atob === "function" ? atob(p) : Buffer.from(p, "base64").toString("binary");
      return JSON.parse(txt).role || "";
    } catch (e) { return ""; }
  }
  function chaveInsegura(k) {
    return jwtRole(k) === "service_role" || /^sb_secret_/i.test(String(k || ""));
  }
  function configurado() { return !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY); }

  /* ---------- utilidades ---------- */
  // Aceita só https ou caminho relativo; troca caracteres que quebram atributos/CSS.
  function safeUrl(u) {
    u = String(u == null ? "" : u).trim();
    if (!u) return "";
    var temEsquema = /^[a-z][a-z0-9+.\-]*:/i.test(u);
    if (temEsquema && !/^https:\/\//i.test(u)) return "";
    return u.replace(/[\s"'()<>\\]/g, function (c) {
      return "%" + ("0" + c.charCodeAt(0).toString(16).toUpperCase()).slice(-2);
    });
  }
  function slugSeguro(s) {
    return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "");
  }
  function fmtNum(n) {
    var v = Number(n);
    if (!isFinite(v)) return "";
    return v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  }
  function ehNum(n) { return n !== null && n !== undefined && n !== "" && isFinite(Number(n)) && Number(n) > 0; }
  function plural(n, s, p) { return n + " " + (Number(n) === 1 ? s : p); }

  /* ---------- linha curta (card) e destaques (ficha) ---------- */
  function buildMeta(r) {
    var m = [];
    if (ehNum(r.quartos)) m.push(plural(r.quartos, "quarto", "quartos"));
    if (ehNum(r.banheiros)) m.push(plural(r.banheiros, "banheiro", "banheiros"));
    if (ehNum(r.vagas)) m.push(plural(r.vagas, "vaga", "vagas"));
    if (ehNum(r.area_construida)) m.push(fmtNum(r.area_construida) + " m² construídos");
    if (ehNum(r.area_terreno)) m.push(fmtNum(r.area_terreno) + " m² de terreno");
    return m.join(" · ");
  }
  function buildFacts(r) {
    var f = [];
    if (ehNum(r.quartos)) f.push(["Quartos", String(r.quartos)]);
    if (ehNum(r.banheiros)) f.push(["Banheiros", String(r.banheiros)]);
    if (ehNum(r.vagas)) f.push(["Garagem", plural(r.vagas, "vaga", "vagas")]);
    if (ehNum(r.area_construida)) f.push(["Área construída", fmtNum(r.area_construida) + " m²"]);
    if (ehNum(r.area_terreno)) f.push(["Terreno", fmtNum(r.area_terreno) + " m²"]);
    return f;
  }
  function validFacts(v) {
    var o = [];
    if (Array.isArray(v)) v.forEach(function (a) { if (Array.isArray(a) && a.length >= 2) o.push([String(a[0]), String(a[1])]); });
    return o;
  }
  function validSecs(v) {
    var o = [];
    if (Array.isArray(v)) v.forEach(function (s) {
      if (Array.isArray(s) && s.length >= 2 && Array.isArray(s[1])) o.push([String(s[0]), s[1].map(String)]);
    });
    return o;
  }

  /* ---------- cidade/bairro a partir do texto livre dos anúncios antigos ---------- */
  function derivarLocal(loc) {
    var l = String(loc || ""), cidade = "Formiga";
    if (/pains/i.test(l)) cidade = "Pains";
    else if (/pedra do indai/i.test(l)) cidade = "Pedra do Indaiá";
    var segs = l.split(/\s·\s|,|\//).map(function (s) { return s.trim(); }).filter(Boolean);
    var bairro = "";
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (/^(rua|av\.?|avenida)\s/i.test(s)) continue;
      if (/^a\s+\d+\s*km/i.test(s)) continue;
      if (/^regi[aã]o\s/i.test(s)) continue;
      if (/^(a\s+)?\d+\s*(min|minutos)/i.test(s)) continue;
      if (/^(menos de|pr[oó]ximo|atr[aá]s|ao lado|entre|banhada|fundos|final)/i.test(s)) continue;
      bairro = s; break;
    }
    bairro = bairro.replace(/^bairro\s+/i, "").replace(/\s*\([^)]*\)/g, "")
      .replace(/\s*-\s*[A-Z]{2}$/, "").replace(/\s+de\s+Formiga.*$/i, "").replace(/\s+/g, " ").trim();
    if (/^formiga$/i.test(bairro)) bairro = "";
    return { cidade: cidade, bairro: bairro };
  }

  /* ---------- linha do banco -> objeto no formato do site (PROPS) ---------- */
  function rowToProp(r) {
    var fotos = [];
    (Array.isArray(r.fotos) ? r.fotos : []).forEach(function (f) {
      if (!f || !f.url) return;
      var u = safeUrl(f.url);
      if (u) fotos.push([String(f.legenda || ""), u, safeUrl(f.thumb || "")]);
    });
    if (!fotos.length) fotos.push(["Sem foto", "img/estatico-03.jpg", ""]);

    var videos = [];
    (Array.isArray(r.videos) ? r.videos : []).forEach(function (v) {
      if (!v || !v.url) return;
      var u = safeUrl(v.url);
      if (u) videos.push({ url: u, titulo: String(v.titulo || "") });
    });

    var carac = Array.isArray(r.caracteristicas) ? r.caracteristicas.map(String).filter(Boolean) : [];
    var secs = validSecs(r.secoes);
    if (!secs.length && carac.length) secs = [["Características e diferenciais", carac]];
    var facts = validFacts(r.fatos);
    if (!facts.length) facts = buildFacts(r);

    var loc = r.localizacao || [r.bairro, r.cidade].filter(Boolean).join(", ");
    var sit = r.situacao === "vendido" || r.situacao === "alugado" ? r.situacao : "disponivel";

    return {
      slug: slugSeguro(r.slug), id: r.id, cod: r.codigo || "",
      t: String(r.titulo || ""), tipo: String(r.tipo || ""), fin: r.finalidade === "Aluguel" ? "Aluguel" : "Venda",
      loc: loc, sub: String(r.subtitulo || ""), p: Number(r.preco) || 0,
      meta: r.resumo_meta || buildMeta(r), facts: facts, desc: String(r.descricao || ""),
      secs: secs, fotos: fotos, videos: videos, end: String(r.endereco_publico || ""),
      sit: sit, destaque: !!r.destaque, cidade: String(r.cidade || ""), bairro: String(r.bairro || ""),
      _db: true
    };
  }

  /* ---------- leitura pública (chave anon + RLS) ---------- */
  function get(path) {
    var base = String(CFG.SUPABASE_URL).replace(/\/+$/, "");
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var t = ctrl ? setTimeout(function () { ctrl.abort(); }, 10000) : null;
    return fetch(base + "/rest/v1/" + path, {
      headers: { apikey: CFG.SUPABASE_ANON_KEY, Authorization: "Bearer " + CFG.SUPABASE_ANON_KEY },
      cache: "no-store", signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      if (t) clearTimeout(t);
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }, function (e) { if (t) clearTimeout(t); throw e; });
  }

  function carregar() {
    if (!configurado()) return Promise.reject(new Error("nao-configurado"));
    if (chaveInsegura(CFG.SUPABASE_ANON_KEY)) return Promise.reject(new Error("chave-insegura"));
    return Promise.all([
      get("imoveis?select=" + COLS + "&publicado=eq.true&order=atualizado_em.desc&limit=1000"),
      get("configuracoes?select=chave,valor&chave=eq.legado_importado").catch(function () { return []; })
    ]).then(function (a) {
      var legado = false;
      (a[1] || []).forEach(function (c) { if (c && c.chave === "legado_importado") legado = c.valor === true; });
      var itens = (a[0] || []).map(rowToProp).filter(function (x) { return x.slug && x.t; });
      return { itens: itens, legadoImportado: legado };
    });
  }

  var api = {
    configurado: configurado, chaveInsegura: chaveInsegura, jwtRole: jwtRole, carregar: carregar,
    rowToProp: rowToProp, buildMeta: buildMeta, buildFacts: buildFacts, derivarLocal: derivarLocal,
    safeUrl: safeUrl, slugSeguro: slugSeguro, fmtNum: fmtNum, COLS: COLS
  };
  root.TFDB = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
