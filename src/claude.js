import { createTask, listTasks } from "./tasks.js";

const CLAUDE_MODEL = "claude-sonnet-4-6";
const MAX_TOOL_ROUNDS = 5;

const SYSTEM_PROMPT = `Você é a Nina, secretária pessoal via WhatsApp da Bia.
Você ajuda a marcar eventos na agenda (pessoal ou da família), criar tarefas,
e consultar e-mails. Seja direta, objetiva e use um tom natural de mensagem
de WhatsApp - sem formalidade excessiva. Quando for marcar um evento, sempre
confirme qual calendário usar (pessoal ou família) se não estiver claro.
Quando for criar uma tarefa, use a lista mais apropriada com base no contexto.`;

const CUSTOM_TOOLS = [
  {
    name: "google_tasks_create",
    description: "Cria uma tarefa em uma lista do Google Tasks",
    input_schema: {
      type: "object",
      properties: {
        list_id: { type: "string", description: "ID da lista de tarefas" },
        title: { type: "string", description: "Título da tarefa" },
        notes: { type: "string", description: "Notas adicionais (opcional)" },
        due: { type: "string", description: "Data de vencimento em RFC3339 (opcional)" },
      },
      required: ["list_id", "title"],
    },
  },
  {
    name: "google_tasks_list",
    description: "Lista as tarefas pendentes de uma lista do Google Tasks",
    input_schema: {
      type: "object",
      properties: {
        list_id: { type: "string", description: "ID da lista de tarefas" },
      },
      required: ["list_id"],
    },
  },
];

function buildMcpServers(config) {
  return [
    { type: "url", url: config.MCP_CALENDAR_URL, name: "google-calendar" },
    { type: "url", url: config.MCP_GMAIL_URL, name: "gmail" },
    { type: "url", url: config.MCP_DRIVE_URL, name: "google-drive" },
  ];
}

async function callClaude(config, messages) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "mcp-client-2025-04-04",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages,
      tools: CUSTOM_TOOLS,
      mcp_servers: buildMcpServers(config),
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Erro na API da Claude (${resp.status}): ${errText}`);
  }

  return resp.json();
}

async function executeCustomTool(db, config, name, input) {
  switch (name) {
    case "google_tasks_create": {
      const result = await createTask(db, config, input.list_id, input.title, input.notes, input.due);
      return JSON.stringify(result);
    }
    case "google_tasks_list": {
      const result = await listTasks(db, config, input.list_id);
      return JSON.stringify(result);
    }
    default:
      return JSON.stringify({ error: `Ferramenta desconhecida: ${name}` });
  }
}

/**
 * db = instância do Firestore, config = variáveis de ambiente/secrets.
 */
export async function runNinaAgent(db, config, history, userContentBlocks) {
  const messages = [
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: userContentBlocks },
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await callClaude(config, messages);

    const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");

    if (toolUseBlocks.length === 0) {
      const textBlocks = response.content.filter((b) => b.type === "text");
      return textBlocks.map((b) => b.text).join("\n").trim();
    }

    messages.push({ role: "assistant", content: response.content });

    const toolResults = [];
    for (const block of toolUseBlocks) {
      const result = await executeCustomTool(db, config, block.name, block.input);
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
    }
    messages.push({ role: "user", content: toolResults });
  }

  return "Desculpa, tive um problema pra concluir isso - pode tentar de novo?";
}
