#!/usr/bin/env python3
"""Gera _supabase/03_importar_imoveis_atuais.sql a partir da lista de imóveis (PROPS)
que está embutida no index.html. Rode na raiz do site:  python3 _tools/gerar_importacao.py
O SQL gerado só INSERE (on conflict do nothing): nunca apaga nem sobrescreve nada."""
import json, re, sys, os
raiz = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(raiz, 'index.html')
s = open(src, encoding='utf-8').read()
i = s.index('var PROPS='); j = s.index('\n', i)
P = json.loads(s[i+10:j].rstrip(';'))

def derivar(loc):
    l = loc or ''
    cidade = 'Formiga'
    if re.search(r'pains', l, re.I): cidade = 'Pains'
    elif re.search(r'pedra do indai', l, re.I): cidade = 'Pedra do Indaiá'
    segs = [x.strip() for x in re.split(r'\s·\s|,|/', l) if x.strip()]
    bairro = ''
    for x in segs:
        if re.match(r'^(rua|av\.?|avenida)\s', x, re.I): continue
        if re.match(r'^a\s+\d+\s*km', x, re.I): continue
        if re.match(r'^regi[aã]o\s', x, re.I): continue
        if re.match(r'^(a\s+)?\d+\s*(min|minutos)', x, re.I): continue
        if re.match(r'^(menos de|pr[oó]ximo|atr[aá]s|ao lado|entre|banhada|fundos|final)', x, re.I): continue
        bairro = x; break
    bairro = re.sub(r'^bairro\s+', '', bairro, flags=re.I)
    bairro = re.sub(r'\s*\([^)]*\)', '', bairro)
    bairro = re.sub(r'\s*-\s*[A-Z]{2}$', '', bairro)
    bairro = re.sub(r'\s+de\s+Formiga.*$', '', bairro, flags=re.I)
    bairro = re.sub(r'\s+', ' ', bairro).strip()
    if re.match(r'^formiga$', bairro, re.I): bairro = ''
    return cidade, bairro

def q(t):
    if t is None or t == '': return 'null'
    t = str(t)
    assert '$q$' not in t
    return '$q$' + t + '$q$'
def j_(o):
    t = json.dumps(o, ensure_ascii=False)
    assert '$j$' not in t
    return '$j$' + t + '$j$::jsonb'

out = ['-- =====================================================================',
 '-- Tiago Fernandes | Corretor de Imóveis',
 '-- 03 - Importar os %d imóveis que já estão no site para o painel' % len(P),
 '--',
 '-- Rode DEPOIS do 01 e do 02. Só INSERE (on conflict do nothing): pode rodar',
 '-- de novo sem duplicar e nunca altera o que você já editou no painel.',
 '-- As fotos continuam nas pastas img/ e th/ do site (endereços relativos).',
 '-- Ao final, marca "legado_importado": o site passa a usar só o banco.',
 '-- =====================================================================', '']
for n, p in enumerate(P, 1):
    cidade, bairro = derivar(p['loc'])
    fotos = []
    for cap, url in p['fotos']:
        fotos.append({'url': url, 'thumb': url.replace('img/', 'th/', 1), 'legenda': cap})
    preco = p['p'] if p.get('p') else None
    out.append('insert into public.imoveis (codigo, slug, titulo, subtitulo, tipo, finalidade, preco, cidade, bairro, localizacao, descricao, resumo_meta, fatos, secoes, fotos, videos, publicado, situacao, destaque, origem)')
    out.append('values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, true, \'disponivel\', false, \'importado\')' % (
        q('TF%03d' % n), q(p['slug']), q(p['t']), q(p.get('sub')), q(p['tipo']), q(p.get('fin') or 'Venda'),
        ('%s' % preco) if preco else 'null', q(cidade), q(bairro), q(p['loc']), q(p.get('desc')), q(p.get('meta')),
        j_(p.get('facts') or []), j_(p.get('secs') or []), j_(fotos), "'[]'::jsonb"))
    out.append('on conflict (slug) do nothing;')
    out.append('')
out += ["-- continua a numeração dos códigos a partir do maior já usado",
 "select setval('public.imoveis_codigo_seq', greatest((select coalesce(max(substring(codigo from 3)::int), 0) from public.imoveis where codigo ~ '^TF[0-9]+$') + 1, 104), false);",
 '',
 "-- a partir daqui o banco é a fonte dos imóveis; o site esconde os embutidos",
 "insert into public.configuracoes (chave, valor) values ('legado_importado', 'true'::jsonb)",
 "on conflict (chave) do update set valor = 'true'::jsonb, atualizado_em = now();", '',
 "select count(*) as imoveis_no_banco from public.imoveis;", '']
dest = os.path.join(raiz, '_supabase', '03_importar_imoveis_atuais.sql')
open(dest, 'w', encoding='utf-8').write('\n'.join(out))
print('gerado', dest, len(P), 'imóveis')
