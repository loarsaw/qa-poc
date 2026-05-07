import time
import asyncio
import logging
from typing import List, Dict, Optional, AsyncGenerator
from google import genai
from google.genai import types
from app.core.config import settings

logger = logging.getLogger(__name__)

if not settings.GOOGLE_API_KEY:
    logger.error("GOOGLE_API_KEY is not set! Add it to backend/.env")

_client = genai.Client(api_key=settings.GOOGLE_API_KEY)

DEFAULT_MODEL = "gemini-3.1-flash-lite-preview"
OPENAI_MODELS = {"gpt-4o","gpt-4o-mini","gpt-4","gpt-4-turbo","gpt-3.5-turbo"}

def _normalise_model(name):
    if not name: return DEFAULT_MODEL
    clean = name.removeprefix("models/")
    if clean in OPENAI_MODELS:
        return DEFAULT_MODEL
    return clean

ROLE_MAP = {"user":"user","assistant":"model","system":"user"}

def _build_contents(messages):
    return [types.Content(role=ROLE_MAP.get(m["role"],"user"),
            parts=[types.Part.from_text(text=m["content"])]) for m in messages]

def _extract_system(messages):
    sys_parts, rest = [], []
    for m in messages:
        (sys_parts if m["role"]=="system" else rest).append(m)
    return "\n".join(p["content"] for p in sys_parts).strip(), rest

def _count_tokens_approx(text):
    return max(1, len(text) // 4)

class LLMService:
    def count_tokens(self, text): return _count_tokens_approx(text)

    def build_messages(self, history, system_prompt=None, context_docs=None):
        sys = system_prompt or "You are a helpful AI assistant. Answer clearly and concisely."
        if context_docs:
            sys += f"\n\nContext:\n\n" + "\n\n---\n\n".join(context_docs)
        return [{"role":"system","content":sys}] + history

    async def chat(self, messages, model=None, temperature=None, max_tokens=None):
        model_id = _normalise_model(model)
        sys_txt, rest = _extract_system(messages)
        cfg = types.GenerateContentConfig(
            temperature=temperature if temperature is not None else settings.TEMPERATURE,
            max_output_tokens=max_tokens or settings.MAX_TOKENS,
            system_instruction=sys_txt or None,
        )
        loop = asyncio.get_event_loop()
        start = time.time()
        response = await loop.run_in_executor(None, lambda: _client.models.generate_content(
            model=model_id, contents=_build_contents(rest), config=cfg))
        latency_ms = int((time.time()-start)*1000)
        content = response.text or ""
        token_count = _count_tokens_approx(content)
        try: token_count = response.usage_metadata.candidates_token_count or token_count
        except: pass
        return {"content":content,"model":model_id,"finish_reason":"stop",
                "token_count":token_count,"latency_ms":latency_ms}

    async def stream_chat(self, messages, model=None, temperature=None):
        model_id = _normalise_model(model)
        sys_txt, rest = _extract_system(messages)
        cfg = types.GenerateContentConfig(
            temperature=temperature if temperature is not None else settings.TEMPERATURE,
            max_output_tokens=settings.MAX_TOKENS,
            system_instruction=sys_txt or None,
        )
        loop = asyncio.get_event_loop()
        queue: asyncio.Queue = asyncio.Queue()
        SENTINEL = object()
        def _sync():
            try:
                for chunk in _client.models.generate_content_stream(
                        model=model_id, contents=_build_contents(rest), config=cfg):
                    if chunk.text: loop.call_soon_threadsafe(queue.put_nowait, chunk.text)
            except Exception as e: loop.call_soon_threadsafe(queue.put_nowait, e)
            finally: loop.call_soon_threadsafe(queue.put_nowait, SENTINEL)
        loop.run_in_executor(None, _sync)
        while True:
            item = await queue.get()
            if item is SENTINEL: break
            if isinstance(item, Exception): raise item
            yield item

llm_service = LLMService()
