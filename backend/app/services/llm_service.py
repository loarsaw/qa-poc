import time
import asyncio
from typing import List, Dict, Optional, AsyncGenerator
import google.generativeai as genai
from google.generativeai.types import GenerationConfig, HarmCategory, HarmBlockThreshold

from app.core.config import settings

# Configure Gemini once at import time
genai.configure(api_key=settings.GOOGLE_API_KEY)

# Gemini roles differ from OpenAI: "user" and "model" (not "assistant")
ROLE_MAP = {"user": "user", "assistant": "model", "system": "user"}


def _to_gemini_history(messages: List[Dict[str, str]]) -> tuple[str, list]:
    """
    Split a flat message list into:
      - system_instruction (str): content of the first system message (if any)
      - history (list[dict]): remaining messages in Gemini format
    Gemini's ChatSession takes history as [{"role": "user"|"model", "parts": [text]}, ...]
    The very last message is NOT included in history – it is sent via send_message().
    """
    system_instruction = ""
    history = []

    for msg in messages:
        role = msg["role"]
        content = msg["content"]
        if role == "system":
            # Gemini accepts system_instruction at model-init level;
            # we concatenate multiples and inject as first user turn if needed.
            system_instruction += content + "\n"
        else:
            history.append({"role": ROLE_MAP[role], "parts": [content]})

    return system_instruction.strip(), history


def _count_tokens_approx(text: str) -> int:
    """Approximate token count (Gemini charges ~4 chars/token)."""
    return max(1, len(text) // 4)


class LLMService:
    def __init__(self):
        self.default_model = settings.GEMINI_MODEL
        self._generation_config = GenerationConfig(
            temperature=settings.TEMPERATURE,
            max_output_tokens=settings.MAX_TOKENS,
        )
        # Permissive safety settings – tighten per your policy
        self._safety_settings = {
            HarmCategory.HARM_CATEGORY_HARASSMENT: HarmBlockThreshold.BLOCK_NONE,
            HarmCategory.HARM_CATEGORY_HATE_SPEECH: HarmBlockThreshold.BLOCK_NONE,
            HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: HarmBlockThreshold.BLOCK_NONE,
            HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_NONE,
        }

    def _make_model(self, model_name: Optional[str], system_instruction: str):
        return genai.GenerativeModel(
            model_name=model_name or self.default_model,
            generation_config=self._generation_config,
            safety_settings=self._safety_settings,
            system_instruction=system_instruction or None,
        )

    def count_tokens(self, text: str) -> int:
        return _count_tokens_approx(text)

    def build_messages(
        self,
        history: List[Dict[str, str]],
        system_prompt: Optional[str] = None,
        context_docs: Optional[List[str]] = None,
    ) -> List[Dict[str, str]]:
        """
        Returns a unified message list (OpenAI-style roles) that
        _to_gemini_history() will convert.  The last element is always
        the current user turn.
        """
        base_system = system_prompt or (
            "You are a helpful AI assistant. Answer questions clearly and concisely. "
            "If you don't know something, say so."
        )
        if context_docs:
            context_text = "\n\n---\n\n".join(context_docs)
            base_system += (
                f"\n\nUse the following context to answer the user's question:\n\n{context_text}"
                "\n\nIf the answer is not found in the context, say so clearly."
            )

        messages = [{"role": "system", "content": base_system}] + history
        return messages

    async def chat(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
    ) -> Dict:
        """Non-streaming Gemini chat. Returns content + metadata dict."""
        system_instruction, history = _to_gemini_history(messages[:-1])
        user_turn = messages[-1]["content"]

        gen_cfg = GenerationConfig(
            temperature=temperature if temperature is not None else settings.TEMPERATURE,
            max_output_tokens=max_tokens or settings.MAX_TOKENS,
        )
        gemini_model = genai.GenerativeModel(
            model_name=model or self.default_model,
            generation_config=gen_cfg,
            safety_settings=self._safety_settings,
            system_instruction=system_instruction or None,
        )

        chat_session = gemini_model.start_chat(history=history)

        start = time.time()
        # run_in_executor so we don't block the event loop (SDK is sync)
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None, lambda: chat_session.send_message(user_turn)
        )
        latency_ms = int((time.time() - start) * 1000)

        content = response.text
        token_count = _count_tokens_approx(content)

        # Gemini usage_metadata (available on response object)
        try:
            token_count = response.usage_metadata.candidates_token_count or token_count
        except Exception:
            pass

        return {
            "content": content,
            "model": model or self.default_model,
            "finish_reason": "stop",
            "token_count": token_count,
            "latency_ms": latency_ms,
        }

    async def stream_chat(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        temperature: Optional[float] = None,
    ) -> AsyncGenerator[str, None]:
        """Streaming Gemini chat – yields text deltas."""
        system_instruction, history = _to_gemini_history(messages[:-1])
        user_turn = messages[-1]["content"]

        gen_cfg = GenerationConfig(
            temperature=temperature if temperature is not None else settings.TEMPERATURE,
            max_output_tokens=settings.MAX_TOKENS,
        )
        gemini_model = genai.GenerativeModel(
            model_name=model or self.default_model,
            generation_config=gen_cfg,
            safety_settings=self._safety_settings,
            system_instruction=system_instruction or None,
        )

        chat_session = gemini_model.start_chat(history=history)

        loop = asyncio.get_event_loop()

        # The Gemini SDK's streaming is synchronous; run it in a thread and
        # bridge each chunk to an async generator via a queue.
        queue: asyncio.Queue = asyncio.Queue()
        SENTINEL = object()

        def _stream_sync():
            try:
                response_stream = chat_session.send_message(user_turn, stream=True)
                for chunk in response_stream:
                    if chunk.text:
                        loop.call_soon_threadsafe(queue.put_nowait, chunk.text)
            except Exception as exc:
                loop.call_soon_threadsafe(queue.put_nowait, exc)
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, SENTINEL)

        loop.run_in_executor(None, _stream_sync)

        while True:
            item = await queue.get()
            if item is SENTINEL:
                break
            if isinstance(item, Exception):
                raise item
            yield item


llm_service = LLMService()