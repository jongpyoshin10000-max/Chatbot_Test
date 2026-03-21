const chatEl = document.getElementById('chat');
const chatListEl = document.getElementById('chatList');
const form = document.getElementById('chatForm');
const messageEl = document.getElementById('message');
const fileInput = document.getElementById('fileInput');
const voiceBtn = document.getElementById('voiceBtn');
const genImageBtn = document.getElementById('genImageBtn');
const genFileBtn = document.getElementById('genFileBtn');
const newChatBtn = document.getElementById('newChatBtn');
const settingsBtn = document.getElementById('settingsBtn');
const statusEl = document.getElementById('llmStatus');
const attachInfoEl = document.getElementById('attachInfo');

let chats = [];
let currentChatId = null;
let voiceMode = false;
let recognition = null;
let pendingFiles = [];
let runtimeApiKey = localStorage.getItem('llm_api_key') || '';

function createChat(title = '새 대화') {
  const id = crypto.randomUUID();
  chats.unshift({ id, title, history: [] });
  currentChatId = id;
  renderChatList();
  renderChatMessages();
}

function getCurrentChat() {
  return chats.find((c) => c.id === currentChatId);
}

function renderChatList() {
  chatListEl.innerHTML = '';
  chats.forEach((chat) => {
    const el = document.createElement('button');
    el.className = `chat-item ${chat.id === currentChatId ? 'active' : ''}`;
    el.textContent = chat.title;
    el.onclick = () => {
      currentChatId = chat.id;
      renderChatList();
      renderChatMessages();
    };
    chatListEl.appendChild(el);
  });
}

function renderChatMessages() {
  chatEl.innerHTML = '';
  const chat = getCurrentChat();
  if (!chat) return;
  for (const msg of chat.history) addMsg(msg.role, msg.content);
}

function buildHeaders() {
  const headers = {};
  if (runtimeApiKey) headers['x-llm-api-key'] = runtimeApiKey;
  return headers;
}

function addMsg(role, text) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.textContent = text;
  chatEl.appendChild(div);
  chatEl.scrollTop = chatEl.scrollHeight;
}

function setStatus(type = 'idle') {
  const map = { idle: '대기 중', thinking: '생각 중...', analyzing: '파일 분석 중...', generating: '답변 생성 중...' };
  statusEl.textContent = `상태: ${map[type] || type}`;
}

function renderAttachmentInfo() {
  if (pendingFiles.length === 0) {
    attachInfoEl.textContent = '첨부 파일 없음';
    return;
  }
  const names = pendingFiles.slice(0, 4).map((f) => f.name).join(', ');
  attachInfoEl.textContent = `첨부됨: ${names}${pendingFiles.length > 4 ? ` 외 ${pendingFiles.length - 4}개` : ''}`;
}

function addPendingFiles(files) {
  const arr = [...files].filter((f) => f && f.size > 0);
  pendingFiles = [...pendingFiles, ...arr];
  renderAttachmentInfo();
}

function clearPendingFiles() {
  pendingFiles = [];
  fileInput.value = '';
  renderAttachmentInfo();
}

function parseSSE(chunk) {
  return chunk.split('\n\n').map((b) => b.trim()).filter(Boolean).map((block) => {
    const event = (block.split('\n').find((l) => l.startsWith('event:')) || 'event: message').replace('event:', '').trim();
    const raw = (block.split('\n').find((l) => l.startsWith('data:')) || 'data: {}').replace('data:', '').trim();
    try { return { event, data: JSON.parse(raw) }; } catch { return { event, data: { raw } }; }
  });
}

