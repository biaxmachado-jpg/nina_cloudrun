/**
 * Adiciona receitas no Firestore do app "Cardápio da Casa"
 * (projeto Firebase cardapiocasa-eb828, SEPARADO do projeto ninacloud).
 *
 * O app guarda tudo num único documento `cardapio/main` com um campo
 * `recipes` (array de objetos {id, name, url, text, tags}) - ver
 * saveRecipe() em index.html do repo biaxmachado-jpg/cardapio. Por isso
 * aqui só lemos e regravamos esse campo específico (updateMask=recipes),
 * sem tocar em menus/shopping/tags pra não colidir com o app.
 */
import { JWT } from "google-auth-library";

const CARDAPIO_PROJECT_ID = "cardapiocasa-eb828";
const DOC_URL = `https://firestore.googleapis.com/v1/projects/${CARDAPIO_PROJECT_ID}/databases/(default)/documents/cardapio/main`;

let cachedClient = null;

function getClient(config) {
  if (cachedClient) return cachedClient;
  if (!config.CARDAPIO_SERVICE_ACCOUNT_JSON) {
    throw new Error("CARDAPIO_SERVICE_ACCOUNT_JSON não configurado (secret faltando).");
  }
  const key = JSON.parse(config.CARDAPIO_SERVICE_ACCOUNT_JSON);
  cachedClient = new JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ["https://www.googleapis.com/auth/datastore"],
  });
  return cachedClient;
}

async function getAccessToken(config) {
  const client = getClient(config);
  const { token } = await client.getAccessToken();
  return token;
}

function toFirestoreValue(v) {
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFirestoreValue) } };
  if (v && typeof v === "object") {
    return {
      mapValue: {
        fields: Object.fromEntries(Object.entries(v).map(([k, val]) => [k, toFirestoreValue(val)])),
      },
    };
  }
  return { nullValue: null };
}

function fromFirestoreValue(v) {
  if (!v) return null;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return parseInt(v.integerValue, 10);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.arrayValue) return (v.arrayValue.values || []).map(fromFirestoreValue);
  if (v.mapValue) {
    return Object.fromEntries(
      Object.entries(v.mapValue.fields || {}).map(([k, val]) => [k, fromFirestoreValue(val)])
    );
  }
  return null;
}

async function getCurrentRecipes(token) {
  const resp = await fetch(`${DOC_URL}?mask.fieldPaths=recipes`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (resp.status === 404) return []; // documento ainda não existe / campo vazio
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Falha ao ler receitas do Cardápio (${resp.status}): ${errText}`);
  }
  const data = await resp.json();
  return data.fields?.recipes ? fromFirestoreValue(data.fields.recipes) : [];
}

export async function addRecipe(config, { name, url, text, tags = [] }) {
  const token = await getAccessToken(config);
  const current = await getCurrentRecipes(token);

  const newRecipe = {
    id: "nina" + Date.now(),
    name,
    url: url || "",
    text: text || "",
    tags,
  };
  const updated = [...current, newRecipe];

  const resp = await fetch(`${DOC_URL}?updateMask.fieldPaths=recipes`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { recipes: toFirestoreValue(updated) } }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Falha ao salvar receita no Cardápio (${resp.status}): ${errText}`);
  }

  return newRecipe;
}
