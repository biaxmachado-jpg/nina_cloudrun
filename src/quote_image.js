/**
 * Gera imagens de citação/frase (estilo "quote card") para LinkedIn e
 * Instagram - migrado do workflow n8n "Gerador de Imagem via WhatsApp",
 * mas sem depender de nenhum modelo de geração de imagem (Gemini/DALL-E):
 * desenha a frase num template bonito usando @napi-rs/canvas.
 */
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let fontsRegistered = false;
function ensureFonts() {
  if (fontsRegistered) return;
  GlobalFonts.registerFromPath(
    path.join(__dirname, "..", "assets", "fonts", "Poppins-Bold.ttf"),
    "Poppins Bold"
  );
  GlobalFonts.registerFromPath(
    path.join(__dirname, "..", "assets", "fonts", "Poppins-Regular.ttf"),
    "Poppins Regular"
  );
  fontsRegistered = true;
}

// Paletas de fundo (gradiente diagonal) - alterna pra dar variedade sem
// precisar de nenhuma IA de imagem.
const PALETTES = [
  ["#1F1147", "#5B2A86"], // roxo profundo
  ["#0F2027", "#2C5364"], // azul petróleo
  ["#3A1C71", "#D76D77"], // roxo-rosa
  ["#134E5E", "#71B280"], // verde-azulado
  ["#0F0C29", "#302B63"], // índigo escuro
];

function wrapText(ctx, text, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function fontSizeForText(ctx, text, maxWidth, maxHeight) {
  let fontSize = 88;
  while (fontSize > 32) {
    ctx.font = `600 ${fontSize}px "Poppins Bold"`;
    const lines = wrapText(ctx, text, maxWidth);
    const lineHeight = fontSize * 1.35;
    if (lines.length * lineHeight <= maxHeight) {
      return { fontSize, lines, lineHeight };
    }
    fontSize -= 4;
  }
  ctx.font = `600 32px "Poppins Bold"`;
  return { fontSize: 32, lines: wrapText(ctx, text, maxWidth), lineHeight: 32 * 1.35 };
}

/**
 * Gera um quote card 1080x1080 (formato quadrado, funciona bem em
 * Instagram e LinkedIn) com a frase centralizada.
 * Retorna { base64 } (PNG, sem o prefixo data:).
 */
export function generateQuoteImage(text, { signature } = {}) {
  ensureFonts();

  const SIZE = 1080;
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext("2d");

  const [colorA, colorB] = PALETTES[Math.floor(Math.random() * PALETTES.length)];
  const gradient = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  gradient.addColorStop(0, colorA);
  gradient.addColorStop(1, colorB);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Aspas decorativas
  ctx.font = `700 220px "Poppins Bold"`;
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillText("“", 60, 260);

  const maxWidth = SIZE - 200;
  const maxHeight = SIZE - 420;
  const { lines, lineHeight } = fontSizeForText(ctx, text, maxWidth, maxHeight);

  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const totalHeight = lines.length * lineHeight;
  let y = SIZE / 2 - totalHeight / 2 + lineHeight / 2;
  for (const line of lines) {
    ctx.fillText(line, SIZE / 2, y);
    y += lineHeight;
  }

  if (signature) {
    ctx.font = `400 34px "Poppins Regular"`;
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillText(`— ${signature}`, SIZE / 2, SIZE - 90);
  }

  const buffer = canvas.toBuffer("image/png");
  return { base64: buffer.toString("base64") };
}
