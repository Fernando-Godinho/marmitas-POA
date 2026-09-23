#!/usr/bin/env python3
"""Servidor do site Marmitas POA.

Serve os arquivos do site, recebe as fotos enviadas pelo painel e guarda tudo em
um banco SQLite (`marmitas.db`), sempre convertido para WebP — bem mais leve que
JPEG para o mesmo tamanho de imagem.

Rotas públicas (só leitura):
    GET    /                     index.html
    GET    /<arquivo do site>    estáticos permitidos (ver ARQUIVOS_SITE)
    GET    /img/...              imagens do banco (com cache e ETag)
    GET    /ping                 estado do servidor, sem dados sensíveis

Rotas do painel (exigem sessão iniciada por /login):
    POST   /login                 {"senha": "..."} -> cookie de sessão
    POST   /sair                  encerra a sessão
    GET    /sessao                diz se a sessão atual vale
    GET    /imagens               lista as imagens guardadas (sem os bytes)
    POST   /upload?nome=&prato=   recebe uma imagem e guarda em WebP
    POST   /imagens/orfas         apaga imagens não usadas (corpo {"manter": []})
    POST   /imagens/exportar      grava as imagens do banco como arquivos
    POST   /publicar              grava o dados.js do painel na pasta do site
    DELETE /imagens?caminho=      apaga uma imagem e a miniatura dela

Tudo que escreve exige o cookie de sessão e o cabeçalho `X-Painel: 1`; o banco,
o servidor e os rascunhos nunca são servidos como arquivo estático.

Uso:
    python3 servidor.py                  # http://localhost:4173
    python3 servidor.py --porta 8080
    python3 servidor.py --definir-senha  # troca a senha do painel
"""

from __future__ import annotations

import argparse
import base64
import getpass
import hashlib
import hmac
import io
import json
import re
import secrets
import sqlite3
import threading
import time
import unicodedata
from datetime import datetime, timezone
from email.utils import formatdate
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

RAIZ = Path(__file__).resolve().parent
BANCO = RAIZ / "marmitas.db"
CONFIG = RAIZ / "config.json"
LIMITE_BYTES = 12 * 1024 * 1024
LIMITE_PUBLICAR = 1 * 1024 * 1024
LARGURA_PRINCIPAL = 1400
LARGURA_MINIATURA = 400
QUALIDADE_PRINCIPAL = 82
QUALIDADE_MINIATURA = 78
LARGURA_LOGO = 600
LARGURA_LOGO_MINI = 128
QUALIDADE_LOGO = 88
FORMATO = "WEBP"
MIME = "image/webp"
TIPOS_ACEITOS = {"image/jpeg", "image/png", "image/webp"}

# Só estes arquivos do projeto viram página: o banco, este servidor, os rascunhos
# e as pastas de trabalho ficam fora do alcance do navegador.
ARQUIVOS_SITE = {
    "index.html",
    "styles.css",
    "script.js",
    "dados.js",
    "admin.html",
    "admin.css",
    "admin.js",
}
EXTENSOES_IMAGEM = {".webp", ".jpg", ".jpeg", ".png", ".svg", ".ico"}
COOKIE = "poa_sessao"
SESSAO_SEGUNDOS = 12 * 60 * 60
TENTATIVAS_LOGIN = 8
BLOQUEIO_SEGUNDOS = 5 * 60
# O script.js monta os cartões com style="--bg: <cor>" via innerHTML, então
# style-src precisa de 'unsafe-inline'. O que importa contra XSS é script-src:
# só o próprio site e o único script inline do index.html, liberado por hash.
CSP_SITE = (
    "default-src 'self'; img-src 'self' data:; font-src 'self' https://fonts.gstatic.com; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "script-src 'self' 'sha256-WZRJfWvsnNCPcxzZwvyhovnZGqhZaC+8gPGPRbx6wTk='; "
    "connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'"
)
CSP_PAINEL = (
    "default-src 'self'; img-src 'self' data:; font-src 'self' https://fonts.gstatic.com; "
    "style-src 'self' https://fonts.googleapis.com; script-src 'self'; "
    "connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'"
)

try:
    from PIL import Image, features
except ImportError:
    Image = None
    features = None

TEM_WEBP = bool(features and features.check("webp"))

ESQUEMA = """
CREATE TABLE IF NOT EXISTS arquivos (
  caminho        TEXT PRIMARY KEY,
  nome_base      TEXT NOT NULL,
  variante       TEXT NOT NULL,
  prato          TEXT,
  mime           TEXT NOT NULL,
  largura        INTEGER NOT NULL,
  altura         INTEGER NOT NULL,
  bytes          INTEGER NOT NULL,
  original_bytes INTEGER,
  hash           TEXT NOT NULL,
  criado_em      TEXT NOT NULL,
  dados          BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_arquivos_base ON arquivos(nome_base);
CREATE INDEX IF NOT EXISTS idx_arquivos_hash ON arquivos(hash);
CREATE TABLE IF NOT EXISTS meta (chave TEXT PRIMARY KEY, valor TEXT);
"""


def abrir_banco() -> sqlite3.Connection:
    conexao = sqlite3.connect(BANCO, check_same_thread=False)
    conexao.row_factory = sqlite3.Row
    conexao.execute("PRAGMA journal_mode = WAL")
    conexao.execute("PRAGMA synchronous = NORMAL")
    conexao.executescript(ESQUEMA)
    conexao.commit()
    return conexao


