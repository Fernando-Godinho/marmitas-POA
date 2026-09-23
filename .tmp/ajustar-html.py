"""Ajustes pontuais no index.html: marca os links editáveis pelo admin e
adiciona o link do painel no rodapé. Rodar da raiz: python3 .tmp/ajustar-html.py
"""

caminho = 'index.html'
src = open(caminho, encoding='utf-8').read()

whatsapp = 'href="https://wa.me/5551993560070"'
instagram = 'href="https://instagram.com/marmitaspoa"'
print('links whatsapp:', src.count(whatsapp), '| instagram:', src.count(instagram))

src = src.replace(whatsapp, 'data-link-whatsapp ' + whatsapp)
src = src.replace(instagram, 'data-link-instagram ' + instagram)

antigo = '<a href="#inicio">Voltar ao topo ↑</a>'
novo = '<div class="footer-links"><a href="admin.html">Painel</a><a href="#inicio">Voltar ao topo ↑</a></div>'
if antigo not in src:
    raise SystemExit('link do rodapé não encontrado')
src = src.replace(antigo, novo)

open(caminho, 'w', encoding='utf-8').write(src)
print('index.html atualizado')
