const chatEl = document.getElementById('chat');
const form = document.getElementById('chatForm');
const messageEl = document.getElementById('message');
const fileInput = document.getElementById('fileInput');
const voiceBtn = document.getElementById('voiceBtn');
const genImageBtn = document.getElementById('genImageBtn');
const genFileBtn = document.getElementById('genFileBtn');
const newChatBtn = document.getElementById('newChatBtn');
const settingsBtn = document.getElementById('settingsBtn');

let history = [];
let voiceMode = false;
let recognition = null;

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

async function sendMessage(message, files = []) {
  addMsg('user', message);
  const formData = new FormData();
  formData.append('message', message);
  formData.append('history', JSON.stringify(history));
  files.forEach(f => formData.append('files', f));

  const res = await fetch('/api/chat', { method: 'POST', headers: buildHeaders(), body: formData });
  const data = await res.json();
  const answer = data.answer || data.detail || '오류가 발생했습니다.';
  addMsg('assistant', answer);
  history.push({ role: 'user', content: message });
  history.push({ role: 'assistant', content: answer });

  if (voiceMode && 'speechSynthesis' in window) {
    speechSynthesis.speak(new SpeechSynthesisUtterance(answer));
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const message = messageEl.value.trim();
  const files = [...fileInput.files];
  if (!message && files.length === 0) return;
  messageEl.value = '';
  fileInput.value = '';
  await sendMessage(message || '첨부 파일을 분석해줘', files);
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
