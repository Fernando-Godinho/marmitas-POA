/* ==========================================================================
   Marmitas POA — automações do site
   - Catálogo com filtros combinados (categoria, sem lactose, busca, ordenação)
   - Seletor de tamanho recalculando preço unitário e subtotal
   - Montador de combos com cálculo de economia
   - Carrinho persistente (localStorage) com steppers
   - Checkout validado gerando mensagem estruturada no WhatsApp
   ========================================================================== */

const STORAGE = {
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

const LOGO = {
  full: LOJA.logo || "",
  thumb: LOJA.logoThumb || LOJA.logo || "",
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

// Tudo que vem do dados.js entra na página por innerHTML. Sem escapar, um nome
// de prato com <img onerror=...> viraria código rodando no navegador do cliente.
const esc = (valor) =>
  String(valor ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

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
    photoThumb: prato.fotoThumb || null,
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
      photoThumb: combo.fotoThumb || null,
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

/* ------------------------------------------------------------- utilitários */
const brl = (value) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const normalize = (text) =>
  text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const $ = (selector) => document.querySelector(selector);

function store(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key) || "null");
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    /* modo privado ou storage indisponível: segue sem persistir */
  }
  return null;
}

function toast(message) {
  const container = $("#toasts");
  if (!container) return;
  // Cliques repetidos no mesmo limite geram o mesmo aviso: não empilha igual.
  if (container.lastElementChild && container.lastElementChild.textContent === message) return;
  const element = document.createElement("div");
  element.className = "toast";
  element.textContent = message;
  container.append(element);
  setTimeout(() => {
    element.classList.add("is-out");
    element.addEventListener("animationend", () => element.remove(), { once: true });
  }, 2400);
}

/* ------------------------------------------------------------------ estado */
const params = new URLSearchParams(location.search);

const state = {
  category: FILTERS.some((filter) => filter.key === params.get("categoria")) ? params.get("categoria") : "Todos",
  lactoseOnly: params.get("semlactose") === "1",
  term: "",
  sort: "padrao",
  shown: PAGE_SIZE,
  chosen: new Map(), // id -> rótulo do tamanho selecionado
  cart: [], // { id, option, qty }
  cupom: store(STORAGE.cupom) || "",
};

const allOptions = () => [...PRODUCTS, ...COMBOS];

function getChosen(item) {
  if (!state.chosen.has(item.id)) state.chosen.set(item.id, item.options[0].label);
  return state.chosen.get(item.id);
}

function optionOf(item, label) {
  return item.options.find((option) => option.label === label) || item.options[0];
}

/* --------------------------------------------------------------- catálogo */
function matchesFilters(product) {
  if (state.category !== "Todos" && product.category !== state.category) return false;
  if (state.lactoseOnly && !product.lactoseFree) return false;
  if (!state.term) return true;
  const haystack = normalize(`${product.name} ${product.description} ${product.category}`);
  return haystack.includes(state.term);
}

function sortProducts(list) {
  const sorted = [...list];
  if (state.sort === "preco-asc") sorted.sort((a, b) => a.options[0].price - b.options[0].price);
  if (state.sort === "preco-desc") sorted.sort((a, b) => b.options[0].price - a.options[0].price);
  if (state.sort === "kcal-asc") sorted.sort((a, b) => (a.calories || 9999) - (b.calories || 9999));
  if (state.sort === "nome") sorted.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return sorted;
}

function renderFilters() {
  const counts = new Map();
  PRODUCTS.forEach((product) => {
    counts.set(product.category, (counts.get(product.category) || 0) + 1);
  });

  $("#filters").innerHTML = FILTERS.map((filter) => {
    const total = filter.key === "Todos" ? PRODUCTS.length : counts.get(filter.key) || 0;
    const active = filter.key === state.category ? " is-active" : "";
    return `<button type="button" class="filter-chip${active}" data-category="${esc(filter.key)}" aria-pressed="${
      filter.key === state.category
    }">${esc(filter.label)} <b>${total}</b></button>`;
  }).join("");

  $("#lactoseToggle").setAttribute("aria-pressed", String(state.lactoseOnly));
}

function cardImage(product, index = 0) {
  const badge = product.lactoseFree ? '<span class="badge">Sem lactose</span>' : "";
  const kcal = product.calories ? `<span class="kcal">${esc(product.calories)} kcal</span>` : "";

  // As primeiras fotos carregam na hora (primeira dobra); o resto entra sob
  // demanda. Como todos os pratos usam a mesma foto padrão, isso é uma única
  // requisição de rede.
  const carga = index < 4 ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"';
  const tamanhos = 'sizes="(max-width: 680px) 116px, (max-width: 1080px) 33vw, 25vw"';

  // Foto própria quando existir (com miniatura para o celular); senão a padrão.
  // alt vazio porque a foto padrão não representa o prato específico: o nome
  // já está no título do cartão e leitores de tela não devem ouvir 52 vezes
  // a mesma descrição genérica.
  const photo = product.photo
    ? `<img class="dish-photo" src="${esc(product.photoThumb || product.photo)}" ${
        product.photoThumb ? `srcset="${esc(product.photoThumb)} 400w, ${esc(product.photo)} 1400w" ${tamanhos}` : ""
      } alt="" ${carga} decoding="async" />`
    : `<img class="dish-photo" src="${esc(PHOTO.thumb)}" srcset="${esc(PHOTO.thumb)} 360w, ${esc(PHOTO.full)} 900w"
        ${tamanhos} alt="" ${carga} decoding="async" width="360" height="376" />`;

  return `<div class="dish-art" style="--bg:${paletaDe(product.category)}">
      ${badge}${kcal}
      ${photo}
    </div>`;
}

