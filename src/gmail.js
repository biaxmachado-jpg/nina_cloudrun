/**
 * Gmail via REST direto (mesmo motivo do calendar.js).
 */
import { getValidAccessToken } from "./google_auth.js";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

export async function listMessages(db, config, query, maxResults = 10) {
  const accessToken = await getValidAccessToken(db, config);

  const params = new URLSearchParams({ maxResults: String(maxResults) });
  if (query) params.set("q", query);

  const listResp = await fetch(`${GMAIL_API}/messages?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!listResp.ok) {
    const errText = await listResp.text().catch(() => "");
    throw new Error(`Falha ao listar e-mails (${listResp.status}): ${errText}`);
  }

  const listData = await listResp.json();
  const ids = (listData.messages || []).map((m) => m.id);

  // Busca o resumo (metadata) de cada mensagem em paralelo
  const messages = await Promise.all(
    ids.map(async (id) => {
      const resp = await fetch(
        `${GMAIL_API}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!resp.ok) return null;
      const data = await resp.json();
      const headers = data.payload?.headers || [];
      const get = (name) => headers.find((h) => h.name === name)?.value || "";
      return {
        id,
        from: get("From"),
        subject: get("Subject"),
        date: get("Date"),
        snippet: data.snippet,
      };
    })
  );

  return messages.filter(Boolean);
}

export async function sendMessage(db, config, to, subject, body) {
  const accessToken = await getValidAccessToken(db, config);

  const rawMessage = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
  ].join("\n");

  const encoded = Buffer.from(rawMessage)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const resp = await fetch(`${GMAIL_API}/messages/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: encoded }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Falha ao enviar e-mail (${resp.status}): ${errText}`);
  }

  return resp.json();
}
