#!/usr/bin/env python3
"""Servidor local do site Marmitas POA.

Além de servir os arquivos do site (como o `python3 -m http.server`), recebe as
fotos enviadas pelo painel admin e grava em `img/pratos/`, gerando também a
miniatura usada nos cartões do cardápio.

Uso:
    python3 servidor.py            # http://localhost:4173
    python3 servidor.py --porta 8080
"""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

RAIZ = Path(__file__).resolve().parent
PASTA_FOTOS = RAIZ / "img" / "pratos"
LIMITE_BYTES = 10 * 1024 * 1024
LARGURA_PRINCIPAL = 1400
LARGURA_MINIATURA = 400
TIPOS = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}

try:
    from PIL import Image
except ImportError:  # sem Pillow o envio continua funcionando, só não redimensiona
    Image = None


def virar_slug(texto: str) -> str:
    """Transforma "Frango à Parmegiana" em "frango-a-parmegiana"."""
    texto = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()
    texto = re.sub(r"[^a-zA-Z0-9]+", "-", texto).strip("-").lower()
    return texto[:60] or "prato"


def para_rgb(imagem):
    """Converte para RGB, achatando transparência em fundo branco."""
    if imagem.mode in ("RGBA", "LA", "P"):
        convertida = imagem.convert("RGBA")
        fundo = Image.new("RGB", convertida.size, (255, 255, 255))
        fundo.paste(convertida, mask=convertida.split()[-1])
        return fundo
    return imagem.convert("RGB")


def reduzir(origem: Path, destino: Path, largura_maxima: int, qualidade: int) -> bool:
    """Reduz mantendo a proporção e salva em JPEG. False se não for possível."""
    if Image is None:
        return False
    try:
        with Image.open(origem) as imagem:
            imagem = para_rgb(imagem)
            if max(imagem.size) > largura_maxima:
                imagem.thumbnail((largura_maxima, largura_maxima), Image.LANCZOS)
            imagem.save(destino, "JPEG", quality=qualidade, optimize=True, progressive=True)
        return True
    except Exception as erro:  # noqa: BLE001 - queremos seguir mesmo se uma imagem falhar
        print(f"  ! não consegui redimensionar {origem.name}: {erro}")
        return False


class Servidor(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(RAIZ), **kwargs)

    # -- utilidades --------------------------------------------------------
    def responder(self, codigo: int, dados: dict) -> None:
        corpo = json.dumps(dados, ensure_ascii=False).encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(corpo)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(corpo)

    # -- rotas -------------------------------------------------------------
    def do_GET(self) -> None:  # noqa: N802 - assinatura da biblioteca padrão
        if urlparse(self.path).path == "/ping":
            self.responder(200, {"ok": True, "upload": True, "redimensiona": Image is not None})
            return
        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802 - assinatura da biblioteca padrão
        rota = urlparse(self.path)
        if rota.path != "/upload":
            self.responder(404, {"ok": False, "erro": "rota inexistente"})
            return

        tipo = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if tipo not in TIPOS:
            self.responder(415, {"ok": False, "erro": "envie uma imagem JPG, PNG ou WEBP"})
            return

        try:
            tamanho = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            tamanho = 0
        if tamanho <= 0:
            self.responder(400, {"ok": False, "erro": "arquivo vazio"})
            return
        if tamanho > LIMITE_BYTES:
            self.responder(413, {"ok": False, "erro": "imagem maior que 10 MB"})
            return

        corpo = self.rfile.read(tamanho)
        nome = (parse_qs(rota.query).get("nome") or ["prato"])[0]
        base = f"{virar_slug(nome)}-{datetime.now().strftime('%Y%m%d-%H%M%S')}"

        PASTA_FOTOS.mkdir(parents=True, exist_ok=True)
        recebido = PASTA_FOTOS / f"{base}-enviado{TIPOS[tipo]}"
        recebido.write_bytes(corpo)

        principal = PASTA_FOTOS / f"{base}.jpg"
        miniatura = PASTA_FOTOS / f"{base}-thumb.jpg"

        if reduzir(recebido, principal, LARGURA_PRINCIPAL, 82):
            reduzir(principal, miniatura, LARGURA_MINIATURA, 78)
            recebido.unlink(missing_ok=True)
        else:
            # Sem Pillow: guarda o arquivo original e usa ele nos dois tamanhos.
            principal = recebido.with_name(f"{base}{TIPOS[tipo]}")
            recebido.replace(principal)
            miniatura = principal

        relativo = lambda caminho: caminho.relative_to(RAIZ).as_posix()  # noqa: E731
        print(f"  foto recebida -> {relativo(principal)}")
        if miniatura != principal:
            print(f"  miniatura    -> {relativo(miniatura)}")

        self.responder(200, {"ok": True, "foto": relativo(principal), "fotoThumb": relativo(miniatura)})


def main() -> None:
    parser = argparse.ArgumentParser(description="Servidor do site Marmitas POA")
    parser.add_argument("--porta", type=int, default=4173, help="porta (padrão: 4173)")
    argumentos = parser.parse_args()

    servidor = ThreadingHTTPServer(("0.0.0.0", argumentos.porta), Servidor)
    print("Marmitas POA")
    print(f"  site   : http://localhost:{argumentos.porta}")
    print(f"  painel : http://localhost:{argumentos.porta}/admin.html")
    print(f"  fotos  : {'redimensionadas com Pillow' if Image else 'sem Pillow: salvas sem redimensionar'}")
    print("  pare com Ctrl+C")
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print("\nservidor encerrado")


if __name__ == "__main__":
    main()
