import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import sharp from 'sharp';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import axios from 'axios';
import { Document, Packer, Paragraph } from 'docx';
import XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const GENERATED_DIR = path.join(__dirname, 'generated');
await fs.mkdir(GENERATED_DIR, { recursive: true });

const LLM_API_KEY = process.env.LLM_API_KEY || '';
const LLM_BASE_URL = process.env.LLM_BASE_URL || 'https://api.openai.com/v1';
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';
const PORT = Number(process.env.PORT || 8000);

const SYSTEM_PROMPT = 'You are a multimodal assistant. Answer in the user\'s language.';

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use('/static', express.static(path.join(__dirname, 'static')));
app.use('/generated', express.static(GENERATED_DIR));

app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'templates', 'index.html')));

function resolveApiKey(headerKey) {
  const key = (headerKey || '').trim() || LLM_API_KEY;
  if (!key) {
    const err = new Error('LLM API key is missing. Configure env or use settings button.');
    err.status = 400;
    throw err;
  }
  return key;
}

async function chatCompletion(messages, headerKey = '', modelOverride = '') {
  const apiKey = resolveApiKey(headerKey);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);

  try {
    const response = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model: modelOverride || LLM_MODEL, messages, temperature: 0.4 }),
      signal: controller.signal
    });

    if (!response.ok) throw new Error(`LLM error: ${await response.text()}`);
    const data = await response.json();
    return data?.choices?.[0]?.message?.content || '응답을 생성하지 못했습니다.';
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('LLM 응답 시간이 초과되었습니다. 다시 시도해 주세요.');
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

function isImageFile(file) {
  return file?.mimetype?.startsWith('image/');
}

async function getImageQuickHint(file) {
  try {
    const meta = await sharp(file.buffer).metadata();
    return `이미지 정보: format=${meta.format}, width=${meta.width}, height=${meta.height}`;
  } catch {
    return '이미지 메타데이터를 읽지 못했습니다.';
  }
}

async function extractTextFromFile(file) {
  const name = (file.originalname || '').toLowerCase();
  if (name.endsWith('.txt') || name.endsWith('.md')) return file.buffer.toString('utf-8');
  if (name.endsWith('.pdf')) return (await pdfParse(file.buffer)).text || '';
  if (name.endsWith('.docx')) return (await mammoth.extractRawText({ buffer: file.buffer })).value || '';
  return '';
}

function shouldGenerateImageFromMessage(message = '', files = []) {
  if ((files || []).length > 0) return false;
  const text = String(message || '');
  return /이미지|그림|사진/.test(text) && /생성|만들|그려|제공/.test(text) && !/분석|첨부/.test(text);
}

async function createGeneratedImage(prompt = 'Untitled') {
  const name = `image_${crypto.randomUUID().slice(0, 8)}.png`;
  const outputPath = path.join(GENERATED_DIR, name);

  try {
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`;
    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 45000 });
    await fs.writeFile(outputPath, Buffer.from(response.data));
  } catch {
    const svg = `<svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#141821"/><text x="64" y="120" fill="#f3f6ff" font-size="54">AI IMAGE</text><text x="64" y="190" fill="#d5ddff" font-size="30">${prompt.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</text></svg>`;
    await sharp(Buffer.from(svg)).png().toFile(outputPath);
  }

  return { url: `/generated/${name}`, download_url: `/download/${name}`, filename: name };
}

async function buildMessages({ message, historyRaw, files, onStatus, searchMode = 'standard' }) {
  onStatus?.('thinking');
  const history = JSON.parse(historyRaw || '[]');
  const searchPrompt = searchMode === 'deep'
    ? 'Use deep-search style reasoning: be thorough and compare alternatives.'
    : 'Use standard concise responses.';

  const messages = [{ role: 'system', content: `${SYSTEM_PROMPT} ${searchPrompt}` }];
  for (const item of history.slice(-12)) messages.push({ role: item.role, content: item.content });

  onStatus?.('analyzing');
  const userContent = [{ type: 'text', text: message || '' }];
  for (const file of files || []) {
    if (isImageFile(file)) {
      const b64 = file.buffer.toString('base64');
      const hint = await getImageQuickHint(file);
      userContent.push({ type: 'image_url', image_url: { url: `data:${file.mimetype};base64,${b64}` } });
      userContent.push({ type: 'text', text: `첨부 이미지(${file.originalname}) 분석 요청. ${hint}` });
    } else {
      const text = await extractTextFromFile(file);
      const excerpt = text ? text.slice(0, 12000) : '(텍스트 추출 실패 또는 미지원 형식)';
      userContent.push({ type: 'text', text: `첨부 파일(${file.originalname}) 내용:\n${excerpt}` });
    }
  }

  messages.push({ role: 'user', content: userContent });
  return messages;
}

