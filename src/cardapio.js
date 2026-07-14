/**
 * Recebe a lista de compras do app "Cardápio da Casa"
 * (https://github.com/biaxmachado-jpg/cardapio) e encaminha formatada pro
 * WhatsApp da Bia.
 *
 * Formato real enviado pelo app (função generateAndSend() / resendList()
 * em index.html):
 *   { "tab": "Semanal" | "Mensal",
 *     "lista": [ { "categoria": "Temperos",
 *                  "itens": [ { "nome": "Alho", "qty": "3 unidades", "comprar": "2kg" } ] } ] }
 */
import { sendWhatsAppMessage } from "./uazapi.js";

function parseCardapioPayload(body) {
  if (Array.isArray(body.lista) && body.lista.length && body.lista[0]?.categoria) {
    const tab = body.tab || "Compras";
    const linhas = body.lista.map((cat) => {
      const itens = (cat.itens || [])
        .map((i) => `    • ${i.nome}${i.comprar ? ` — ${i.comprar}` : ""}`)
        .join("\n");
      return `  *${cat.categoria}*\n${itens}`;
    });
    return [`🛒 *Lista de Compras ${tab}*`, "", ...linhas].join("\n");
  }

  if (typeof body.text === "string" && body.text.trim()) {
    return body.text.trim();
  }

  if (Array.isArray(body.items) && body.items.length) {
    return ["🛒 *Lista de compras atualizada:*", ...body.items.map((i) => `  • ${i}`)].join("\n");
  }

  return null;
}

export async function handleCardapioWebhook(config, body) {
  const message = parseCardapioPayload(body);

  if (!message) {
    throw new Error(
      "Payload do Cardápio não reconhecido - esperado { lista: [{categoria, itens}], tab }"
    );
  }

  if (!config.OWNER_WHATSAPP_NUMBER) {
    throw new Error("OWNER_WHATSAPP_NUMBER não configurado - não sei pra qual número mandar.");
  }

  await sendWhatsAppMessage(config, config.OWNER_WHATSAPP_NUMBER, message);
  return message;
}
