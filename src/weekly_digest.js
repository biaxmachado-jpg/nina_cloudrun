/**
 * Digest semanal de conteúdo personalizado - migrado do workflow n8n
 * "Resumo Semanal - Conteúdos Personalizado". O n8n usava Gemini com uma
 * tool de busca; aqui usamos a API da Claude com o web_search nativo
 * (a busca roda no lado do servidor da Anthropic, sem precisar de loop
 * de tool round-trip como as ferramentas customizadas do agente principal).
 */
import { sendWhatsAppMessage } from "./uazapi.js";

const CLAUDE_MODEL = "claude-sonnet-4-6";

const PROMPT = `Você é um pesquisador especializado em conteúdo de liderança, cultura e bem-estar. Sua tarefa é buscar e resumir o conteúdo mais recente (últimos 7 dias) das seguintes autoras e pesquisadoras:
1. Brené Brown
2. Amy Gallo
3. Amy Webb
4. Jennifer B. Wallace
5. Rohit Bhargava
6. Kasley Killam
Para cada pessoa, busque:
- Novos vídeos no YouTube (inclua o link)
- Artigos publicados (inclua o link)
- Palestras ou aparições em podcasts
- Postagens relevantes em mídias sociais (LinkedIn, Instagram, etc.)
Após pesquisar, monte um digest estruturado em português com o seguinte formato:
📚 *DIGEST SEMANAL — CONTEÚDOS NOVOS*
_{{data de hoje}}_
━━━━━━━━━━━━━━━━
Para cada autora que tiver conteúdo novo:
👤 *[NOME]*
• [Tipo: Vídeo/Artigo/Podcast/Post] — [Título ou descrição]
  🔗 [Link se disponível]
  💡 [2-3 linhas resumindo o tema principal e a ideia-chave]
Se não houver conteúdo novo nos últimos 7 dias para alguma autora, omita-a do digest ou mencione brevemente.
Ao final, inclua:
━━━━━━━━━━━━━━━━
🎯 *TEMAS DA SEMANA*
Resuma em 3-4 bullets os grandes temas e tendências que aparecem nos conteúdos desta semana.
Responda APENAS com o digest formatado, sem texto adicional.`;

export async function buildWeeklyDigest(config) {
  const hoje = new Date().toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  });

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 2048,
      messages: [{ role: "user", content: PROMPT.replace("{{data de hoje}}", hoje) }],
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Erro na API da Claude ao gerar digest semanal (${resp.status}): ${errText}`);
  }

  const data = await resp.json();
  const textBlocks = (data.content || []).filter((b) => b.type === "text");
  const digest = textBlocks.map((b) => b.text).join("\n").trim();

  if (!digest) {
    throw new Error("Digest semanal veio vazio - a busca pode não ter retornado nada.");
  }
  return digest;
}

export async function sendWeeklyDigest(config) {
  if (!config.OWNER_WHATSAPP_NUMBER) {
    throw new Error("OWNER_WHATSAPP_NUMBER não configurado - não sei pra qual número mandar.");
  }
  const digest = await buildWeeklyDigest(config);
  await sendWhatsAppMessage(config, config.OWNER_WHATSAPP_NUMBER, digest);
  return digest;
}
