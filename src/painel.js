/**
 * Leitura do "Meu Painel" (o painel pessoal da Bia que roda como Artifact
 * no claude.ai).
 *
 * Os dados do painel ficam no armazenamento interno do claude.ai, que não
 * tem API acessível daqui do Cloud Run. A ponte é o botão "Fazer cópia" do
 * próprio painel: cada cópia vira uma planilha Google nova (uma aba por
 * seção: Pendências, Hábitos, Compromissos, Planos, Extrato contas...)
 * dentro de uma pasta fixa do Drive. A Nina lê a cópia MAIS RECENTE dessa
 * pasta - então o que ela vê é tão atual quanto a última cópia feita.
 *
 * Escrita: a Nina não tem como gravar direto no painel, então ela anota o
 * pedido (criar pendência, marcar hábito...) numa linha da planilha
 * "Nina → Meu Painel (pedidos)", na mesma pasta. Quando a Bia abre o painel,
 * ele lê essa planilha e aplica os pedidos que ainda não aplicou.
 *
 * Autenticação: conta de serviço padrão do Cloud Run (ADC). Pra funcionar, a
 * pasta precisa estar compartilhada (como Leitor) e a planilha de pedidos
 * (como Editor) com 1059605088472-compute@developer.gserviceaccount.com, e
 * as APIs Drive + Sheets precisam estar ativadas no projeto ninacloud.
 */
import { GoogleAuth } from "google-auth-library";
import { fetchWithTimeout } from "./fetch_timeout.js";

// Pasta "cópias do Meu Painel" no Drive da Bia (BK_FOLDER no HTML do painel)
const DEFAULT_FOLDER_ID = "1Pf-dlXuTgD8hSQCeASrIdcoQSqZtFsoM";
// Planilha "Nina → Meu Painel (pedidos)": colunas id, criado_em, acao, dados
const DEFAULT_INBOX_ID = "1l9E3_dhFL-Lm3nv9K209uDC16f6zBHV57iUjRF3f15E";

// Pedidos que o painel sabe aplicar (ver aplicarPedidosNina no HTML do painel)
export const PAINEL_ACOES = [
  "pendencia_criar",
  "pendencia_concluir",
  "compromisso_criar",
  "habito_marcar",
  "nota_criar",
  "nota_adicionar_item",
  "lancamento_criar",
];

export const PAINEL_SECOES = [
  "Pendências",
  "Hábitos",
  "Compromissos",
  "Planos",
  "Contas",
  "Cartões",
  "Extrato contas",
  "Compras cartão",
  "Lançamentos manuais",
  "Categorias",
  "Regras",
];

// Limite de linhas por aba devolvidas pra Claude, pra não estourar contexto
// (extrato e compras de cartão podem ter centenas de linhas).
const MAX_ROWS = 150;

let auth = null;

async function getAccessToken() {
  if (!auth) {
    auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/drive.readonly", "https://www.googleapis.com/auth/spreadsheets"],
    });
  }
  const token = await auth.getAccessToken();
  if (!token) throw new Error("Não consegui token da conta de serviço pro Drive.");
  return token;
}

async function getJson(url, token, what, options = {}) {
  const resp = await fetchWithTimeout(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.body ? { "Content-Type": "application/json" } : {}) },
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Falha ao ${what} (${resp.status}): ${errText}`);
  }
  return resp.json();
}

async function findLatestCopy(token, folderId) {
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.spreadsheet' and name contains 'cópia' and trashed = false`,
    orderBy: "createdTime desc",
    pageSize: "1",
    fields: "files(id,name,createdTime)",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const data = await getJson(`https://www.googleapis.com/drive/v3/files?${params}`, token, "listar a pasta do painel");
  const file = (data.files || [])[0];
  if (!file) {
    throw new Error(
      "Nenhuma cópia do painel encontrada na pasta do Drive. Ou a Bia ainda não fez uma cópia (botão no painel), ou a pasta não está compartilhada com a conta de serviço da Nina."
    );
  }
  return file;
}

function rowsToObjects(values) {
  const [header, ...rows] = values || [];
  if (!header) return [];
  return rows
    .filter((r) => r.some((c) => String(c ?? "").trim() !== ""))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])))
    .filter((o) => !("vazio" in o && Object.keys(o).length === 1));
}

/**
 * secoes: lista de nomes de aba (ver PAINEL_SECOES). Vazio = só as seções
 * do dia a dia (pendências, hábitos, compromissos, planos).
 * apenasAbertas: em Pendências, omite as já feitas.
 */
export async function readPainel(config, { secoes, apenasAbertas = true } = {}) {
  const folderId = config.PAINEL_FOLDER_ID || DEFAULT_FOLDER_ID;
  const wanted = secoes && secoes.length ? secoes : ["Pendências", "Hábitos", "Compromissos", "Planos"];
  const token = await getAccessToken();
  const file = await findLatestCopy(token, folderId);

  const params = new URLSearchParams();
  wanted.forEach((s) => params.append("ranges", `'${s.replace(/'/g, "''")}'`));
  const data = await getJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${file.id}/values:batchGet?${params}`,
    token,
    "ler a cópia do painel"
  );

  const result = {
    copia: file.name,
    copia_feita_em: file.createdTime,
    aviso: "Dados da última cópia do painel; o que a Bia mudou depois dessa cópia não aparece aqui.",
    secoes: {},
  };
  (data.valueRanges || []).forEach((vr, i) => {
    let rows = rowsToObjects(vr.values);
    if (wanted[i] === "Pendências" && apenasAbertas) rows = rows.filter((r) => r.feita !== "sim");
    result.secoes[wanted[i]] = {
      total: rows.length,
      linhas: rows.slice(-MAX_ROWS),
      ...(rows.length > MAX_ROWS ? { cortado: `mostrando só as últimas ${MAX_ROWS}` } : {}),
    };
  });
  // Pedidos que a Nina anotou depois dessa cópia ainda não aparecem nela
  try {
    const pend = await readPedidos(config, token);
    const recentes = pend.filter((p) => p.criado_em > file.createdTime);
    if (recentes.length) result.pedidos_da_nina_depois_da_copia = recentes;
  } catch (err) {
    console.error("Erro ao ler pedidos da Nina (seguindo sem eles):", err);
  }
  return result;
}

async function readPedidos(config, token) {
  const inboxId = config.PAINEL_INBOX_ID || DEFAULT_INBOX_ID;
  const data = await getJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${inboxId}/values/A:D`,
    token,
    "ler os pedidos da Nina"
  );
  return rowsToObjects(data.values);
}

/**
 * Anota um pedido de mudança pro painel aplicar quando a Bia abrir.
 */
export async function writePainel(config, acao, dados) {
  if (!PAINEL_ACOES.includes(acao)) throw new Error(`Ação desconhecida pro painel: ${acao}`);
  const inboxId = config.PAINEL_INBOX_ID || DEFAULT_INBOX_ID;
  const token = await getAccessToken();
  const id = `nina-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const params = new URLSearchParams({ valueInputOption: "RAW", insertDataOption: "INSERT_ROWS" });
  await getJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${inboxId}/values/A:D:append?${params}`,
    token,
    "anotar o pedido no painel",
    { method: "POST", body: JSON.stringify({ values: [[id, new Date().toISOString(), acao, JSON.stringify(dados || {})]] }) }
  );
  return {
    ok: true,
    id,
    aviso: "Anotado. O painel aplica esse pedido na próxima vez que a Bia abrir o Meu Painel.",
  };
}
