/**
 * Processamento de mídia.
 * - Áudio: transcrito via Google Cloud Speech-to-Text (fica dentro do mesmo
 *   projeto GCP, sem depender de serviço externo).
 * - Imagem/documento: convertidos em bloco de conteúdo nativo do Claude.
 */

export async function transcribeAudio(speechClient, base64Audio) {
  const [response] = await speechClient.recognize({
    audio: { content: base64Audio },
    config: {
      encoding: "OGG_OPUS", // WhatsApp/UAZAPI normalmente manda ogg/opus - ajuste se necessário
      sampleRateHertz: 16000,
      languageCode: "pt-BR",
    },
  });

  return (response.results || [])
    .map((r) => r.alternatives[0]?.transcript || "")
    .join(" ")
    .trim();
}

export function imageToClaudeBlock(base64Image, mimetype) {
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: mimetype || "image/jpeg",
      data: base64Image,
    },
  };
}

export function documentToClaudeBlock(base64Doc, mimetype) {
  if (mimetype === "application/pdf") {
    return {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: base64Doc },
    };
  }
  return null;
}