BANCO_CONEXAO = abrir_banco()


# --------------------------------------------------------------------- banco
def caminho_de(nome_base: str, variante: str, pasta: str = "img/pratos") -> str:
    sufixo = "-thumb" if variante == "miniatura" else ""
    return f"{pasta}/{nome_base}{sufixo}.webp"


def guardar_arquivo(nome_base, variante, prato, conteudo, largura, altura, original_bytes, pasta="img/pratos"):
    BANCO_CONEXAO.execute(
        """INSERT INTO arquivos
             (caminho, nome_base, variante, prato, mime, largura, altura, bytes,
              original_bytes, hash, criado_em, dados)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(caminho) DO UPDATE SET
             bytes = excluded.bytes, largura = excluded.largura, altura = excluded.altura,
             hash = excluded.hash, criado_em = excluded.criado_em, dados = excluded.dados""",
        (
            caminho_de(nome_base, variante, pasta),
            nome_base,
            variante,
            prato,
            MIME,
            largura,
            altura,
            len(conteudo),
            original_bytes,
            hashlib.sha256(conteudo).hexdigest(),
            datetime.now().isoformat(timespec="seconds"),
            sqlite3.Binary(conteudo),
        ),
    )
    BANCO_CONEXAO.commit()


def buscar_arquivo(caminho: str):
    return BANCO_CONEXAO.execute(
        "SELECT dados, mime, hash FROM arquivos WHERE caminho = ?", (caminho,)
    ).fetchone()


def listar_arquivos():
    return BANCO_CONEXAO.execute(
        """SELECT caminho, nome_base, variante, prato, largura, altura, bytes,
                  original_bytes, hash, criado_em
             FROM arquivos ORDER BY criado_em DESC, variante"""
    ).fetchall()


def apagar_por_base(nome_base: str) -> int:
    cursor = BANCO_CONEXAO.execute("DELETE FROM arquivos WHERE nome_base = ?", (nome_base,))
    BANCO_CONEXAO.commit()
    # Devolve o espaço ao arquivo: sem isso o conteúdo apagado continua no WAL.
    BANCO_CONEXAO.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    return cursor.rowcount


def contar_arquivos() -> int:
    return BANCO_CONEXAO.execute("SELECT COUNT(*) FROM arquivos").fetchone()[0]


# ------------------------------------------------------------------ utilidades
def virar_slug(texto: str) -> str:
    """Transforma "Frango à Parmegiana" em "frango-a-parmegiana"."""
    texto = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()
    texto = re.sub(r"[^a-zA-Z0-9]+", "-", texto).strip("-").lower()
    return texto[:60] or "prato"


def para_rgb(imagem):
    """Achata transparência em fundo branco, para poder salvar em WebP com perdas."""
    if imagem.mode in ("RGBA", "LA", "P"):
        convertida = imagem.convert("RGBA")
        fundo = Image.new("RGB", convertida.size, (255, 255, 255))
        fundo.paste(convertida, mask=convertida.split()[-1])
        return fundo
    return imagem.convert("RGB")


def tem_alfa(imagem) -> bool:
    return imagem.mode in ("RGBA", "LA") or (imagem.mode == "P" and "transparency" in imagem.info)


def converter(origem: bytes, largura_maxima: int, qualidade: int, preservar_alfa=False, sem_perdas=False):
    """Reduz mantendo a proporção e converte para WebP. None se não for possível.

    Logos passam com `preservar_alfa` porque recortar a transparência os deixaria
    com um retângulo branco em cima do rodapé escuro.
    """
    if not (Image and TEM_WEBP):
        return None
    with Image.open(io.BytesIO(origem)) as imagem:
        base = imagem.convert("RGBA") if (preservar_alfa and tem_alfa(imagem)) else para_rgb(imagem)
        if max(base.size) > largura_maxima:
            base.thumbnail((largura_maxima, largura_maxima), Image.LANCZOS)
        buffer = io.BytesIO()
        if sem_perdas and base.mode == "RGBA":
            base.save(buffer, FORMATO, lossless=True, quality=100, method=6)
        else:
            base.save(buffer, FORMATO, quality=qualidade, method=6)
        return buffer.getvalue(), base.width, base.height


def imagens_de(dados: dict) -> set[str]:
    """Caminhos de imagem citados nos dados: pratos, combos e configurações da loja.

    A loja entra na lista porque a foto padrão do cardápio e a logo também são
    imagens do banco — sem isso a limpeza de não usadas apagaria a logo em uso.
    """
    usados = set()
    for chave in ("pratos", "combos"):
        for item in dados.get(chave) or []:
            for campo in ("foto", "fotoThumb"):
                valor = str(item.get(campo) or "").strip()
                if valor:
                    usados.add(valor.lstrip("/"))
    loja = dados.get("loja") or {}
    for campo in ("fotoPadrao", "fotoPadraoThumb", "logo", "logoThumb"):
        valor = str(loja.get(campo) or "").strip()
        if valor:
            usados.add(valor.lstrip("/"))
    return usados


