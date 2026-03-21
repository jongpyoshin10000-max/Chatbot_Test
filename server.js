import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import sharp from 'sharp';

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

const SYSTEM_PROMPT = [
  'You are a multimodal assistant.',
  'Answer in the user\'s language.',
  'If files are provided, analyze them and explain clearly.',
  'When asked, create concise downloadable contents.'
].join(' ');

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use('/static', express.static(path.join(__dirname, 'static')));
app.use('/generated', express.static(GENERATED_DIR));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'templates', 'index.html'));
});

function resolveApiKey(headerKey) {
  const key = (headerKey || '').trim() || LLM_API_KEY;
  if (!key) {
    const err = new Error('LLM API key is missing. Configure env or use settings button.');
    err.status = 400;
    throw err;
  }
  return key;
}

async function chatCompletion(messages, headerKey = '') {
  const apiKey = resolveApiKey(headerKey);
  const response = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ model: LLM_MODEL, messages, temperature: 0.4 })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM error: ${text}`);
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content || '응답을 생성하지 못했습니다.';
}

function isImageFile(file) {
  return file?.mimetype?.startsWith('image/');
}

async function extractTextFromFile(file) {
  const name = (file.originalname || '').toLowerCase();
  if (name.endsWith('.txt') || name.endsWith('.md')) return file.buffer.toString('utf-8');
  if (name.endsWith('.pdf')) return (await pdfParse(file.buffer)).text || '';
  if (name.endsWith('.docx')) return (await mammoth.extractRawText({ buffer: file.buffer })).value || '';
  return '';
}

async function buildMessages({ message, historyRaw, files, onStatus }) {
  onStatus?.('thinking');
  const history = JSON.parse(historyRaw || '[]');
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
  for (const item of history.slice(-12)) messages.push({ role: item.role, content: item.content });

  onStatus?.('analyzing');
  const userContent = [{ type: 'text', text: message || '' }];
  for (const file of files || []) {
    if (isImageFile(file)) {
      const base64 = file.buffer.toString('base64');
      userContent.push({ type: 'image_url', image_url: { url: `data:${file.mimetype};base64,${base64}` } });
      userContent.push({ type: 'text', text: `첨부 이미지(${file.originalname})를 분석해줘.` });
      continue;
    }

    const extracted = await extractTextFromFile(file);
    const excerpt = extracted ? extracted.slice(0, 12000) : '(텍스트 추출 실패 또는 미지원 형식)';
    userContent.push({ type: 'text', text: `첨부 파일(${file.originalname}) 내용:\n${excerpt}` });
  }

  messages.push({ role: 'user', content: userContent });
  return messages;
}

app.post('/api/chat', upload.array('files'), async (req, res) => {
  try {
    const headerKey = req.header('x-llm-api-key') || '';
    const messages = await buildMessages({
      message: req.body.message,
      historyRaw: req.body.history,
      files: req.files
    });

    const answer = await chatCompletion(messages, headerKey);
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
    const messages = await buildMessages({
      message: req.body.message,
      historyRaw: req.body.history,
      files: req.files,
      onStatus: (phase) => send('status', { phase })
    });

    send('status', { phase: 'generating' });
    const answer = await chatCompletion(messages, headerKey);
    send('done', { answer });
  } catch (error) {
    send('error', { message: error.message || '서버 오류' });
  } finally {
    res.end();
  }
});

app.post('/api/generate/image', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    const prompt = req.body.prompt || 'Untitled';
    const name = `image_${crypto.randomUUID().slice(0, 8)}.png`;
    const outputPath = path.join(GENERATED_DIR, name);

    const svg = `
      <svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#141821" />
        <text x="64" y="120" fill="#f3f6ff" font-size="54" font-family="Arial">AI IMAGE</text>
        <foreignObject x="64" y="180" width="896" height="760">
          <div xmlns="http://www.w3.org/1999/xhtml" style="font-size:34px;color:#d5ddff;line-height:1.5;font-family:Arial;">${prompt
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')}</div>
        </foreignObject>
      </svg>`;

    await sharp(Buffer.from(svg)).png().toFile(outputPath);
    res.json({ url: `/generated/${name}`, filename: name });
  } catch (error) {
    res.status(500).json({ detail: error.message || '이미지 생성 실패' });
  }
});

app.post('/api/generate/file', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    const prompt = req.body.prompt || '';
    const format = req.body.format === 'txt' ? 'txt' : 'md';
    const headerKey = req.header('x-llm-api-key') || '';
    const content = await chatCompletion([
      { role: 'system', content: 'Create downloadable content exactly as requested.' },
      { role: 'user', content: prompt }
    ], headerKey);

    const name = `file_${crypto.randomUUID().slice(0, 8)}.${format}`;
    const outputPath = path.join(GENERATED_DIR, name);
    await fs.writeFile(outputPath, content, 'utf-8');
    res.json({ url: `/generated/${name}`, filename: name });
  } catch (error) {
    res.status(500).json({ detail: error.message || '파일 생성 실패' });
  }
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, model: LLM_MODEL });
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
