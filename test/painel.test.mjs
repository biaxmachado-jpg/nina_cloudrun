// Testa a leitura do "Meu Painel" a partir da cópia no Drive, com Drive,
// Sheets e a conta de serviço mockados.

import assert from "node:assert";
import { GoogleAuth } from "google-auth-library";

GoogleAuth.prototype.getAccessToken = async () => "fake-sa-token";

const calls = [];
global.fetch = async (url, opts) => {
  calls.push(url);
  assert.strictEqual(opts.headers.Authorization, "Bearer fake-sa-token");

  if (url.startsWith("https://www.googleapis.com/drive/v3/files?")) {
    assert.ok(new URL(url).searchParams.get("q").includes("'pasta-teste' in parents"));
    return {
      ok: true,
      json: async () => ({
        files: [{ id: "planilha1", name: "Meu Painel – cópia 2026-10-21 15h32", createdTime: "2026-10-21T18:32:44Z" }],
      }),
    };
  }

  if (url.startsWith("https://sheets.googleapis.com/v4/spreadsheets/planilha1/values:batchGet?")) {
    return {
      ok: true,
      json: async () => ({
        valueRanges: [
          {
            values: [
              ["lista", "tarefa", "prazo", "prioridade", "feita", "nota"],
              ["TO DO!", "Pagar IPTU", "2026-10-25", "alta", "não", ""],
              ["Casa", "Trocar lâmpada", "", "", "sim", ""],
            ],
          },
          { values: [["vazio"]] },
        ],
      }),
    };
  }

  throw new Error(`chamada de fetch não esperada no teste: ${url}`);
};

const { readPainel } = await import("../src/painel.js");

const r = await readPainel({ PAINEL_FOLDER_ID: "pasta-teste" }, { secoes: ["Pendências", "Hábitos"] });
assert.strictEqual(r.copia_feita_em, "2026-10-21T18:32:44Z");
assert.strictEqual(r.secoes["Pendências"].total, 1);
assert.strictEqual(r.secoes["Pendências"].linhas[0].tarefa, "Pagar IPTU");
assert.strictEqual(r.secoes["Hábitos"].total, 0);

const r2 = await readPainel({ PAINEL_FOLDER_ID: "pasta-teste" }, { secoes: ["Pendências"], apenasAbertas: false });
assert.strictEqual(r2.secoes["Pendências"].total, 2);

console.log("OK: painel lê a cópia mais recente do Drive e filtra pendências abertas");
