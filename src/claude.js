import { createTask, listTasks, listTaskLists } from "./tasks.js";
import { listEvents, createEvent } from "./calendar.js";
import { listMessages, sendMessage } from "./gmail.js";
import { addRecipe } from "./cardapio_recipes.js";

const CLAUDE_MODEL = "claude-sonnet-4-6";
const MAX_TOOL_ROUNDS = 5;

// IDs dos calendários já configurados (mesmos usados no n8n/Nina anterior)
const CALENDAR_IDS = {
  pessoal: "bia.x.machado@gmail.com",
  familia: "family05481570382979939457@group.calendar.google.com",
};

function buildSystemPrompt(taskLists, taskListsError) {
  const listaTexto = taskLists.length
    ? taskLists.map((l) => `- "${l.title}" → list_id: ${l.id}`).join("\n")
    : `(não foi possível carregar as listas agora - erro técnico: "${taskListsError || "desconhecido"}". Se a Bia perguntar sobre tarefas, conte esse erro técnico pra ela em vez de pedir o list_id.)`;

  return `Você é a Nina, secretária pessoal via WhatsApp da Bia.
Você ajuda a marcar eventos na agenda (pessoal ou da família), criar tarefas,
consultar e-mails, e adicionar receitas no app Cardápio da Casa. Seja direta,
objetiva e use um tom natural de mensagem de WhatsApp - sem formalidade
excessiva.

Calendários disponíveis:
- Pessoal: "${CALENDAR_IDS.pessoal}"
- Família: "${CALENDAR_IDS.familia}"
Quando for marcar ou consultar um evento, sempre confirme qual calendário
usar (pessoal ou família) se não estiver claro pelo contexto da mensagem.

Quando a Bia mandar uma imagem de convite (aniversário, festa, reunião,
evento em geral), extraia data, horário, local e nome do evento/aniversariante,
e já pergunte se quer que você adicione na agenda - sugira o calendário mais
provável pelo contexto (ex: aniversário de criança → família). Se ela
confirmar, use calendar_create_event com esses dados. Se a imagem não tiver
informação suficiente (falta data ou horário, por exemplo), avise o que está
faltando em vez de inventar.

Listas de tarefas do Google Tasks já disponíveis (use o list_id certo, NUNCA
pergunte o list_id pra Bia - você já sabe todos):
${listaTexto}
Se a Bia não disser qual lista usar, escolha a mais apropriada pelo contexto
(ex: assunto de compras → lista de compras, assunto de casa → "Casa", etc.)
e mencione qual lista você escolheu na resposta.

Se uma ferramenta retornar um erro, não trave a conversa - avise brevemente
que aquela ação específica não funcionou agora e continue ajudando com o
resto da mensagem normalmente.`;
}

// Nota: os MCP servers do Google (Calendar/Gmail) não podem ser usados aqui
// porque a API da Claude fora do claude.ai exige um token de autorização
// próprio por servidor MCP, que não temos como gerar automaticamente nesse
// fluxo. Por isso Calendar, Gmail e Tasks são todos ferramentas custom com
// chamada REST direta à API do Google (ver calendar.js, gmail.js, tasks.js).
const CUSTOM_TOOLS = [
  {
    name: "calendar_list_events",
    description: "Lista eventos de um calendário do Google (pessoal ou família) num período",
    input_schema: {
      type: "object",
      properties: {
        calendar: { type: "string", enum: ["pessoal", "familia"], description: "Qual calendário consultar" },
        time_min: { type: "string", description: "Data/hora inicial em ISO 8601 (opcional, padrão: agora)" },
        time_max: { type: "string", description: "Data/hora final em ISO 8601 (opcional)" },
      },
      required: ["calendar"],
    },
  },
  {
    name: "calendar_create_event",
    description: "Cria um evento em um calendário do Google (pessoal ou família)",
    input_schema: {
      type: "object",
      properties: {
        calendar: { type: "string", enum: ["pessoal", "familia"] },
        summary: { type: "string", description: "Título do evento" },
        start: { type: "string", description: "Início em ISO 8601, ex: 2026-07-10T14:00:00-03:00" },
        end: { type: "string", description: "Fim em ISO 8601" },
        description: { type: "string", description: "Descrição opcional" },
      },
      required: ["calendar", "summary", "start", "end"],
    },
  },
  {
    name: "gmail_list_messages",
    description: "Lista e-mails recentes da caixa de entrada, opcionalmente filtrados por uma busca",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Busca no estilo Gmail, ex: 'is:unread from:banco' (opcional)" },
        max_results: { type: "integer", description: "Quantidade máxima de e-mails (padrão 10)" },
      },
    },
  },
  {
    name: "gmail_send_message",
    description: "Envia um e-mail",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Destinatário" },
        subject: { type: "string" },
        body: { type: "string" },
      },
      required: ["to", "subject", "body"],
    },
  },
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
  {
    name: "cardapio_add_recipe",
    description:
      "Adiciona uma receita no app Cardápio da Casa (cardapiocasa-eb828.web.app). Use quando a Bia mandar um link ou o texto de uma receita e pedir pra incluir no cardápio.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nome da receita, ex: 'Bolinho de arroz'" },
        url: { type: "string", description: "Link da receita (se veio de um site)" },
        text: { type: "string", description: "Texto completo da receita (se não tiver link)" },
      },
      required: ["name"],
    },
  },
];

