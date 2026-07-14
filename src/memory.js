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

/**
 * Trava atômica de dedupe: UAZAPI/Baileys às vezes reenvia o mesmo webhook
 * (reconexão, retry). Usamos .create() (não .get()+.set()) de propósito -
 * é atômico no Firestore, então se duas requisições quase simultâneas
 * tentarem "reivindicar" o mesmo messageId, só uma ganha.
 * Retorna true na primeira vez que vê essa mensagem, false se já processou.
 */
export async function claimMessage(db, messageId) {
  if (!messageId) return true; // sem id, não dá pra travar - deixa processar
  try {
    await db.collection("processed_messages").doc(messageId).create({
      processedAt: new Date(),
    });
    return true;
  } catch (err) {
    if (err.code === 6) return false; // ALREADY_EXISTS
    throw err;
  }
}