def ler_dados_js(texto: str) -> dict:
    """Extrai o objeto de window.DADOS do conteúdo de um dados.js."""
    dados = json.loads(texto.split("window.DADOS", 1)[1].lstrip(" =").rstrip().rstrip(";"))
    if not isinstance(dados, dict) or not isinstance(dados.get("pratos"), list):
        raise ValueError("dados.js sem a lista de pratos")
    return dados


def caminhos_usados_no_site() -> set[str]:
    """Lê o dados.js publicado e devolve os caminhos de imagem referenciados."""
    arquivo = RAIZ / "dados.js"
    if not arquivo.exists():
        return set()
    try:
        return imagens_de(ler_dados_js(arquivo.read_text(encoding="utf-8")))
    except Exception:  # noqa: BLE001 - dados.js inválido: melhor não apagar nada
        return set()


def gravar_imagem(caminho: str, conteudo: bytes) -> None:
    destino = RAIZ / caminho
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_bytes(conteudo)


def gravar_imagens(caminhos: set[str] | None = None) -> list[str]:
    """Grava no disco as imagens do banco: todas, ou só as indicadas."""
    gravadas = []
    for linha in BANCO_CONEXAO.execute("SELECT caminho, dados FROM arquivos"):
        if caminhos is not None and linha["caminho"] not in caminhos:
            continue
        gravar_imagem(linha["caminho"], bytes(linha["dados"]))
        gravadas.append(linha["caminho"])
    return gravadas


def nome_base_de(caminho: str) -> str:
    return Path(caminho).name.split("-thumb")[0].replace(".webp", "")


def caminho_publico(caminho: str) -> str | None:
    """Devolve o caminho relativo se ele for um arquivo do site, senão None.

    É a única porta de entrada para arquivos em disco: banco, este servidor,
    rascunhos, config e pastas de trabalho nunca são servidos.
    """
    relativo = unquote(caminho).lstrip("/")
    if not relativo or relativo.endswith("/"):
        return None
    if "\\" in relativo or "\x00" in relativo:
        return None
    if relativo in ARQUIVOS_SITE:
        return relativo
    if relativo.startswith("img/"):
        destino = (RAIZ / relativo).resolve()
        if not destino.is_relative_to(RAIZ / "img"):
            return None
        if destino.is_file() and destino.suffix.lower() in EXTENSOES_IMAGEM:
            return relativo
    return None


# ------------------------------------------------------------------ segurança
def criar_hash_senha(senha: str) -> str:
    sal = secrets.token_bytes(16)
    resumo = hashlib.pbkdf2_hmac("sha256", senha.encode("utf-8"), sal, 200_000)
    return f"pbkdf2_sha256$200000${base64.b64encode(sal).decode()}${base64.b64encode(resumo).decode()}"


def conferir_senha(senha: str, registro: str) -> bool:
    """Compara em tempo constante, para não vazar a senha por diferença de tempo."""
    try:
        algoritmo, iteracoes, sal, esperado = (registro or "").split("$")
        if algoritmo != "pbkdf2_sha256":
            return False
        resumo = hashlib.pbkdf2_hmac(
            "sha256", senha.encode("utf-8"), base64.b64decode(sal), int(iteracoes)
        )
        return hmac.compare_digest(base64.b64encode(resumo).decode(), esperado)
    except (ValueError, TypeError):
        return False


def gerar_senha() -> str:
    """Senha legível, para o dono anotar: ex. 'panela-feira-4821'."""
    palavras = ("porto", "alegre", "marmita", "sabor", "caseiro", "tempero", "forno", "panela", "horta", "feira")
    return f"{secrets.choice(palavras)}-{secrets.choice(palavras)}-{secrets.randbelow(9000) + 1000}"


