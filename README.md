# MyCloud Share

Extensão Chrome (MV3) que envia um arquivo para o Cloudflare R2 e gera uma URL pública.
Quem abre a URL vê o arquivo no navegador (imagem, PDF, txt/csv) ou recebe a opção de baixar.

## Setup do Worker

```sh
cd worker
npm install
npx wrangler r2 bucket create mycloud-share
npx wrangler secret put UPLOAD_TOKEN      # token que a extensão usará
npx wrangler deploy
```

Opcional: no painel do R2, adicione uma regra de lifecycle para apagar objetos com mais de 30 dias
(a expiração por arquivo já é verificada no acesso).

Teste local: crie `worker/.dev.vars` com `UPLOAD_TOKEN=dev` e rode `npm run dev`.

## Extensão

1. `chrome://extensions` → Modo desenvolvedor → **Carregar sem compactação** → pasta `extension/`.
2. No popup, abra *Configurações*, informe a URL do Worker e o token.
3. Escolha o arquivo → **Compartilhar** → a URL é copiada.

## Rotas

| Rota | Função |
|---|---|
| `POST /upload` | Upload (Bearer token). Headers: `X-Filename`, `X-TTL-Days`. |
| `GET /v/:id` | Visualizador (imagem, PDF, texto) com botão de download. |
| `GET /f/:id` | Arquivo bruto; tipos desconhecidos/HTML/SVG são sempre `attachment`. |
