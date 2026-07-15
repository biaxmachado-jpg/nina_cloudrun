/**
 * Resumo diário (agenda + e-mails + tarefas) enviado por WhatsApp.
 * Chamado pelo endpoint /cron/daily-briefing (ver index.js), disparado
 * pelo Cloud Scheduler todo dia de manhã.
 */
import { listEvents } from "./calendar.js";
import { listMessages } from "./gmail.js";
import { listTasks, listTaskLists } from "./tasks.js";
import { sendWhatsAppMessage } from "./uazapi.js";

const CALENDAR_IDS = {
  pessoal: "bia.x.machado@gmail.com",
  familia: "family05481570382979939457@group.calendar.google.com",
};

// Nome da lista usada no resumo diário. Buscamos o ID dinamicamente a cada
// vez (em vez de fixar um ID), pra não depender de um ID que pode ficar
// desatualizado se a lista for recriada/renomeada.
const DAILY_TASK_LIST_TITLE = "TO DO!";

async function resolveDailyTaskListId(db, config) {
  const lists = await listTaskLists(db, config);
  const match = lists.find((l) => l.title === DAILY_TASK_LIST_TITLE);
  if (match) return match.id;
  console.error(
    `Lista "${DAILY_TASK_LIST_TITLE}" não encontrada entre: ${lists.map((l) => l.title).join(", ")}`
  );
  return lists[0]?.id || null; // fallback: primeira lista disponível
}

const TZ = "America/Sao_Paulo";

function formatHora(dateTimeOrDate) {
  if (!dateTimeOrDate) return "dia inteiro";
  return new Date(dateTimeOrDate).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ,
  });
}

function formatEventos(events) {
  if (!events.length) return "  _(nada por aqui)_";
  return events
    .map((e) => {
      const inicio = formatHora(e.start?.dateTime || e.start?.date);
      const fim = formatHora(e.end?.dateTime || e.end?.date);
      return `  • ${e.summary || "Sem título"} — ${inicio} às ${fim}`;
    })
    .join("\n");
}

function formatEmails(messages) {
  if (!messages.length) return "  _(nenhum e-mail não lido)_";
  return messages
    .map((m) => `  • *${m.subject || "(sem assunto)"}* — ${m.from || ""}`)
    .join("\n");
}

function formatTarefas(tasks) {
  if (!tasks.length) return "  _(nenhuma tarefa pendente)_";
  return tasks.map((t) => `  • ${t.title}`).join("\n");
}

function startEndOfDayISO(offsetDays = 0) {
  const now = new Date();
  const base = new Date(now.getTime() + offsetDays * 86400000);
  const dateStr = base.toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD
  return {
    timeMin: `${dateStr}T00:00:00-03:00`,
    timeMax: `${dateStr}T23:59:59-03:00`,
  };
}

export async function buildBriefingMessage(db, config) {
  const { timeMin, timeMax } = startEndOfDayISO(0);

  const dailyTaskListId = await resolveDailyTaskListId(db, config).catch((err) => {
    console.error("Erro ao resolver lista de tarefas do briefing:", err);
    return null;
  });

  const [eventosPessoal, eventosFamilia, emails, tarefas] = await Promise.all([
    listEvents(db, config, CALENDAR_IDS.pessoal, timeMin, timeMax).catch((err) => {
      console.error("Erro ao buscar agenda pessoal no briefing:", err);
      return [];
    }),
    listEvents(db, config, CALENDAR_IDS.familia, timeMin, timeMax).catch((err) => {
      console.error("Erro ao buscar agenda família no briefing:", err);
      return [];
    }),
    listMessages(db, config, "is:unread", 8).catch((err) => {
      console.error("Erro ao buscar e-mails no briefing:", err);
      return [];
    }),
    dailyTaskListId
      ? listTasks(db, config, dailyTaskListId).catch((err) => {
          console.error("Erro ao buscar tarefas no briefing:", err);
          return [];
        })
      : Promise.resolve([]),
  ]);

  const hoje = new Date().toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    timeZone: TZ,
  });

  return [
    `🌅 *Bom dia, Bia!* Hoje é ${hoje}.`,
    "",
    "📅 *Agenda pessoal:*",
    formatEventos(eventosPessoal),
    "",
    "👨‍👩‍👧 *Agenda família:*",
    formatEventos(eventosFamilia),
    "",
    "📧 *E-mails não lidos:*",
    formatEmails(emails),
    "",
    "✅ *Tarefas pendentes:*",
    formatTarefas(tarefas),
  ].join("\n");
}

export async function sendDailyBriefing(db, config) {
  if (!config.OWNER_WHATSAPP_NUMBER) {
    throw new Error(
      "OWNER_WHATSAPP_NUMBER não configurado (secret/env var faltando) - não sei pra qual número mandar o resumo."
    );
  }
  const message = await buildBriefingMessage(db, config);
  await sendWhatsAppMessage(config, config.OWNER_WHATSAPP_NUMBER, message);
  return message;
}
