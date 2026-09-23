# Marmitas POA — site, painel e banco de imagens em um único container.
#
# O que este container roda:
#   - os arquivos do site (index/styles/script/dados + img)
#   - o painel do cardápio (/admin.html), com login conferido no servidor
#   - o banco de imagens (SQLite) e a publicação do dados.js
#
# O que ele NÃO faz: HTTPS. Quem termina o TLS é o nginx (ou Caddy/Traefik) do
# host, apontando para esta porta. Veja o DEPLOY.md.

FROM python:3.13-slim

# tzdata: os horários (nome de arquivo, log, cabeçalho do dados.js) saem no
# fuso de Porto Alegre, não em UTC.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tzdata \
    && rm -rf /var/lib/apt/lists/*

ENV TZ=America/Sao_Paulo \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# O wheel do Pillow já vem com suporte a WebP: não precisa compilar nada
# (por isso a imagem slim, sem gcc).
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Código e conteúdo do site. O banco (marmitas.db) e a senha (config.json) ficam
# de fora — veja o .dockerignore. Eles são seus dados e entram por volume.
COPY . .

# Roda como usuário comum: se algo escapar pelo servidor, não escapa como root.
# O uid 1000 combina com o usuário padrão de uma VPS; se o seu for outro, use
# `user:` no docker-compose.yml (veja o DEPLOY.md).
RUN useradd --create-home --uid 1000 --user-group marmitas \
    && mkdir -p /app/.tmp \
    && chown -R marmitas:marmitas /app
USER marmitas

EXPOSE 4173
# Ctrl+C no container encerra o servidor com a mensagem de saída, em vez de matar.
STOPSIGNAL SIGINT

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:4173/ping', timeout=4)"

# 0.0.0.0 dentro do container é o que permite o mapeamento de portas do Docker.
# Na VPS, publique só em 127.0.0.1 (127.0.0.1:4173:4173) e deixe o nginx na frente.
CMD ["python3", "servidor.py", "--host", "0.0.0.0", "--porta", "4173"]
