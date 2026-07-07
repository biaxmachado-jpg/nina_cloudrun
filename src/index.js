import express from "express";
import { Firestore } from "@google-cloud/firestore";
import { SpeechClient } from "@google-cloud/speech";

import { loadHistory, saveMessage } from "./memory.js";
import { sendWhatsAppMessage, downloadMedia } from "./uazapi.js";
import { transcribeAudio, imageToClaudeBlock, documentToClaudeBlock } from "./media.js";
import { runNinaAgent } from "./claude.js";
import { refreshGoogleToken } from "./tasks.js";

const app = express();
app.use(express.json({ limit: "20mb" }));

// Credenciais automáticas do Cloud Run (service account do próprio serviço) -
// não precisa de chave JSON manual.
const db = new Firestore();
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
};

app.get("/health", (req, res) => res.status(200).send("ok"));

app.post("/webhook", (req, res) => {
  // Responde rápido pro UAZAPI (evita timeout/retry duplicado) e processa
  // o resto em background.
  res.status(200).send("ok");
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

/**
 * TODO: ajustar a extração de campos abaixo conforme o payload real do
 * UAZAPI - copie a estrutura exata do nó "Dados" do seu n8n atual.
 */
function parseIncoming(payload) {
  const message = payload.message || payload;
  return {
    from: message.chatid || message.from || message.number,
    type: message.type || detectTypeFallback(message),
    text: message.text || message.body || "",
    messageId: message.id || message.messageId,
    mimetype: message.mimetype || message.mimeType,
  };
}

function detectTypeFallback(message) {
  if (message.audio) return "audio";
  if (message.image) return "image";
  if (message.document) return "document";
  return "text";
}

async function handleIncomingMessage(payload) {
  const incoming = parseIncoming(payload);

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
    await sendWhatsAppMessage(
      config,
      incoming.from,
      "Desculpa, tive um problema aqui do meu lado. Pode tentar de novo?"
    ).catch(() => {});
  }
}

async function buildUserContentBlocks(incoming) {
  switch (incoming.type) {
    case "audio": {
      const { base64 } = await downloadMedia(config, incoming.messageId);
      const transcript = await transcribeAudio(speechClient, base64);
      return [{ type: "text", text: transcript }];
    }
    case "image": {
      const { base64, mimetype } = await downloadMedia(config, incoming.messageId);
      const block = imageToClaudeBlock(base64, mimetype);
      return incoming.text ? [block, { type: "text", text: incoming.text }] : [block];
    }
    case "document": {
      const { base64, mimetype } = await downloadMedia(config, incoming.messageId);
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