def ler_config() -> dict:
    try:
        return json.loads(CONFIG.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def gravar_config(config: dict) -> None:
    CONFIG.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    CONFIG.chmod(0o600)  # só o dono lê: aqui dentro está o hash da senha


def senha_guardada() -> str:
    return str(ler_config().get("senha") or "")


def definir_senha(senha: str) -> None:
    config = ler_config()
    config["senha"] = criar_hash_senha(senha)
    gravar_config(config)


class Sessoes:
    """Sessões em memória: reiniciar o servidor derruba todos os acessos."""

    def __init__(self) -> None:
        self._trava = threading.Lock()
        self._abertas: dict[str, float] = {}

    def abrir(self) -> str:
        token = secrets.token_urlsafe(32)
        with self._trava:
            self._limpar()
            self._abertas[token] = time.time() + SESSAO_SEGUNDOS
        return token

    def valida(self, token: str) -> bool:
        if not token:
            return False
        with self._trava:
            limite = self._abertas.get(token)
            if not limite or limite < time.time():
                self._abertas.pop(token, None)
                return False
            self._abertas[token] = time.time() + SESSAO_SEGUNDOS  # renova enquanto usa
            return True

    def fechar(self, token: str) -> None:
        with self._trava:
            self._abertas.pop(token, None)

    def _limpar(self) -> None:
        agora = time.time()
        for token in [t for t, limite in self._abertas.items() if limite < agora]:
            self._abertas.pop(token, None)


SESSOES = Sessoes()


class Tentativas:
    """Freio contra força bruta no login, por IP."""

    def __init__(self) -> None:
        self._trava = threading.Lock()
        self._falhas: dict[str, list[float]] = {}

    def espera(self, ip: str) -> int:
        with self._trava:
            agora = time.time()
            falhas = [t for t in self._falhas.get(ip, []) if agora - t < BLOQUEIO_SEGUNDOS]
            self._falhas[ip] = falhas
            if len(falhas) < TENTATIVAS_LOGIN:
                return 0
            return int(BLOQUEIO_SEGUNDOS - (agora - falhas[0])) + 1

    def falhou(self, ip: str) -> None:
        with self._trava:
            self._falhas.setdefault(ip, []).append(time.time())

    def acertou(self, ip: str) -> None:
        with self._trava:
            self._falhas.pop(ip, None)


TENTATIVAS = Tentativas()


# --------------------------------------------------------------- sanitização
def texto_limpo(valor, limite: int = 200) -> str:
    """Texto com tamanho máximo e sem caracteres de controle."""
    if isinstance(valor, bool) or isinstance(valor, (dict, list)):
        return ""
    texto = "" if valor is None else str(valor)
    texto = "".join(c for c in texto if c >= " " or c == "\n")
    return texto.strip()[:limite]


def caminho_imagem(valor) -> str:
    """Aceita só caminho de imagem do próprio site: corta URL externa, data: e javascript:."""
    texto = texto_limpo(valor, 200).lstrip("/")
    if not texto or ".." in texto or not texto.startswith("img/"):
        return ""
    return texto if Path(texto).suffix.lower() in EXTENSOES_IMAGEM else ""


def para_float(valor) -> float:
    try:
        return max(0.0, round(float(valor), 2))
    except (TypeError, ValueError):
        return 0.0


ESQUEMA_TAMANHO = {"rotulo": "texto", "preco": "numero", "unitario": "numero"}
ESQUEMA_LOJA = {
    "nome": "texto", "slogan": "texto", "whatsapp": "texto", "whatsappExibicao": "texto",
    "instagram": "texto", "moeda": "texto", "horarios": "texto", "aviso": "texto",
    "taxaEntrega": "numero", "freteGratisAcima": "numero", "pedidoMinimo": "numero",
    "fotoPadrao": "imagem", "fotoPadraoThumb": "imagem", "logo": "imagem", "logoThumb": "imagem",
}
ESQUEMA_PRATO = {
    "id": "texto", "nome": "texto", "categoria": "texto", "descricao": "texto", "kcal": "livre",
    "semLactose": "booleano", "ativo": "booleano", "foto": "imagem", "fotoThumb": "imagem",
    "tamanhos": "lista",
}
ESQUEMA_COMBO = {
    "id": "texto", "nome": "texto", "quantidade": "numero", "destaque": "booleano",
    "ativo": "booleano", "foto": "imagem", "fotoThumb": "imagem", "opcoes": "lista",
}
ESQUEMA_CUPOM = {
    "id": "texto", "codigo": "texto", "tipo": "texto", "valor": "numero", "minimo": "numero",
    "ativo": "booleano", "inicio": "texto", "fim": "texto", "usoMaximo": "numero", "descricao": "texto",
}
ESQUEMA_PROMOCAO = {
    "id": "texto", "nome": "texto", "tipo": "texto", "categoria": "texto", "valor": "numero",
    "minimo": "numero", "ativo": "booleano", "descricao": "texto",
}
LIMITES_TEXTO = {
    "nome": 120, "slogan": 160, "descricao": 600, "categoria": 60, "codigo": 40, "rotulo": 40,
    "aviso": 120, "horarios": 200, "whatsapp": 20, "whatsappExibicao": 30, "instagram": 60,
    "moeda": 8, "id": 60, "tipo": 40, "inicio": 10, "fim": 10,
}
LIMITE_ITENS = 500


def sanear_registro(item, esquema: dict) -> dict:
    """Mantém só as chaves conhecidas, com o tipo e o tamanho certos."""
    if not isinstance(item, dict):
        return {}
    limpo: dict = {}
    for chave, tipo in esquema.items():
        if chave not in item:
            continue
        valor = item[chave]
        if tipo == "texto":
            limpo[chave] = texto_limpo(valor, LIMITES_TEXTO.get(chave, 200))
        elif tipo == "numero":
            limpo[chave] = para_float(valor)
        elif tipo == "booleano":
            limpo[chave] = bool(valor)
        elif tipo == "imagem":
            limpo[chave] = caminho_imagem(valor)
        elif tipo == "livre":
            limpo[chave] = valor if isinstance(valor, (int, float)) and not isinstance(valor, bool) else texto_limpo(valor, 40)
        elif tipo == "lista":
            lista = valor if isinstance(valor, list) else []
            limpo[chave] = [sanear_registro(sub, ESQUEMA_TAMANHO) for sub in lista[:20]]
    return limpo


def sanear_dados(dados: dict) -> dict:
    """Deixa o dados.js no formato esperado; o resto é descartado."""
    def lista(chave: str, esquema: dict) -> list:
        itens = dados.get(chave) if isinstance(dados.get(chave), list) else []
        return [sanear_registro(item, esquema) for item in itens[:LIMITE_ITENS]]

    categorias = dados.get("categorias") if isinstance(dados.get("categorias"), list) else []
    return {
        "versao": 2,
        "atualizadoEm": texto_limpo(dados.get("atualizadoEm"), 20),
        "loja": sanear_registro(dados.get("loja"), ESQUEMA_LOJA),
        "categorias": [texto_limpo(c, 60) for c in categorias[:60] if texto_limpo(c, 60)],
        "pratos": lista("pratos", ESQUEMA_PRATO),
        "combos": lista("combos", ESQUEMA_COMBO),
        "cupons": lista("cupons", ESQUEMA_CUPOM),
        "promocoes": lista("promocoes", ESQUEMA_PROMOCAO),
    }


def texto_do_dados(dados: dict) -> str:
    """Monta o dados.js aqui no servidor: nada de JavaScript vindo do cliente."""
    momento = texto_limpo(dados.get("atualizadoEm"), 20) or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    dados["atualizadoEm"] = momento
    cabecalho = (
        "/* ------------------------------------------------------------------------\n"
        "   dados.js — fonte de verdade do cardápio, combos, cupons e configurações.\n"
        f"   Gerado pelo painel admin (admin.html) em {momento}.\n"
        "   ------------------------------------------------------------------------ */\n"
    )
    return f"{cabecalho}window.DADOS = {json.dumps(dados, ensure_ascii=False, indent=2)};\n"


# ------------------------------------------------------------------- servidor
class Servidor(SimpleHTTPRequestHandler):
    server_version = "MarmitasPOA"  # sem versão do Python para o mundo
    sys_version = ""
    protocol_version = "HTTP/1.1"
    timeout = 30  # conexão parada é encerrada, em vez de ficar pendurada

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(RAIZ), **kwargs)

    def parse_request(self) -> bool:
        self._corpo_lido = False  # zerado a cada requisição da mesma conexão
        self._csp = ""  # política só vale para a página que está sendo servida
        return super().parse_request()

    def log_error(self, formato: str, *args) -> None:
        # Conexão ociosa que expirou não é erro: não polui o log.
        if "timed out" in formato:
            return
        super().log_error(formato, *args)

    # -- cabeçalhos ---------------------------------------------------------
    def end_headers(self) -> None:
        caminho = unquote(urlparse(self.path).path)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
        if caminho.endswith("dados.js"):
            # Muda a cada publicação: sem isso o navegador pode mostrar o antigo.
            self.send_header("Cache-Control", "no-store, must-revalidate")
        if self._csp:
            self.send_header("Content-Security-Policy", self._csp)
        if self.headers.get("X-Forwarded-Proto") == "https":
            # Só quando existe HTTPS na frente (proxy reverso).
            self.send_header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        super().end_headers()

    def responder(self, codigo: int, dados: dict, cabecalhos: dict | None = None) -> None:
        corpo = json.dumps(dados, ensure_ascii=False).encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(corpo)))
        self.send_header("Cache-Control", "no-store")
        for nome, valor in (cabecalhos or {}).items():
            self.send_header(nome, valor)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(corpo)
        if not self._corpo_lido:
            # O endpoint não leu o corpo (pedido recusado, por exemplo). Sem
            # esvaziar o socket, os bytes que sobraram seriam lidos como se
            # fossem a próxima requisição da mesma conexão.
            self.descartar_corpo()

    def descartar_corpo(self) -> None:
        """Joga fora o corpo pendente; se for gigante, encerra a conexão."""
        try:
            tamanho = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            tamanho = 0
        if tamanho <= 0:
            return
        if tamanho > LIMITE_BYTES:
            self.close_connection = True
            return
        self.rfile.read(tamanho)

    def ler_corpo(self, limite: int = LIMITE_BYTES) -> bytes | None:
        """Lê o corpo com teto; None quando o pedido passa do limite (não lê nada)."""
        try:
            tamanho = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return b""
        if tamanho > limite:
            return None
        self._corpo_lido = True
        return self.rfile.read(tamanho) if tamanho > 0 else b""

    # -- sessão -------------------------------------------------------------
    def token_da_sessao(self) -> str:
        for parte in (self.headers.get("Cookie") or "").split(";"):
            nome, _, valor = parte.strip().partition("=")
            if nome == COOKIE:
                return valor
        return ""

    def autenticado(self) -> bool:
        return SESSOES.valida(self.token_da_sessao())

    def mesma_origem(self) -> bool:
        """Pedido que muda algo precisa vir do painel, e não de outro site."""
        if (self.headers.get("X-Painel") or "") != "1":
            return False
        origem = self.headers.get("Origin")
        if not origem:
            return True
        return urlparse(origem).netloc == (self.headers.get("Host") or "")

    def proteger(self) -> bool:
        """Porteiro de tudo que escreve: responde sozinho e devolve False se barrou."""
        origem = self.headers.get("Origin") or "-"
        if not self.autenticado():
            print(f"  bloqueado (sem sessão): {self.command} {self.path} de {self.client_address[0]}")
            self.responder(401, {"ok": False, "erro": "entre no painel para continuar"})
            return False
        if self.command != "GET" and not self.mesma_origem():
            print(f"  bloqueado (origem {origem}): {self.command} {self.path}")
            self.responder(403, {"ok": False, "erro": "pedido recusado"})
            return False
        return True

    def entrar_no_painel(self) -> None:
        ip = self.client_address[0]
        espera = TENTATIVAS.espera(ip)
        if espera:
            self.responder(429, {"ok": False, "erro": f"muitas tentativas; espere {espera} segundos"})
            return
        if not self.mesma_origem():
            self.responder(403, {"ok": False, "erro": "pedido recusado"})
            return

        corpo = self.ler_corpo(4096)
        if corpo is None:
            self.responder(413, {"ok": False, "erro": "pedido grande demais"})
            return
        try:
            senha = str(json.loads(corpo or b"{}").get("senha") or "")
        except (json.JSONDecodeError, AttributeError):
            senha = ""

        if not senha_guardada():
            self.responder(500, {"ok": False, "erro": "painel sem senha definida"})
            return
        if not conferir_senha(senha, senha_guardada()):
            TENTATIVAS.falhou(ip)
            print(f"  senha errada de {ip} ({len(senha)} caracteres)")
            time.sleep(0.5)
            self.responder(401, {"ok": False, "erro": "senha incorreta"})
            return

        TENTATIVAS.acertou(ip)
        token = SESSOES.abrir()
        cookie = f"{COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={SESSAO_SEGUNDOS}"
        if self.headers.get("X-Forwarded-Proto") == "https":
            cookie += "; Secure"
        print(f"  painel liberado para {ip}")
        self.responder(200, {"ok": True}, {"Set-Cookie": cookie})

    def sair_do_painel(self) -> None:
        SESSOES.fechar(self.token_da_sessao())
        baixar = f"{COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"
        self.responder(200, {"ok": True}, {"Set-Cookie": baixar})

    # -- GET ---------------------------------------------------------------
    def do_GET(self) -> None:  # noqa: N802 - assinatura da biblioteca padrão
        rota = urlparse(self.path)
        caminho = unquote(rota.path)

        if caminho == "/ping":
            # Só atestado de vida: sem detalhes de capacidade para quem não entrou.
            self.responder(200, {"ok": True})
            return

        if caminho == "/sessao":
            self.responder(200, {"ok": True, "autenticado": self.autenticado()})
            return

        if caminho == "/imagens":
            if not self.proteger():
                return
            self.listar_imagens()
            return

        if caminho.startswith("/img/"):
            linha = buscar_arquivo(caminho.lstrip("/"))
            if linha:
                self.servir_do_banco(linha)
                return

        self.servir_estatico(caminho)

    def servir_estatico(self, caminho: str) -> None:
        """Entrega só os arquivos do site; qualquer outra coisa vira 404.

        Aqui é o que impede `marmitas.db`, `servidor.py`, `config.json`, os
        rascunhos em `.tmp` e as pastas de trabalho de irem para o navegador.
        """
        relativo = "index.html" if caminho in ("/", "/index.html") else caminho_publico(caminho)
        if relativo:
            destino = (RAIZ / relativo).resolve()
            try:
                conteudo = destino.read_bytes()
            except OSError:
                relativo = None
        if not relativo:
            self.responder(404, {"ok": False, "erro": "não encontrado"})
            return

        modificado = formatdate(destino.stat().st_mtime, usegmt=True)
        self._csp = CSP_PAINEL if relativo == "admin.html" else CSP_SITE if relativo.endswith(".html") else ""
        if self.headers.get("If-Modified-Since") == modificado:
            self.send_response(304)
            self.end_headers()
            return

        self.send_response(200)
        self.send_header("Content-Type", self.guess_type(str(destino)))
        self.send_header("Content-Length", str(len(conteudo)))
        self.send_header("Last-Modified", modificado)
        if relativo.startswith("img/"):
            self.send_header("Cache-Control", "public, max-age=3600")
        self.end_headers()
        self.wfile.write(conteudo)

    def servir_do_banco(self, linha, somente_cabecalhos: bool = False) -> None:
        etiqueta = f'"{linha["hash"][:32]}"'
        if self.headers.get("If-None-Match") == etiqueta:
            self.send_response(304)
            self.send_header("ETag", etiqueta)
            self.end_headers()
            return
        dados = bytes(linha["dados"])
        self.send_response(200)
        self.send_header("Content-Type", linha["mime"])
        self.send_header("Content-Length", str(len(dados)))
        self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        self.send_header("ETag", etiqueta)
        self.end_headers()
        if not somente_cabecalhos:
            self.wfile.write(dados)

    # HEAD precisa passar pelo banco também: a classe base procuraria arquivo em disco.
    def do_HEAD(self) -> None:  # noqa: N802 - assinatura da biblioteca padrão
        caminho = unquote(urlparse(self.path).path)
        if caminho.startswith("/img/"):
            linha = buscar_arquivo(caminho.lstrip("/"))
            if linha:
                self.servir_do_banco(linha, somente_cabecalhos=True)
                return
        self.servir_estatico(caminho)

    def listar_imagens(self) -> None:
        usados = caminhos_usados_no_site()
        itens = [
            {
                "caminho": linha["caminho"],
                "nomeBase": linha["nome_base"],
                "variante": linha["variante"],
                "prato": linha["prato"] or "",
                "largura": linha["largura"],
                "altura": linha["altura"],
                "bytes": linha["bytes"],
                "originalBytes": linha["original_bytes"] or 0,
                "criadoEm": linha["criado_em"],
                "emUso": linha["caminho"] in usados,
            }
            for linha in listar_arquivos()
        ]
        principais = [item for item in itens if item["variante"] == "principal"]
        total = sum(item["bytes"] for item in principais)
        original = sum(item["originalBytes"] for item in principais)
        self.responder(200, {
            "itens": itens,
            "total": len(itens),
            "bytes": total,
            "originalBytes": original,
            "economia": (1 - total / original) if original else 0,
            "webp": TEM_WEBP,
        })

    # -- POST --------------------------------------------------------------
    def do_POST(self) -> None:  # noqa: N802 - assinatura da biblioteca padrão
        rota = urlparse(self.path)

        if rota.path == "/login":
            self.entrar_no_painel()
            return
        if rota.path == "/sair":
            self.sair_do_painel()
            return

        # Daqui para baixo só entra quem está com sessão aberta no painel.
        if not self.proteger():
            return

        if rota.path == "/upload":
            self.receber_upload(parse_qs(rota.query))
            return
        if rota.path == "/imagens/orfas":
            self.apagar_orfaos()
            return
        if rota.path == "/imagens/exportar":
            self.exportar_para_arquivos()
            return
        if rota.path == "/publicar":
            self.publicar()
            return

        self.responder(404, {"ok": False, "erro": "rota inexistente"})

    def receber_upload(self, parametros) -> None:
        tipo = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if tipo not in TIPOS_ACEITOS:
            self.responder(415, {"ok": False, "erro": "envie uma imagem JPG, PNG ou WEBP"})
            return

        corpo = self.ler_corpo(LIMITE_BYTES)
        if corpo is None:
            self.responder(413, {"ok": False, "erro": "imagem maior que 12 MB"})
            return
        if not corpo:
            self.responder(400, {"ok": False, "erro": "arquivo vazio"})
            return

        rotulo = texto_limpo((parametros.get("nome") or ["prato"])[0], 80) or "prato"
        prato = texto_limpo((parametros.get("prato") or [rotulo])[0], 80) or rotulo
        eh_logo = (parametros.get("tipo") or ["prato"])[0] == "logo"
        pasta = "img/logo" if eh_logo else "img/pratos"
        nome_base = f"{virar_slug(rotulo)}-{datetime.now().strftime('%Y%m%d-%H%M%S')}"

        principal = converter(
            corpo,
            LARGURA_LOGO if eh_logo else LARGURA_PRINCIPAL,
            QUALIDADE_LOGO if eh_logo else QUALIDADE_PRINCIPAL,
            preservar_alfa=eh_logo,
            sem_perdas=eh_logo,
        )
        if not principal:
            self.responder(500, {"ok": False, "erro": "não consegui preparar essa imagem"})
            return

        bytes_principal, largura, altura = principal
        guardar_arquivo(nome_base, "principal", prato, bytes_principal, largura, altura, len(corpo), pasta)
        caminho_miniatura = caminho_de(nome_base, "principal", pasta)

        if eh_logo:
            # Versão pequena: cabeçalho, rodapé e favicon. Mantém a transparência.
            miniatura = converter(
                bytes_principal, LARGURA_LOGO_MINI, QUALIDADE_LOGO, preservar_alfa=True
            )
        else:
            miniatura = converter(bytes_principal, LARGURA_MINIATURA, QUALIDADE_MINIATURA)
        if miniatura:
            bytes_miniatura, l_min, a_min = miniatura
            guardar_arquivo(nome_base, "miniatura", prato, bytes_miniatura, l_min, a_min, len(corpo), pasta)
            caminho_miniatura = caminho_de(nome_base, "miniatura", pasta)

        economia = 1 - len(bytes_principal) / len(corpo)
        print(
            f"  {'logo' if eh_logo else 'imagem'} {caminho_de(nome_base, 'principal', pasta)}  "
            f"{largura}x{altura}  "
            f"{len(bytes_principal)/1024:.0f} KB WebP (enviado {len(corpo)/1024:.0f} KB, "
            f"economia {economia*100:.0f}%)"
        )
        self.responder(200, {
            "ok": True,
            "foto": caminho_de(nome_base, "principal", pasta),
            "fotoThumb": caminho_miniatura,
            "largura": largura,
            "altura": altura,
            "bytes": len(bytes_principal),
            "originalBytes": len(corpo),
            "economia": economia,
        })

    def apagar_orfaos(self) -> None:
        """Apaga imagens que não estão no dados.js nem no rascunho do painel."""
        try:
            pedido = json.loads(self.ler_corpo(64 * 1024) or b"{}")
        except json.JSONDecodeError:
            pedido = {}
        manter = {texto_limpo(item, 200).lstrip("/") for item in (pedido.get("manter") or [])}
        usados = caminhos_usados_no_site() | manter

        bases = {linha["nome_base"] for linha in listar_arquivos() if linha["caminho"] not in usados}
        for base in bases:
            apagar_por_base(base)

        print(f"  limpeza: {len(bases)} imagem(ns) removida(s)")
        self.responder(200, {"ok": True, "removidas": len(bases)})

    def exportar_para_arquivos(self) -> None:
        """Grava as imagens do banco como arquivos, útil para hospedagem estática."""
        gravados = gravar_imagens()
        print(f"  exportadas {len(gravados)} imagens para arquivos")
        self.responder(200, {"ok": True, "gravados": gravados})

    def publicar(self) -> None:
        """Publica o rascunho: grava o dados.js na pasta do site, sem download.

        O painel manda o rascunho; o arquivo final é montado aqui, a partir de
        dados saneados. Assim nunca entra JavaScript de fora no site, mesmo que
        alguém consiga falar com esta rota. A versão anterior vai para .tmp/.
        """
        corpo = self.ler_corpo(LIMITE_PUBLICAR)
        if corpo is None:
            self.responder(413, {"ok": False, "erro": "dados.js acima de 1 MB"})
            return
        if not corpo:
            self.responder(400, {"ok": False, "erro": "nada para publicar"})
            return
        try:
            texto = corpo.decode("utf-8")
        except UnicodeDecodeError:
            self.responder(400, {"ok": False, "erro": "o dados.js precisa estar em UTF-8"})
            return
        if "window.DADOS" not in texto:
            self.responder(400, {"ok": False, "erro": "o arquivo enviado não é um dados.js"})
            return
        try:
            dados = ler_dados_js(texto)
        except Exception:  # noqa: BLE001 - arquivo inválido não pode sobrescrever o site
            self.responder(400, {"ok": False, "erro": "dados.js com conteúdo inválido"})
            return

        limpo = sanear_dados(dados)
        if not limpo["pratos"]:
            self.responder(400, {"ok": False, "erro": "o cardápio não pode ficar sem pratos"})
            return
        conteudo = texto_do_dados(limpo)

        destino = RAIZ / "dados.js"
        backup = ""
        if destino.exists():
            pasta = RAIZ / ".tmp"
            pasta.mkdir(exist_ok=True)
            arquivo_backup = pasta / f"dados-{datetime.now().strftime('%Y%m%d-%H%M%S')}.js"
            arquivo_backup.write_bytes(destino.read_bytes())
            backup = arquivo_backup.name

        destino.write_text(conteudo, encoding="utf-8")
        # As imagens usadas também viram arquivos: assim o site publicado abre
        # igual mesmo sem este servidor (hospedagem estática).
        gravadas = gravar_imagens(imagens_de(limpo))

        print(
            f"  publicado: dados.js ({len(conteudo)} bytes) · {len(gravadas)} imagem(ns) em arquivo"
            + (f" · backup .tmp/{backup}" if backup else "")
        )
        self.responder(200, {
            "ok": True,
            "bytes": len(conteudo),
            "backup": backup,
            "imagens": len(gravadas),
        })

    # -- DELETE ------------------------------------------------------------
    def do_DELETE(self) -> None:  # noqa: N802 - assinatura da biblioteca padrão
        rota = urlparse(self.path)
        if rota.path != "/imagens":
            self.responder(404, {"ok": False, "erro": "rota inexistente"})
            return
        if not self.proteger():
            return

        caminho = texto_limpo((parse_qs(rota.query).get("caminho") or [""])[0], 200).lstrip("/")
        if not caminho or not caminho.startswith("img/"):
            self.responder(400, {"ok": False, "erro": "informe o caminho da imagem"})
            return

        removidos = apagar_por_base(nome_base_de(caminho))
        print(f"  imagem apagada: {caminho} ({removidos} arquivo(s))")
        self.responder(200, {"ok": True, "removidos": removidos})


