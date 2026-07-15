import express from "express";
import { Firestore } from "@google-cloud/firestore";
import { SpeechClient } from "@google-cloud/speech";

import { loadHistory, saveMessage, claimMessage } from "./memory.js";
import { sendWhatsAppMessage, downloadMedia, downloadMediaByMessageId } from "./uazapi.js";
import { transcribeAudio, imageToClaudeBlock, documentToClaudeBlock } from "./media.js";
import { runNinaAgent } from "./claude.js";
import { refreshGoogleToken } from "./google_auth.js";
import { sendDailyBriefing } from "./briefing.js";
import { handleCardapioWebhook } from "./cardapio.js";
import { listTaskLists } from "./tasks.js";
import { listEvents } from "./calendar.js";
import { listMessages } from "./gmail.js";

const app = express();
app.use(express.json({ limit: "20mb" }));

// Credenciais automáticas do Cloud Run (service account do próprio serviço) -
// não precisa de chave JSON manual.
const db = new Firestore({ databaseId: "nina" });
const speechClient = new SpeechClient();

const config = {
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  UAZAPI_TOKEN: process.env.UAZAPI_TOKEN,
  UAZAPI_BASE_URL: process.env.UAZAPI_BASE_URL,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  GOOGLE_REFRESH_TOKEN: process.env.GOOGLE_REFRESH_TOKEN,
  MCP_CALENDAR_URL: process.env.MCP_CALENDAR_URL,
  MCP_GMAIL_URL: process.env.MCP_GMAIL_URL,
  MCP_DRIVE_URL: process.env.MCP_DRIVE_URL,
  CRON_SECRET: process.env.CRON_SECRET,
  CARDAPIO_WEBHOOK_SECRET: process.env.CARDAPIO_WEBHOOK_SECRET,
  CARDAPIO_SERVICE_ACCOUNT_JSON: process.env.CARDAPIO_SERVICE_ACCOUNT_JSON,
  OWNER_WHATSAPP_NUMBER: process.env.OWNER_WHATSAPP_NUMBER,
};

app.get("/health", (req, res) => res.status(200).send("ok"));

app.post("/webhook", (req, res) => {
  // Responde rápido pro UAZAPI (evita timeout/retry duplicado) e processa
  // o resto em background.
  res.status(200).send("ok");
  // Captura o payload bruto pra diagnóstico (temporário) - deixa ver
  // exatamente os campos reais que o UAZAPI manda, sem precisar adivinhar.
  db.collection("debug_payloads")
    .add({ payload: req.body, receivedAt: new Date() })
    .catch((err) => console.error("Erro ao salvar debug_payload:", err));
  handleIncomingMessage(req.body).catch((err) => {
    console.error("Erro ao processar mensagem:", err);
  });
});

// Cloud Scheduler chama esse endpoint periodicamente pra renovar o token do
// Google Tasks. Protegido por um secret simples enviado no header.
app.post("/cron/refresh-token", async (req, res) => {
  if (req.header("x-cron-secret") !== config.CRON_SECRET) {
    return res.status(401).send("unauthorized");
  }
  try {
    await refreshGoogleToken(db, config);
    res.status(200).send("ok");
  } catch (err) {
    console.error("Erro ao renovar token:", err);
    res.status(500).send("erro");
  }
});

// Cloud Scheduler chama esse endpoint todo dia de manhã (7h) para mandar o
// resumo de agenda + e-mails + tarefas pro WhatsApp da Bia.
app.post("/cron/daily-briefing", async (req, res) => {
  if (req.header("x-cron-secret") !== config.CRON_SECRET) {
    return res.status(401).send("unauthorized");
  }
  try {
    await sendDailyBriefing(db, config);
    res.status(200).send("ok");
  } catch (err) {
    console.error("Erro ao enviar resumo diário:", err);
    res.status(500).send("erro");
  }
});

// Recebe a lista de compras do app "Cardápio da Casa"
// (https://cardapiocasa-eb828.web.app) e encaminha pro WhatsApp. Roda
// direto do navegador da Bia, então precisamos liberar CORS pro domínio do
// app e aceitar o preflight OPTIONS.
const CARDAPIO_ORIGIN = "https://cardapiocasa-eb828.web.app";

app.options("/webhook/cardapio", (req, res) => {
  res.set("Access-Control-Allow-Origin", CARDAPIO_ORIGIN);
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, x-cardapio-secret");
  res.status(204).send();
});

