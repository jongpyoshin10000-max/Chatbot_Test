import base64
import mimetypes
import os
import uuid
from io import BytesIO
from pathlib import Path
from typing import Any

import requests
from docx import Document
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from PIL import Image, ImageDraw
from pypdf import PdfReader

BASE_DIR = Path(__file__).parent
GENERATED_DIR = BASE_DIR / "generated"
GENERATED_DIR.mkdir(exist_ok=True)

LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://api.openai.com/v1")
LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4o-mini")

app = FastAPI(title="Multimodal Chatbot")
app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount("/generated", StaticFiles(directory="generated"), name="generated")
templates = Jinja2Templates(directory="templates")

SYSTEM_PROMPT = (
    "You are a multimodal assistant. Answer in the user's language. "
    "If files are provided, analyze them and explain clearly. "
    "When the user asks for content that can be downloaded, return concise content."
)


def _llm_headers() -> dict[str, str]:
    if not LLM_API_KEY:
        raise HTTPException(status_code=500, detail="LLM_API_KEY is not configured.")
    return {
        "Authorization": f"Bearer {LLM_API_KEY}",
        "Content-Type": "application/json",
    }


def _extract_text_from_upload(file: UploadFile, raw: bytes) -> str:
    filename = (file.filename or "unknown").lower()
    if filename.endswith(".txt") or filename.endswith(".md"):
        return raw.decode("utf-8", errors="ignore")
    if filename.endswith(".pdf"):
        reader = PdfReader(BytesIO(raw))
        pages = [page.extract_text() or "" for page in reader.pages]
        return "\n".join(pages)
    if filename.endswith(".docx"):
        doc = Document(BytesIO(raw))
        return "\n".join(p.text for p in doc.paragraphs)
    return ""


def _is_image(file: UploadFile) -> bool:
    mime, _ = mimetypes.guess_type(file.filename or "")
    return bool(mime and mime.startswith("image/"))


def _chat_completion(messages: list[dict[str, Any]]) -> str:
    payload = {
        "model": LLM_MODEL,
        "messages": messages,
        "temperature": 0.4,
    }
    response = requests.post(
        f"{LLM_BASE_URL}/chat/completions",
        headers=_llm_headers(),
        json=payload,
        timeout=120,
    )
    if response.status_code >= 400:
        raise HTTPException(status_code=500, detail=f"LLM error: {response.text}")
    data = response.json()
    return data["choices"][0]["message"]["content"]


@app.get("/", response_class=HTMLResponse)
def home(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.post("/api/chat")
async def chat(
    message: str = Form(...),
    history: str = Form("[]"),
    files: list[UploadFile] = File(default=[]),
):
    import json

    parsed_history = json.loads(history)
    messages: list[dict[str, Any]] = [{"role": "system", "content": SYSTEM_PROMPT}]

    for item in parsed_history[-12:]:
        messages.append({"role": item["role"], "content": item["content"]})

    user_content: list[dict[str, Any]] = [{"type": "text", "text": message}]

    for file in files:
        raw = await file.read()
        if _is_image(file):
            mime, _ = mimetypes.guess_type(file.filename or "")
            b64 = base64.b64encode(raw).decode("utf-8")
            user_content.append(
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:{mime};base64,{b64}"},
                }
            )
            user_content.append(
                {"type": "text", "text": f"위 이미지({file.filename})를 분석해줘."}
            )
        else:
            text = _extract_text_from_upload(file, raw)
            excerpt = text[:12000] if text else "(텍스트 추출 실패 또는 지원하지 않는 형식)"
            user_content.append(
                {
                    "type": "text",
                    "text": f"다음 파일({file.filename}) 내용:\n{excerpt}",
                }
            )

    messages.append({"role": "user", "content": user_content})
    answer = _chat_completion(messages)
    return JSONResponse({"answer": answer})


@app.post("/api/generate/image")
async def generate_image(prompt: str = Form(...)):
    img = Image.new("RGB", (1024, 1024), color=(20, 22, 30))
    draw = ImageDraw.Draw(img)
    text = f"AI IMAGE\n\n{prompt[:140]}"
    draw.multiline_text((60, 80), text, fill=(240, 240, 240), spacing=12)
    name = f"image_{uuid.uuid4().hex[:10]}.png"
    path = GENERATED_DIR / name
    img.save(path, "PNG")
    return {"url": f"/generated/{name}", "filename": name}


@app.post("/api/generate/file")
async def generate_file(prompt: str = Form(...), format: str = Form("md")):
    content = _chat_completion(
        [
            {"role": "system", "content": "Create downloadable content exactly as requested."},
            {"role": "user", "content": prompt},
        ]
    )
    ext = "md" if format not in {"txt", "md"} else format
    name = f"file_{uuid.uuid4().hex[:10]}.{ext}"
    path = GENERATED_DIR / name
    path.write_text(content, encoding="utf-8")
    return {"url": f"/generated/{name}", "filename": name}


@app.get("/health")
def health():
    return {"ok": True, "model": LLM_MODEL}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
