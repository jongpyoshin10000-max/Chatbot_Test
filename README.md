# Multimodal Chatbot (External LLM)

외부 LLM(OpenAI 호환 API)을 이용해 ChatGPT/Gemini 스타일의 사용자 환경을 제공하는 멀티모달 챗봇입니다.

## 지원 기능
- 텍스트 질의응답
- 이미지 첨부 후 분석(비전 지원 모델 필요)
- 문서(.txt/.md/.docx) 첨부 후 분석
- PDF 첨부 후 분석
- 마이크 버튼 기반 음성 모드(브라우저 SpeechRecognition + TTS)
- 요청 기반 파일 생성(.md/.txt)
- 요청 기반 이미지 생성(샘플 이미지 생성)

## 실행 방법
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export LLM_API_KEY="your_api_key"
export LLM_BASE_URL="https://api.openai.com/v1"
export LLM_MODEL="gpt-4o-mini"
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

브라우저에서 `http://localhost:8000` 접속.

## 참고
- 이미지 분석은 연결한 외부 모델이 비전 입력을 지원해야 동작합니다.
- 음성 인식은 브라우저 지원 여부에 따라 동작이 달라질 수 있습니다.