app.post("/webhook/cardapio", async (req, res) => {
  res.set("Access-Control-Allow-Origin", CARDAPIO_ORIGIN);
  if (req.header("x-cardapio-secret") !== config.CARDAPIO_WEBHOOK_SECRET) {
    return res.status(401).send("unauthorized");
  }
  try {
    await handleCardapioWebhook(config, req.body);
    res.status(200).send("ok");
  } catch (err) {
    console.error("Erro ao processar webhook do cardápio:", err);
    res.status(500).send("erro");
  }
});

// Mostra os últimos payloads brutos recebidos do UAZAPI, sem nenhuma
// interpretação - pra diagnosticar o formato real de campos de mídia.
app.get("/debug/last-payloads", async (req, res) => {
  if (req.query.secret !== config.CARDAPIO_WEBHOOK_SECRET) {
    return res.status(401).send("unauthorized");
  }
  try {
    const snapshot = await db
      .collection("debug_payloads")
      .orderBy("receivedAt", "desc")
      .limit(5)
      .get();
    const payloads = snapshot.docs.map((d) => d.data());
    res.status(200).json(payloads);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Limpa o histórico de conversa de um número (Firestore) - útil pra testar
// sem a Nina "repetir" explicações erradas que ela mesma deu antes e que
// ficaram salvas no histórico. Só apaga, não mexe em mais nada.
app.get("/debug/reset-history", async (req, res) => {
  if (req.query.secret !== config.CARDAPIO_WEBHOOK_SECRET) {
    return res.status(401).send("unauthorized");
  }
  const number = req.query.number;
  if (!number) {
    return res.status(400).send("faltou ?number=5521999999999 na URL");
  }
  try {
    const snapshot = await db.collection("conversations").where("whatsappNumber", "==", number).get();
    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    res.status(200).json({ ok: true, apagadas: snapshot.size });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Endpoint de diagnóstico: mostra erro cru do Google pra Calendar/Gmail/Tasks
// sem depender da Nina reformular ou do WhatsApp cortar a mensagem. Só abrir
// a URL no navegador (GET, com o CRON_SECRET na query).
app.get("/debug/google-status", async (req, res) => {
  if (req.query.secret !== config.CARDAPIO_WEBHOOK_SECRET) {
    return res.status(401).send("unauthorized");
  }

  const result = {};

  try {
    const lists = await listTaskLists(db, config);
    result.tasks = { ok: true, lists };
  } catch (err) {
    result.tasks = { ok: false, error: err.message };
  }

  try {
    const { timeMin, timeMax } = (() => {
      const d = new Date().toISOString().slice(0, 10);
      return { timeMin: `${d}T00:00:00-03:00`, timeMax: `${d}T23:59:59-03:00` };
    })();
    const events = await listEvents(db, config, "bia.x.machado@gmail.com", timeMin, timeMax);
    result.calendar = { ok: true, count: events.length };
  } catch (err) {
    result.calendar = { ok: false, error: err.message };
  }

  try {
    const messages = await listMessages(db, config, "is:unread", 3);
    result.gmail = { ok: true, count: messages.length };
  } catch (err) {
    result.gmail = { ok: false, error: err.message };
  }

  res.status(200).json(result);
});

/**
 * Extrai os campos relevantes do payload real do UAZAPI (confirmado a partir
 * do nó "Dados" do n8n). A mensagem sempre vem dentro de body.message.
 * Exemplo real de texto confirmado:
 *   message.chatid = "5521971653435@s.whatsapp.net"
 *   message.type = "text", message.text/content = texto da mensagem
 *   message.messageid = id puro da mensagem
 * Para áudio/imagem, o link do arquivo já vem no próprio payload
 * (fileURL ou mediaUrl), sem precisar de uma chamada separada de download.
 */
function parseIncoming(payload) {
  const message = payload.message || payload;

  // chatid vem como "5521971653435@s.whatsapp.net" - extrai só o número
  const rawChatId = message.chatid || message.chatlid || "";
  const from = rawChatId.split("@")[0];

  return {
    from,
    type: message.type || "text", // "text" | "audio" | "image" | "document"
    text: toSafeString(message.text || message.content || message.caption),
    messageId: message.messageid || message.id,
    fileUrl:
      message.fileURL ||
      message.mediaUrl ||
      message.url ||
      message.image?.url ||
      message.imageMessage?.url,
    // Muitas APIs de WhatsApp (mídia é E2E-criptografada) já mandam o
    // conteúdo pronto em base64 direto no payload do webhook, em vez de só
    // uma URL. Se existir, usamos direto - é bem mais confiável que buscar
    // o fileURL (que pode apontar pra um arquivo ainda criptografado).
    fileBase64: message.fileBase64 || message.base64 || message.file || null,
    fileName: message.fileName || message.caption,
    mimetype: message.mimeType || message.mimetype || message.mediaType,
  };
}

// O UAZAPI/Baileys às vezes manda o texto/legenda como um objeto aninhado
// (ex: legenda de mídia encaminhada) em vez de string simples. A API da
// Claude exige que campos "text" sejam sempre string - isso já causou o
// erro "Input should be a valid string". Essa função garante isso sempre.
function toSafeString(value) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function handleIncomingMessage(payload) {
  const incoming = parseIncoming(payload);

  const isFirstTime = await claimMessage(db, incoming.messageId);
  if (!isFirstTime) {
    console.log(`Mensagem ${incoming.messageId} já processada, ignorando duplicata.`);
    return;
  }

  try {
    const userContentBlocks = await buildUserContentBlocks(incoming);
    const history = await loadHistory(db, incoming.from);
    const replyText = await runNinaAgent(db, config, history, userContentBlocks);

    const userTextForHistory = incoming.text || `[${incoming.type}]`;
    await saveMessage(db, incoming.from, "user", userTextForHistory);
    await saveMessage(db, incoming.from, "assistant", replyText);

    await sendWhatsAppMessage(config, incoming.from, replyText);
  } catch (err) {
    console.error("Erro ao processar mensagem:", err);
    let detalhe = (err?.message || String(err)).slice(0, 300);
    if (incoming.type !== "text") {
      const rawMessage = payload.message || payload;
      detalhe += ` | campos do payload: ${Object.keys(rawMessage).join(", ")}`;
    }
    await sendWhatsAppMessage(
      config,
      incoming.from,
      `Desculpa, tive um problema aqui do meu lado 😕\n\n_Detalhe técnico: ${detalhe}_\n\nPode tentar de novo?`
    ).catch(() => {});
  }
}

async function getMediaBase64(incoming) {
  // Prioridade 1: o endpoint real do UAZAPI que o n8n antigo usava e
  // funcionava (/message/download com o messageId) - mídia do WhatsApp é
  // criptografada, então isso é o caminho correto, não um atalho.
  if (incoming.messageId) {
    try {
      return await downloadMediaByMessageId(config, incoming.messageId);
    } catch (err) {
      console.error("Falha em downloadMediaByMessageId, tentando alternativas:", err.message);
    }
  }
  // Prioridade 2: base64 embutido direto no payload do webhook, se existir.
  if (incoming.fileBase64) {
    return { base64: incoming.fileBase64, mimetype: incoming.mimetype };
  }
  // Prioridade 3 (fallback menos confiável): baixar a fileURL crua direto.
  return downloadMedia(config, incoming.fileUrl, incoming.mimetype);
}

async function buildUserContentBlocks(incoming) {
  switch (incoming.type) {
    case "audio": {
      const { base64 } = await getMediaBase64(incoming);
      const transcript = await transcribeAudio(speechClient, base64);
      if (!transcript) {
        throw new Error(
          "Transcrição do áudio veio vazia (Speech-to-Text não reconheceu nada - pode ser mismatch de encoding/sample rate)."
        );
      }
      return [{ type: "text", text: transcript }];
    }
    case "image": {
      const { base64, mimetype } = await getMediaBase64(incoming);
      const block = imageToClaudeBlock(base64, mimetype);
      return incoming.text ? [block, { type: "text", text: incoming.text }] : [block];
    }
    case "document": {
      const { base64, mimetype } = await getMediaBase64(incoming);
      const docBlock = documentToClaudeBlock(base64, mimetype);
      if (docBlock) {
        return incoming.text ? [docBlock, { type: "text", text: incoming.text }] : [docBlock];
      }
      return [
        {
          type: "text",
          text: `${incoming.text || ""}\n[Documento recebido em formato não suportado diretamente - avise a Bia se precisar do conteúdo extraído.]`,
        },
      ];
    }
    default:
      return [{ type: "text", text: incoming.text }];
  }
}

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Nina rodando na porta ${port}`));
