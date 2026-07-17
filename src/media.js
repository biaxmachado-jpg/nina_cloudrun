/**
 * Processamento de mídia.
 * - Áudio: transcrito via Google Cloud Speech-to-Text (fica dentro do mesmo
 *   projeto GCP, sem depender de serviço externo).
 * - Imagem/documento: convertidos em bloco de conteúdo nativo do Claude.
 */

export async function transcribeAudio(speechClient, base64Audio) {
  // Confirmado via erro real do Google: o endpoint de download do UAZAPI
  // entrega o áudio em MP3 (não OGG_OPUS como se assumia). Pra MP3, a
  // sampleRateHertz é opcional - deixamos o Google detectar automático,
  // com um fallback explícito só por garantia.
  const attempts = [
    { encoding: "MP3" }, // sample rate automático
    { encoding: "MP3", sampleRateHertz: 44100 },
    { encoding: "MP3", sampleRateHertz: 48000 },
  ];
  const attemptErrors = [];

  for (const audioConfig of attempts) {
    try {
      const [response] = await speechClient.recognize({
        audio: { content: base64Audio },
        config: { ...audioConfig, languageCode: "pt-BR" },
      });

      const transcript = (response.results || [])
        .map((r) => r.alternatives[0]?.transcript || "")
        .join(" ")
        .trim();

      if (transcript) return transcript;
      attemptErrors.push(`${JSON.stringify(audioConfig)}: sem resultados (0 results)`);
    } catch (err) {
      console.error(`Falha na transcrição com ${JSON.stringify(audioConfig)}:`, err.message);
      attemptErrors.push(`${JSON.stringify(audioConfig)}: ${err.message}`);
    }
  }

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
