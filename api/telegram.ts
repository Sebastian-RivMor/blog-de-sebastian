import { Telegraf, Markup } from 'telegraf';
import type { Update } from 'telegraf/types';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Octokit } from '@octokit/rest';

// --- Configuración de Seguridad y Entorno ---
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_REPO_OWNER = process.env.GITHUB_REPO_OWNER || '';
const GITHUB_REPO_NAME = process.env.GITHUB_REPO_NAME || '';

// --- Clientes de API ---
const bot = new Telegraf(BOT_TOKEN);
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const octokit = new Octokit({ auth: GITHUB_TOKEN });

// --- Almacenamiento Temporal ---
const topicCache = new Map<number, string>();

// --- Funciones de Utilidad ---
function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .normalize('NFD') // separate accent from letter
    .replace(/[\u0300-\u036f]/g, '') // remove all separated accents
    .replace(/\s+/g, '-') // replace spaces with -
    .replace(/[^\w-]+/g, '') // remove all non-word chars
    .replace(/--+/g, '-'); // replace multiple - with single -
}

function formatPost(markdownContent: string): { title: string, content: string } {
  // Extrae el título del H1 de Markdown
  const titleMatch = markdownContent.match(/^#\s+(.*)/);
  const title = titleMatch ? titleMatch[1] : 'Nuevo Post';

  const today = new Date();
  const pubDate = today.toISOString();
  const description = markdownContent.substring(0, 160).replace(/\n/g, ' ');

  const frontmatter = `---
title: "${title.replace(/"/g, '\\"')}"
description: "${description.replace(/"/g, '\\"')}"
pubDate: "${pubDate}"
---
`;

  return {
    title,
    content: frontmatter + '\n' + markdownContent
  };
}

// --- Lógica Principal ---
async function generatePost(topic: string): Promise<string> {
  if (!GEMINI_API_KEY) throw new Error("La API Key de Gemini no está configurada.");

  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
  const prompt = `Eres un talentoso escritor de blogs de tecnología. Escribe un post atractivo y bien estructurado sobre el siguiente tema: "${topic}". El post debe estar en formato Markdown, listo para ser publicado. Debe incluir:
  - Un título creativo y llamativo como H1 (ej: '# Título').
  - Una introducción que enganche.
  - Un cuerpo de texto con subtítulos (usando '###').
  - Una conclusión.
  IMPORTANTE: No incluyas el frontmatter de Astro.`;

  const result = await model.generateContent(prompt);
  return result.response.text();
}

async function commitPostToGitHub(topic: string, markdownContent: string): Promise<string> {
  if (!GITHUB_TOKEN || !GITHUB_REPO_OWNER || !GITHUB_REPO_NAME) {
    throw new Error("Las variables de entorno de GitHub no están configuradas.");
  }

  const { title, content } = formatPost(markdownContent);
  const fileName = `${slugify(title)}.md`;
  const filePath = `src/content/blog/${fileName}`;

  const response = await octokit.repos.createOrUpdateFileContents({
    owner: GITHUB_REPO_OWNER,
    repo: GITHUB_REPO_NAME,
    path: filePath,
    message: `feat(blog): Nuevo post generado por IA: ${title}`,
    content: Buffer.from(content).toString('base64'),
    branch: 'main', // O la rama principal que uses
  });

  return response.data.content?.html_url || '';
}

// --- Manejadores del Bot ---
bot.on('text', async (ctx) => {
  const topic = ctx.message.text;
  topicCache.set(ctx.from.id, topic);
  await ctx.reply(`Tema: "${topic}".\n¿Qué quieres hacer?`, Markup.inlineKeyboard([
    Markup.button.callback('📝 Crear Post', 'create_post'),
    Markup.button.callback('📦 Crear Contenido (Pronto)', 'create_content'),
  ]));
});

bot.action('create_post', async (ctx) => {
  const userId = ctx.from.id;
  const topic = topicCache.get(userId);
  if (!topic) return ctx.answerCbQuery('No encontré un tema. Por favor, envíalo de nuevo.');

  await ctx.editMessageText(`📝 Entendido. Generando post sobre "${topic}"...`);

  try {
    const generatedMarkdown = await generatePost(topic);
    await ctx.reply('✅ Contenido generado. Publicando en GitHub...');
    const fileUrl = await commitPostToGitHub(topic, generatedMarkdown);
    await ctx.reply(`🚀 ¡Post publicado con éxito!\nPuedes verlo aquí: ${fileUrl}`);
  } catch (error) {
    console.error('Error en el proceso de creación de post:', error);
    await ctx.reply(`❌ Hubo un error: ${error instanceof Error ? error.message : 'Error desconocido'}`);
  } finally {
    topicCache.delete(userId);
  }
});

bot.action('create_content', async (ctx) => {
  await ctx.answerCbQuery('Esta función aún no está implementada.', { show_alert: true });
});

// --- Exportación para Vercel ---
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    await bot.handleUpdate(req.body);
    res.status(200).send('OK');
  } catch (error) {
    console.error('Error handling update:', error);
    if (!res.headersSent) res.status(500).send('Internal Server Error');
  }
}
