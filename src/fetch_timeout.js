/**
 * Utilitário compartilhado: fetch com timeout explícito.
 *
 * BUG ENCONTRADO (06/08): o commit anterior só adicionou timeout nas
 * chamadas pra UAZAPI e pra API da Claude (uazapi.js e claude.js), mas
 * deixou de fora TODAS as chamadas de rede pro Google (OAuth, Tasks,
 * Calendar, Gmail) e pro Cardápio da Casa - que são chamadas em toda
 * mensagem, sem exceção, via runNinaAgent → listTaskLists. Uma dessas
 * travando (rede lenta, Google/Firestore momentaneamente sem resposta)
 * prende a requisição inteira até o Cloud Run matar por timeout do
 * serviço, sem nosso código nunca chegar no catch - por isso a Nina fica
 * muda pra QUALQUER mensagem (texto, áudio, imagem), não só as que usam
 * agenda/tarefas diretamente.
 */
export async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`Timeout de ${timeoutMs / 1000}s ao chamar ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
