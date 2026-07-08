/**
 * Autenticação Google compartilhada entre Tasks, Calendar e Gmail.
 * O refresh token já foi gerado com os escopos calendar + gmail.modify +
 * tasks, então o mesmo token de acesso serve pras três APIs.
 */

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

export async function getValidAccessToken(db, config) {
  const snap = await db.doc(TOKEN_DOC).get();
  const data = snap.exists ? snap.data() : null;

  if (data && new Date(data.expiresAt).getTime() > Date.now() + 60_000) {
    return data.accessToken;
  }
  return refreshGoogleToken(db, config);
}
