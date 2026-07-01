# Coletor Territorial

Aplicação web (PWA) para coleta de dados territoriais offline com formulário dinâmico, GNSS do celular, mapa e exportação geoespacial (CSV, KML, GeoJSON e Shapefile).

## Estrutura

```
ColetorTerritorial/
├── index.html              # Layout, telas, navegação
├── styles.css              # Tema campo (alto contraste, dark mode, acessível)
├── app.js                  # Lógica (IndexedDB, formulário, GNSS, mapa, export)
├── sw.js                   # Service Worker (cache offline)
├── manifest.webmanifest    # Manifest PWA
└── icons/
    ├── icon-192.png
    └── icon-512.png
```

## Como executar

### Requisito crítico: HTTPS

O GNSS (`navigator.geolocation`) **só funciona em HTTPS** ou em `localhost`. Em `http://` comum o navegador bloqueia a captura.

### Opção A — desenvolvimento local

```bash
# Python (se instalado)
python -m http.server 8080
# acessar http://localhost:8080  (GNSS funciona em localhost)
```

```bash
# Node.js
npx serve .
```

### Opção B — produção (recomendado)

Publique a pasta em qualquer host estático com HTTPS:
- GitHub Pages
- Netlify
- Vercel
- Cloudflare Pages
- ou seu próprio servidor web com TLS

Depois de carregar a página uma vez online, instale como PWA (menu do navegador → "Adicionar à tela inicial"). A partir daí o Service Worker garante funcionamento offline.

## Funcionalidades

- **Construtor de formulário dinâmico** com 10 tipos de campo e versionamento de schema.
- **Coleta offline** com armazenamento em IndexedDB (persistente).
- **GNSS** com captura única, monitoramento contínuo e entrada manual com preservação da coordenada original.
- **Mapa Leaflet** com pop-ups dinâmicos baseados nos campos do formulário.
- **Validação** de campos obrigatórios, coordenadas e tipos numéricos.
- **Exportação**:
  - **CSV** — UTF-8 com BOM (abre certo no Excel pt-BR), separador configurável.
  - **KML** — para Google Earth, ordem lon,lat,alt.
  - **GeoJSON** — FeatureCollection, ordem lon,lat.
  - **Shapefile (.zip)** — via `@crmackey/shp-write`, com mapeamento automático de nomes de campo ≤ 10 caracteres exibido antes do download.
- **Acessibilidade** — alto contraste, alvos de toque ≥ 44px, navegação por teclado, `aria-live`.
- **Status online/offline** e indicador de cota de armazenamento.

## Dados de exemplo

No primeiro acesso, a aplicação cria automaticamente:
- Um formulário demo ("Cadastro Territorial de Campo") com 4 campos.
- Três registros de exemplo (Comunidade, Escola, Porto) ao redor de Manaus.

Para recomeçar do zero: Configurações → "Apagar todos os dados".

## Sobre o Shapefile

A exportação usa `@crmackey/shp-write` (fork mantido do `mapbox/shp-write`, com `fflate` no lugar de JSZip). Como o formato DBF impõe limite de 10 caracteres no nome do campo, a aplicação abrevia automaticamente e mostra a tabela de mapeamento antes do download.

Para casos-limite (geometrias mistas, reprojeção complexa), use a exportação GeoJSON e converta no QGIS.

## Limitações conhecidas

- Sincronização com servidor está fora do escopo desta versão.
- Tiles de mapa base comerciais (Google/Bing) não são cacheados offline (violam ToS). O mapa funciona sem base, mostrando apenas os pontos coletados.
- Modo anônimo/incógnita do navegador apaga o IndexedDB ao fechar — use a instalação PWA.

## Versão

2.0.0 — conforme especificação da skill `skill_formulario_dinamico_offline_gnss_webgis.md` (v2.0).
