# Nina Cloud Run

Substitui o fluxo n8n da Nina por um serviço Node/Express no Cloud Run - mesma
stack dos seus outros projetos pessoais (Firebase + Cloud Run, como o Tio
Patinhas Finanças). Testado localmente: sintaxe validada, servidor sobe e
responde no `/health`, dependências instalam sem conflito, e o loop de tool
use foi testado com mocks.

## O que muda em relação ao n8n

| Antes (n8n) | Agora (Cloud Run) |
|---|---|
| Switch + 4 ramos manuais | roteamento por tipo dentro de `index.js` |
| Nó de transcrição externo | Google Cloud Speech-to-Text |
| Nó "Analyze an image" | Claude recebe a imagem nativamente na mesma chamada |
| Postgres (`n8n_chat_bia`) | Firestore (coleção `conversations`) |
| OAuth do Google expirando sem avisar | MCP resolve Calendar/Gmail/Drive; Tasks tem refresh automático via Cloud Scheduler |
| ~13 nós de ferramenta pendurados no AI Agent | 3 MCP servers + 1 tool custom (Tasks) |

## Passo a passo (Google Cloud Console + GitHub, sem terminal)

### 1. Criar o repositório
Suba esta pasta pro GitHub (ex: `biaxmachado-jpg/nina-cloudrun`), mesmo padrão
dos seus outros projetos.

### 2. Criar/escolher o projeto GCP
Se for usar um projeto novo, crie em console.cloud.google.com. Se for
reaproveitar um que já tem (ex: o mesmo do Tio Patinhas), tudo bem também.

Habilite as APIs (Console → APIs & Services → Enable APIs):
- Cloud Run API
- Cloud Build API
- Firestore API
- Cloud Speech-to-Text API
- Cloud Scheduler API

### 3. Criar o banco Firestore
Console → **Firestore → Create database** → modo **Native**, região
`southamerica-east1` (ou a mesma que você já usa). Não precisa criar
coleções manualmente - o código cria ao gravar a primeira mensagem.

### 4. Criar a service account de deploy
Console → **IAM & Admin → Service Accounts → Create**. Dá os papéis:
- Cloud Run Admin
- Cloud Build Editor
- Service Account User
- Firestore User (pra rodar localmente/testar, se precisar)

Gera uma chave JSON pra essa conta (Keys → Add key → JSON) e guarda o
conteúdo - vai usar no passo 6.

### 5. Configurar os secrets no Secret Manager
Console → **Security → Secret Manager → Create secret**, um por vez:
- `ANTHROPIC_API_KEY`
- `UAZAPI_TOKEN`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` (os mesmos
  que você já usa no n8n hoje)
- `MCP_CALENDAR_URL` → `https://calendarmcp.googleapis.com/mcp/v1`
- `MCP_GMAIL_URL` → `https://gmailmcp.googleapis.com/mcp/v1`
- `MCP_DRIVE_URL` → `https://drivemcp.googleapis.com/mcp/v1`
- `CRON_SECRET` → invente uma senha aleatória qualquer (protege o endpoint de refresh de token)

Dê à service account do Cloud Run (a que for criada automaticamente no
primeiro deploy, formato `PROJECT_NUMBER-compute@developer.gserviceaccount.com`)
o papel **Secret Manager Secret Accessor** em cada um desses secrets.

### 6. Configurar o GitHub Actions
No repositório: **Settings → Secrets and variables → Actions**, adicionar:
- `GCP_SA_KEY` → cola o JSON inteiro da chave do passo 4

Edita `.github/workflows/deploy.yml` direto pelo navegador e troca
`SEU_PROJECT_ID_AQUI` pelo ID real do seu projeto GCP.

### 7. Disparar o deploy
Qualquer commit na `main` builda a imagem (via Cloud Build) e publica no
Cloud Run automaticamente. Confirma na aba **Actions** do GitHub que rodou
verde, e pega a URL do serviço em Console → Cloud Run → `nina-cloudrun`.

### 8. Apontar o UAZAPI pro novo serviço
No painel do UAZAPI, troca a URL do webhook pra
`https://SUA-URL-DO-CLOUD-RUN/webhook` (hoje deve estar apontando pro n8n).

### 9. Configurar o Cloud Scheduler (refresh de token)
Console → **Cloud Scheduler → Create job**:
- Frequência: `0 */6 * * *` (a cada 6 horas)
- Destino: HTTP, URL = `https://SUA-URL-DO-CLOUD-RUN/cron/refresh-token`
- Método: POST
- Cabeçalho: `x-cron-secret: <o mesmo valor que você colocou no secret CRON_SECRET>`

### 10. Ajustar os dois pontos que dependem do seu payload real
Marcados com `TODO` no código:
- `src/index.js` → `parseIncoming()`
- `src/uazapi.js` → `downloadMedia()`

Me manda um exemplo real (censurando dados sensíveis) do payload que hoje
chega no nó "Dados" do n8n e do retorno do "Buscar mídia", que eu ajusto certinho.

## Rodar localmente (opcional)

```
npm install
npm test
```

## Estrutura

```
src/
  index.js    → servidor Express, webhook, endpoint de cron
  memory.js   → histórico de conversa (Firestore)
  media.js    → transcrição de áudio (Speech-to-Text) e blocos pro Claude
  claude.js   → chamada à API da Claude, MCP servers, loop de tool use
  tasks.js    → Google Tasks (REST direto) + refresh de token (Firestore)
  uazapi.js   → enviar mensagem e baixar mídia
Dockerfile    → container pro Cloud Run
.github/workflows/deploy.yml → build + deploy automático a cada push na main
```
