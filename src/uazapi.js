/**
 * Integração com UAZAPI.
 *
 * IMPORTANTE: confirme os endpoints exatos (/send/text, /message/download)
 * contra o que já funciona hoje nos nós "Buscar mídia" / "HTTP Baixar
 * documento" do n8n - copie a URL exata de lá se for diferente.
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

export async function downloadMedia(config, messageId) {
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
    throw new Error(`Falha ao baixar mídia UAZAPI (${resp.status}): ${errText}`);
  }

  const data = await resp.json();
  return {
    base64: data.fileData || data.base64 || data.data,
    mimetype: data.mimetype || data.mimeType || "application/octet-stream",
  };
}
