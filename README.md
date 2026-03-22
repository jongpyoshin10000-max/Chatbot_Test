# Multimodal Chatbot (Node.js + External LLM)

외부 LLM(OpenAI 호환 API)을 연결해, ChatGPT/Gemini 스타일 UX를 제공하는 **Node.js 기반 멀티모달 챗봇**입니다.

## 기능
- 좌측 상단 모델 선택(예: gpt-4o-mini, gpt-4.1-mini, gpt-4.1)
- 검색 모드 선택(표준 검색 / 심층 검색)
- 왼쪽 사이드바 채팅방 목록(멀티 세션 전환/삭제)
- 텍스트 질의응답
- 이미지 첨부 분석(비전 지원 모델 필요)
- 문서 분석: `.txt`, `.md`, `.docx`
- PDF 분석
- 마이크 버튼으로 음성모드(STT/TTS)
- 요청 시 파일(.md/.txt/.pdf/.docx/.xlsx) 생성 후 다운로드 링크 제공
- 요청 시 이미지 생성 후 다운로드 링크 제공

- 드래그앤드롭/붙여넣기 업로드(파일 탐색기 없이 채팅창에 바로 첨부)
- 답변 대기 중 상태 표시(생각 중 → 파일 분석 중 → 답변 생성 중)

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
- 좌측 상단 `⚙️ 설정` 버튼에서 API Key를 입력/저장할 수 있습니다.
- 입력한 키는 브라우저 `localStorage`에 저장되며 요청 시 `x-llm-api-key` 헤더로 전송됩니다.
- 설정 버튼을 비워서 저장하면 저장된 키가 삭제됩니다.


## 오픈 라이브러리 적용
- 문서 분석: `pdf-parse`, `mammoth`
- 파일 생성: `pdf-lib`, `docx`, `exceljs`
- 이미지 생성: `axios` + 오픈모델 이미지 API, `sharp` fallback
- 이미지 생성/처리: `sharp`
- 파일 업로드 처리: `multer`
- 음성 모드: 브라우저 Web Speech API(STT/TTS)
- 이미지 처리 안정화: 메타데이터 기반 힌트 + LLM 요청 타임아웃(90초)


## sandbox 다운로드 링크 변환
- 답변에 `sandbox:/...` 형태 링크가 포함되면, 클라이언트가 `/api/materialize-download`를 호출해 실제 다운로드 가능한 파일로 변환합니다.
- 변환된 링크는 `/download/:filename` 경로로 제공되어 브라우저에서 바로 다운로드됩니다.


## UI 컨셉
- ChatGPT 유사한 레이아웃(좌측 대화목록 + 우측 대화영역)
- 회색/하얀색 기반 테마
- 메인 헤더('멀티모달 챗봇')는 sticky 고정


## 생성 기능 개선
- 이미지 생성 요청 시 외부 오픈모델 이미지 API를 사용해 실제 생성 이미지를 저장/제공합니다(실패 시 로컬 fallback).
- 파일 생성은 txt/md뿐 아니라 pdf/docx/xlsx까지 materialize 가능합니다.
