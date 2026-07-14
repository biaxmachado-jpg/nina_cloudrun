/**
 * Recebe a lista de compras do app/site do "Cardápio" (mesmo conceito do
 * workflow "Cardápio - Atualizar via Webhook" que existia no n8n) e
 * encaminha formatada pro WhatsApp da Bia.
 *
 * Aceita formatos flexíveis de payload, já que ainda não confirmamos o
 * formato exato que o app externo envia:
 *   { "items": ["Arroz", "Feijão", "Leite"] }
 *   { "text": "Lista de compras:\n- Arroz\n- Feijão" }
 *   { "lista": [{ "nome": "Arroz", "quantidade": "2kg" }] }
 * Se o formato real for diferente, ajuste parseCardapioPayload().
 */
import { sendWhatsAppMessage } from "./uazapi.js";

function parseCardapioPayload(body) {
  if (typeof body.text === "string" && body.text.trim()) {
    return body.text.trim();
  }

  if (Array.isArray(body.items) && body.items.length) {
    return ["🛒 *Lista de compras atualizada:*", ...body.items.map((i) => `  • ${i}`)].join("\n");
  }

  if (Array.isArray(body.lista) && body.lista.length) {
    const linhas = body.lista.map((item) => {
      if (typeof item === "string") return `  • ${item}`;
      const nome = item.nome || item.name || JSON.stringify(item);
      const qtd = item.quantidade || item.qty;
      return qtd ? `  • ${nome} — ${qtd}` : `  • ${nome}`;
    });
    return ["🛒 *Lista de compras atualizada:*", ...linhas].join("\n");
  }

  return null;
}

export async function handleCardapioWebhook(config, body) {
  const message = parseCardapioPayload(body);

  if (!message) {
    throw new Error(
      "Payload do Cardápio não reconhecido - esperado { text } ou { items: [] } ou { lista: [] }"
    );
  }

  if (!config.OWNER_WHATSAPP_NUMBER) {
    throw new Error("OWNER_WHATSAPP_NUMBER não configurado - não sei pra qual número mandar.");
  }

  await sendWhatsAppMessage(config, config.OWNER_WHATSAPP_NUMBER, message);
  return message;
}
