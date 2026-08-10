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
import { fetchWithTimeout } from "./fetch_timeout.js";

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
  const resp = await fetchWithTimeout(`${DOC_URL}?mask.fieldPaths=recipes`, {
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

async function getRecipesAndMenus(token) {
  const resp = await fetchWithTimeout(`${DOC_URL}?mask.fieldPaths=recipes&mask.fieldPaths=menus`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (resp.status === 404) return { recipes: [], menus: {} };
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Falha ao ler cardápio (${resp.status}): ${errText}`);
  }
  const data = await resp.json();
  return {
    recipes: data.fields?.recipes ? fromFirestoreValue(data.fields.recipes) : [],
    menus: data.fields?.menus ? fromFirestoreValue(data.fields.menus) : {},
  };
}

/**
 * Slots fixos do cardápio semanal do app (ver DAYS em index.html):
 *   seg -> cozinha segunda, serve segunda e terça
 *   qua -> cozinha quarta, serve quarta e quinta
 *   sex -> cozinha sexta, serve fim de semana
 * O app NÃO guarda por data específica, só por esses 3 slots que se
 * repetem toda semana.
 */
const VALID_MENU_DAYS = ["seg", "qua", "sex"];

/**
 * Monta/atualiza o cardápio de um dos 3 slots (seg/qua/sex): define quais
 * pratos vão ser feitos e uma observação pra cozinheira. Pratos que já
 * existem no array `recipes` (por nome, case-insensitive) são reaproveitados;
 * pratos novos são criados automaticamente (sem link/texto/tags).
 */
export async function setMenu(config, { day, dishes, notes }) {
  if (!VALID_MENU_DAYS.includes(day)) {
    throw new Error(`Dia inválido "${day}" - use "seg", "qua" ou "sex".`);
  }
  const cleanDishes = (dishes || []).map((d) => String(d).trim()).filter(Boolean);
  if (cleanDishes.length === 0) {
    throw new Error("Preciso de pelo menos um prato pra montar o cardápio do dia.");
  }

  const token = await getAccessToken(config);
  const { recipes, menus } = await getRecipesAndMenus(token);

  const recipeIds = [];
  let recipesChanged = false;
  for (const dishName of cleanDishes) {
    const existing = recipes.find((r) => (r.name || "").toLowerCase() === dishName.toLowerCase());
    if (existing) {
      recipeIds.push(existing.id);
    } else {
      const newRecipe = {
        id: "nina" + Date.now() + Math.floor(Math.random() * 1000),
        name: dishName,
        url: "",
        text: "",
        tags: [],
      };
      recipes.push(newRecipe);
      recipeIds.push(newRecipe.id);
      recipesChanged = true;
    }
  }

  menus[day] = { recipeIds, notes: notes || "" };

  const fields = { menus: toFirestoreValue(menus) };
  const maskFields = ["menus"];
  if (recipesChanged) {
    fields.recipes = toFirestoreValue(recipes);
    maskFields.push("recipes");
  }
  const maskQuery = maskFields.map((f) => `updateMask.fieldPaths=${f}`).join("&");

  const resp = await fetchWithTimeout(`${DOC_URL}?${maskQuery}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Falha ao salvar cardápio (${resp.status}): ${errText}`);
  }

  return { day, dishes: cleanDishes, notes: notes || "" };
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

  const resp = await fetchWithTimeout(`${DOC_URL}?updateMask.fieldPaths=recipes`, {
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