function sizesBlock(item) {
  if (item.options.length < 2) return "";
  const chosen = getChosen(item);
  return `<div class="sizes" role="group" aria-label="Escolha o tamanho de ${esc(item.name)}">${item.options
    .map(
      (option) =>
        `<button type="button" class="size${option.label === chosen ? " is-active" : ""}" data-size="${
          esc(option.label)
        }" data-item="${esc(item.id)}" aria-pressed="${option.label === chosen}">${esc(option.label)}</button>`
    )
    .join("")}</div>`;
}

function addButton(item, label = "Adicionar") {
  return `<button type="button" class="add-btn" data-add="${item.id}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      <span>${label}</span>
    </button>`;
}

function priceBlock(item) {
  const option = optionOf(item, getChosen(item));
  return `<span class="price">${brl(option.price)}${
    item.isCombo ? `<small>${brl(option.unit)} por marmita</small>` : ""
  }</span>`;
}

function renderMenu() {
  const filtered = sortProducts(PRODUCTS.filter(matchesFilters));
  const visible = filtered.slice(0, state.shown);

  $("#menuGrid").innerHTML = visible
    .map(
      (product, index) => `<article class="dish-card" data-id="${esc(product.id)}">
        ${cardImage(product, index)}
        <div class="dish-body">
          <p class="dish-cat">${esc(product.category)}</p>
          <h3>${esc(product.name)}</h3>
          <p class="dish-desc">${esc(product.description)}</p>
          ${sizesBlock(product)}
          <div class="dish-foot">${priceBlock(product)}${addButton(product)}</div>
        </div>
      </article>`
    )
    .join("");

  $("#emptyState").hidden = filtered.length > 0;
  $("#loadMore").hidden = filtered.length <= state.shown;

  const label = filtered.length === 1 ? "prato encontrado" : "pratos encontrados";
  $("#resultCount").textContent = filtered.length
    ? `Mostrando ${visible.length} de ${filtered.length} ${label}`
    : "";
}

// Delegação de eventos: o cardápio é re-renderizado a cada filtro, então os
// listeners ficam nos contêineres para nunca duplicarem entre renders.
function bindCatalogEvents() {
  const onSize = (event) => {
    const button = event.target.closest(".size");
    if (!button) return;
    const item = CATALOG.get(button.dataset.item);
    state.chosen.set(item.id, button.dataset.size);
    renderMenu();
    renderCombos();
  };

  const onAdd = (event) => {
    const button = event.target.closest("[data-add]");
    if (!button) return;
    const item = CATALOG.get(button.dataset.add);
    button.classList.add("is-added");
    setTimeout(() => button.classList.remove("is-added"), 600);

    if (item.isCombo) {
      abrirCombo(item, getChosen(item));
      return;
    }
    addToCart(item.id, getChosen(item));
  };

  ["#menuGrid", "#comboList"].forEach((selector) => {
    $(selector).addEventListener("click", (event) => {
      onSize(event);
      onAdd(event);
    });
  });
}

/* ------------------------------------------------------------------ combos */
function renderCombos() {
  $("#comboList").innerHTML = COMBOS.map((combo) => {
    const item = CATALOG.get(combo.id);
    const option = optionOf(item, getChosen(item));
    const full = option.unit * combo.qty;
    const saving = full - option.price;
    return `<article class="combo-card${combo.featured ? " is-featured" : ""}" data-id="${esc(combo.id)}">
      ${combo.featured ? '<span class="combo-tag">Mais pedido</span>' : ""}
      <h3>${esc(combo.name)}</h3>
      <p class="combo-unit">${brl(option.unit)} por marmita · ${brl(option.price)} no total</p>
      ${sizesBlock(item)}
      <div class="combo-foot">
        ${priceBlock(item)}
        ${addButton(item, "Escolher os pratos")}
      </div>
      <p class="combo-unit">${saving > 0 ? `Economia de ${brl(saving)}` : "Preço de tabela"} · entrega grátis</p>
    </article>`;
  }).join("");
}

/* ---------------------------------------------------------------- carrinho */
// A composição entra na chave: dois combos do mesmo tamanho, com pratos
// diferentes, são linhas separadas no pedido.
const composicaoKey = (pratos) =>
  (pratos || []).map((prato) => `${prato.id}x${prato.qtd}`).sort().join(",");

const lineKey = (id, option, pratos) => `${id}|${option}|${composicaoKey(pratos)}`;

function findLine(id, option, pratos) {
  const chave = lineKey(id, option, pratos);
  return state.cart.find((line) => lineKey(line.id, line.option, line.pratos) === chave);
}

function cartCount() {
  return state.cart.reduce((total, line) => total + line.qty, 0);
}

function hasCombo() {
  return state.cart.some((line) => ehCombo(CATALOG.get(String(line.id))));
}

const arredondar = (valor) => Math.round(valor * 100) / 100;

function linhasComItem() {
  return state.cart
    .map((line, indice) => {
      const item = CATALOG.get(String(line.id));
      if (!item) return null;
      const option = optionOf(item, line.option);
      return { ...line, indice, item, option, total: option.price * line.qty };
    })
    .filter(Boolean);
}

/* ------------------------------------------------------ preços e descontos */
// Cupom: o cliente digita o código. Promoção: entra automaticamente, conforme
// as regras configuradas no painel admin.
function cupomPorCodigo(codigo) {
  const procurar = String(codigo || "").trim().toUpperCase();
  if (!procurar) return null;
  const hoje = new Date().toISOString().slice(0, 10);
  return (
    CUPONS.find((cupom) => {
      if (String(cupom.codigo || "").trim().toUpperCase() !== procurar) return false;
      if (cupom.ativo === false) return false;
      if (cupom.inicio && hoje < cupom.inicio) return false;
      if (cupom.fim && hoje > cupom.fim) return false;
      return true;
    }) || null
  );
}

function calcular() {
  const linhas = linhasComItem();
  const subtotal = arredondar(linhas.reduce((soma, linha) => soma + linha.total, 0));
  const descontos = [];

  PROMOCOES.filter((promocao) => promocao.ativo !== false).forEach((promocao) => {
    const valor = Number(promocao.valor) || 0;
    const minimo = Number(promocao.minimo) || 0;
    if (!valor || subtotal < minimo) return;

    if (promocao.tipo === "desconto_categoria") {
      const base = linhas
        .filter((linha) => !linha.item.isCombo && linha.item.category === promocao.categoria)
        .reduce((soma, linha) => soma + linha.total, 0);
      if (base > 0) {
        descontos.push({
          nome: promocao.nome || `Promoção ${promocao.categoria}`,
          valor: arredondar((base * valor) / 100),
        });
      }
      return;
    }

    if (promocao.tipo === "desconto_pedido") {
      descontos.push({
        nome: promocao.nome || "Desconto no pedido",
        valor: arredondar((subtotal * valor) / 100),
      });
    }
  });

  const descontoPromocoes = arredondar(descontos.reduce((soma, desconto) => soma + desconto.valor, 0));

  let cupomAplicado = null;
  let descontoCupom = 0;
  if (state.cupom) {
    const cupom = cupomPorCodigo(state.cupom);
    const base = arredondar(Math.max(0, subtotal - descontoPromocoes));
    if (cupom && base >= (Number(cupom.minimo) || 0)) {
      const valor = Number(cupom.valor) || 0;
      const bruto = cupom.tipo === "valor" ? valor : (base * valor) / 100;
      const final = arredondar(Math.min(bruto, base));
      if (final > 0) {
        descontoCupom = final;
        cupomAplicado = cupom;
      }
    }
  }

  const freteGratis =
    linhas.length > 0 && (hasCombo() || (FRETE_GRATIS_ACIMA > 0 && subtotal >= FRETE_GRATIS_ACIMA));
  const entrega = !linhas.length ? 0 : freteGratis ? 0 : TAXA_ENTREGA;
  const total = arredondar(Math.max(0, subtotal - descontoPromocoes - descontoCupom) + entrega);

  return { linhas, subtotal, descontos, descontoPromocoes, descontoCupom, cupomAplicado, freteGratis, entrega, total };
}

function shippingLabel(calculo) {
  if (!state.cart.length) return "Porto Alegre";
  if (calculo.freteGratis) return hasCombo() ? "Grátis (combo)" : "Grátis";
  return calculo.entrega > 0 ? brl(calculo.entrega) : "A confirmar no bairro";
}

function shippingHint(calculo) {
  if (!state.cart.length) {
    return "Os combos têm entrega grátis. Para pedidos avulsos, confirmamos a taxa pelo WhatsApp.";
  }
  if (calculo.freteGratis) {
    return hasCombo() ? "Seu pedido tem combo: entrega grátis." : "Você atingiu o valor de entrega grátis.";
  }
  if (FRETE_GRATIS_ACIMA > 0 && calculo.subtotal < FRETE_GRATIS_ACIMA) {
    return `Faltam ${brl(arredondar(FRETE_GRATIS_ACIMA - calculo.subtotal))} para ganhar entrega grátis.`;
  }
  return "Confirmamos a taxa de entrega pelo bairro no WhatsApp.";
}

function addToCart(id, option, { silent = false, pratos = null } = {}) {
  const line = findLine(id, option, pratos);
  if (line) line.qty += 1;
  else state.cart.push(pratos ? { id, option, pratos, qty: 1 } : { id, option, qty: 1 });

  persistCart();
  renderCart();

  const count = $("#cartCount");
  count.classList.add("is-bump");
  setTimeout(() => count.classList.remove("is-bump"), 450);

  // A gaveta do pedido não abre sozinha: quem clica em "Adicionar" quer seguir
  // escolhendo. O retorno é o contador pulsando, o aviso e a barra do celular.
  if (!silent) {
    const item = CATALOG.get(String(id));
    toast(`${item.name} (${option}) no pedido`);
  }
}

// Carrinho por posição: cada linha é identificada pelo índice atual, então não
// depende de remontar a chave (id, tamanho e pratos do combo) na hora de mexer.
function changeQty(indice, delta) {
  const line = state.cart[indice];
  if (!line) return;
  line.qty += delta;
  if (line.qty < 1) state.cart.splice(indice, 1);
  persistCart();
  renderCart();
}

function persistCart() {
  store(STORAGE.cart, state.cart);
}

function restoreCart() {
  const saved = store(STORAGE.cart);
  if (!Array.isArray(saved)) return;
  state.cart = saved
    .filter((line) => line && CATALOG.has(String(line.id)) && typeof line.qty === "number" && line.qty > 0)
    .map((line) => {
      const item = CATALOG.get(String(line.id));
      const option = item.options.some((entry) => entry.label === line.option) ? line.option : item.options[0].label;
      const qty = Math.min(99, Math.round(line.qty));
      const pratos = Array.isArray(line.pratos)
        ? line.pratos
            .filter((prato) => prato && CATALOG.has(String(prato.id)) && Number(prato.qtd) > 0)
            .map((prato) => ({ id: String(prato.id), qtd: Math.min(99, Math.round(Number(prato.qtd))) }))
        : [];
      // Composição que não fecha com o combo (ou combo ajustado no painel) cai
      // fora: o cliente escolhe os pratos de novo ao abrir o pedido.
      const completa = pratos.reduce((soma, prato) => soma + prato.qtd, 0) === item.qty;
      return completa ? { id: line.id, option, qty, pratos } : { id: line.id, option, qty };
    });
}

function renderCart() {
  const count = cartCount();
  const counter = $("#cartCount");
  counter.textContent = count;
  counter.dataset.empty = String(count === 0);

  const calculo = calcular();

  $("#cartSubtotal").textContent = brl(calculo.subtotal);
  $("#cartShipping").textContent = shippingLabel(calculo);
  $("#cartTotal").textContent = brl(calculo.total);
  $("#shippingHint").textContent = shippingHint(calculo);

  // Descontos: promoções automáticas + cupom digitado
  const linhas = calculo.descontos
    .map((desconto) => `<div class="discount-row"><span>${esc(desconto.nome)}</span><b>−${brl(desconto.valor)}</b></div>`)
    .join("");
  const cupom = calculo.descontoCupom
    ? `<div class="discount-row is-coupon"><span>Cupom ${esc(calculo.cupomAplicado.codigo)}<button type="button" id="removeCoupon" aria-label="Remover cupom">remover</button></span><b>−${brl(calculo.descontoCupom)}</b></div>`
    : "";
  const areaDescontos = $("#cartDiscounts");
  areaDescontos.innerHTML = linhas + cupom;
  areaDescontos.hidden = !(linhas || cupom);

  // Feedback do cupom
  const feedback = $("#couponFeedback");
  if (!state.cupom) {
    feedback.textContent = "";
    feedback.className = "coupon-feedback";
  } else if (calculo.cupomAplicado) {
    feedback.textContent = `Cupom aplicado: ${calculo.cupomAplicado.descricao || "desconto ativo"}.`;
    feedback.className = "coupon-feedback is-ok";
  } else {
    const encontrado = cupomPorCodigo(state.cupom);
    feedback.textContent = encontrado
      ? `Este cupom vale a partir de ${brl(Number(encontrado.minimo) || 0)}.`
      : "Cupom inválido, expirado ou inativo.";
    feedback.className = "coupon-feedback is-error";
  }

  const inputCupom = $("#couponInput");
  if (inputCupom && document.activeElement !== inputCupom) inputCupom.value = state.cupom;

  // Pedido mínimo configurado no admin
  const abaixoDoMinimo = PEDIDO_MINIMO > 0 && calculo.linhas.length > 0 && calculo.subtotal < PEDIDO_MINIMO;
  const avisoMinimo = $("#minimumHint");
  avisoMinimo.hidden = !abaixoDoMinimo;
  avisoMinimo.textContent = abaixoDoMinimo
    ? `Pedido mínimo de ${brl(PEDIDO_MINIMO)} · faltam ${brl(arredondar(PEDIDO_MINIMO - calculo.subtotal))}`
    : "";
  $("#sendOrder").disabled = abaixoDoMinimo;

  $("#clearOrder").hidden = count === 0;
  $("#repeatOrder").hidden = count > 0 || !store(STORAGE.last);

  if (!state.cart.length) {
    $("#cartItems").innerHTML =
      '<div class="cart-empty"><b>Seu pedido está vazio</b>Escolha um prato do cardápio para começar.</div>';
  } else {
    $("#cartItems").innerHTML = calculo.linhas
      .map((linha) => {
        const pratos = itensDaComposicao(linha);
        const composicao = pratos.length
          ? `<span class="cart-line-composicao">${esc(pratos.join(" · "))}</span>`
          : "";
        const trocar = linha.item.isCombo
          ? `<button type="button" class="cart-line-trocar" data-trocar-combo="${linha.indice}">${
              pratos.length ? "Trocar os pratos" : "Escolher os pratos"
            }</button>`
          : "";
        return `<div class="cart-line">
          <div class="cart-line-main">
            <strong>${esc(linha.item.name)}</strong>
            <small>${esc(linha.option.label)}</small>
            ${composicao}
            ${trocar}
          </div>
          <div class="cart-line-side">
            <b>${brl(linha.total)}</b>
            <div class="stepper">
              <button type="button" data-dec="${linha.indice}" aria-label="Diminuir ${esc(linha.item.name)}">−</button>
              <span>${linha.qty}</span>
              <button type="button" data-inc="${linha.indice}" aria-label="Aumentar ${esc(linha.item.name)}">+</button>
            </div>
          </div>
          <button type="button" class="remove" data-remove="${linha.indice}">Remover</button>
        </div>`;
      })
      .join("");

    document.querySelectorAll("[data-inc]").forEach((button) => {
      button.addEventListener("click", () => changeQty(Number(button.dataset.inc), 1));
    });
    document.querySelectorAll("[data-dec]").forEach((button) => {
      button.addEventListener("click", () => changeQty(Number(button.dataset.dec), -1));
    });
    document.querySelectorAll("[data-remove]").forEach((button) => {
      button.addEventListener("click", () => {
        state.cart.splice(Number(button.dataset.remove), 1);
        persistCart();
        renderCart();
      });
    });
    document.querySelectorAll("[data-trocar-combo]").forEach((button) => {
      button.addEventListener("click", () => abrirComboPorIndice(Number(button.dataset.trocarCombo)));
    });

    const botaoRemoverCupom = $("#removeCoupon");
    if (botaoRemoverCupom) botaoRemoverCupom.addEventListener("click", aplicarCupom(""));
  }

  renderMobileBar();
}

function renderMobileBar() {
  const count = cartCount();
  const bar = $("#mobileBar");
  const drawerAberto = !$("#cartDrawer").hidden;
  bar.hidden = count === 0 || drawerAberto;
  $("#barCount").textContent = count === 1 ? "1 item" : `${count} itens`;
  $("#barTotal").textContent = brl(calcular().total);
}

// Aplica (ou limpa) o cupom digitado e guarda a escolha para a próxima visita.
function aplicarCupom(codigo) {
  return () => {
    const novo = String(codigo || "").trim().toUpperCase();
    state.cupom = novo;
    store(STORAGE.cupom, novo);
    renderCart();
    if (!novo) return;
    const cupom = cupomPorCodigo(novo);
    toast(cupom ? `Cupom ${cupom.codigo} aplicado` : "Cupom não encontrado");
  };
}

/* ----------------------------------------------------------------- layout */
let lastFocused = null;

function openCart() {
  const drawer = $("#cartDrawer");
  if (!drawer.hidden) return;
  closeMenu();
  lastFocused = document.activeElement;
  drawer.hidden = false;
  $("#overlay").hidden = false;
  document.documentElement.classList.add("is-locked");
  renderMobileBar();
  setTimeout(() => ($("#fieldName").matches(":focus") ? null : $("#closeCart").focus()), 60);
}

function closeCart() {
  const drawer = $("#cartDrawer");
  if (drawer.hidden) return;
  drawer.hidden = true;
  $("#overlay").hidden = true;
  document.documentElement.classList.remove("is-locked");
  renderMobileBar();
  if (lastFocused && document.contains(lastFocused)) lastFocused.focus();
}

/* Menu de navegação do celular: bottom sheet, fechado por Esc, link ou toque fora. */
function openMenu() {
  closeCart();
  $("#mobileNav").hidden = false;
  $("#menuOverlay").hidden = false;
  $("#menuToggle").classList.add("is-open");
  $("#menuToggle").setAttribute("aria-expanded", "true");
  document.documentElement.classList.add("is-locked");
  $("#closeMenu").focus();
}

function closeMenu() {
  if ($("#mobileNav").hidden) return;
  $("#mobileNav").hidden = true;
  $("#menuOverlay").hidden = true;
  $("#menuToggle").classList.remove("is-open");
  $("#menuToggle").setAttribute("aria-expanded", "false");
  if ($("#cartDrawer").hidden) document.documentElement.classList.remove("is-locked");
}

/* --------------------------------------- montagem do combo (quais pratos) */
// O combo não entra no pedido sem os pratos escolhidos: a quantidade do combo
// é fechada com a soma do que o cliente marcou. Lasanhas e porções ficam fora,
// como já diz a nota dos combos.
const FORA_DO_COMBO = ["lasanha", "porc"];
const pratosDoCombo = () =>
  PRODUCTS.filter((prato) => !FORA_DO_COMBO.some((fora) => normalize(prato.category).includes(fora)));

const comboForm = { item: null, opcao: null, indice: null, escolhas: new Map(), termo: "", categoria: "Todas" };

const somaEscolhas = () => [...comboForm.escolhas.values()].reduce((total, qtd) => total + qtd, 0);

// Pratos escolhidos de uma linha do carrinho, prontos para exibir (carrinho e
// mensagem do WhatsApp usam a mesma lista).
function itensDaComposicao(linha) {
  if (!linha || !linha.item || !linha.item.isCombo) return [];
  return (linha.pratos || [])
    .map((prato) => {
      const escolhido = CATALOG.get(String(prato.id));
      return escolhido ? `${prato.qtd}× ${escolhido.name}` : "";
    })
    .filter(Boolean);
}

function abrirComboPorIndice(indice) {
  const linha = state.cart[indice];
  const item = linha ? CATALOG.get(String(linha.id)) : null;
  if (!item || !item.isCombo) return;
  abrirCombo(item, linha.option, indice);
}

function abrirCombo(item, opcao, indice = null) {
  const linha = indice !== null ? state.cart[indice] : null;
  comboForm.item = item;
  comboForm.opcao = opcao || (linha && linha.option) || item.options[0].label;
  comboForm.indice = indice;
  comboForm.escolhas = new Map(
    ((linha && linha.pratos) || []).map((prato) => [String(prato.id), prato.qtd])
  );
  comboForm.termo = "";
  comboForm.categoria = "Todas";
  $("#comboSearch").value = "";
  desenharChipsDoCombo();
  desenharCombo();
  $("#comboOverlay").hidden = false;
  $("#comboModal").hidden = false;
  document.documentElement.classList.add("is-locked");
  setTimeout(() => $("#comboSearch").focus(), 60);
}

function fecharCombo() {
  const modal = $("#comboModal");
  if (modal.hidden) return;
  modal.hidden = true;
  $("#comboOverlay").hidden = true;
  if ($("#cartDrawer").hidden && $("#mobileNav").hidden) {
    document.documentElement.classList.remove("is-locked");
  }
}

function desenharChipsDoCombo() {
  const categorias = ["Todas", ...new Set(pratosDoCombo().map((prato) => prato.category))];
  $("#comboFilters").innerHTML = categorias
    .map(
      (categoria) =>
        `<button type="button" class="filter-chip${
          categoria === comboForm.categoria ? " is-active" : ""
        }" data-combo-cat="${esc(categoria)}" aria-pressed="${categoria === comboForm.categoria}">${esc(
          categoria
        )}</button>`
    )
    .join("");
}

function pratosFiltradosDoCombo() {
  return pratosDoCombo().filter((prato) => {
    if (comboForm.categoria !== "Todas" && prato.category !== comboForm.categoria) return false;
    if (!comboForm.termo) return true;
    return normalize(`${prato.name} ${prato.description}`).includes(comboForm.termo);
  });
}

function linhaDoPrato(prato) {
  const qtd = comboForm.escolhas.get(prato.id) || 0;
  const detalhes = [prato.category, prato.calories ? `${prato.calories} kcal` : ""].filter(Boolean).join(" · ");
  return `<article class="combo-item${qtd ? " is-on" : ""}">
    <div class="combo-item-info">
      <strong>${esc(prato.name)}</strong>
      <small>${esc(detalhes)}</small>
    </div>
    <div class="combo-stepper">
      <button type="button" data-combo-dec="${esc(prato.id)}" aria-label="Tirar uma de ${esc(prato.name)}" ${
    qtd ? "" : "disabled"
  }>−</button>
      <span>${qtd}</span>
      <button type="button" data-combo-inc="${esc(prato.id)}" aria-label="Adicionar uma de ${esc(prato.name)}">+</button>
    </div>
  </article>`;
}

function desenharCombo() {
  const item = comboForm.item;
  const total = somaEscolhas();
  const falta = item.qty - total;
  const completo = falta <= 0;

  $("#comboTitle").textContent = `${item.name} · ${comboForm.opcao}`;
  $("#comboBar").style.width = `${Math.min(100, (total / item.qty) * 100)}%`;
  $(".combo-bar").classList.toggle("is-completo", completo);
  $("#comboStatus").innerHTML = completo
    ? "Combo completo. Pode adicionar ao pedido."
    : `Escolha <b>${falta}</b> ${falta === 1 ? "marmita" : "marmitas"} para fechar o combo.`;
  $("#comboCount").textContent = `${total} de ${item.qty}`;
  $("#comboHint").textContent = completo
    ? `${brl(optionOf(item, comboForm.opcao).price)} · dá para trocar depois`
    : `Some ${item.qty} marmitas no total.`;

  const lista = pratosFiltradosDoCombo();
  $("#comboDishes").innerHTML = lista.length
    ? lista.map(linhaDoPrato).join("")
    : '<p class="combo-vazio">Nenhum prato com esse filtro. Tente outro nome ou categoria.</p>';

  const confirmar = $("#comboConfirm");
  confirmar.disabled = !completo;
  confirmar.textContent = completo ? "Adicionar ao pedido" : `Faltam ${falta}`;
  $("#comboClear").hidden = total === 0;
}

function mudarPratoDoCombo(id, delta) {
  const atual = comboForm.escolhas.get(id) || 0;
  if (delta > 0 && somaEscolhas() >= comboForm.item.qty) {
    toast(`Este combo tem ${comboForm.item.qty} marmitas. Tire uma para trocar por outra.`);
    return;
  }
  const novo = atual + delta;
  if (novo <= 0) comboForm.escolhas.delete(id);
  else comboForm.escolhas.set(id, novo);
  desenharCombo();
}

function confirmarCombo() {
  const item = comboForm.item;
  const total = somaEscolhas();
  if (total !== item.qty) {
    toast(`Faltam ${item.qty - total} para fechar o combo`);
    return;
  }
  const pratos = [...comboForm.escolhas.entries()]
    .map(([id, qtd]) => ({ id, qtd }))
    .sort((a, b) => b.qtd - a.qtd);

  const trocando = comboForm.indice !== null && state.cart[comboForm.indice];
  if (trocando) {
    state.cart[comboForm.indice] = { ...state.cart[comboForm.indice], option: comboForm.opcao, pratos };
    persistCart();
    renderCart();
    fecharCombo();
    toast("Pratos do combo atualizados");
  } else {
    fecharCombo();
    addToCart(item.id, comboForm.opcao, { pratos });
  }
}

function ligarCombo() {
  $("#comboDishes").addEventListener("click", (event) => {
    const botao = event.target.closest("[data-combo-inc], [data-combo-dec]");
    if (!botao) return;
    const subindo = botao.hasAttribute("data-combo-inc");
    const id = botao.getAttribute(subindo ? "data-combo-inc" : "data-combo-dec");
    mudarPratoDoCombo(id, subindo ? 1 : -1);
  });

  $("#comboFilters").addEventListener("click", (event) => {
    const chip = event.target.closest("[data-combo-cat]");
    if (!chip) return;
    comboForm.categoria = chip.dataset.comboCat;
    desenharChipsDoCombo();
    desenharCombo();
  });

  $("#comboSearch").addEventListener("input", (event) => {
    comboForm.termo = normalize(event.target.value);
    desenharCombo();
  });
  $("#comboSearch").addEventListener("keydown", (event) => {
    if (event.key === "Enter") event.preventDefault();
  });

  $("#comboClear").addEventListener("click", () => {
    comboForm.escolhas.clear();
    desenharCombo();
  });
  $("#comboConfirm").addEventListener("click", confirmarCombo);
  $("#closeCombo").addEventListener("click", fecharCombo);
  $("#comboOverlay").addEventListener("click", fecharCombo);
}

/* -------------------------------------------------------------- checkout */
function formatPhone(value) {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function readForm() {
  return {
    name: $("#fieldName").value.trim(),
    phone: $("#fieldPhone").value.trim(),
    neighborhood: $("#fieldNeighborhood").value.trim(),
    address: $("#fieldAddress").value.trim(),
    notes: $("#fieldNotes").value.trim(),
  };
}

function persistForm() {
  store(STORAGE.form, readForm());
}

function restoreForm() {
  const saved = store(STORAGE.form);
  if (!saved) return;
  $("#fieldName").value = saved.name || "";
  $("#fieldPhone").value = saved.phone || "";
  $("#fieldNeighborhood").value = saved.neighborhood || "";
  $("#fieldAddress").value = saved.address || "";
  $("#fieldNotes").value = saved.notes || "";
}

function setError(fieldId, message) {
  const input = $(`#${fieldId}`);
  const wrapper = input.closest(".field");
  const slot = wrapper.querySelector(`[data-error-for="${fieldId}"]`);
  wrapper.classList.toggle("has-error", Boolean(message));
  if (slot) slot.textContent = message || "";
  return !message;
}

