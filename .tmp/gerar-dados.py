"""Gera dados.js (fonte de verdade publicável) a partir do RAW em script.js."""
import ast
import json
import re

src = open('script.js', encoding='utf-8').read()
bloco = src.split('const RAW = [', 1)[1].split('\n];', 1)[0]


def para_python(linha):
    """Converte literais do JavaScript (false/true/null) para o Python."""
    linha = re.sub(r'\bfalse\b', 'False', linha)
    linha = re.sub(r'\btrue\b', 'True', linha)
    return re.sub(r'\bnull\b', 'None', linha)


def tamanhos(spec):
    if spec == 'm':
        return [
            {"rotulo": "400 g", "preco": 23.0},
            {"rotulo": "600 g", "preco": 26.0},
        ]
    if isinstance(spec, list):
        return [{"rotulo": rotulo, "preco": float(preco)} for rotulo, preco in spec]
    return [{"rotulo": "porção", "preco": float(spec)}]


pratos = []
for linha in bloco.splitlines():
    linha = linha.strip().rstrip(',')
    if not linha.startswith('['):
        continue
    row = ast.literal_eval(para_python(linha))
    numero = len(pratos) + 1
    pratos.append({
        "id": "p%d" % numero,
        "nome": row[0],
        "categoria": row[1],
        "descricao": row[2],
        "kcal": row[3],
        "semLactose": bool(row[4]),
        "foto": "",
        "ativo": True,
        "tamanhos": tamanhos(row[5]),
    })

combos = [
    {"id": "c15", "nome": "15 marmitas", "quantidade": 15, "destaque": False, "ativo": True,
     "opcoes": [{"rotulo": "400 g", "preco": 345.0, "unitario": 23.0},
                {"rotulo": "600 g", "preco": 390.0, "unitario": 26.0}]},
    {"id": "c25", "nome": "25 marmitas", "quantidade": 25, "destaque": True, "ativo": True,
     "opcoes": [{"rotulo": "400 g", "preco": 562.5, "unitario": 22.5},
                {"rotulo": "600 g", "preco": 637.5, "unitario": 25.5}]},
    {"id": "c35", "nome": "35 marmitas", "quantidade": 35, "destaque": False, "ativo": True,
     "opcoes": [{"rotulo": "400 g", "preco": 770.0, "unitario": 22.0},
                {"rotulo": "600 g", "preco": 875.0, "unitario": 25.0}]},
    {"id": "c45", "nome": "45 marmitas", "quantidade": 45, "destaque": False, "ativo": True,
     "opcoes": [{"rotulo": "400 g", "preco": 967.5, "unitario": 21.5},
                {"rotulo": "600 g", "preco": 1102.5, "unitario": 24.5}]},
]

dados = {
    "versao": 2,
    "atualizadoEm": "",
    "loja": {
        "nome": "Marmitas POA",
        "slogan": "comida de verdade",
        "whatsapp": "5551993560070",
        "whatsappExibicao": "(51) 99356-0070",
        "instagram": "marmitaspoa",
        "moeda": "BRL",
        "fotoPadrao": "img/marmita-padrao.jpg",
        "fotoPadraoThumb": "img/marmita-padrao-thumb.jpg",
        "taxaEntrega": 0.0,
        "freteGratisAcima": 0.0,
        "pedidoMinimo": 0.0,
        "horarios": "Combine o horário da entrega pelo WhatsApp",
        "aviso": "",
    },
    "categorias": ["Tradicional", "Primavera / verão", "Light", "Vegetariano", "Lasanhas", "Porções"],
    "pratos": pratos,
    "combos": combos,
    "cupons": [
        {"id": "cupom-exemplo", "codigo": "BEMVINDO", "tipo": "percentual", "valor": 10.0,
         "minimo": 100.0, "ativo": False, "inicio": "", "fim": "", "usoMaximo": 0,
         "descricao": "10% no primeiro pedido acima de R$ 100"}
    ],
    "promocoes": [
        {"id": "promo-exemplo", "nome": "Semana da marmita", "tipo": "desconto_categoria",
         "categoria": "Tradicional", "valor": 5.0, "minimo": 0.0, "ativo": False,
         "descricao": "5% de desconto nas marmitas tradicionais"}
    ],
}

cabecalho = (
    "/* ------------------------------------------------------------------------\n"
    "   dados.js — fonte de verdade do cardápio, combos, cupons e configurações.\n"
    "   Gerado/atualizado pelo painel admin (admin.html).\n"
    "   Para publicar alterações: abra o admin > aba Publicar > baixar este arquivo\n"
    "   e substituir o que está aqui.\n"
    "   ------------------------------------------------------------------------ */\n"
)

with open('dados.js', 'w', encoding='utf-8') as arquivo:
    arquivo.write(cabecalho)
    arquivo.write('window.DADOS = ')
    arquivo.write(json.dumps(dados, ensure_ascii=False, indent=2))
    arquivo.write(';\n')

print('pratos:', len(pratos), 'combos:', len(combos))