def main() -> None:
    parser = argparse.ArgumentParser(description="Servidor do site Marmitas POA")
    parser.add_argument("--porta", type=int, default=4173, help="porta (padrão: 4173)")
    parser.add_argument("--host", default="0.0.0.0", help="interface (padrão: 0.0.0.0)")
    parser.add_argument(
        "--definir-senha",
        nargs="?",
        const="",
        help="troca a senha do painel (sem valor, pergunta no terminal)",
    )
    argumentos = parser.parse_args()

    if argumentos.definir_senha is not None:
        nova = argumentos.definir_senha or getpass.getpass("Nova senha do painel: ")
        if len(nova) < 8:
            print("Use pelo menos 8 caracteres.")
            return
        definir_senha(nova)
        print(f"Senha do painel atualizada em {CONFIG.name}")
        return

    primeira_vez = ""
    if not senha_guardada():
        primeira_vez = gerar_senha()
        definir_senha(primeira_vez)

    ThreadingHTTPServer.daemon_threads = True
    servidor = ThreadingHTTPServer((argumentos.host, argumentos.porta), Servidor)
    print("Marmitas POA")
    print(f"  site   : http://{argumentos.host}:{argumentos.porta}")
    print(f"  painel : http://{argumentos.host}:{argumentos.porta}/admin.html")
    print(f"  banco  : {BANCO.name} — {contar_arquivos()} arquivo(s) de imagem")
    print(f"  formato: {'WebP' if TEM_WEBP else 'Pillow sem WebP: instale o suporte'}")
    if primeira_vez:
        print(f"  senha  : {primeira_vez}  (anote agora; troque com --definir-senha)")
    else:
        print(f"  senha  : guardada em {CONFIG.name} (troque com --definir-senha)")
    print("  pare com Ctrl+C")
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print("\nservidor encerrado")


if __name__ == "__main__":
    main()
