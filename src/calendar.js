/**
 * Google Calendar via REST direto (em vez de MCP - ver nota no claude.js
 * sobre por que trocamos: a API da Claude usada fora do claude.ai exige um
 * token de autorização próprio pra cada MCP server, que não temos como gerar
 * automaticamente aqui).
 */
import { getValidAccessToken } from "./google_auth.js";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export async function listEvents(db, config, calendarId, timeMin, timeMax) {
  const accessToken = await getValidAccessToken(db, config);

  const params = new URLSearchParams({
    singleEvents: "true",
    orderBy: "startTime",
    timeMin: timeMin || new Date().toISOString(),
  });
  if (timeMax) params.set("timeMax", timeMax);

  const resp = await fetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Falha ao listar eventos (${resp.status}): ${errText}`);
  }

  const data = await resp.json();
  return data.items || [];
}

export async function createEvent(db, config, calendarId, event) {
  const accessToken = await getValidAccessToken(db, config);

  const resp = await fetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    }
  );

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Falha ao criar evento (${resp.status}): ${errText}`);
  }

  return resp.json();
}
