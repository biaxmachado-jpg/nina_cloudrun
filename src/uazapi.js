/**
 * Integração com UAZAPI.
 *
 * O payload de mensagem do UAZAPI já traz o link direto do arquivo em
 * message.fileURL (ou message.mediaUrl) quando é áudio/imagem/documento -
 * não existe um endpoint separado de "download por id". Por isso
 * downloadMedia() aqui só baixa essa URL diretamente e converte pra base64.
 */

export async function sendWhatsAppMessage(config, to, text) {
  const url = `${config.UAZAPI_BASE_URL}/send/text`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      token: config.UAZAPI_TOKEN,
    },
    body: JSON.stringify({ number: to, text }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Falha ao enviar mensagem UAZAPI (${resp.status}): ${errText}`);
  }

  return resp.json().catch(() => ({}));
}

/**
 * Baixa mídia usando o endpoint real do UAZAPI para isso (descoberto a
 * partir do node "n8n-nodes-uazapi" usado no fluxo antigo: POST
 * /message/download com { id: messageId }). Mídia do WhatsApp é
 * criptografada de ponta a ponta - a fileURL crua do webhook não é
 * diretamente utilizável; esse endpoint devolve o conteúdo já decodificado.
 */
export async function downloadMediaByMessageId(config, messageId) {
  const url = `${config.UAZAPI_BASE_URL}/message/download`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      token: config.UAZAPI_TOKEN,
    },
    body: JSON.stringify({ id: messageId }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Falha ao chamar /message/download (${resp.status}): ${errText}`);
  }

  const data = await resp.json();

  // O formato exato da resposta não está 100% documentado - tenta os
  // campos mais prováveis, nessa ordem.
  const base64 = data.fileBase64 || data.base64 || data.file;
  if (base64) {
    return { base64, mimetype: data.mimetype || data.mimeType };
  }

  if (data.fileURL) {
    return downloadMedia(config, data.fileURL, data.mimetype || data.mimeType);
  }

  throw new Error(
    `/message/download não retornou base64 nem fileURL reconhecível. Campos recebidos: ${Object.keys(data).join(", ")}`
  );
}

export async function downloadMedia(config, fileUrl, fallbackMimetype) {
  if (!fileUrl) {
    throw new Error("downloadMedia chamado sem fileUrl (mensagem sem mídia reconhecida?)");
  }

  let resp;
  try {
    resp = await fetch(fileUrl);
  } catch (err) {
    let dominio = "desconhecido";
    try {
      dominio = new URL(fileUrl).hostname;
    } catch {
      // URL inválida mesmo
    }
    throw new Error(`Falha de rede ao baixar mídia de "${dominio}": ${err.message}`);
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Falha ao baixar mídia (${resp.status}): ${errText}`);
  }

  const mimetype =
    resp.headers.get("content-type") || fallbackMimetype || "application/octet-stream";

  const arrayBuffer = await resp.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");

  return { base64, mimetype };
}
