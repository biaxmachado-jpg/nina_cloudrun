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
  const attemptErrors = [];

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
      attemptErrors.push(`sampleRateHertz=${sampleRateHertz}: sem resultados (0 results)`);
    } catch (err) {
      console.error(`Falha na transcrição com sampleRateHertz=${sampleRateHertz}:`, err.message);
      attemptErrors.push(`sampleRateHertz=${sampleRateHertz}: ${err.message}`);
    }
  }

  // Nenhuma taxa funcionou / áudio sem fala reconhecível - devolve os
  // detalhes de cada tentativa junto pra dar pra diagnosticar sem log.
  const err = new Error(
    `Speech-to-Text não reconheceu nada em nenhuma tentativa. Detalhes: ${attemptErrors.join(" | ")}`
  );
  err.isEmptyTranscript = true;
  throw err;
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
