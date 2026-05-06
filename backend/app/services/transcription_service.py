"""
Transcription service using Google Speech-to-Text v2 (async, long-running).
Falls back to Gemini 1.5 multimodal for short files (< 1 min) if no
service-account credentials are configured.
"""
import os
import asyncio
import mimetypes
from pathlib import Path
from typing import Optional, Dict, Any, List
import aiofiles

from app.core.config import settings

SUPPORTED_AUDIO = {".mp3", ".m4a", ".wav", ".webm", ".ogg", ".flac", ".mpga"}
SUPPORTED_VIDEO = {".mp4", ".mpeg", ".webm", ".mov", ".avi", ".mkv"}
ALL_SUPPORTED = SUPPORTED_AUDIO | SUPPORTED_VIDEO

MIME_MAP: Dict[str, str] = {
    ".mp3":  "audio/mpeg",
    ".mp4":  "video/mp4",
    ".mpeg": "video/mpeg",
    ".mpga": "audio/mpeg",
    ".m4a":  "audio/mp4",
    ".wav":  "audio/wav",
    ".webm": "audio/webm",
    ".ogg":  "audio/ogg",
    ".flac": "audio/flac",
    ".mov":  "video/quicktime",
    ".avi":  "video/x-msvideo",
    ".mkv":  "video/x-matroska",
}

# Google Speech-to-Text encoding map (for WAV/FLAC direct-path)
STT_ENCODING_MAP: Dict[str, str] = {
    "audio/wav":   "LINEAR16",
    "audio/flac":  "FLAC",
    "audio/mpeg":  "MP3",
    "audio/ogg":   "OGG_OPUS",
    "audio/webm":  "WEBM_OPUS",
}


class TranscriptionService:
    def __init__(self):
        os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
        self._use_stt = bool(settings.GOOGLE_APPLICATION_CREDENTIALS)

    # ── helpers ──────────────────────────────────────────────────────────────

    def is_supported(self, filename: str) -> bool:
        return Path(filename).suffix.lower() in ALL_SUPPORTED

    def get_mime_type(self, filename: str) -> str:
        return MIME_MAP.get(Path(filename).suffix.lower(), "application/octet-stream")

    async def save_upload(self, file_bytes: bytes, filename: str) -> str:
        safe_name = Path(filename).name
        dest = os.path.join(settings.UPLOAD_DIR, safe_name)
        async with aiofiles.open(dest, "wb") as f:
            await f.write(file_bytes)
        return dest

    # ── main entry point ─────────────────────────────────────────────────────

    async def transcribe(
        self, file_path: str, language: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Transcribe audio/video.

        Strategy:
          1. If GOOGLE_APPLICATION_CREDENTIALS is set → Google Speech-to-Text v1
          2. Otherwise → Gemini 1.5 Flash multimodal (supports audio up to ~8 h)
        """
        if self._use_stt:
            return await self._transcribe_with_stt(file_path, language)
        return await self._transcribe_with_gemini(file_path, language)

    # ── Google Speech-to-Text v1 ─────────────────────────────────────────────

    async def _transcribe_with_stt(
        self, file_path: str, language: Optional[str]
    ) -> Dict[str, Any]:
        from google.cloud import speech

        mime = self.get_mime_type(file_path)
        encoding_name = STT_ENCODING_MAP.get(mime)

        async with aiofiles.open(file_path, "rb") as f:
            audio_bytes = await f.read()

        # Build config
        lang_code = language or "en-US"
        config_kwargs: Dict[str, Any] = {
            "language_code": lang_code,
            "enable_automatic_punctuation": True,
            "enable_word_time_offsets": True,
            "model": "latest_long",
        }
        if encoding_name:
            config_kwargs["encoding"] = getattr(
                speech.RecognitionConfig.AudioEncoding, encoding_name
            )
        else:
            # Let the API auto-detect
            config_kwargs["encoding"] = speech.RecognitionConfig.AudioEncoding.ENCODING_UNSPECIFIED

        config = speech.RecognitionConfig(**config_kwargs)
        audio = speech.RecognitionAudio(content=audio_bytes)
        client = speech.SpeechClient()

        loop = asyncio.get_event_loop()

        # Use long_running_recognize for files > ~1 min
        if len(audio_bytes) > 1_000_000:
            operation = await loop.run_in_executor(
                None, lambda: client.long_running_recognize(config=config, audio=audio)
            )
            response = await loop.run_in_executor(None, operation.result)
        else:
            response = await loop.run_in_executor(
                None, lambda: client.recognize(config=config, audio=audio)
            )

        segments: List[Dict] = []
        full_text_parts: List[str] = []
        duration = 0.0

        for i, result in enumerate(response.results):
            alt = result.alternatives[0]
            full_text_parts.append(alt.transcript)
            seg: Dict[str, Any] = {
                "id": i,
                "text": alt.transcript,
                "start": 0.0,
                "end": 0.0,
                "avg_logprob": None,
            }
            if alt.words:
                start_s = alt.words[0].start_time.total_seconds()
                end_s = alt.words[-1].end_time.total_seconds()
                seg["start"] = start_s
                seg["end"] = end_s
                duration = max(duration, end_s)
            segments.append(seg)

        return {
            "text": " ".join(full_text_parts),
            "language": lang_code,
            "duration": duration,
            "segments": segments,
            "model": "google-speech-to-text-v1",
        }

    # ── Gemini multimodal transcription ──────────────────────────────────────

    async def _transcribe_with_gemini(
        self, file_path: str, language: Optional[str]
    ) -> Dict[str, Any]:
        import google.generativeai as genai
        from google.generativeai.types import GenerationConfig

        genai.configure(api_key=settings.GOOGLE_API_KEY)

        async with aiofiles.open(file_path, "rb") as f:
            audio_bytes = await f.read()

        mime = self.get_mime_type(file_path)
        lang_hint = f" The audio is in {language}." if language else ""

        prompt = (
            "Transcribe the following audio accurately."
            f"{lang_hint} "
            "Return ONLY the transcript text, with proper punctuation and paragraph breaks. "
            "Do not add any commentary or explanation."
        )

        model = genai.GenerativeModel(
            model_name=settings.GEMINI_VISION_MODEL,
            generation_config=GenerationConfig(temperature=0.0, max_output_tokens=8192),
        )

        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None,
            lambda: model.generate_content(
                [{"mime_type": mime, "data": audio_bytes}, prompt]
            ),
        )

        transcript = response.text.strip()

        return {
            "text": transcript,
            "language": language or "unknown",
            "duration": 0.0,        # Gemini doesn't return timestamps
            "segments": [{"id": 0, "text": transcript, "start": 0.0, "end": 0.0}],
            "model": f"gemini-multimodal/{settings.GEMINI_VISION_MODEL}",
        }


transcription_service = TranscriptionService()