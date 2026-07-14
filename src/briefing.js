/**
 * Resumo diário (agenda + e-mails + tarefas) enviado por WhatsApp.
 * Chamado pelo endpoint /cron/daily-briefing (ver index.js), disparado
 * pelo Cloud Scheduler todo dia de manhã.
 */
import { listEvents } from "./calendar.js";
import { listMessages } from "./gmail.js";
import { listTasks } from "./tasks.js";
import { sendWhatsAppMessage } from "./uazapi.js";

const CALENDAR_IDS = {
  pessoal: "bia.x.machado@gmail.com",
  familia: "family05481570382979939457@group.calendar.google.com",
};

// Lista "TO DO!" do Google Tasks (mesma usada no n8n antigo). Ajuste aqui se
// quiser puxar o resumo diário de outra lista.
const DAILY_TASK_LIST_ID = "MTM3OTM5OTUxNjcyMzE5Njk1NjA6MDow";

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
    listTasks(db, config, DAILY_TASK_LIST_ID).catch((err) => {
      console.error("Erro ao buscar tarefas no briefing:", err);
      return [];
    }),
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
