/**
 * Google Tasks não tem MCP server oficial ainda, então fala direto com a
 * API REST do Google. O token é renovado automaticamente via Cloud Scheduler
 * batendo em /cron/refresh-token (ver index.js), então não deveria mais
 * expirar em silêncio como acontecia no n8n.
 */

const TASKS_API = "https://tasks.googleapis.com/tasks/v1";
const TOKEN_DOC = "system/google_token"; // documento único no Firestore

export async function refreshGoogleToken(db, config) {
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.GOOGLE_CLIENT_ID,
      client_secret: config.GOOGLE_CLIENT_SECRET,
      refresh_token: config.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Falha ao renovar token Google (${resp.status}): ${errText}`);
  }

  const data = await resp.json();
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

  await db.doc(TOKEN_DOC).set({
    accessToken: data.access_token,
    expiresAt,
    updatedAt: new Date(),
  });

  return data.access_token;
}

async function getValidAccessToken(db, config) {
  const snap = await db.doc(TOKEN_DOC).get();
  const data = snap.exists ? snap.data() : null;

  if (data && new Date(data.expiresAt).getTime() > Date.now() + 60_000) {
    return data.accessToken;
  }
  return refreshGoogleToken(db, config);
}

export async function createTask(db, config, listId, title, notes, due) {
  const accessToken = await getValidAccessToken(db, config);

  const resp = await fetch(`${TASKS_API}/lists/${listId}/tasks`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title, notes, due }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Falha ao criar tarefa (${resp.status}): ${errText}`);
  }

  return resp.json();
}

export async function listTasks(db, config, listId) {
  const accessToken = await getValidAccessToken(db, config);

  const resp = await fetch(`${TASKS_API}/lists/${listId}/tasks?showCompleted=false`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Falha ao listar tarefas (${resp.status}): ${errText}`);
  }

  const data = await resp.json();
  return data.items || [];
}