function validateForm(data) {
  const results = [
    setError("fieldName", data.name.length < 3 ? "Informe seu nome completo." : ""),
    setError("fieldPhone", data.phone.replace(/\D/g, "").length < 10 ? "Informe um WhatsApp com DDD." : ""),
    setError("fieldNeighborhood", data.neighborhood.length < 2 ? "Informe o bairro da entrega." : ""),
  ];
  return results.every(Boolean);
}

function buildMessage(data) {
  const calculo = calcular();
  const lines = [];
  lines.push(`*PEDIDO — ${LOJA.nome || "Marmitas POA"}*`);
  lines.push("_Enviado pelo site_");
  lines.push("");
  lines.push("*ITENS*");
  calculo.linhas.forEach((linha) => {
    lines.push(`• ${linha.qty}x ${linha.item.name} (${linha.option.label}) — ${brl(linha.total)}`);
    const pratos = itensDaComposicao(linha);
    if (pratos.length) lines.push(`   ${pratos.join(" · ")}`);
  });
  lines.push("");
  lines.push("*RESUMO*");
  lines.push(`Subtotal: ${brl(calculo.subtotal)}`);
  calculo.descontos.forEach((desconto) => lines.push(`${desconto.nome}: −${brl(desconto.valor)}`));
  if (calculo.descontoCupom) lines.push(`Cupom ${calculo.cupomAplicado.codigo}: −${brl(calculo.descontoCupom)}`);
  lines.push(`Entrega: ${shippingLabel(calculo)}`);
  lines.push(`*Total: ${brl(calculo.total)}*`);
  lines.push("");
  lines.push("*DADOS PARA ENTREGA*");
  lines.push(`Nome: ${data.name}`);
  lines.push(`WhatsApp: ${data.phone}`);
  lines.push(`Bairro: ${data.neighborhood}`);
  if (data.address) lines.push(`Endereço: ${data.address}`);
  if (data.notes) lines.push(`Observações: ${data.notes}`);
  return lines.join("\n");
}

