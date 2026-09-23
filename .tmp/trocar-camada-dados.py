"""Troca a camada de dados do script.js: remove o cardápio embutido (RAW) e
passa a ler tudo de dados.js (window.DADOS) + rascunho do painel admin.

Roda a partir da raiz do projeto: python3 .tmp/trocar-camada-dados.py
"""

NOVO = '''const STORAGE = {
  cart: "marmitaspoa.cart.v2",
  form: "marmitaspoa.form.v2",
  last: "marmitaspoa.last.v2",
  cupom: "marmitaspoa.cupom.v1",
  draft: "marmitaspoa.draft.v1",
};
const PAGE_SIZE = 12;

/* ------------------------------------------------------------------- dados */
// O conteúdo publicado vem de dados.js (window.DADOS), arquivo gerado pelo
// painel admin. Um rascunho salvo neste navegador tem prioridade, para o
// responsável conseguir pré-visualizar antes de publicar para os clientes.
const DADOS_VAZIOS = { loja: {}, categorias: [], pratos: [], combos: [], cupons: [], promocoes: [] };
const PUBLICADO = window.DADOS || null;
const RASCUNHO = store(STORAGE.draft);
const USANDO_RASCUNHO = Boolean(RASCUNHO && Array.isArray(RASCUNHO.pratos));
const DADOS = USANDO_RASCUNHO ? RASCUNHO : PUBLICADO || DADOS_VAZIOS;
const SEM_DADOS = !PUBLICADO && !USANDO_RASCUNHO;

const LOJA = DADOS.loja || {};
const WHATSAPP_NUMBER = String(LOJA.whatsapp || "5551993560070");
const INSTAGRAM = String(LOJA.instagram || "");
const TAXA_ENTREGA = Number(LOJA.taxaEntrega) || 0;
const FRETE_GRATIS_ACIMA = Number(LOJA.freteGratisAcima) || 0;
const PEDIDO_MINIMO = Number(LOJA.pedidoMinimo) || 0;
const CUPONS = DADOS.cupons || [];
const PROMOCOES = DADOS.promocoes || [];

const PHOTO = {
  thumb: LOJA.fotoPadraoThumb || "img/marmita-padrao-thumb.jpg",
  full: LOJA.fotoPadrao || "img/marmita-padrao.jpg",
};

// Cor de fundo do cartão enquanto a foto carrega. Categorias novas criadas no
// admin caem na cor padrão.
const PALETA = {
  "Tradicional": "#f1e3cd",
  "Primavera / verão": "#e8e7d2",
  "Light": "#e3ecdc",
  "Vegetariano": "#e7ead6",
  "Lasanhas": "#f2ded0",
  "Porções": "#efe6d4",
};
const PALETA_PADRAO = "#efe6d4";
const paletaDe = (categoria) => PALETA[categoria] || PALETA_PADRAO;

const paraPreco = (valor) => {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : 0;
};

// Aceita os formatos do admin: array de {rotulo, preco} ou preço único.
function tamanhosDe(tamanhos) {
  const lista = Array.isArray(tamanhos) && tamanhos.length ? tamanhos : [{ rotulo: "porção", preco: 0 }];
  return lista.map((tamanho) => ({
    label: String(tamanho.rotulo || "porção"),
    price: paraPreco(tamanho.preco),
    unit: tamanho.unitario === undefined ? null : paraPreco(tamanho.unitario),
  }));
}

const PRODUCTS = (DADOS.pratos || [])
  .filter((prato) => prato.ativo !== false)
  .map((prato) => ({
    id: String(prato.id),
    name: prato.nome || "Sem nome",
    category: prato.categoria || "Outros",
    description: prato.descricao || "",
    calories: prato.kcal === undefined || prato.kcal === null || prato.kcal === "" ? null : Number(prato.kcal),
    lactoseFree: Boolean(prato.semLactose),
    photo: prato.foto || null,
    options: tamanhosDe(prato.tamanhos),
    isCombo: false,
  }));

const COMBOS = (DADOS.combos || [])
  .filter((combo) => combo.ativo !== false)
  .map((combo) => {
    const quantidade = Number(combo.quantidade) || 0;
    return {
      id: String(combo.id),
      name: combo.nome || "Combo",
      category: "Combos",
      description: quantidade ? `${quantidade} marmitas` : "",
      calories: null,
      lactoseFree: false,
      photo: combo.foto || null,
      qty: quantidade,
      featured: Boolean(combo.destaque),
      isCombo: true,
      options: tamanhosDe(combo.opcoes).map((opcao) => ({
        ...opcao,
        unit: opcao.unit === null ? (quantidade ? opcao.price / quantidade : opcao.price) : opcao.unit,
      })),
    };
  });

const CATALOG = new Map([...PRODUCTS, ...COMBOS].map((item) => [item.id, item]));

const CATEGORIAS = DADOS.categorias && DADOS.categorias.length
  ? DADOS.categorias
  : [...new Set(PRODUCTS.map((produto) => produto.category))];

const FILTERS = [{ key: "Todos", label: "Todos" }].concat(
  CATEGORIAS.map((categoria) => ({ key: categoria, label: categoria }))
);

const ehCombo = (item) => Boolean(item && item.isCombo);
'''

caminho = 'script.js'
codigo = open(caminho, encoding='utf-8').read()

inicio = codigo.index('const WHATSAPP_NUMBER')
marcador = codigo.index('const CATEGORY_KEY')
fim = codigo.index('\n', marcador) + 1

open(caminho, 'w', encoding='utf-8').write(codigo[:inicio] + NOVO + codigo[fim:])
print('camada de dados trocada; linhas antes:', codigo.count('\n') + 1)