app.post('/api/chat', upload.array('files'), async (req, res) => {
  try {
    const headerKey = req.header('x-llm-api-key') || '';
    const selectedModel = req.body.model || '';
    const searchMode = req.body.search_mode || 'standard';

    if (shouldGenerateImageFromMessage(req.body.message, req.files)) {
      const generated = await createGeneratedImage(req.body.message || 'image');
      return res.json({ answer: `요청하신 이미지를 생성했습니다.\n![generated](${generated.url})\n[다운로드](${generated.download_url})` });
    }

    const messages = await buildMessages({ message: req.body.message, historyRaw: req.body.history, files: req.files, searchMode });
    const answer = await chatCompletion(messages, headerKey, selectedModel);
    res.json({ answer });
  } catch (error) {
    res.status(error.status || 500).json({ detail: error.message || '서버 오류' });
  }
});

app.post('/api/chat/stream', upload.array('files'), async (req, res) => {
  const send = (event, payload) => res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);

  try {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const headerKey = req.header('x-llm-api-key') || '';
    const selectedModel = req.body.model || '';
    const searchMode = req.body.search_mode || 'standard';

    if (shouldGenerateImageFromMessage(req.body.message, req.files)) {
      send('status', { phase: 'generating' });
      const generated = await createGeneratedImage(req.body.message || 'image');
      send('done', { answer: `요청하신 이미지를 생성했습니다.\n![generated](${generated.url})\n[다운로드](${generated.download_url})` });
      return;
    }

    const messages = await buildMessages({ message: req.body.message, historyRaw: req.body.history, files: req.files, onStatus: (phase) => send('status', { phase }), searchMode });
    send('status', { phase: 'generating' });
    const answer = await chatCompletion(messages, headerKey, selectedModel);
    send('done', { answer });
  } catch (error) {
    send('error', { message: error.message || '서버 오류' });
  } finally {
    res.end();
  }
});

app.get('/download/:filename', async (req, res) => {
  const filename = path.basename(req.params.filename);
  const fullPath = path.join(GENERATED_DIR, filename);
  try {
    await fs.access(fullPath);
    res.download(fullPath, filename);
  } catch {
    res.status(404).json({ detail: '파일을 찾을 수 없습니다.' });
  }
});

async function writePdf(filename, content) {
  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage([595, 842]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  let y = 800;
  for (const line of content.replace(/\r/g, '').split('\n')) {
    const chunks = line.match(/.{1,90}/g) || [''];
    for (const c of chunks) {
      if (y < 50) {
        page = pdfDoc.addPage([595, 842]);
        y = 800;
      }
      page.drawText(c.replace(/[^\x00-\x7F]/g, '?'), { x: 40, y, size: 11, font, color: rgb(0.1, 0.1, 0.1) });
      y -= 16;
    }
  }
  await fs.writeFile(filename, await pdfDoc.save());
}

async function writeDocx(filename, content) {
  const doc = new Document({ sections: [{ children: content.split('\n').map((line) => new Paragraph(line || ' ')) }] });
  await fs.writeFile(filename, await Packer.toBuffer(doc));
}

async function writeXlsx(filename, content) {
  const rows = content
    .split('\n')
    .filter(Boolean)
    .map((line) => (line.includes(',') ? line.split(',').map((c) => c.trim()) : [line]));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows.length ? rows : [['']]);
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  XLSX.writeFile(wb, filename);
}

async function materializeFile(filenameRaw, content = '') {
  const safeName = path.basename(filenameRaw).replace(/[^a-zA-Z0-9_.가-힣-]/g, '_');
  const ext = (safeName.split('.').pop() || 'txt').toLowerCase();
  const base = safeName.replace(/\.[^.]+$/, '');
  const allowed = ['txt', 'md', 'pdf', 'docx', 'xlsx'];
  const finalExt = allowed.includes(ext) ? ext : 'txt';
  const finalName = `${base}.${finalExt}`;
  const fullPath = path.join(GENERATED_DIR, finalName);

  if (finalExt === 'pdf') await writePdf(fullPath, content);
  else if (finalExt === 'docx') await writeDocx(fullPath, content);
  else if (finalExt === 'xlsx') await writeXlsx(fullPath, content);
  else await fs.writeFile(fullPath, content, 'utf-8');

  return { filename: finalName, url: `/generated/${finalName}`, download_url: `/download/${finalName}` };
}

app.post('/api/materialize-download', async (req, res) => {
  try {
    const data = await materializeFile(String(req.body.filename || 'result.txt'), String(req.body.content || ''));
    res.json(data);
  } catch (error) {
    res.status(500).json({ detail: `다운로드 파일 생성 실패: ${error.message}` });
  }
});

app.post('/api/generate/image', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    res.json(await createGeneratedImage(req.body.prompt || 'Untitled'));
  } catch (error) {
    res.status(500).json({ detail: error.message || '이미지 생성 실패' });
  }
});

app.post('/api/generate/file', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    const prompt = req.body.prompt || '';
    const format = (req.body.format || 'md').toLowerCase();
    const headerKey = req.header('x-llm-api-key') || '';
    const content = await chatCompletion([
      { role: 'system', content: 'Create downloadable content exactly as requested.' },
      { role: 'user', content: prompt }
    ], headerKey);

    const data = await materializeFile(`file_${crypto.randomUUID().slice(0, 8)}.${format}`, content);
    res.json(data);
  } catch (error) {
    res.status(500).json({ detail: error.message || '파일 생성 실패' });
  }
});

app.get('/health', (_req, res) => res.json({ ok: true, model: LLM_MODEL }));

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