function sendOrder() {
  if (!state.cart.length) {
    toast("Seu pedido está vazio");
    openCart();
    return;
  }
  // Combo sem os pratos escolhidos não fecha o pedido: abre a montagem nele.
  const comboIncompleto = state.cart.findIndex((linha) => {
    const item = CATALOG.get(String(linha.id));
    if (!item || !item.isCombo) return false;
    const escolhidas = (linha.pratos || []).reduce((soma, prato) => soma + prato.qtd, 0);
    return escolhidas !== item.qty;
  });
  if (comboIncompleto >= 0) {
    closeCart();
    abrirComboPorIndice(comboIncompleto);
    toast("Escolha os pratos do combo para fechar o pedido");
    return;
  }
  const calculo = calcular();
  if (PEDIDO_MINIMO > 0 && calculo.subtotal < PEDIDO_MINIMO) {
    toast(`Pedido mínimo de ${brl(PEDIDO_MINIMO)}`);
    openCart();
    return;
  }
  const data = readForm();
  if (!validateForm(data)) {
    toast("Confira os campos destacados");
    return;
  }
  store(STORAGE.last, state.cart);
  persistForm();
  window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(buildMessage(data))}`, "_blank", "noopener");
  toast("Pedido pronto no WhatsApp");
}

function repeatLastOrder() {
  const saved = store(STORAGE.last);
  if (!Array.isArray(saved) || !saved.length) {
    toast("Nenhum pedido anterior encontrado");
    return;
  }
  state.cart = saved
    .filter((line) => line && CATALOG.has(String(line.id)))
    .map((line) => {
      const item = CATALOG.get(String(line.id));
      const option = item.options.some((entry) => entry.label === line.option) ? line.option : item.options[0].label;
      return { id: line.id, option, qty: Math.max(1, Math.round(line.qty || 1)) };
    });
  persistCart();
  renderCart();
  toast("Último pedido restaurado");
}

function clearOrder() {
  if (!state.cart.length) return;
  if (!window.confirm("Remover todos os itens do pedido?")) return;
  state.cart = [];
  persistCart();
  renderCart();
  toast("Pedido limpo");
}

/* ------------------------------------------------------------- movimento */
function setupReveal() {
  const elements = document.querySelectorAll(".reveal");
  const revealAll = () => elements.forEach((element) => element.classList.add("is-visible"));

  if (!("IntersectionObserver" in window)) {
    revealAll();
    return;
  }

  // Rede de segurança: revela o que já está na tela. Cobre abas em segundo plano
  // e navegadores em que o observer não dispara, evitando seções invisíveis.
  const revealInView = () => {
    const limit = window.innerHeight * 0.98;
    document.querySelectorAll(".reveal:not(.is-visible)").forEach((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.top < limit && rect.bottom > 0) element.classList.add("is-visible");
    });
  };

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
  );
  elements.forEach((element) => observer.observe(element));

  window.addEventListener("scroll", revealInView, { passive: true });
  window.addEventListener("resize", revealInView);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) revealInView();
  });
  revealInView();
}

function setupScrollEffects() {
  const topbar = $("#topbar");
  const progress = $("#scrollProgress");
  const sections = ["cardapio", "combos", "como-funciona", "duvidas", "sobre"]
    .map((id) => document.getElementById(id))
    .filter(Boolean);

  const onScroll = () => {
    const scrolled = window.scrollY;
    topbar.classList.toggle("is-scrolled", scrolled > 20);

    const height = document.documentElement.scrollHeight - window.innerHeight;
    progress.style.width = `${height > 0 ? Math.min(100, (scrolled / height) * 100) : 0}%`;

    const middle = scrolled + window.innerHeight * 0.32;
    let current = "";
    sections.forEach((section) => {
      if (section.offsetTop <= middle) current = section.id;
    });
    document.querySelectorAll(".nav a").forEach((link) => {
      link.classList.toggle("is-active", link.getAttribute("href") === `#${current}`);
    });
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}

