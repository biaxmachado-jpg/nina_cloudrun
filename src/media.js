/**
 * Processamento de mídia.
 * - Áudio: transcrito via Google Cloud Speech-to-Text (fica dentro do mesmo
 *   projeto GCP, sem depender de serviço externo).
 * - Imagem/documento: convertidos em bloco de conteúdo nativo do Claude.
 */

export async function transcribeAudio(speechClient, base64Audio) {
  // O WhatsApp/Baileys manda OGG_OPUS, mas a taxa de amostragem real do
  // arquivo pode variar (16000 é o mais comum em notas de voz, mas alguns
  // clientes mandam 48000). Tenta as duas em vez de assumir uma fixa.
  const sampleRatesToTry = [16000, 48000];

  for (const sampleRateHertz of sampleRatesToTry) {
    try {
      const [response] = await speechClient.recognize({
        audio: { content: base64Audio },
        config: {
          encoding: "OGG_OPUS",
          sampleRateHertz,
          languageCode: "pt-BR",
        },
      });

      const transcript = (response.results || [])
        .map((r) => r.alternatives[0]?.transcript || "")
        .join(" ")
        .trim();

      if (transcript) return transcript;
    } catch (err) {
      console.error(`Falha na transcrição com sampleRateHertz=${sampleRateHertz}:`, err.message);
      // tenta a próxima taxa
    }
  }

  return ""; // nenhuma taxa funcionou / áudio sem fala reconhecível
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
