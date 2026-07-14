/**
 * Google Tasks - chamada REST direta (sem MCP oficial disponível).
 */
import { getValidAccessToken } from "./google_auth.js";

const TASKS_API = "https://tasks.googleapis.com/tasks/v1";

export async function listTaskLists(db, config) {
  const accessToken = await getValidAccessToken(db, config);

  const resp = await fetch(`${TASKS_API}/users/@me/lists`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Falha ao listar listas de tarefas (${resp.status}): ${errText}`);
  }

  const data = await resp.json();
  return data.items || []; // cada item: { id, title }
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
