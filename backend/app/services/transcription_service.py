import os
import asyncio
import logging
from pathlib import Path
from typing import Optional, Dict, Any, List
import aiofiles

from app.core.config import settings

logger = logging.getLogger(__name__)

SUPPORTED_AUDIO = {".mp3", ".m4a", ".wav", ".flac", ".ogg", ".webm", ".mpga"}
SUPPORTED_VIDEO = {".mp4", ".mpeg", ".mov", ".avi", ".mkv"}
ALL_SUPPORTED   = SUPPORTED_AUDIO | SUPPORTED_VIDEO

MIME_MAP: Dict[str, str] = {
    ".mp3":  "audio/mpeg",  ".mp4":  "video/mp4",
    ".mpeg": "video/mpeg",  ".mpga": "audio/mpeg",
    ".m4a":  "audio/mp4",   ".wav":  "audio/wav",
    ".webm": "audio/webm",  ".ogg":  "audio/ogg",
    ".flac": "audio/flac",  ".mov":  "video/quicktime",
    ".avi":  "video/x-msvideo", ".mkv": "video/x-matroska",
}

# -- Detect which SDK API is available ────────────────────────────────────────
try:
    from deepgram import AsyncDeepgramClient  # v4+
    _HAS_ASYNC_CLIENT = True
    logger.info("Deepgram SDK v4+ detected — using AsyncDeepgramClient")
except ImportError:
    _HAS_ASYNC_CLIENT = False
    logger.info("Deepgram SDK v3 detected — using sync client via executor")


class TranscriptionService:
    def __init__(self):
        os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
        if not settings.DEEPGRAM_API_KEY:
            logger.warning(
                "DEEPGRAM_API_KEY is not set! "
                "Free tier at https://console.deepgram.com"
            )

    def is_supported(self, filename: str) -> bool:
        return bool(filename) and Path(filename).suffix.lower() in ALL_SUPPORTED

    def get_mime_type(self, filename: str) -> str:
        return MIME_MAP.get(Path(filename).suffix.lower(), "application/octet-stream")

    async def save_upload(self, file_bytes: bytes, filename: str) -> str:
        if not self.is_supported(filename):
            raise ValueError(f"Unsupported file type: {filename}")
        if not file_bytes:
            raise ValueError("Cannot save empty file")
        dest = os.path.join(settings.UPLOAD_DIR, Path(filename).name)
        async with aiofiles.open(dest, "wb") as f:
            await f.write(file_bytes)
        return dest

    async def transcribe(
        self, file_path: str, language: Optional[str] = None
    ) -> Dict[str, Any]:
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"File not found: {file_path}")
        if not self.is_supported(file_path):
            raise ValueError(f"Unsupported file type: {file_path}")
        if os.path.getsize(file_path) == 0:
            raise ValueError(f"File is empty: {file_path}")

        if _HAS_ASYNC_CLIENT:
            return await self._transcribe_v4(file_path, language)
        return await self._transcribe_v3(file_path, language)

    # -- SDK v4 — AsyncDeepgramClient ─────────────────────────────────────────
    async def _transcribe_v4(
        self, file_path: str, language: Optional[str]
    ) -> Dict[str, Any]:
        from deepgram import AsyncDeepgramClient, PrerecordedOptions

        client = AsyncDeepgramClient(api_key=settings.DEEPGRAM_API_KEY)

        async with aiofiles.open(file_path, "rb") as f:
            audio_bytes = await f.read()

        payload = {"buffer": audio_bytes, "mimetype": self.get_mime_type(file_path)}
        options = PrerecordedOptions(
            model=settings.DEEPGRAM_MODEL or "nova-3",
            smart_format=True,
            punctuate=True,
            paragraphs=True,
            utterances=True,
            language=language or "en",
        )

        response = await client.listen.asyncrest.v("1").transcribe_file(payload, options)
        return self._parse_response(response, language)

    # -- SDK v3 — sync DeepgramClient in executor ──────────────────────────────
    async def _transcribe_v3(
        self, file_path: str, language: Optional[str]
    ) -> Dict[str, Any]:
        from deepgram import DeepgramClient, PrerecordedOptions

        async with aiofiles.open(file_path, "rb") as f:
            audio_bytes = await f.read()

        payload = {"buffer": audio_bytes, "mimetype": self.get_mime_type(file_path)}
        options = PrerecordedOptions(
            model=settings.DEEPGRAM_MODEL or "nova-3",
            smart_format=True,
            punctuate=True,
            paragraphs=True,
            utterances=True,
            language=language or "en",
        )

        def _sync_call():
            client = DeepgramClient(api_key=settings.DEEPGRAM_API_KEY)
            return client.listen.prerecorded.v("1").transcribe_file(payload, options)

        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(None, _sync_call)
        return self._parse_response(response, language)

    def _parse_response(self, response: Any, language: Optional[str]) -> Dict[str, Any]:
        transcript_text = ""
        segments: List[Dict[str, Any]] = []
        duration = 0.0
        detected_language = language or "en"

        try:
            channel = response.results.channels[0]
            alt     = channel.alternatives[0]
            transcript_text = alt.transcript or ""

            try:
                detected_language = channel.detected_language or detected_language
            except AttributeError:
                pass

            if response.metadata and getattr(response.metadata, "duration", None):
                duration = float(response.metadata.duration)

            utterances = getattr(response.results, "utterances", None)
            if utterances:
                for i, utt in enumerate(utterances):
                    segments.append({
                        "id":          i,
                        "text":        utt.transcript,
                        "start":       float(utt.start),
                        "end":         float(utt.end),
                        "avg_logprob": getattr(utt, "confidence", None),
                    })
            else:
                # Fallback: paragraph sentences
                try:
                    paras = alt.paragraphs.paragraphs
                    idx = 0
                    for para in paras:
                        for sent in para.sentences:
                            segments.append({
                                "id":          idx,
                                "text":        sent.text,
                                "start":       float(sent.start),
                                "end":         float(sent.end),
                                "avg_logprob": None,
                            })
                            idx += 1
                except (AttributeError, TypeError):
                    pass

        except (AttributeError, IndexError, TypeError) as e:
            logger.warning("Could not fully parse Deepgram response: %s", e)

        return {
            "text":     transcript_text,
            "language": detected_language,
            "duration": duration,
            "segments": segments,
            "model":    f"deepgram-{settings.DEEPGRAM_MODEL or 'nova-3'}",
        }


transcription_service = TranscriptionService()