function setupHeroParallax() {
  const art = $("#heroArt");
  if (!art || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (window.matchMedia("(pointer: coarse)").matches) return;
  window.addEventListener("mousemove", (event) => {
    const x = (event.clientX / window.innerWidth - 0.5) * 14;
    const y = (event.clientY / window.innerHeight - 0.5) * 14;
    art.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  });
}

function setupMarquee() {
  const words = [
    "Cozinha caseira",
    "Feito hoje, congelado no ponto",
    "400 g ou 600 g",
    "Sem lactose",
    "Opções light e vegetarianas",
    "Entrega grátis nos combos",
    "Feito em Porto Alegre",
  ];
  const block = words.map((word) => `<span class="marquee-item">${word}</span>`).join("");
  $("#marqueeTrack").innerHTML = block + block;
}

/* -------------------------------------------- frases dos cartões do hero */
// Os dois cartões sobre a foto trocam de frase sozinhos. Cada um tem sua lista e
// seu ritmo, para não mudarem no mesmo instante, e a troca para quando o mouse
// está em cima (dá tempo de ler) ou quando o sistema pede menos movimento.
const FRASES_DOS_CARTOES = [
  {
    alvo: ".float-a",
    intervalo: 5200,
    frases: [
      ["400 g ou 600 g", "do almoço leve ao dia de fome"],
      ["Panela de casa", "tempero no ponto, sem pressa"],
      ["Sai do freezer", "pronta em minutos no micro-ondas"],
      ["52 pratos", "tradicional, light e vegetariano"],
      ["Sem lactose", "tem opção marcada no cardápio"],
    ],
  },
  {
    alvo: ".float-b",
    intervalo: 6600,
    frases: [
      ["Tempero de casa", "aqui em Porto Alegre"],
      ["Feito hoje", "porcionado à mão na nossa cozinha"],
      ["Entrega em POA", "grátis nos combos"],
      ["Porção generosa", "do jeito que a gente come em casa"],
      ["Quem entrega", "somos nós, aqui da cidade"],
    ],
  },
];

function setupCartoesDoHero() {
  const semMovimento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  FRASES_DOS_CARTOES.forEach(({ alvo, intervalo, frases }) => {
    const cartao = document.querySelector(alvo);
    if (!cartao || frases.length < 2) return;
    const forte = cartao.querySelector("b");
    const apoio = cartao.querySelector("small");
    if (!forte || !apoio) return;

    let indice = 0;
    let pausado = false;
    cartao.addEventListener("mouseenter", () => (pausado = true));
    cartao.addEventListener("mouseleave", () => (pausado = false));

    if (semMovimento) return; // quem pediu menos movimento fica com a primeira frase

    setInterval(() => {
      if (pausado || document.hidden) return;
      indice = (indice + 1) % frases.length;
      const [destaque, texto] = frases[indice];
      cartao.classList.add("is-trocando");
      setTimeout(() => {
        forte.textContent = destaque;
        apoio.textContent = texto;
        cartao.classList.remove("is-trocando");
      }, 240);
    }, intervalo);
  });
}

/* ------------------------------------------------------------------- boot */
function bindEvents() {
  let debounce;
  $("#searchInput").addEventListener("input", (event) => {
    clearTimeout(debounce);
    const value = event.target.value;
    debounce = setTimeout(() => {
      state.term = normalize(value);
      state.shown = PAGE_SIZE;
      renderMenu();
    }, 180);
  });

  $("#sortSelect").addEventListener("change", (event) => {
    state.sort = event.target.value;
    state.shown = PAGE_SIZE;
    renderMenu();
  });

  $("#filters").addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    state.category = button.dataset.category;
    state.shown = PAGE_SIZE;
    renderFilters();
    renderMenu();
  });

  $("#lactoseToggle").addEventListener("click", () => {
    state.lactoseOnly = !state.lactoseOnly;
    state.shown = PAGE_SIZE;
    renderFilters();
    renderMenu();
  });

  $("#loadMore").addEventListener("click", () => {
    state.shown += PAGE_SIZE;
    renderMenu();
  });

  $("#clearFilters").addEventListener("click", () => {
    state.category = "Todos";
    state.lactoseOnly = false;
    state.term = "";
    state.sort = "padrao";
    state.shown = PAGE_SIZE;
    $("#searchInput").value = "";
    $("#sortSelect").value = "padrao";
    renderFilters();
    renderMenu();
  });

  bindCatalogEvents();

  $("#menuToggle").addEventListener("click", () => ($("#mobileNav").hidden ? openMenu() : closeMenu()));
  $("#closeMenu").addEventListener("click", closeMenu);
  $("#menuOverlay").addEventListener("click", closeMenu);
  $("#mobileNav").addEventListener("click", (event) => {
    if (event.target.closest("a")) closeMenu();
  });

  $("#cartButton").addEventListener("click", openCart);
  $("#barButton").addEventListener("click", openCart);
  $("#closeCart").addEventListener("click", closeCart);
  $("#overlay").addEventListener("click", closeCart);
  $("#sendOrder").addEventListener("click", sendOrder);
  $("#repeatOrder").addEventListener("click", repeatLastOrder);
  $("#clearOrder").addEventListener("click", clearOrder);

  $("#fieldPhone").addEventListener("input", (event) => {
    event.target.value = formatPhone(event.target.value);
  });
  $("#checkoutForm").addEventListener("input", persistForm);

  // Cupom de desconto
  $("#applyCoupon").addEventListener("click", () => aplicarCupom($("#couponInput").value)());
  $("#couponInput").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    aplicarCupom($("#couponInput").value)();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    fecharCombo();
    closeMenu();
    closeCart();
  });

  ligarCombo();
}

