const chatEl = document.getElementById('chat');
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

let history = [];
let voiceMode = false;
let recognition = null;
let pendingFiles = [];
let runtimeApiKey = localStorage.getItem('llm_api_key') || '';

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
  const map = {
    idle: '대기 중',
    thinking: '생각 중...',
    analyzing: '파일 분석 중...',
    generating: '답변 생성 중...'
  };
  statusEl.textContent = `상태: ${map[type] || type}`;
}

function renderAttachmentInfo() {
  if (pendingFiles.length === 0) {
    attachInfoEl.textContent = '첨부 파일 없음';
    return;
  }
  const names = pendingFiles.slice(0, 3).map((f) => f.name).join(', ');
  const more = pendingFiles.length > 3 ? ` 외 ${pendingFiles.length - 3}개` : '';
  attachInfoEl.textContent = `첨부됨: ${names}${more}`;
}

function addPendingFiles(files) {
  const arr = [...files].filter((f) => f && f.size > 0);
  if (arr.length === 0) return;
  pendingFiles = [...pendingFiles, ...arr];
  renderAttachmentInfo();
}

function clearPendingFiles() {
  pendingFiles = [];
  fileInput.value = '';
  renderAttachmentInfo();
}

function parseSSE(chunk) {
  return chunk
    .split('\n\n')
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const eventLine = block.split('\n').find((l) => l.startsWith('event:'));
      const dataLine = block.split('\n').find((l) => l.startsWith('data:'));
      const event = eventLine ? eventLine.replace('event:', '').trim() : 'message';
      const raw = dataLine ? dataLine.replace('data:', '').trim() : '{}';
      let data = {};
      try { data = JSON.parse(raw); } catch { data = { raw }; }
      return { event, data };
    });
}

async function sendMessage(message, files = []) {
  addMsg('user', message);
  setStatus('thinking');

  const formData = new FormData();
  formData.append('message', message);
  formData.append('history', JSON.stringify(history));
  files.forEach((f) => formData.append('files', f));

  const res = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: buildHeaders(),
    body: formData
  });

  if (!res.ok || !res.body) {
    const text = await res.text();
    addMsg('assistant', `오류: ${text || '요청 실패'}`);
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
    const lastBoundary = buffer.lastIndexOf('\n\n');
    const complete = buffer.slice(0, lastBoundary);
    buffer = buffer.slice(lastBoundary + 2);

    for (const evt of parseSSE(complete)) {
      if (evt.event === 'status') setStatus(evt.data.phase);
      if (evt.event === 'done') answer = evt.data.answer || '';
      if (evt.event === 'error') answer = evt.data.message || '오류가 발생했습니다.';
    }
  }

  addMsg('assistant', answer || '응답을 받지 못했습니다.');
  history.push({ role: 'user', content: message });
  history.push({ role: 'assistant', content: answer });
  setStatus('idle');

  if (voiceMode && 'speechSynthesis' in window && answer) {
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

form.addEventListener('drop', (e) => {
  const dropped = e.dataTransfer?.files || [];
  addPendingFiles(dropped);
});

messageEl.addEventListener('paste', (e) => {
  const pasted = e.clipboardData?.files || [];
  addPendingFiles(pasted);
});

voiceBtn.addEventListener('click', () => {
  voiceMode = !voiceMode;
  voiceBtn.textContent = voiceMode ? '🎤 음성모드 ON' : '🎤 음성모드';

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    alert('이 브라우저는 음성 인식을 지원하지 않습니다.');
    return;
  }

  if (voiceMode) {
    recognition = new SR();
    recognition.lang = 'ko-KR';
    recognition.interimResults = false;
    recognition.onresult = async (event) => {
      const transcript = event.results[0][0].transcript;
      await sendMessage(transcript, []);
    };
    recognition.start();
  } else if (recognition) {
    recognition.stop();
  }
});

newChatBtn.addEventListener('click', () => {
  history = [];
  chatEl.innerHTML = '';
});

genImageBtn.addEventListener('click', async () => {
  const prompt = prompt('생성할 이미지 설명을 입력하세요');
  if (!prompt) return;
  const fd = new FormData();
  fd.append('prompt', prompt);
  const res = await fetch('/api/generate/image', { method: 'POST', body: fd });
  const data = await res.json();
  addMsg('assistant', `이미지를 생성했습니다: ${location.origin}${data.url}`);
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
});

settingsBtn.addEventListener('click', () => {
  const current = runtimeApiKey ? `${runtimeApiKey.slice(0, 6)}...` : '(미설정)';
  const input = prompt(`외부 LLM API Key를 입력하세요.\n현재: ${current}\n비워두고 확인하면 저장된 키를 삭제합니다.`, runtimeApiKey);
  if (input === null) return;
  runtimeApiKey = input.trim();
  if (runtimeApiKey) {
    localStorage.setItem('llm_api_key', runtimeApiKey);
    alert('API Key가 저장되었습니다.');
  } else {
    localStorage.removeItem('llm_api_key');
    alert('저장된 API Key를 삭제했습니다.');
  }
});

renderAttachmentInfo();
setStatus('idle');
