/* ==========================================================================
   Painel administrativo — Marmitas POA
   - Edita cardápio, combos, cupons, promoções e configurações da loja
   - Guarda tudo como rascunho no localStorage deste navegador
   - Publica o dados.js (o site público lê esse arquivo) ou baixa uma cópia
   ========================================================================== */

const CHAVES = {
  rascunho: "marmitaspoa.draft.v1",
};
const VAZIO = { versao: 2, atualizadoEm: "", loja: {}, categorias: [], pratos: [], combos: [], cupons: [], promocoes: [] };
const UPLOAD = { disponivel: null }; // null = ainda não verificado

const $ = (seletor, contexto = document) => contexto.querySelector(seletor);
const $$ = (seletor, contexto = document) => [...contexto.querySelectorAll(seletor)];
const clone = (valor) => JSON.parse(JSON.stringify(valor));
const num = (valor) => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};
const esc = (valor) =>
  String(valor ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const brl = (valor) => num(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const uid = (prefixo) => `${prefixo}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function toast(mensagem) {
  const area = $("#toasts");
  const elemento = document.createElement("div");
  elemento.className = "adm-toast";
  elemento.textContent = mensagem;
  area.append(elemento);
  setTimeout(() => elemento.remove(), 2600);
}

// Todo pedido que mexe em algo sai com X-Painel: o servidor recusa o que não
// vier do próprio painel (é o que segura CSRF). Sessão vencida volta ao login.
async function api(caminho, opcoes = {}) {
  const resposta = await fetch(caminho, {
    ...opcoes,
    headers: { "X-Painel": "1", ...(opcoes.headers || {}) },
  });
  if (resposta.status === 401) {
    mostrarLogin("Entre novamente para continuar.");
    throw Object.assign(new Error("sessão encerrada"), { status: 401 });
  }
  return resposta;
}

/* --------------------------------------------------------------- armazenamento */
// PUBLICADO é o que está no dados.js do site; o rascunho deste navegador tem
// prioridade enquanto você edita. Publicar grava o rascunho no dados.js e
// atualiza esta referência, para o painel voltar a dizer "tudo publicado".
let PUBLICADO = clone(window.DADOS || VAZIO);
let rascunho = carregarRascunho();

function carregarRascunho() {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVES.rascunho) || "null");
    if (salvo && Array.isArray(salvo.pratos)) return salvo;
  } catch (erro) {
    /* rascunho corrompido: começa do publicado */
  }
  return clone(PUBLICADO);
}

function salvar() {
  try {
    localStorage.setItem(CHAVES.rascunho, JSON.stringify(rascunho));
  } catch (erro) {
    toast("Não consegui salvar no navegador (armazenamento cheio?)");
  }
  atualizarStatus();
}

function temAlteracoes() {
  return JSON.stringify(rascunho) !== JSON.stringify(PUBLICADO);
}

function atualizarStatus() {
  const sujo = temAlteracoes();
  const selo = $("#statusRascunho");
  selo.textContent = sujo ? "Alterações não publicadas" : "Tudo publicado";
  selo.className = `adm-status${sujo ? " is-dirty" : ""}`;

  const painel = $("#publishStatus");
  if (painel) {
    painel.textContent = sujo
      ? "Estas alterações ainda valem só neste navegador. Clique em Publicar agora para gravar o dados.js do site."
      : "Tudo igual ao que já está publicado no site.";
    painel.className = `adm-publish-status${sujo ? " is-dirty" : ""}`;
  }
}

/* ------------------------------------------------------------------ pratos */
const estado = { aba: "cardapio", busca: "", categoria: "" };

function categoriasDisponiveis() {
  const doDados = rascunho.categorias || [];
  const dosPratos = rascunho.pratos.map((prato) => prato.categoria).filter(Boolean);
  return [...new Set([...doDados, ...dosPratos])];
}

function precosDe(tamanhos) {
  return (tamanhos || []).map((t) => num(t.preco));
}

function linhaTamanho(tamanho = {}) {
  return `<div class="adm-row3" data-linha>
    <input data-tamanho="rotulo" placeholder="Rótulo (ex.: 400 g)" value="${esc(tamanho.rotulo || "")}" />
    <input data-tamanho="preco" type="number" min="0" step="0.01" placeholder="Preço" value="${num(tamanho.preco)}" />
    <button class="adm-btn adm-btn-sm adm-btn-danger" data-acao="del-tamanho" type="button">remover</button>
  </div>`;
}

function blocoTamanhos(tamanhos) {
  const lista = tamanhos && tamanhos.length ? tamanhos : [{ rotulo: "400 g", preco: 0 }];
  return `<div class="adm-sub" data-tamanhos>
    <div class="adm-sub-head"><b>Tamanhos e preços</b><button class="adm-btn adm-btn-sm" data-acao="add-tamanho" type="button">+ tamanho</button></div>
    <div class="adm-rows">${lista.map(linhaTamanho).join("")}</div>
  </div>`;
}

/* ------------------------------------------------------------ foto do prato */
function fotoPadrao() {
  return (PUBLICADO.loja && PUBLICADO.loja.fotoPadrao) || "img/marmita-padrao.jpg";
}

function blocoFoto(prato) {
  const atual = prato.foto || "";
  const aviso =
    UPLOAD.disponivel === false
      ? '<small class="adm-foto-aviso">Envio de fotos indisponível agora. Confirme se o servidor do site está rodando e tente de novo.</small>'
      : "";
  return `<div class="adm-sub adm-foto" data-foto-bloco data-foto-campo="foto" data-foto-campo-thumb="fotoThumb" data-foto-nome="${esc(prato.nome || "prato")}">
    <div class="adm-sub-head">
      <b>Foto do prato</b>
      <span class="adm-foto-status" data-foto-status></span>
    </div>
    <div class="adm-foto-area">
      <div class="adm-foto-preview"><img data-foto-img alt="" src="${esc(atual || fotoPadrao())}" /></div>
      <div class="adm-foto-acoes">
        <input type="file" accept="image/jpeg,image/png,image/webp" data-foto-arquivo hidden />
        <button class="adm-btn adm-btn-primary adm-btn-sm" data-acao="foto-escolher" type="button">Enviar imagem</button>
        <button class="adm-btn adm-btn-sm" data-acao="foto-padrao" type="button">Usar a padrão</button>
        <small>JPG, PNG ou WEBP até 10 MB. A imagem é reduzida automaticamente e você também pode arrastar o arquivo para cá.</small>
        ${aviso}
      </div>
    </div>
    <label class="adm-foto-caminho">Caminho da imagem <small>(preenchido ao enviar; também aceita URL)</small>
      <input data-campo="foto" value="${esc(atual)}" placeholder="img/pratos/nome.jpg" />
    </label>
    <input type="hidden" data-campo="fotoThumb" value="${esc(prato.fotoThumb || "")}" />
  </div>`;
}

function itemPrato(prato) {
  const ativo = prato.ativo !== false;
  const precos = precosDe(prato.tamanhos);
  const menor = precos.length ? Math.min(...precos) : 0;
  return `<article class="adm-item${ativo ? "" : " is-off"}" data-id="${esc(prato.id)}">
    <header class="adm-item-head">
      <div class="adm-item-title">
        <b>${esc(prato.nome)}</b>
        <small>${esc(prato.categoria || "sem categoria")} · ${esc(menor ? brl(menor) : "sem preço")} ${
    prato.kcal ? `· ${esc(prato.kcal)} kcal` : ""
  } ${prato.semLactose ? "· sem lactose" : ""}</small>
      </div>
      <div class="adm-item-actions">
        ${ativo ? '<span class="adm-badge">no site</span>' : '<span class="adm-badge is-warn">oculto</span>'}
        <label class="adm-switch"><input type="checkbox" data-acao="ativo" ${ativo ? "checked" : ""} /> Ativo</label>
        <button class="adm-btn adm-btn-sm" data-acao="editar" type="button">Editar</button>
        <button class="adm-btn adm-btn-sm" data-acao="duplicar" type="button">Duplicar</button>
        <button class="adm-btn adm-btn-sm adm-btn-danger" data-acao="excluir" type="button">Excluir</button>
      </div>
    </header>
    <form class="adm-form" data-form hidden>
      <div class="adm-grid">
        <label>Nome do prato<input data-campo="nome" value="${esc(prato.nome)}" /></label>
        <label>Categoria<input data-campo="categoria" list="listaCategorias" value="${esc(prato.categoria || "")}" /></label>
        <label>Descrição / acompanhamentos<input data-campo="descricao" value="${esc(prato.descricao || "")}" /></label>
        <label>Calorias (kcal)<input data-campo="kcal" type="number" min="0" value="${prato.kcal ?? ""}" /></label>
        <label class="adm-inline"><input data-campo="semLactose" type="checkbox" ${prato.semLactose ? "checked" : ""} /> Sem lactose</label>
      </div>
      ${blocoFoto(prato)}
      ${blocoTamanhos(prato.tamanhos)}
      <div class="adm-actions">
        <button class="adm-btn adm-btn-primary" data-acao="salvar" type="button">Salvar prato</button>
        <button class="adm-btn" data-acao="cancelar" type="button">Cancelar</button>
      </div>
    </form>
  </article>`;
}

function pratosVisiveis() {
  const termo = estado.busca.trim().toLowerCase();
  return rascunho.pratos.filter((prato) => {
    if (estado.categoria && prato.categoria !== estado.categoria) return false;
    if (!termo) return true;
    return `${prato.nome} ${prato.categoria} ${prato.descricao}`.toLowerCase().includes(termo);
  });
}

function renderPratos() {
  const lista = pratosVisiveis();
  const ativos = rascunho.pratos.filter((prato) => prato.ativo !== false).length;
  $("#contagemPratos").textContent = `${lista.length} de ${rascunho.pratos.length} pratos · ${ativos} aparecem no site`;

  $("#listaPratos").innerHTML =
    lista.map(itemPrato).join("") || '<p class="adm-help">Nenhum prato encontrado com esse filtro.</p>';

  $("#filtroCategoria").innerHTML =
    '<option value="">Todas as categorias</option>' +
    categoriasDisponiveis()
      .map((categoria) => `<option value="${esc(categoria)}"${categoria === estado.categoria ? " selected" : ""}>${esc(categoria)}</option>`)
      .join("");

  $("#listaCategorias").innerHTML = categoriasDisponiveis()
    .map((categoria) => `<option value="${esc(categoria)}"></option>`)
    .join("");
}

function lerTamanhos(form) {
  return $$("[data-linha]", form)
    .map((linha) => ({
      rotulo: $('[data-tamanho="rotulo"]', linha).value.trim() || "porção",
      preco: num($('[data-tamanho="preco"]', linha).value),
    }))
    .filter((tamanho) => tamanho.rotulo);
}

function lerFormularioPrato(form) {
  const valor = (campo) => ($(`[data-campo="${campo}"]`, form).value || "").trim();
  const marcado = (campo) => $(`[data-campo="${campo}"]`, form).checked;
  const tamanhos = lerTamanhos(form);
  return {
    nome: valor("nome"),
    categoria: valor("categoria") || "Outros",
    descricao: valor("descricao"),
    kcal: valor("kcal") === "" ? null : num(valor("kcal")),
    foto: valor("foto"),
    fotoThumb: valor("fotoThumb") || valor("foto"),
    semLactose: marcado("semLactose"),
    tamanhos: tamanhos.length ? tamanhos : [{ rotulo: "porção", preco: 0 }],
  };
}

function garantirCategoria(categoria) {
  if (!categoria) return;
  if (!Array.isArray(rascunho.categorias)) rascunho.categorias = [];
  if (!rascunho.categorias.includes(categoria)) rascunho.categorias.push(categoria);
}

/* --------------------------------------------------------- envio de fotos */
function lerArquivo(arquivo) {
  return new Promise((resolver, rejeitar) => {
    const imagem = new Image();
    imagem.onload = () => resolver(imagem);
    imagem.onerror = () => rejeitar(new Error("não consegui ler essa imagem"));
    imagem.src = URL.createObjectURL(arquivo);
  });
}

// O navegador só gera WebP no canvas se souber codificar; senão mandamos JPEG e o
// servidor converte de qualquer forma.
let cacheWebP = null;
function suportaWebP() {
  if (cacheWebP === null) {
    try {
      cacheWebP = document.createElement("canvas").toDataURL("image/webp").startsWith("data:image/webp");
    } catch (erro) {
      cacheWebP = false;
    }
  }
  return cacheWebP;
}

// Reduz antes de enviar: fotos de celular costumam ter 3 a 5 MB.
async function prepararImagem(arquivo, larguraMaxima = 1400) {
  const imagem = await lerArquivo(arquivo);
  const escala = Math.min(1, larguraMaxima / Math.max(imagem.naturalWidth, imagem.naturalHeight));
  const tela = document.createElement("canvas");
  tela.width = Math.max(1, Math.round(imagem.naturalWidth * escala));
  tela.height = Math.max(1, Math.round(imagem.naturalHeight * escala));
  tela.getContext("2d").drawImage(imagem, 0, 0, tela.width, tela.height);
  URL.revokeObjectURL(imagem.src);
  const blob = await new Promise((resolver) =>
    tela.toBlob(resolver, suportaWebP() ? "image/webp" : "image/jpeg", 0.82)
  );
  if (!blob) throw new Error("não consegui processar a imagem");
  return blob;
}

async function enviarImagem(blob, nome, tipo) {
  const parametros = new URLSearchParams({ nome: nome || "foto" });
  if (tipo) parametros.set("tipo", tipo);
  const resposta = await api(`/upload?${parametros}`, {
    method: "POST",
    headers: { "Content-Type": blob.type || "image/jpeg" },
    body: blob,
  });
  if (!resposta.ok) {
    const detalhe = await resposta.json().catch(() => ({}));
    const erro = new Error(detalhe.erro || `falha no envio (${resposta.status})`);
    erro.status = resposta.status;
    throw erro;
  }
  return resposta.json();
}

function camposDoBloco(bloco) {
  return {
    foto: bloco.dataset.fotoCampo || "foto",
    thumb: bloco.dataset.fotoCampoThumb || "fotoThumb",
  };
}

function atualizarPreview(bloco) {
  const { foto } = camposDoBloco(bloco);
  const entrada = $(`[data-campo="${foto}"]`, bloco);
  const caminho = (entrada && entrada.value ? entrada.value : "").trim();
  // Sem imagem, o prato mostra a foto padrão e o logo mostra o selo do site.
  const padrao = bloco.dataset.fotoTipo === "logo" ? "img/favicon.svg" : fotoPadrao();
  $("[data-foto-img]", bloco).src = caminho || padrao;
}

function mensagemDeEnvio(erro) {
  if (!erro.status || erro.status === 501 || erro.status === 405 || erro.status === 404) {
    return "Envio indisponível agora. Confirme se o servidor do site está rodando.";
  }
  return erro.message || "Não consegui enviar a imagem";
}

// Sobe a imagem de um bloco de foto. Quem chamou decide onde gravar: no prato
// ou nas configurações da loja (foto padrão).
async function subirFotoDoBloco(bloco, arquivo, aoGravar) {
  if (!bloco || !arquivo) return;
  const status = $("[data-foto-status]", bloco);
  if (!String(arquivo.type || "").startsWith("image/")) {
    toast("Escolha um arquivo de imagem (JPG, PNG ou WEBP)");
    return;
  }
  const { foto, thumb } = camposDoBloco(bloco);
  status.textContent = "Enviando imagem...";
  try {
    const blob = await prepararImagem(arquivo);
    const dados = await enviarImagem(blob, bloco.dataset.fotoNome || "foto", bloco.dataset.fotoTipo || "prato");
    $(`[data-campo="${foto}"]`, bloco).value = dados.foto;
    $(`[data-campo="${thumb}"]`, bloco).value = dados.fotoThumb || dados.foto;
    atualizarPreview(bloco);
    aoGravar(dados.foto, dados.fotoThumb || dados.foto);
    UPLOAD.disponivel = true;
    status.textContent = "Foto salva em WebP";
    const kb = Math.round((dados.bytes || 0) / 1024);
    const economia = dados.economia ? ` · ${Math.round(dados.economia * 100)}% menor` : "";
    toast(`Foto enviada: ${kb} KB${economia}`);
  } catch (erro) {
    if (!erro.status || erro.status === 501 || erro.status === 405) UPLOAD.disponivel = false;
    status.textContent = "";
    toast(mensagemDeEnvio(erro));
  }
  setTimeout(() => {
    status.textContent = "";
  }, 3000);
}

// A foto do prato vai para o rascunho na hora, para não se perder se a tela fechar.
async function subirFoto(prato, item, arquivo) {
  await subirFotoDoBloco($("[data-foto-bloco]", item), arquivo, (foto, thumb) => {
    prato.foto = foto;
    prato.fotoThumb = thumb;
    salvar();
  });
}

function gravarFoto(prato, item) {
  const bloco = $("[data-foto-bloco]", item);
  const { foto, thumb } = camposDoBloco(bloco);
  prato.foto = $(`[data-campo="${foto}"]`, bloco).value.trim();
  prato.fotoThumb = $(`[data-campo="${thumb}"]`, bloco).value.trim() || prato.foto;
  salvar();
}

function ligarPratos() {
  const container = $("#listaPratos");

  container.addEventListener("click", (event) => {
    const botao = event.target.closest("[data-acao]");
    if (!botao) return;
    const item = botao.closest(".adm-item");
    const prato = rascunho.pratos.find((p) => p.id === item.dataset.id);
    if (!prato) return;
    const acao = botao.dataset.acao;

    if (acao === "editar" || acao === "cancelar") {
      const form = $("[data-form]", item);
      if (acao === "cancelar") {
        renderPratos();
        return;
      }
      form.hidden = !form.hidden;
      botao.textContent = form.hidden ? "Editar" : "Fechar";
      if (!form.hidden) $("[data-campo='nome']", form).focus();
      return;
    }

    if (acao === "foto-escolher") {
      $("[data-foto-arquivo]", item).click();
      return;
    }

    if (acao === "foto-padrao") {
      $('[data-campo="foto"]', item).value = "";
      $('[data-campo="fotoThumb"]', item).value = "";
      atualizarPreview(item);
      gravarFoto(prato, item);
      toast("Este prato voltou a usar a foto padrão");
      return;
    }

    if (acao === "add-tamanho") {
      $("[data-tamanhos] .adm-rows", item).insertAdjacentHTML("beforeend", linhaTamanho());
      return;
    }

    if (acao === "del-tamanho") {
      const linha = botao.closest("[data-linha]");
      const total = $$("[data-linha]", item).length;
      if (total > 1) linha.remove();
      else toast("O prato precisa de pelo menos um tamanho");
      return;
    }

    if (acao === "duplicar") {
      const copia = clone(prato);
      copia.id = uid("p");
      copia.nome = `${prato.nome} (cópia)`;
      const posicao = rascunho.pratos.indexOf(prato);
      rascunho.pratos.splice(posicao + 1, 0, copia);
      garantirCategoria(copia.categoria);
      salvar();
      renderPratos();
      toast("Prato duplicado");
      return;
    }

    if (acao === "excluir") {
      if (!window.confirm(`Excluir "${prato.nome}"? Isso não pode ser desfeito.`)) return;
      rascunho.pratos = rascunho.pratos.filter((p) => p.id !== prato.id);
      salvar();
      renderPratos();
      toast("Prato excluído");
      return;
    }

    if (acao === "salvar") {
      const dados = lerFormularioPrato($("[data-form]", item));
      if (dados.nome.length < 2) {
        toast("Dê um nome ao prato");
        return;
      }
      if (!precosDe(dados.tamanhos).some((preco) => preco > 0)) {
        toast("Informe pelo menos um preço maior que zero");
        return;
      }
      Object.assign(prato, dados);
      garantirCategoria(dados.categoria);
      salvar();
      renderPratos();
      toast(`"${dados.nome}" salvo`);
    }
  });

  container.addEventListener("change", (event) => {
    const caixa = event.target.closest('[data-acao="ativo"]');
    if (!caixa) return;
    const item = caixa.closest(".adm-item");
    const prato = rascunho.pratos.find((p) => p.id === item.dataset.id);
    if (!prato) return;
    prato.ativo = caixa.checked;
    salvar();
    renderPratos();
  });

  // Arquivo escolhido no botão "Enviar imagem"
  container.addEventListener("change", (event) => {
    const entrada = event.target.closest("[data-foto-arquivo]");
    if (!entrada) return;
    const item = entrada.closest(".adm-item");
    const prato = rascunho.pratos.find((p) => p.id === item.dataset.id);
    if (prato) subirFoto(prato, item, entrada.files[0]);
    entrada.value = "";
  });

  // Arrastar e soltar a imagem sobre o bloco de foto
  container.addEventListener("dragover", (event) => {
    const bloco = event.target.closest("[data-foto-bloco]");
    if (!bloco) return;
    event.preventDefault();
    bloco.classList.add("is-dragover");
  });
  container.addEventListener("dragleave", (event) => {
    const bloco = event.target.closest("[data-foto-bloco]");
    if (bloco) bloco.classList.remove("is-dragover");
  });
  container.addEventListener("drop", (event) => {
    const bloco = event.target.closest("[data-foto-bloco]");
    if (!bloco) return;
    event.preventDefault();
    bloco.classList.remove("is-dragover");
    const item = bloco.closest(".adm-item");
    const prato = rascunho.pratos.find((p) => p.id === item.dataset.id);
    const arquivo = event.dataTransfer.files[0];
    if (prato && arquivo) subirFoto(prato, item, arquivo);
  });
}

function adicionarPrato() {
  const prato = {
    id: uid("p"),
    nome: "Novo prato",
    categoria: estado.categoria || categoriasDisponiveis()[0] || "Tradicional",
    descricao: "",
    kcal: null,
    semLactose: false,
    foto: "",
    fotoThumb: "",
    ativo: true,
    tamanhos: [
      { rotulo: "400 g", preco: 23 },
      { rotulo: "600 g", preco: 26 },
    ],
  };
  rascunho.pratos.unshift(prato);
  salvar();
  estado.busca = "";
  estado.categoria = "";
  $("#buscaPrato").value = "";
  renderPratos();
  const primeiro = $(`#listaPratos .adm-item[data-id="${prato.id}"]`);
  if (primeiro) {
    $("[data-form]", primeiro).hidden = false;
    $("[data-acao='editar']", primeiro).textContent = "Fechar";
    primeiro.scrollIntoView({ block: "center" });
    $("[data-campo='nome']", primeiro).select();
  }
  toast("Preencha os dados do novo prato");
}

/* ------------------------------------------------------------------ combos */
function linhaOpcaoCombo(opcao = {}) {
  return `<div class="adm-row4" data-linha>
    <input data-opcao="rotulo" placeholder="Rótulo (400 g)" value="${esc(opcao.rotulo || "")}" />
    <input data-opcao="preco" type="number" min="0" step="0.01" placeholder="Preço total" value="${num(opcao.preco)}" />
    <input data-opcao="unitario" type="number" min="0" step="0.01" placeholder="Por marmita" value="${num(opcao.unitario)}" />
    <button class="adm-btn adm-btn-sm adm-btn-danger" data-acao="del-opcao" type="button">remover</button>
  </div>`;
}

function itemCombo(combo) {
  const ativo = combo.ativo !== false;
  const opcoes = combo.opcoes || [];
  return `<article class="adm-item${ativo ? "" : " is-off"}" data-id="${esc(combo.id)}">
    <header class="adm-item-head">
      <div class="adm-item-title">
        <b>${esc(combo.nome)}</b>
        <small>${esc(combo.quantidade || 0)} marmitas · ${
    opcoes.length ? esc(opcoes.map((o) => brl(o.preco)).join(" / ")) : "sem preço"
  }${combo.destaque ? " · em destaque" : ""}</small>
      </div>
      <div class="adm-item-actions">
        ${ativo ? '<span class="adm-badge">no site</span>' : '<span class="adm-badge is-warn">oculto</span>'}
        <label class="adm-switch"><input type="checkbox" data-acao="ativo" ${ativo ? "checked" : ""} /> Ativo</label>
        <button class="adm-btn adm-btn-sm" data-acao="editar" type="button">Editar</button>
        <button class="adm-btn adm-btn-sm adm-btn-danger" data-acao="excluir" type="button">Excluir</button>
      </div>
    </header>
    <form class="adm-form" data-form hidden>
      <div class="adm-grid">
        <label>Nome do combo<input data-campo="nome" value="${esc(combo.nome)}" /></label>
        <label>Quantidade de marmitas<input data-campo="quantidade" type="number" min="1" value="${num(combo.quantidade)}" /></label>
        <label>Foto <small>(opcional)</small><input data-campo="foto" value="${esc(combo.foto || "")}" /></label>
        <label class="adm-inline"><input data-campo="destaque" type="checkbox" ${combo.destaque ? "checked" : ""} /> Destacar no site</label>
      </div>
      <div class="adm-sub" data-opcoes>
        <div class="adm-sub-head"><b>Tamanhos, preço total e preço por marmita</b><button class="adm-btn adm-btn-sm" data-acao="add-opcao" type="button">+ tamanho</button></div>
        <div class="adm-rows">${opcoes.map(linhaOpcaoCombo).join("") || linhaOpcaoCombo()}</div>
      </div>
      <div class="adm-actions">
        <button class="adm-btn adm-btn-primary" data-acao="salvar" type="button">Salvar combo</button>
        <button class="adm-btn" data-acao="cancelar" type="button">Cancelar</button>
      </div>
    </form>
  </article>`;
}

function renderCombos() {
  $("#listaCombos").innerHTML =
    rascunho.combos.map(itemCombo).join("") || '<p class="adm-help">Nenhum combo cadastrado.</p>';
}

function ligarCombos() {
  const container = $("#listaCombos");

  container.addEventListener("click", (event) => {
    const botao = event.target.closest("[data-acao]");
    if (!botao) return;
    const item = botao.closest(".adm-item");
    const combo = rascunho.combos.find((c) => c.id === item.dataset.id);
    if (!combo) return;
    const acao = botao.dataset.acao;

    if (acao === "editar" || acao === "cancelar") {
      if (acao === "cancelar") {
        renderCombos();
        return;
      }
      const form = $("[data-form]", item);
      form.hidden = !form.hidden;
      botao.textContent = form.hidden ? "Editar" : "Fechar";
      return;
    }

    if (acao === "add-opcao") {
      $("[data-opcoes] .adm-rows", item).insertAdjacentHTML("beforeend", linhaOpcaoCombo());
      return;
    }

    if (acao === "del-opcao") {
      const linhas = $$("[data-linha]", item);
      if (linhas.length > 1) botao.closest("[data-linha]").remove();
      else toast("O combo precisa de pelo menos um tamanho");
      return;
    }

    if (acao === "excluir") {
      if (!window.confirm(`Excluir "${combo.nome}"?`)) return;
      rascunho.combos = rascunho.combos.filter((c) => c.id !== combo.id);
      salvar();
      renderCombos();
      toast("Combo excluído");
      return;
    }

    if (acao === "salvar") {
      const form = $("[data-form]", item);
      const nome = $('[data-campo="nome"]', form).value.trim();
      const quantidade = num($('[data-campo="quantidade"]', form).value);
      const opcoes = $$("[data-linha]", form)
        .map((linha) => ({
          rotulo: $('[data-opcao="rotulo"]', linha).value.trim() || "porção",
          preco: num($('[data-opcao="preco"]', linha).value),
          unitario: num($('[data-opcao="unitario"]', linha).value),
        }))
        .filter((opcao) => opcao.rotulo);

      if (nome.length < 2) return toast("Dê um nome ao combo");
      if (quantidade < 1) return toast("Informe a quantidade de marmitas");
      if (!opcoes.some((opcao) => opcao.preco > 0)) return toast("Informe pelo menos um preço");

      combo.nome = nome;
      combo.quantidade = quantidade;
      combo.foto = $('[data-campo="foto"]', form).value.trim();
      combo.destaque = $('[data-campo="destaque"]', form).checked;
      combo.opcoes = opcoes.map((opcao) => ({
        ...opcao,
        unitario: opcao.unitario > 0 ? opcao.unitario : Math.round((opcao.preco / quantidade) * 100) / 100,
      }));
      salvar();
      renderCombos();
      toast(`"${nome}" salvo`);
    }
  });

  container.addEventListener("change", (event) => {
    const caixa = event.target.closest('[data-acao="ativo"]');
    if (!caixa) return;
    const combo = rascunho.combos.find((c) => c.id === caixa.closest(".adm-item").dataset.id);
    if (!combo) return;
    combo.ativo = caixa.checked;
    salvar();
    renderCombos();
  });
}

/* ------------------------------------------------------------------ cupons */
function resumoCupom(cupom) {
  const desconto = cupom.tipo === "valor" ? `${brl(cupom.valor)} de desconto` : `${num(cupom.valor)}% de desconto`;
  const partes = [desconto];
  if (num(cupom.minimo) > 0) partes.push(`mínimo ${brl(cupom.minimo)}`);
  if (cupom.inicio) partes.push(`a partir de ${cupom.inicio.split("-").reverse().join("/")}`);
  if (cupom.fim) partes.push(`até ${cupom.fim.split("-").reverse().join("/")}`);
  return partes.join(" · ");
}

function itemCupom(cupom) {
  const ativo = cupom.ativo !== false;
  return `<article class="adm-item${ativo ? "" : " is-off"}" data-id="${esc(cupom.id)}">
    <header class="adm-item-head">
      <div class="adm-item-title">
        <b>${esc(cupom.codigo)}</b>
        <small>${esc(resumoCupom(cupom))}${cupom.descricao ? ` · ${esc(cupom.descricao)}` : ""}</small>
      </div>
      <div class="adm-item-actions">
        ${ativo ? '<span class="adm-badge">valendo</span>' : '<span class="adm-badge is-warn">inativo</span>'}
        <label class="adm-switch"><input type="checkbox" data-acao="ativo" ${ativo ? "checked" : ""} /> Ativo</label>
        <button class="adm-btn adm-btn-sm" data-acao="editar" type="button">Editar</button>
        <button class="adm-btn adm-btn-sm" data-acao="duplicar" type="button">Duplicar</button>
        <button class="adm-btn adm-btn-sm adm-btn-danger" data-acao="excluir" type="button">Excluir</button>
      </div>
    </header>
    <form class="adm-form" data-form hidden>
      <div class="adm-grid">
        <label>Código que o cliente digita<input data-campo="codigo" value="${esc(cupom.codigo)}" /></label>
        <label>Tipo de desconto
          <select data-campo="tipo">
            <option value="percentual"${cupom.tipo !== "valor" ? " selected" : ""}>Percentual (%)</option>
            <option value="valor"${cupom.tipo === "valor" ? " selected" : ""}>Valor fixo (R$)</option>
          </select>
        </label>
        <label>Valor do desconto<input data-campo="valor" type="number" min="0" step="0.01" value="${num(cupom.valor)}" /></label>
        <label>Pedido mínimo (R$)<input data-campo="minimo" type="number" min="0" step="0.01" value="${num(cupom.minimo)}" /></label>
        <label>Começa em <small>(opcional)</small><input data-campo="inicio" type="date" value="${esc(cupom.inicio || "")}" /></label>
        <label>Termina em <small>(opcional)</small><input data-campo="fim" type="date" value="${esc(cupom.fim || "")}" /></label>
        <label>Limite de usos <small>(0 = sem limite; só informativo)</small><input data-campo="usoMaximo" type="number" min="0" value="${num(cupom.usoMaximo)}" /></label>
        <label>Descrição para o cliente<input data-campo="descricao" value="${esc(cupom.descricao || "")}" /></label>
      </div>
      <div class="adm-actions">
        <button class="adm-btn adm-btn-primary" data-acao="salvar" type="button">Salvar cupom</button>
        <button class="adm-btn" data-acao="cancelar" type="button">Cancelar</button>
      </div>
    </form>
  </article>`;
}

function renderCupons() {
  $("#listaCupons").innerHTML =
    rascunho.cupons.map(itemCupom).join("") || '<p class="adm-help">Nenhum cupom cadastrado.</p>';
}

function ligarCupons() {
  const container = $("#listaCupons");

  container.addEventListener("click", (event) => {
    const botao = event.target.closest("[data-acao]");
    if (!botao) return;
    const item = botao.closest(".adm-item");
    const cupom = rascunho.cupons.find((c) => c.id === item.dataset.id);
    if (!cupom) return;
    const acao = botao.dataset.acao;

    if (acao === "editar" || acao === "cancelar") {
      if (acao === "cancelar") {
        renderCupons();
        return;
      }
      const form = $("[data-form]", item);
      form.hidden = !form.hidden;
      botao.textContent = form.hidden ? "Editar" : "Fechar";
      return;
    }

    if (acao === "duplicar") {
      const copia = clone(cupom);
      copia.id = uid("cupom");
      copia.codigo = `${cupom.codigo}-COPIA`;
      rascunho.cupons.push(copia);
      salvar();
      renderCupons();
      toast("Cupom duplicado");
      return;
    }

    if (acao === "excluir") {
      if (!window.confirm(`Excluir o cupom "${cupom.codigo}"?`)) return;
      rascunho.cupons = rascunho.cupons.filter((c) => c.id !== cupom.id);
      salvar();
      renderCupons();
      toast("Cupom excluído");
      return;
    }

    if (acao === "salvar") {
      const form = $("[data-form]", item);
      const valor = (campo) => ($(`[data-campo="${campo}"]`, form).value || "").trim();
      const codigo = valor("codigo").toUpperCase().replace(/\s+/g, "");
      const desconto = num(valor("valor"));
      const inicio = valor("inicio");
      const fim = valor("fim");

      if (codigo.length < 3) return toast("O código precisa de pelo menos 3 caracteres");
      if (desconto <= 0) return toast("Informe o valor do desconto");
      if (valor("tipo") !== "valor" && desconto > 100) return toast("Percentual não pode passar de 100%");
      if (inicio && fim && inicio > fim) return toast("A data final é anterior à inicial");
      const repetido = rascunho.cupons.some((c) => c.id !== cupom.id && c.codigo === codigo);
      if (repetido) return toast("Já existe um cupom com esse código");

      Object.assign(cupom, {
        codigo,
        tipo: valor("tipo"),
        valor: desconto,
        minimo: num(valor("minimo")),
        inicio,
        fim,
        usoMaximo: num(valor("usoMaximo")),
        descricao: valor("descricao"),
      });
      salvar();
      renderCupons();
      toast(`Cupom ${codigo} salvo`);
    }
  });

  container.addEventListener("change", (event) => {
    const caixa = event.target.closest('[data-acao="ativo"]');
    if (!caixa) return;
    const cupom = rascunho.cupons.find((c) => c.id === caixa.closest(".adm-item").dataset.id);
    if (!cupom) return;
    cupom.ativo = caixa.checked;
    salvar();
    renderCupons();
  });
}

/* -------------------------------------------------------------- promoções */
const TIPOS_PROMOCAO = {
  desconto_categoria: "Percentual em uma categoria",
  desconto_pedido: "Percentual no pedido inteiro",
};

function itemPromocao(promocao) {
  const ativo = promocao.ativo !== false;
  const tipo = TIPOS_PROMOCAO[promocao.tipo] || promocao.tipo;
  return `<article class="adm-item${ativo ? "" : " is-off"}" data-id="${esc(promocao.id)}">
    <header class="adm-item-head">
      <div class="adm-item-title">
        <b>${esc(promocao.nome)}</b>
        <small>${esc(tipo)} · ${num(promocao.valor)}%${
    promocao.tipo === "desconto_categoria" ? ` em ${esc(promocao.categoria || "sem categoria")}` : ""
  }${num(promocao.minimo) > 0 ? ` · mínimo ${brl(promocao.minimo)}` : ""}</small>
      </div>
      <div class="adm-item-actions">
        ${ativo ? '<span class="adm-badge">valendo</span>' : '<span class="adm-badge is-warn">inativa</span>'}
        <label class="adm-switch"><input type="checkbox" data-acao="ativo" ${ativo ? "checked" : ""} /> Ativa</label>
        <button class="adm-btn adm-btn-sm" data-acao="editar" type="button">Editar</button>
        <button class="adm-btn adm-btn-sm adm-btn-danger" data-acao="excluir" type="button">Excluir</button>
      </div>
    </header>
    <form class="adm-form" data-form hidden>
      <div class="adm-grid">
        <label>Nome da promoção<input data-campo="nome" value="${esc(promocao.nome)}" /></label>
        <label>Tipo
          <select data-campo="tipo">
            ${Object.entries(TIPOS_PROMOCAO)
              .map(([valor, rotulo]) => `<option value="${valor}"${promocao.tipo === valor ? " selected" : ""}>${rotulo}</option>`)
              .join("")}
          </select>
        </label>
        <label>Categoria alvo <small>(só para desconto por categoria)</small>
          <select data-campo="categoria">
            <option value="">—</option>
            ${categoriasDisponiveis()
              .map((categoria) => `<option value="${esc(categoria)}"${promocao.categoria === categoria ? " selected" : ""}>${esc(categoria)}</option>`)
              .join("")}
          </select>
        </label>
        <label>Percentual de desconto (%)<input data-campo="valor" type="number" min="0" max="100" step="1" value="${num(promocao.valor)}" /></label>
        <label>Pedido mínimo (R$)<input data-campo="minimo" type="number" min="0" step="0.01" value="${num(promocao.minimo)}" /></label>
        <label>Descrição para o cliente<input data-campo="descricao" value="${esc(promocao.descricao || "")}" /></label>
      </div>
      <div class="adm-actions">
        <button class="adm-btn adm-btn-primary" data-acao="salvar" type="button">Salvar promoção</button>
        <button class="adm-btn" data-acao="cancelar" type="button">Cancelar</button>
      </div>
    </form>
  </article>`;
}

function renderPromocoes() {
  $("#listaPromocoes").innerHTML =
    rascunho.promocoes.map(itemPromocao).join("") || '<p class="adm-help">Nenhuma promoção cadastrada.</p>';
}

function ligarPromocoes() {
  const container = $("#listaPromocoes");

  container.addEventListener("click", (event) => {
    const botao = event.target.closest("[data-acao]");
    if (!botao) return;
    const item = botao.closest(".adm-item");
    const promocao = rascunho.promocoes.find((p) => p.id === item.dataset.id);
    if (!promocao) return;
    const acao = botao.dataset.acao;

    if (acao === "editar" || acao === "cancelar") {
      if (acao === "cancelar") {
        renderPromocoes();
        return;
      }
      const form = $("[data-form]", item);
      form.hidden = !form.hidden;
      botao.textContent = form.hidden ? "Editar" : "Fechar";
      return;
    }

    if (acao === "excluir") {
      if (!window.confirm(`Excluir a promoção "${promocao.nome}"?`)) return;
      rascunho.promocoes = rascunho.promocoes.filter((p) => p.id !== promocao.id);
      salvar();
      renderPromocoes();
      toast("Promoção excluída");
      return;
    }

    if (acao === "salvar") {
      const form = $("[data-form]", item);
      const valor = (campo) => ($(`[data-campo="${campo}"]`, form).value || "").trim();
      const nome = valor("nome");
      const tipo = valor("tipo");
      const percentual = num(valor("valor"));

      if (nome.length < 2) return toast("Dê um nome à promoção");
      if (percentual <= 0 || percentual > 100) return toast("O percentual deve ficar entre 1 e 100");
      if (tipo === "desconto_categoria" && !valor("categoria")) return toast("Escolha a categoria da promoção");

      Object.assign(promocao, {
        nome,
        tipo,
        categoria: valor("categoria"),
        valor: percentual,
        minimo: num(valor("minimo")),
        descricao: valor("descricao"),
      });
      salvar();
      renderPromocoes();
      toast(`"${nome}" salva`);
    }
  });

  container.addEventListener("change", (event) => {
    const caixa = event.target.closest('[data-acao="ativo"]');
    if (!caixa) return;
    const promocao = rascunho.promocoes.find((p) => p.id === caixa.closest(".adm-item").dataset.id);
    if (!promocao) return;
    promocao.ativo = caixa.checked;
    salvar();
    renderPromocoes();
  });
}

/* ------------------------------------------------------------------- loja */
function campoLoja(chave) {
  return $(`[data-loja="${chave}"]`);
}

// Junta as categorias digitadas, tirando repetidas e espaços sobrando.
function listaDeCategorias() {
  const vistos = new Set();
  const lista = [];
  (campoLoja("categorias").value || "").split(",").forEach((item) => {
    const categoria = item.trim();
    const chave = categoria.toLowerCase();
    if (!categoria || vistos.has(chave)) return;
    vistos.add(chave);
    lista.push(categoria);
  });
  return lista;
}

function atualizarStatusLoja() {
  const pendente = lojaPendente();
  const alvo = $("#lojaStatus");
  alvo.textContent = pendente ? "Alterações ainda não salvas" : "";
  alvo.className = `adm-hint${pendente ? " is-error" : ""}`;
}

// Mostra em texto o efeito de cada grupo, para não precisar abrir o site.
function atualizarPreviewsLoja() {
  const valor = (chave) => (campoLoja(chave).value || "").trim();
  const nome = valor("nome") || "Marmitas POA";
  const slogan = valor("slogan");
  $("#previewIdentidade").innerHTML = `<b>${esc(nome)}</b>${slogan ? ` · ${esc(slogan)}` : ""}`;

  const digitos = valor("whatsapp").replace(/\D/g, "");
  const instagram = valor("instagram").replace(/^@+/, "");
  $("#previewContato").innerHTML =
    digitos.length >= 12
      ? `O botão abre <b>wa.me/${esc(digitos)}</b>${instagram ? ` · Instagram <b>@${esc(instagram)}</b>` : ""}`
      : "Informe o WhatsApp com DDI e DDD para gerar o link do botão.";

  const taxa = num(valor("taxaEntrega"));
  const gratis = num(valor("freteGratisAcima"));
  const minimo = num(valor("pedidoMinimo"));
  const partes = [taxa > 0 ? `taxa de ${brl(taxa)}` : "taxa combinada no WhatsApp"];
  if (gratis > 0) partes.push(`entrega grátis acima de ${brl(gratis)}`);
  partes.push(minimo > 0 ? `pedido mínimo de ${brl(minimo)}` : "sem pedido mínimo");
  $("#previewEntrega").textContent = `No site: ${partes.join(" · ")}.`;

  const categorias = listaDeCategorias();
  $("#previewCategorias").innerHTML = categorias.length
    ? `Filtros na ordem: ${categorias.map((categoria) => `<b>${esc(categoria)}</b>`).join(" · ")}`
    : "Informe as categorias para o site montar os filtros.";

  const aviso = valor("aviso");
  const caixa = $("#previewAviso");
  caixa.hidden = !aviso;
  caixa.textContent = aviso;
}

function preencherLoja() {
  const loja = rascunho.loja || {};
  $$("[data-loja]").forEach((campo) => {
    const chave = campo.dataset.loja;
    campo.value = chave === "categorias" ? (rascunho.categorias || []).join(", ") : loja[chave] ?? "";
  });
  $$(".adm-grupo label").forEach((rotulo) => rotulo.classList.remove("tem-erro"));
  $$(".adm-campo-erro").forEach((aviso) => aviso.remove());

  $("#marcaSub").textContent = loja.nome || "Marmitas POA";
  $$("#formLoja [data-foto-bloco]").forEach((bloco) => atualizarPreview(bloco));
  atualizarPreviewsLoja();
  atualizarStatusLoja();
}

// Compara o formulário com o rascunho, para avisar sobre o que ainda não foi salvo.
function lojaPendente() {
  const loja = rascunho.loja || {};
  return $$("[data-loja]").some((campo) => {
    const chave = campo.dataset.loja;
    if (chave === "categorias") {
      return campo.value.trim() !== (rascunho.categorias || []).join(", ");
    }
    const atual = loja[chave] ?? "";
    if (campo.type === "number") return num(campo.value) !== num(atual);
    return campo.value.trim() !== String(atual).trim();
  });
}

function marcarErro(campo, mensagem) {
  if (!campo) return;
  const rotulo = campo.closest("label") || campo.parentElement;
  rotulo.classList.toggle("tem-erro", Boolean(mensagem));
  let aviso = rotulo.querySelector(".adm-campo-erro");
  if (!aviso) {
    aviso = document.createElement("small");
    aviso.className = "adm-campo-erro";
    rotulo.append(aviso);
  }
  aviso.textContent = mensagem || "";
}

function validarLoja(loja, categorias) {
  const erros = [];
  if (String(loja.nome || "").trim().length < 2) {
    erros.push([campoLoja("nome"), "Informe o nome da loja"]);
  }
  if (String(loja.whatsapp || "").replace(/\D/g, "").length < 12) {
    erros.push([campoLoja("whatsapp"), "Use DDI + DDD + número (ex.: 5551993560070)"]);
  }
  [["taxaEntrega"], ["freteGratisAcima"], ["pedidoMinimo"]].forEach(([chave]) => {
    if (num(loja[chave]) < 0) erros.push([campoLoja(chave), "Não pode ser negativo"]);
  });
  if (!categorias.length) {
    erros.push([campoLoja("categorias"), "Informe ao menos uma categoria"]);
  }
  return erros;
}

async function subirFotoPadrao(arquivo) {
  if (!arquivo) return;
  await subirFotoDoBloco($('#formLoja [data-foto-tipo="prato"]'), arquivo, (foto, thumb) => {
    rascunho.loja = { ...(rascunho.loja || {}), fotoPadrao: foto, fotoPadraoThumb: thumb };
    salvar();
    atualizarStatusLoja();
  });
}

async function subirLogo(arquivo) {
  if (!arquivo) return;
  const bloco = $('#formLoja [data-foto-tipo="logo"]');
  await subirFotoDoBloco(bloco, arquivo, (foto, thumb) => {
    rascunho.loja = { ...(rascunho.loja || {}), logo: foto, logoThumb: thumb };
    salvar();
    atualizarStatusLoja();
  });
}

function ligarLoja() {
  const formulario = $("#formLoja");
  // Cada bloco de foto agora é identificado pelo tipo: "prato" (foto padrão) e "logo".
  const blocoPadrao = $('#formLoja [data-foto-tipo="prato"]');

  formulario.addEventListener("input", (event) => {
    const campo = event.target.closest("[data-loja]");
    if (!campo) return;
    const chave = campo.dataset.loja;

    // Normaliza o que o cliente vai ver: telefone só com números, Instagram sem @.
    if (chave === "whatsapp") {
      const digitos = campo.value.replace(/\D/g, "").slice(0, 15);
      if (campo.value !== digitos) campo.value = digitos;
    }
    if (chave === "instagram") campo.value = campo.value.replace(/^@+/, "");
    if (chave === "fotoPadrao" || chave === "logo") {
      atualizarPreview(event.target.closest("[data-foto-bloco]"));
    }

    marcarErro(campo, "");
    atualizarPreviewsLoja();
    atualizarStatusLoja();
  });

  formulario.addEventListener("submit", (event) => {
    event.preventDefault();

    const loja = { ...(rascunho.loja || {}) };
    $$("[data-loja]").forEach((campo) => {
      const chave = campo.dataset.loja;
      if (chave === "categorias") return;
      loja[chave] = campo.type === "number" ? num(campo.value) : campo.value.trim();
    });
    const categorias = listaDeCategorias();

    $$("[data-loja]").forEach((campo) => marcarErro(campo, ""));
    const erros = validarLoja(loja, categorias);
    if (erros.length) {
      erros.forEach(([campo, mensagem]) => marcarErro(campo, mensagem));
      toast("Confira os campos destacados");
      if (erros[0][0]) erros[0][0].focus();
      return;
    }

    rascunho.loja = loja;
    rascunho.categorias = categorias;
    salvar();
    renderPratos();
    preencherLoja();
    toast("Configurações salvas");
  });

  $("#desfazerLoja").addEventListener("click", () => {
    if (!lojaPendente()) {
      toast("Nada para desfazer");
      return;
    }
    if (!window.confirm("Descartar as alterações não salvas desta aba?")) return;
    preencherLoja();
    toast("Alterações descartadas");
  });

  // Foto padrão do cardápio, com o mesmo fluxo das fotos dos pratos
  $('[data-acao="foto-escolher-loja"]').addEventListener("click", () => $("[data-foto-arquivo]", blocoPadrao).click());

  $("[data-foto-arquivo]", blocoPadrao).addEventListener("change", (event) => {
    subirFotoPadrao(event.target.files[0]);
    event.target.value = "";
  });

  $('[data-acao="foto-restaurar-loja"]').addEventListener("click", () => {
    if (!window.confirm("Voltar para a foto padrão original que acompanha o site?")) return;
    rascunho.loja = { ...(rascunho.loja || {}), fotoPadrao: "", fotoPadraoThumb: "" };
    $('[data-campo="fotoPadrao"]', blocoPadrao).value = "";
    $('[data-campo="fotoPadraoThumb"]', blocoPadrao).value = "";
    atualizarPreview(blocoPadrao);
    salvar();
    atualizarStatusLoja();
    toast("Foto padrão original restaurada");
  });

  // Logo do restaurante
  const blocoLogo = $('#formLoja [data-foto-tipo="logo"]');
  $('[data-acao="foto-escolher-logo"]').addEventListener("click", () => $("[data-foto-arquivo]", blocoLogo).click());

  $("[data-foto-arquivo]", blocoLogo).addEventListener("change", (event) => {
    subirLogo(event.target.files[0]);
    event.target.value = "";
  });

  $('[data-acao="foto-restaurar-logo"]').addEventListener("click", () => {
    if (!window.confirm("Voltar para o selo com as iniciais?")) return;
    rascunho.loja = { ...(rascunho.loja || {}), logo: "", logoThumb: "" };
    $('[data-campo="logo"]', blocoLogo).value = "";
    $('[data-campo="logoThumb"]', blocoLogo).value = "";
    atualizarPreview(blocoLogo);
    salvar();
    atualizarStatusLoja();
    toast("O site volta a usar o selo com as iniciais");
  });

  formulario.addEventListener("dragover", (event) => {
    const alvo = event.target.closest("[data-foto-bloco]");
    if (!alvo) return;
    event.preventDefault();
    alvo.classList.add("is-dragover");
  });
  formulario.addEventListener("dragleave", (event) => {
    const alvo = event.target.closest("[data-foto-bloco]");
    if (alvo) alvo.classList.remove("is-dragover");
  });
  formulario.addEventListener("drop", (event) => {
    const alvo = event.target.closest("[data-foto-bloco]");
    if (!alvo) return;
    event.preventDefault();
    alvo.classList.remove("is-dragover");
    const arquivo = event.dataTransfer.files[0];
    if (alvo.dataset.fotoTipo === "logo") subirLogo(arquivo);
    else subirFotoPadrao(arquivo);
  });
}

/* --------------------------------------------------------------- publicar */
function conteudoDados() {
  const dados = clone(rascunho);
  dados.versao = 2;
  const cabecalho = `/* ------------------------------------------------------------------------
   dados.js — fonte de verdade do cardápio, combos, cupons e configurações.
   Gerado pelo painel admin (admin.html) em ${dados.atualizadoEm || "—"}.
   ------------------------------------------------------------------------ */
`;
  return `${cabecalho}window.DADOS = ${JSON.stringify(dados, null, 2)};\n`;
}

function exportar() {
  rascunho.atualizadoEm = new Date().toISOString().slice(0, 19).replace("T", " ");
  salvar();
  const blob = new Blob([conteudoDados()], { type: "text/javascript;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "dados.js";
  link.click();
  URL.revokeObjectURL(url);
  toast("Arquivo dados.js gerado");
}

// Publica sem download: o servidor local grava o dados.js na pasta do site e
// exporta as imagens usadas, para o site abrir igual até sem este servidor.
async function publicarAgora() {
  const botao = $("#publicarAgora");
  const aviso = $("#publicarResultado");
  const lojaNaoSalva = lojaPendente();

  rascunho.atualizadoEm = new Date().toISOString().slice(0, 19).replace("T", " ");
  salvar();
  botao.disabled = true;
  botao.textContent = "Publicando...";
  aviso.hidden = true;

  try {
    const resposta = await api("/publicar", {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: conteudoDados(),
    });
    const dados = await resposta.json().catch(() => ({}));
    if (!resposta.ok || !dados.ok) throw new Error(dados.erro || "não consegui publicar");

    // Publicado: o rascunho perde a função, porque o site passou a ler o dados.js.
    PUBLICADO = clone(rascunho);
    localStorage.removeItem(CHAVES.rascunho);
    atualizarStatus();
    if (estado.aba === "imagens") carregarImagens();

    const imagens = dados.imagens ? ` e ${dados.imagens} imagem(ns) exportada(s)` : "";
    aviso.hidden = false;
    aviso.textContent = `${lojaNaoSalva ? "Atenção: as configurações da loja que estavam sem salvar ficaram de fora. " : ""}dados.js gravado${imagens}${dados.backup ? " · versão anterior guardada em cópia de segurança" : ""}.`;
    toast("Publicado! O site já mostra as alterações");
  } catch (erro) {
    const semServidor = !erro.status || [404, 405, 501].includes(erro.status);
    toast(semServidor ? "Não consegui publicar: confirme se o servidor do site está rodando." : erro.message);
  } finally {
    botao.disabled = false;
    botao.textContent = "Publicar agora";
  }
}

function importar(texto) {
  const trecho = texto.includes("window.DADOS")
    ? texto.split("window.DADOS")[1].replace(/^[\s=]+/, "").replace(/;\s*$/, "")
    : texto;
  const dados = JSON.parse(trecho);
  if (!dados || !Array.isArray(dados.pratos)) throw new Error("formato inesperado");
  rascunho = dados;
  salvar();
  renderTudo();
  toast("Arquivo importado");
}

function ligarPublicar() {
  $("#publicarAgora").addEventListener("click", publicarAgora);
  $("#exportar").addEventListener("click", exportar);

  $("#importarBotao").addEventListener("click", () => $("#importarArquivo").click());
  $("#importarArquivo").addEventListener("change", async (event) => {
    const arquivo = event.target.files[0];
    if (!arquivo) return;
    try {
      importar(await arquivo.text());
    } catch (erro) {
      toast("Não consegui ler esse arquivo. Use um dados.js válido.");
    }
    event.target.value = "";
  });

  $("#verRascunho").addEventListener("click", () => window.open("index.html", "_blank", "noopener"));

  $("#descartar").addEventListener("click", () => {
    if (!temAlteracoes()) return toast("Não há alterações para descartar");
    if (!window.confirm("Descartar todas as alterações e voltar para o que está publicado?")) return;
    localStorage.removeItem(CHAVES.rascunho);
    rascunho = clone(PUBLICADO);
    renderTudo();
    salvar();
    toast("Rascunho descartado");
  });
}

/* --------------------------------------------------------- banco de imagens */
function tamanhoLegivel(bytes) {
  const valor = Number(bytes) || 0;
  if (valor >= 1024 * 1024) return `${(valor / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(valor / 1024))} KB`;
}

function caminhosDoRascunho() {
  const lista = [];
  ["pratos", "combos"].forEach((chave) => {
    (rascunho[chave] || []).forEach((item) => {
      ["foto", "fotoThumb"].forEach((campo) => {
        if (item[campo]) lista.push(item[campo]);
      });
    });
  });
  // A loja também tem imagens: foto padrão do cardápio e logo do restaurante.
  // Sem isso a limpeza de não usadas apagaria a logo que está no ar.
  ["fotoPadrao", "fotoPadraoThumb", "logo", "logoThumb"].forEach((campo) => {
    const valor = (rascunho.loja || {})[campo];
    if (valor) lista.push(valor);
  });
  return lista;
}

function itemImagem(imagem, usadosNoRascunho) {
  const capa = imagem.caminho.replace(/(\.webp)$/, "-thumb$1");
  const economia = imagem.originalBytes
    ? ` · ${Math.round((1 - imagem.bytes / imagem.originalBytes) * 100)}% menor`
    : "";
  // Uma imagem recém-enviada ainda não está no dados.js publicado, mas já está
  // no rascunho: não pode aparecer como "não usada".
  const noRascunho = usadosNoRascunho.has(imagem.caminho);
  const emUso = imagem.emUso || noRascunho;
  const selo = imagem.emUso
    ? '<span class="adm-badge">no site publicado</span>'
    : noRascunho
    ? '<span class="adm-badge">no rascunho</span>'
    : '<span class="adm-badge is-warn">não usada</span>';
  return `<article class="adm-imagem${emUso ? "" : " is-solta"}" data-caminho="${esc(imagem.caminho)}">
    <img src="${esc(capa)}" alt="" loading="lazy" decoding="async" />
    <div class="adm-imagem-info">
      <b>${esc(imagem.prato || imagem.nomeBase)}</b>
      <small>${imagem.largura}x${imagem.altura} · ${tamanhoLegivel(imagem.bytes)}${economia}</small>
      <small>${esc((imagem.criadoEm || "").replace("T", " ").slice(0, 16))}</small>
      ${selo}
    </div>
    <button class="adm-btn adm-btn-sm adm-btn-danger" data-apagar-imagem type="button">Apagar</button>
  </article>`;
}

function renderImagens(dados) {
  const usadosNoRascunho = new Set(caminhosDoRascunho().map((item) => String(item).replace(/^\/+/, "")));
  const principais = (dados.itens || []).filter((item) => item.variante === "principal");
  const emUso = principais.filter((item) => item.emUso || usadosNoRascunho.has(item.caminho)).length;
  const soltas = principais.length - emUso;
  const economia = dados.originalBytes
    ? ` · ${Math.round((1 - dados.bytes / dados.originalBytes) * 100)}% menor que o enviado`
    : "";

  $("#imagensResumo").innerHTML = `${principais.length} imagem(ns) · <b>${tamanhoLegivel(dados.bytes)}</b> no banco${economia}${
    soltas ? ` · <b>${soltas} sem uso</b>` : ""
  }`;

  $("#listaImagens").innerHTML =
    principais.map((item) => itemImagem(item, usadosNoRascunho)).join("") ||
    '<p class="adm-help">Nenhuma imagem no banco ainda. Envie uma pelo bloco "Foto do prato".</p>';

  $$("#listaImagens [data-apagar-imagem]").forEach((botao) => {
    botao.addEventListener("click", () => apagarImagem(botao.closest(".adm-imagem").dataset.caminho));
  });
}

async function carregarImagens() {
  const alvo = $("#listaImagens");
  alvo.innerHTML = '<p class="adm-help">Carregando imagens...</p>';
  try {
    const resposta = await api("/imagens");
    if (!resposta.ok) throw new Error("sem banco de imagens");
    renderImagens(await resposta.json());
  } catch (erro) {
    $("#imagensResumo").textContent = "";
    alvo.innerHTML =
      '<p class="adm-help">Não consegui falar com o banco de imagens. Confirme se o servidor do site está rodando.</p>';
  }
}

async function apagarImagem(caminho) {
  if (!window.confirm("Apagar esta imagem do banco? Os pratos que usam ela ficarão sem foto.")) return;
  try {
    await api(`/imagens?caminho=${encodeURIComponent(caminho)}`, { method: "DELETE" });
    toast("Imagem apagada");
    carregarImagens();
  } catch (erro) {
    toast("Não consegui apagar a imagem");
  }
}

async function limparImagensSoltas() {
  if (!window.confirm("Apagar as imagens que não estão em uso neste cardápio?")) return;
  try {
    const resposta = await api("/imagens/orfas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ manter: caminhosDoRascunho() }),
    });
    const dados = await resposta.json();
    toast(`${dados.removidas || 0} imagem(ns) apagada(s)`);
    carregarImagens();
  } catch (erro) {
    toast("Não consegui limpar as imagens");
  }
}

async function exportarImagens() {
  try {
    const resposta = await api("/imagens/exportar", { method: "POST" });
    const dados = await resposta.json();
    toast(`${(dados.gravados || []).length} imagem(ns) gravada(s) em img/pratos`);
  } catch (erro) {
    toast("Não consegui exportar as imagens");
  }
}

function ligarImagens() {
  $("#limparOrfas").addEventListener("click", limparImagensSoltas);
  $("#exportarImagens").addEventListener("click", exportarImagens);
  $("#atualizarImagens").addEventListener("click", carregarImagens);
}

/* ------------------------------------------------------------------- abas */
function trocarAba(aba) {
  // Sair da aba Loja com edições pendentes apagaria o que foi digitado.
  if (estado.aba === "loja" && aba !== "loja" && lojaPendente()) {
    const seguir = window.confirm("As configurações da loja têm alterações não salvas. Sair e descartar?");
    if (!seguir) return;
  }
  estado.aba = aba;
  $$("#tabs button").forEach((botao) => botao.classList.toggle("is-active", botao.dataset.tab === aba));
  $$("[data-panel]").forEach((painel) => {
    const ativo = painel.dataset.panel === aba;
    painel.hidden = !ativo;
    painel.classList.toggle("is-active", ativo);
  });
  if (aba === "loja") preencherLoja();
  if (aba === "imagens") carregarImagens();
  if (aba === "publicar") atualizarStatus();
}

function ligarAbas() {
  $("#tabs").addEventListener("click", (event) => {
    const botao = event.target.closest("[data-tab]");
    if (botao) trocarAba(botao.dataset.tab);
  });
}

/* ------------------------------------------------------------------ login */
// Quem confere a senha é o servidor; o navegador fica apenas com o cookie de
// sessão, que o JavaScript da página não consegue ler.
function dicaDoLogin(mensagem, tipo = "is-error") {
  const dica = $("#loginHint");
  dica.textContent = mensagem;
  dica.className = `adm-hint ${tipo}`;
}

function mostrarLogin(mensagem = "") {
  $("#painel").hidden = true;
  $("#login").hidden = false;
  $("#senha").value = "";
  if (mensagem) dicaDoLogin(mensagem);
}

function mostrarPainel() {
  $("#login").hidden = true;
  $("#painel").hidden = false;
  renderTudo();
  trocarAba("cardapio");
}

async function entrar() {
  const botao = $("#loginForm button[type=submit]");
  const senha = $("#senha").value;
  if (!senha) {
    dicaDoLogin("Digite a senha do painel.");
    return;
  }
  botao.disabled = true;
  dicaDoLogin("Conferindo...", "is-ok");
  try {
    const resposta = await fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Painel": "1" },
      body: JSON.stringify({ senha }),
    });
    const dados = await resposta.json().catch(() => ({}));
    if (!resposta.ok || !dados.ok) throw new Error(dados.erro || "não consegui entrar");
    $("#senha").value = "";
    dicaDoLogin("");
    mostrarPainel();
  } catch (erro) {
    // Navegador às vezes preenche com uma senha antiga: limpa para digitar de novo.
    const senhaErrada = /senha incorreta/i.test(erro.message);
    dicaDoLogin(
      senhaErrada
        ? `${erro.message}. Se o navegador preencheu sozinho, apague e digite de novo.`
        : erro.message
    );
    if (senhaErrada) {
      $("#senha").value = "";
      $("#senha").focus();
    }
  } finally {
    botao.disabled = false;
  }
}