// Liga os links e o aviso do topo ao dados.js (tudo editável no painel admin).
function aplicarDadosDaLoja() {
  document.querySelectorAll("[data-link-whatsapp]").forEach((link) => {
    link.href = `https://wa.me/${WHATSAPP_NUMBER}`;
  });
  if (INSTAGRAM) {
    document.querySelectorAll("[data-link-instagram]").forEach((link) => {
      link.href = `https://instagram.com/${INSTAGRAM}`;
    });
  }

  const aviso = $("#aviso");
  if (aviso && LOJA.aviso) {
    aviso.textContent = LOJA.aviso;
    aviso.hidden = false;
  }

  // Nome e assinatura também vêm das configurações da loja
  document.querySelectorAll("[data-loja-nome]").forEach((elemento) => {
    elemento.textContent = LOJA.nome || "Marmitas POA";
  });
  document.querySelectorAll("[data-loja-slogan]").forEach((elemento) => {
    elemento.textContent = LOJA.slogan || "comida de verdade";
  });

  // Logo: quando existe, substitui o selo com as iniciais e vira o ícone da aba
  if (LOGO.thumb) {
    document.querySelectorAll("[data-logo]").forEach((alvo) => {
      const imagem = document.createElement("img");
      imagem.className = "brand-logo";
      imagem.alt = "";
      imagem.src = LOGO.thumb;
      alvo.classList.add("tem-logo");
      alvo.replaceChildren(imagem);
    });
    const icone = document.getElementById("favicon");
    if (icone) icone.href = LOGO.thumb;
  }

  const marca = $(".topbar .brand");
  if (marca) marca.setAttribute("aria-label", `${LOJA.nome || "Marmitas POA"}, início`);

  if (USANDO_RASCUNHO) {
    const faixa = $("#rascunho");
    if (faixa) faixa.hidden = false;
  }

  document.title = `${LOJA.nome || "Marmitas POA"} | ${LOJA.slogan || "Comida de verdade"}`;
}

function init() {
  document.documentElement.classList.add("js");
  aplicarDadosDaLoja();
  restoreCart();
  restoreForm();
  bindEvents();
  renderFilters();
  renderCombos();
  renderMenu();
  renderCart();
  setupMarquee();
  setupCartoesDoHero();
  setupReveal();
  setupScrollEffects();
  setupHeroParallax();

  if (SEM_DADOS) {
    $("#resultCount").textContent = "Não encontramos o arquivo dados.js, então o cardápio não pôde ser carregado.";
  }

  const saved = store(STORAGE.cart);
  if (Array.isArray(saved) && saved.length) toast("Recuperamos seu pedido anterior");
}

init();