async function sendMessage(message, files = []) {
  const chat = getCurrentChat();
  if (!chat) return;

  if (chat.history.length === 0 && message.trim()) {
    chat.title = message.trim().slice(0, 20);
    renderChatList();
  }

  addMsg('user', message);
  chat.history.push({ role: 'user', content: message });
  setStatus('thinking');

  const formData = new FormData();
  formData.append('message', message);
  formData.append('history', JSON.stringify(chat.history.slice(0, -1)));
  files.forEach((f) => formData.append('files', f));

  const res = await fetch('/api/chat/stream', { method: 'POST', headers: buildHeaders(), body: formData });
  if (!res.ok || !res.body) {
    const text = await res.text();
    const err = `오류: ${text || '요청 실패'}`;
    addMsg('assistant', err);
    chat.history.push({ role: 'assistant', content: err });
    setStatus('idle');
    return;
  }

  let answer = '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    if (!buffer.includes('\n\n')) continue;
    const boundary = buffer.lastIndexOf('\n\n');
    const completed = buffer.slice(0, boundary);
    buffer = buffer.slice(boundary + 2);
    for (const evt of parseSSE(completed)) {
      if (evt.event === 'status') setStatus(evt.data.phase);
      if (evt.event === 'done') answer = evt.data.answer || '';
      if (evt.event === 'error') answer = evt.data.message || '오류가 발생했습니다.';
    }
  }

  addMsg('assistant', answer || '응답을 받지 못했습니다.');
  chat.history.push({ role: 'assistant', content: answer || '응답을 받지 못했습니다.' });
  setStatus('idle');

  if (voiceMode && answer && 'speechSynthesis' in window) {
    speechSynthesis.speak(new SpeechSynthesisUtterance(answer));
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const message = messageEl.value.trim();
  const files = [...pendingFiles];
  if (!message && files.length === 0) return;
  messageEl.value = '';
  clearPendingFiles();
  await sendMessage(message || '첨부 파일을 분석해줘', files);
});
fileInput.addEventListener('change', (e) => addPendingFiles(e.target.files || []));

['dragenter', 'dragover'].forEach((eventName) => {
  form.addEventListener(eventName, (e) => {
    e.preventDefault();
    e.stopPropagation();
    form.classList.add('dragging');
  });
});
['dragleave', 'drop'].forEach((eventName) => {
  form.addEventListener(eventName, (e) => {
    e.preventDefault();
    e.stopPropagation();
    form.classList.remove('dragging');
  });
});
form.addEventListener('drop', (e) => addPendingFiles(e.dataTransfer?.files || []));
messageEl.addEventListener('paste', (e) => addPendingFiles(e.clipboardData?.files || []));

voiceBtn.addEventListener('click', () => {
  voiceMode = !voiceMode;
  voiceBtn.textContent = voiceMode ? '🎤 음성모드 ON' : '🎤 음성모드';
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return alert('이 브라우저는 음성 인식을 지원하지 않습니다.');
  if (voiceMode) {
    recognition = new SR();
    recognition.lang = 'ko-KR';
    recognition.onresult = async (event) => await sendMessage(event.results[0][0].transcript, []);
    recognition.start();
  } else if (recognition) {
    recognition.stop();
  }
});

newChatBtn.addEventListener('click', () => createChat('새 대화'));

genImageBtn.addEventListener('click', async () => {
  const prompt = prompt('생성할 이미지 설명을 입력하세요');
  if (!prompt) return;
  const fd = new FormData();
  fd.append('prompt', prompt);
  const res = await fetch('/api/generate/image', { method: 'POST', body: fd });
  const data = await res.json();
  addMsg('assistant', `이미지를 생성했습니다: ${location.origin}${data.url}`);
  getCurrentChat()?.history.push({ role: 'assistant', content: `이미지를 생성했습니다: ${location.origin}${data.url}` });
});

genFileBtn.addEventListener('click', async () => {
  const promptText = prompt('생성할 파일 설명을 입력하세요');
  if (!promptText) return;
  const fd = new FormData();
  fd.append('prompt', promptText);
  fd.append('format', 'md');
  const res = await fetch('/api/generate/file', { method: 'POST', headers: buildHeaders(), body: fd });
  const data = await res.json();
  addMsg('assistant', `파일을 생성했습니다: ${location.origin}${data.url}`);
  getCurrentChat()?.history.push({ role: 'assistant', content: `파일을 생성했습니다: ${location.origin}${data.url}` });
});

settingsBtn.addEventListener('click', () => {
  const current = runtimeApiKey ? `${runtimeApiKey.slice(0, 6)}...` : '(미설정)';
  const input = prompt(`외부 LLM API Key를 입력하세요.\n현재: ${current}\n비워두고 확인하면 저장된 키를 삭제합니다.`, runtimeApiKey);
  if (input === null) return;
  runtimeApiKey = input.trim();
  if (runtimeApiKey) localStorage.setItem('llm_api_key', runtimeApiKey);
  else localStorage.removeItem('llm_api_key');
});

createChat('새 대화');
renderAttachmentInfo();
setStatus('idle');