async function sair() {
  try {
    await api("/sair", { method: "POST" });
  } catch (erro) {
    /* sessão já tinha caído: só volta para o login */
  }
  mostrarLogin("Você saiu do painel.");
}

function ligarLogin() {
  $("#loginForm").addEventListener("submit", (event) => {
    event.preventDefault();
    entrar();
  });

  $("#sair").addEventListener("click", sair);
}

/* ------------------------------------------------------------------- boot */
function renderTudo() {
  renderPratos();
  renderCombos();
  renderCupons();
  renderPromocoes();
  preencherLoja();
  atualizarStatus();
}

function iniciar() {
  // Sem o servidor do site (servindo só arquivos estáticos), o envio de fotos
  // e o login ficam indisponíveis e o formulário avisa.
  api("/ping")
    .then((resposta) => (resposta.ok ? resposta.json() : null))
    .then((dados) => {
      UPLOAD.disponivel = Boolean(dados && dados.ok);
    })
    .catch(() => {
      UPLOAD.disponivel = false;
    });

  ligarLogin();
  ligarAbas();
  ligarPratos();
  ligarCombos();
  ligarCupons();
  ligarPromocoes();
  ligarLoja();
  ligarPublicar();
  ligarImagens();

  $("#buscaPrato").addEventListener("input", (event) => {
    estado.busca = event.target.value;
    renderPratos();
  });
  $("#filtroCategoria").addEventListener("change", (event) => {
    estado.categoria = event.target.value;
    renderPratos();
  });
  $("#novoPrato").addEventListener("click", adicionarPrato);
  $("#novoCombo").addEventListener("click", () => {
    rascunho.combos.push({
      id: uid("c"),
      nome: "Novo combo",
      quantidade: 10,
      destaque: false,
      ativo: true,
      foto: "",
      opcoes: [
        { rotulo: "400 g", preco: 0, unitario: 0 },
        { rotulo: "600 g", preco: 0, unitario: 0 },
      ],
    });
    salvar();
    renderCombos();
    toast("Preencha os dados do novo combo");
  });
  $("#novoCupom").addEventListener("click", () => {
    rascunho.cupons.push({
      id: uid("cupom"),
      codigo: "NOVOCUPOM",
      tipo: "percentual",
      valor: 10,
      minimo: 0,
      ativo: true,
      inicio: "",
      fim: "",
      usoMaximo: 0,
      descricao: "",
    });
    salvar();
    renderCupons();
    toast("Ajuste o código e o valor do cupom");
  });
  $("#novaPromocao").addEventListener("click", () => {
    rascunho.promocoes.push({
      id: uid("promo"),
      nome: "Nova promoção",
      tipo: "desconto_categoria",
      categoria: categoriasDisponiveis()[0] || "",
      valor: 5,
      minimo: 0,
      ativo: true,
      descricao: "",
    });
    salvar();
    renderPromocoes();
    toast("Ajuste os dados da promoção");
  });

  // Só entra direto se o servidor confirmar que a sessão ainda vale.
  api("/sessao")
    .then((resposta) => (resposta.ok ? resposta.json() : null))
    .then((dados) => {
      if (dados && dados.autenticado) mostrarPainel();
    })
    .catch(() => {
      /* sem servidor: fica na tela de login */
    });
}

iniciar();
