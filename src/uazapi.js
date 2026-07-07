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

export async function downloadMedia(config, fileUrl, fallbackMimetype) {
  if (!fileUrl) {
    throw new
