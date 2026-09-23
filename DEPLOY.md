# Publicar o Marmitas POA numa VPS

Este arquivo não é servido pelo site (só `index.html`, `styles.css`, `script.js`,
`dados.js`, `admin.html`, `admin.css`, `admin.js` e imagens de `img/` são
públicos). Ele é o roteiro para subir o site com segurança.

São dois caminhos. O primeiro é o recomendado — **Docker na Hetzner**:

| Caminho | Quando usar |
|---|---|
| [Com Docker](#com-docker-caminho-recomendado-na-hetzner) | Subir rápido, atualizar sem mexer no sistema e reiniciar sozinho se cair. |
| [Sem Docker](#passo-a-passo-sem-docker) | Se você preferir rodar direto na VPS, com `systemd`. |

Nos dois casos o **nginx com HTTPS fica no host** e é ele que fala com a internet;
o servidor Python só escuta em localhost.

## O que o servidor já protege

| Risco | Como está resolvido |
|---|---|
| Baixar o banco de imagens | `marmitas.db`, `.db-wal`, `.db-shm` e as pastas de trabalho (`.tmp`, `.agents`, `.legacy`) devolvem 404: o servidor só entrega uma lista branca de arquivos. |
| Baixar o código do servidor ou a config | `servidor.py`, `config.json` e os `.md` do projeto também ficam fora do alcance. |
| Qualquer pessoa apagar ou trocar o conteúdo | Escrever (`/upload`, `/publicar`, `/imagens/*`, `DELETE /imagens`) exige sessão. Sem cookie, a resposta é 401. |
| Roubar a senha | A senha vive em `config.json` como hash PBKDF2-SHA256 (200 mil iterações, sal aleatório) e o arquivo fica com permissão 600. O cookie é `HttpOnly` + `SameSite=Strict`, então o JavaScript da página não o lê. |
| Força bruta | 8 tentativas erradas por IP e o login passa a responder 429 por 5 minutos (mais meio segundo de atraso em cada erro). |
| Site de terceiros publicando no seu lugar (CSRF) | Todo pedido que escreve precisa do cabeçalho `X-Painel: 1` e de `Origin` igual ao próprio host. |
| Injeção de JavaScript pelo publicar | O servidor recebe o rascunho, descarta o que não conhece (tipos, tamanhos, chaves) e monta o `dados.js` ele mesmo. Nada de JavaScript vindo de fora entra no arquivo. |
| XSS com nome de prato | O site escapa todo texto que vem do `dados.js` antes de montar o HTML (`esc()` em `script.js`). |
| Poluição de cache | `dados.js` sai com `no-store`, então o cliente sempre pega a versão publicada. |
| Listagem de diretórios, path traversal, vazamento de versão | Tudo desligado; o cabeçalho `Server` não informa a versão do Python. |
| Cabeçalhos | `Content-Security-Policy` (uma política para o site, outra mais estrita para o painel), `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` e HSTS quando há HTTPS. |

## Com Docker (caminho recomendado na Hetzner)

O `Dockerfile` e o `docker-compose.yml` estão na raiz do projeto. O container roda
o site, o painel e o banco de imagens; **o HTTPS continua sendo do nginx do host**,
que repassa para a porta publicada só em localhost.

A imagem **não leva** o banco nem a senha (veja o `.dockerignore`): esses dois são
seus dados e ficam na pasta da VPS, montada como volume.

### 1. Preparar a VPS

Um CX22 (2 vCPU, 4 GB) já sobra — o container fica em torno de 150 MB de memória.
Ubuntu 24.04:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx rsync
sudo usermod -aG docker $USER      # saia e entre de novo para o grupo valer
```

### 2. Levar o projeto para lá

```bash
sudo mkdir -p /opt/marmitas && sudo chown $USER:$USER /opt/marmitas

# da sua máquina: leva o site, o banco com suas imagens e o dados.js publicado.
# Deixe o config.json de fora para o container criar uma senha nova por lá.
rsync -av --exclude .agents --exclude .legacy --exclude __pycache__ \
      --exclude config.json ./ usuario@SEU_IP:/opt/marmitas/
```

### 3. Subir

```bash
cd /opt/marmitas
PUID=$(id -u) PGID=$(id -g) docker compose up -d --build
docker compose logs -f marmitas
```

Na primeira vez o log mostra a senha do painel:

```
  senha  : tempero-forno-9699  (anote agora; troque com --definir-senha)
```

Anote e depois troque (o comando pergunta a senha nova e já vale na hora):

```bash
docker compose exec marmitas python3 servidor.py --definir-senha
docker compose restart marmitas       # derruba as sessões abertas
```

### 4. HTTPS na frente

O nginx do host usa a mesma configuração da seção seguinte, apontando para
`http://127.0.0.1:4173`. A porta está publicada **só em localhost** justamente
por isso: `4173:4173` sem o `127.0.0.1:` deixaria o painel exposto sem TLS.

### 5. Atualizar o site depois

```bash
cd /opt/marmitas
git pull    # ou repita o rsync da sua máquina
PUID=$(id -u) PGID=$(id -g) docker compose up -d --build
```

Mudar o cardápio continua sendo pelo painel (**Publicar agora**), sem tocar no
container.

### 6. Backup, logs e socorro

```bash
# backup consistente do banco de imagens (mesmo com o site rodando)
sqlite3 /opt/marmitas/marmitas.db ".backup '/var/backups/marmitas-$(date +%F).db'"

docker compose logs --tail 100 marmitas     # o que o servidor está fazendo
docker compose ps                           # estado e saúde do container
docker compose down                         # parar (o volume é a pasta, nada se perde)
```

### Alternativa: guardar os dados num volume em vez da pasta

Se preferir não montar a pasta inteira, crie um volume — ele nasce com o conteúdo
da imagem e cresce sozinho:

```bash
docker volume create marmitas-dados
docker run -d --name marmitas --restart unless-stopped \
  -p 127.0.0.1:4173:4173 \
  -v marmitas-dados:/app \
  --user $(id -u):$(id -g) \
  -e TZ=America/Sao_Paulo \
  marmitas-poa:latest
```

A diferença é que, com volume, atualizar o código exige `docker cp` ou reconstruir
a imagem — por isso o bind mount da pasta é o caminho mais simples no dia a dia.

## Passo a passo sem Docker

### 1. Usuário e pasta

```bash
sudo adduser --system --group marmitas
sudo mkdir -p /opt/marmitas
# envie os arquivos do site (rsync/scp) para /opt/marmitas
sudo chown -R marmitas:marmitas /opt/marmitas
sudo chmod 600 /opt/marmitas/marmitas.db /opt/marmitas/config.json
```

### 2. Dependências

```bash
sudo apt update
sudo apt install python3 python3-pil     # Pillow com suporte a WebP
```

### 3. Definir a senha do painel

```bash
cd /opt/marmitas
sudo -u marmitas python3 servidor.py --definir-senha
```

Sem argumento, ele pergunta a senha no terminal (não fica no histórico). Se você
nunca definir, o primeiro start cria uma senha aleatória e mostra uma única vez.

### 4. Rodar como serviço

`/etc/systemd/system/marmitas.service`:

```ini
[Unit]
Description=Site Marmitas POA
After=network.target

[Service]
User=marmitas
Group=marmitas
WorkingDirectory=/opt/marmitas
ExecStart=/usr/bin/python3 servidor.py --host 127.0.0.1 --porta 4173
Restart=on-failure
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/marmitas

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now marmitas
sudo systemctl status marmitas
```

Repare no `--host 127.0.0.1`: o servidor **não** fica exposto direto na internet;
quem atende é o nginx. O `ProtectSystem=strict` deixa o sistema de arquivos
somente leitura, exceto a pasta do site.

### 5. Nginx com HTTPS

```bash
sudo apt install nginx certbot python3-certbot-nginx
```

`/etc/nginx/sites-available/marmitas`:

```nginx
server {
    listen 80;
    server_name seudominio.com.br www.seudominio.com.br;

    client_max_body_size 14m;   # as fotos têm teto de 12 MB no servidor

    location / {
        proxy_pass http://127.0.0.1:4173;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/marmitas /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d seudominio.com.br -d www.seudominio.com.br
```

O certbot reescreve o bloco para HTTPS e cuida da renovação. Com o
`X-Forwarded-Proto` chegando como `https`, o servidor manda HSTS e marca o
cookie de sessão como `Secure`.

### 6. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

A porta 4173 não precisa ser liberada — ela escuta só no localhost.

### 7. Backup

O conteúdo que muda é o `marmitas.db` (imagens) e o `dados.js` (cardápio).
Uma linha no cron resolve:

```bash
sqlite3 /opt/marmitas/marmitas.db ".backup '/var/backups/marmitas-$(date +%F).db'"
```

## Depois de publicado

- **Mudar o cardápio**: entre no painel, edite e clique em **Publicar agora**. O
  `dados.js` é gravado na pasta do site e as imagens usadas são exportadas para
  `img/pratos` e `img/logo`.
- **Trocar a senha**: `sudo -u marmitas python3 servidor.py --definir-senha`
  (depois `systemctl restart marmitas` para derrubar as sessões abertas).
- **Conferir se está tudo fechado** (rode na VPS, com o domínio real):

```bash
D=https://seudominio.com.br
for alvo in "/marmitas.db" "/servidor.py" "/config.json" "/.tmp/"; do
  echo -n "$alvo -> "; curl -s -o /dev/null -w '%{http_code}\n' "$D$alvo"
done                              # esperado: 404 em todos
curl -s -o /dev/null -w 'publicar sem sessão -> %{http_code}\n' -X POST "$D/publicar"   # 401
curl -sI "$D/" | grep -i content-security-policy                                        # aparece
```

## Hospedagem sem servidor (opcional)

Como o publicar exporta as imagens para arquivos, o site pode ser servido
estático (S3, Netlify, nginx sem proxy). Nesse caso copie **só** `index.html`,
`styles.css`, `script.js`, `dados.js` e `img/` — nunca o resto da pasta:
`admin.html`, `admin.css`, `admin.js`, `DEPLOY.md`, `cardápio.md`,
`ficha-cadastro-*.md`, `marmitas.db*`, `config.json`, `servidor.py`, `.tmp/`,
`.agents/` ou `.legacy/`. O painel e o banco continuam na VPS, protegidos.

O painel não tem link no site: entre direto pela URL
(`https://seudominio.com.br/admin.html`) e deixe nos favoritos.

## O que ainda vale a pena fazer

- **Backup fora da VPS** (o cron acima grava na mesma máquina).
- **fail2ban** apontando para o log do nginx, se quiser bloquear IPs que ficam
  varrendo o servidor.
- **2FA no painel**: hoje a proteção é a senha + bloqueio por tentativas; para
  duas etapas seria preciso um segundo fator (TOTP), que ainda não existe.
- **Revisar as dependências** (`python3-pil`) junto com o `apt upgrade` da VPS.
