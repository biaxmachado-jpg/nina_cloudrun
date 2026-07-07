/**
 * Histórico de conversa por número de WhatsApp, usando Firestore.
 * Substitui a memória Postgres (n8n_chat_bia) do fluxo antigo.
 *
 * Estrutura: coleção "conversations", um documento por mensagem, com
 * campo whatsappNumber pra filtrar e createdAt pra ordenar.
 */

const MAX_HISTORY_MESSAGES = 20;

export async function loadHistory(db, whatsappNumber) {
  const snapshot = await db
    .collection("conversations")
    .where("whatsappNumber", "==", whatsappNumber)
    .orderBy("createdAt", "desc")
    .limit(MAX_HISTORY_MESSAGES)
    .get();

  const docs = snapshot.docs.map((d) => d.data());
  docs.reverse(); // ordem cronológica

  return docs.map((d) => ({ role: d.role, content: d.content }));
}

export async function saveMessage(db, whatsappNumber, role, content) {
  await db.collection("conversations").add({
    whatsappNumber,
    role,
    content,
    createdAt: new Date(),
  });
}
