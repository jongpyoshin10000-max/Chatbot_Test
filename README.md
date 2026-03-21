# Multimodal Chatbot (Node.js + External LLM)

외부 LLM(OpenAI 호환 API)을 연결해, ChatGPT/Gemini 스타일 UX를 제공하는 **Node.js 기반 멀티모달 챗봇**입니다.

## 기능
- 텍스트 질의응답
- 이미지 첨부 분석(비전 지원 모델 필요)
- 문서 분석: `.txt`, `.md`, `.docx`
- PDF 분석
- 마이크 버튼으로 음성모드(STT/TTS)
- 요청 시 파일(.md/.txt) 생성 후 다운로드 링크 제공
- 요청 시 이미지 생성 후 다운로드 링크 제공

## 실행
```bash
npm install
export LLM_API_KEY="your_api_key"
export LLM_BASE_URL="https://api.openai.com/v1"
export LLM_MODEL="gpt-4o-mini"
npm run dev
```

브라우저: `http://localhost:8000`

## 체크
```bash
npm run check
```

## 참고
- 이미지 분석은 연결 모델이 멀티모달 입력(`image_url`)을 지원해야 동작합니다.
- 음성 인식은 브라우저(Web Speech API) 지원 여부에 영향을 받습니다.


## API Key 설정 버튼
- 우상단 `⚙️ 설정` 버튼에서 API Key를 입력/저장할 수 있습니다.
- 입력한 키는 브라우저 `localStorage`에 저장되며 요청 시 `x-llm-api-key` 헤더로 전송됩니다.
- 설정 버튼을 비워서 저장하면 저장된 키가 삭제됩니다.