async function callClaude(env, systemPrompt, messages) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages,
      tools: CUSTOM_TOOLS,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Erro na API da Claude (${resp.status}): ${errText}`);
  }

  return resp.json();
}

async function executeCustomTool(db, env, name, input) {
  switch (name) {
    case "calendar_list_events": {
      const calendarId = CALENDAR_IDS[input.calendar];
      const result = await listEvents(db, env, calendarId, input.time_min, input.time_max);
      return JSON.stringify(result);
    }
    case "calendar_create_event": {
      const calendarId = CALENDAR_IDS[input.calendar];
      const result = await createEvent(db, env, calendarId, {
        summary: input.summary,
        description: input.description,
        start: { dateTime: input.start },
        end: { dateTime: input.end },
      });
      return JSON.stringify(result);
    }
    case "gmail_list_messages": {
      const result = await listMessages(db, env, input.query, input.max_results);
      return JSON.stringify(result);
    }
    case "gmail_send_message": {
      const result = await sendMessage(db, env, input.to, input.subject, input.body);
      return JSON.stringify(result);
    }
    case "google_tasks_create": {
      const result = await createTask(db, env, input.list_id, input.title, input.notes, input.due);
      return JSON.stringify(result);
    }
    case "google_tasks_list": {
      const result = await listTasks(db, env, input.list_id);
      return JSON.stringify(result);
    }
    case "cardapio_add_recipe": {
      const result = await addRecipe(env, { name: input.name, url: input.url, text: input.text });
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

  let taskLists = [];
  let taskListsError = null;
  try {
    taskLists = await listTaskLists(db, config);
  } catch (err) {
    console.error("Erro ao buscar listas de tarefas (seguindo sem elas):", err);
    taskListsError = err.message;
  }
  const systemPrompt = buildSystemPrompt(taskLists, taskListsError);

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await callClaude(config, systemPrompt, messages);

    const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");

    if (toolUseBlocks.length === 0) {
      const textBlocks = response.content.filter((b) => b.type === "text");
      return textBlocks.map((b) => b.text).join("\n").trim();
    }

    messages.push({ role: "assistant", content: response.content });

    const toolResults = [];
    for (const block of toolUseBlocks) {
      let result;
      try {
        result = await executeCustomTool(db, config, block.name, block.input);
      } catch (err) {
        console.error(`Erro na ferramenta ${block.name}:`, err);
        result = JSON.stringify({
          error: true,
          message: `Não foi possível completar essa ação agora (${err.message || "erro desconhecido"}). Avise a Bia que precisa tentar de novo mais tarde, sem travar o resto da resposta.`,
        });
      }
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
    }
    messages.push({ role: "user", content: toolResults });
  }

  return "Desculpa, tive um problema pra concluir isso - pode tentar de novo?";
}
