import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import {
  useUploadFile,
  useTranscriptions,
  useTranscription,
  useDeleteTranscription,
  useCreateDocument,
} from "@/hooks/index";
import { MediaPlayer } from "@/components/player/media_player";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Spinner,
  Empty,
  Modal,
} from "@/components/ui/index";
import { formatBytes, formatDate, formatDuration, cn } from "@/lib/utils/index";
import type { TranscriptionListItem } from "@/types/index";

const ACCEPT = {
  "application/pdf": [".pdf"],
  "audio/*": [".mp3", ".m4a", ".wav", ".flac", ".ogg", ".webm", ".mpga"],
  "video/*": [".mp4", ".mov", ".avi", ".mkv", ".mpeg", ".webm"],
};

function fileCategory(file: File): "pdf" | "audio" | "video" {
  if (file.type === "application/pdf") return "pdf";
  if (file.type.startsWith("audio/")) return "audio";
  return "video";
}

function SummaryPanel({ text, title }: { text: string; title: string }) {
  const [summary, setSummary] = useState<string | null>(null);
  const [topics, setTopics] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const createDoc = useCreateDocument();

  async function generateSummary() {
    setLoading(true);
    try {
      const { chatApi } = await import("@/api/index");
      const session = await chatApi.createSession({
        title: `Summary: ${title}`,
        system_prompt:
          "You are a summarisation assistant. When given text, return a JSON object with keys: " +
          '"summary" (2-3 sentences), "key_topics" (array of 4-6 short topic strings). ' +
          "Respond ONLY with valid JSON, no markdown fences.",
      });
      const resp = await chatApi.sendMessage(session.id, {
        content: `Summarise this content:\n\n${text.slice(0, 6000)}`,
      });
      let parsed: { summary?: string; key_topics?: string[] } = {};
      try {
        parsed = JSON.parse(resp.message.content);
      } catch {
        /* raw fallback */
      }
      setSummary(parsed.summary ?? resp.message.content);
      setTopics(parsed.key_topics ?? []);
      setDone(true);
    } catch (e: unknown) {
      setSummary(
        "Failed to generate summary. " + (e instanceof Error ? e.message : ""),
      );
      setDone(true);
    } finally {
      setLoading(false);
    }
  }

  async function saveAsDocument() {
    if (!summary) return;
    await createDoc.mutateAsync({
      title: `Summary: ${title}`,
      content:
        summary + (topics.length ? "\n\nKey topics: " + topics.join(", ") : ""),
      source_type: "text",
    });
  }

  return (
    <div className="bg-surface3 border bg-white border-border rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-muted2 uppercase tracking-wider">
          ✨ AI Summary
        </p>
        {!done && (
          <Button
            variant="subtle"
            className="text-xs py-1 px-3 h-auto"
            onClick={generateSummary}
            disabled={loading}
          >
            {loading ? (
              <>
                <Spinner size={12} /> Generating…
              </>
            ) : (
              "Generate"
            )}
          </Button>
        )}
        {done && (
          <Button
            variant="ghost"
            className="text-xs py-1 px-3 h-auto"
            onClick={saveAsDocument}
            disabled={createDoc.isPending}
          >
            {createDoc.isPending ? <Spinner size={12} /> : "💾 Save"}
          </Button>
        )}
      </div>

      {summary && (
        <p className="text-sm text-text leading-relaxed">{summary}</p>
      )}

      {topics.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {topics.map((t) => (
            <span
              key={t}
              className="text-[11px] px-2 py-0.5 rounded-full bg-accent/10 border border-accent/20 text-accent"
            >
              {t}
            </span>
          ))}
        </div>
      )}

      {!done && !loading && (
        <p className="text-xs text-muted">
          Click Generate to summarise this content with Gemini.
        </p>
      )}
    </div>
  );
}

function TranscriptionModal({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const { data, isLoading } = useTranscription(id);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);

  if (isLoading || !data) {
    return (
      <Modal
        onClose={onClose}
        className="items-center justify-center min-h-[200px]"
      >
        <Spinner size={28} />
      </Modal>
    );
  }

  const isAV =
    data.mime_type?.startsWith("audio/") ||
    data.mime_type?.startsWith("video/");

  return (
    <Modal onClose={onClose} className="max-w-2xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-base">{data.file_name}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Badge variant={data.status}>{data.status}</Badge>
            {data.language && <Badge variant="text">🌐 {data.language}</Badge>}
            {data.duration_seconds != null && (
              <span className="text-xs text-muted">
                ⏱ {formatDuration(data.duration_seconds)}
              </span>
            )}
            {data.whisper_model && (
              <span className="text-xs text-muted">
                🤖 {data.whisper_model}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-muted hover:text-text transition-colors text-lg leading-none cursor-pointer bg-transparent border-0"
        >
          ✕
        </button>
      </div>

      {/* Error */}
      {data.error_message && (
        <div className="bg-red-light border border-red/20 text-red rounded-lg px-4 py-2 text-sm">
          {data.error_message}
        </div>
      )}

      {/* Still processing */}
      {(data.status === "pending" || data.status === "processing") && (
        <div className="flex items-center gap-3 text-sm text-muted2">
          <Spinner size={16} />
          Processing… page will auto-refresh
        </div>
      )}

      {/* Media player + segments (audio/video only) */}
      {isAV && data.status === "completed" && (
        <div className="flex flex-col gap-3">
          {/* NOTE: In production, expose a /media/:id endpoint on the backend
              to serve the file; below shows the player UI wired to segments */}
          {mediaUrl ? (
            <MediaPlayer
              src={mediaUrl}
              mimeType={data.mime_type!}
              segments={data.segments}
            />
          ) : (
            <div className="bg-surface3 border border-border rounded-xl p-4">
              <p className="text-xs text-muted mb-2">
                ℹ️ To enable in-browser playback, add a{" "}
                <code className="text-accent text-[11px]">
                  GET /api/v1/transcription/{"{id}"}/media
                </code>{" "}
                endpoint that serves the file, then it will appear here
                automatically.
              </p>

              {/* Segments with ▶ Play buttons — functional once mediaUrl is set */}
              {data.segments.length > 0 && (
                <div className="flex flex-col gap-1 max-h-60 overflow-y-auto mt-2">
                  <p className="text-[10px] text-muted uppercase tracking-wider font-semibold mb-1">
                    Timestamps — click ▶ to jump when player is active
                  </p>
                  {data.segments.map((seg, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-3 px-3 py-2 rounded-lg hover:bg-surface2 group cursor-default"
                    >
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-surface2 group-hover:bg-accent/20 text-muted2 group-hover:text-accent flex items-center justify-center text-[10px] transition-all">
                        ▶
                      </span>
                      <span className="flex-shrink-0 text-xs font-mono text-muted2 mt-0.5 w-11">
                        {formatDuration(seg.start)}
                      </span>
                      <span className="text-xs text-muted2 leading-relaxed">
                        {seg.text}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Transcript text */}
      {data.transcript_text && (
        <div>
          <p className="text-xs text-muted uppercase tracking-wider font-semibold mb-2">
            Transcript
          </p>
          <div className="bg-surface3 border border-border rounded-xl px-4 py-3 max-h-48 overflow-y-auto text-sm leading-relaxed text-text">
            {data.transcript_text}
          </div>
        </div>
      )}

      {/* AI Summary (only when transcript exists) */}
      {data.transcript_text && data.status === "completed" && (
        <SummaryPanel text={data.transcript_text} title={data.file_name} />
      )}
    </Modal>
  );
}

async function extractPdfText(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve((e.target?.result as string) || "");
    reader.readAsText(file);
  });
}

function StatusBadge({ status }: { status: string }) {
  const dots: Record<string, string> = {
    pending: "text-amber",
    processing: "text-blue",
    completed: "text-green",
    failed: "text-red",
  };
  return (
    <span
      className={cn("flex items-center gap-1", dots[status] ?? "text-muted2")}
    >
      {(status === "pending" || status === "processing") && (
        <Spinner size={10} />
      )}
      <Badge variant={status}>{status}</Badge>
    </span>
  );
}

export default function UploadPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [language, setLanguage] = useState("");
  const [pdfUploading, setPdfUploading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const uploadFile = useUploadFile();
  const createDoc = useCreateDocument();
  const deleteItem = useDeleteTranscription();
  const { data, isLoading } = useTranscriptions();

  const items: TranscriptionListItem[] = data?.items ?? [];

  const onDrop = useCallback(
    async (accepted: File[]) => {
      for (const file of accepted) {
        const cat = fileCategory(file);

        if (cat === "pdf") {
          setPdfUploading(true);
          setPdfError(null);
          try {
            const text = await extractPdfText(file);
            await createDoc.mutateAsync({
              title: file.name.replace(".pdf", ""),
              content: text || `[PDF uploaded: ${file.name}]`,
              source_type: "pdf",
              metadata: { file_name: file.name, file_size: file.size },
            });
          } catch (e: unknown) {
            setPdfError(e instanceof Error ? e.message : "PDF upload failed");
          } finally {
            setPdfUploading(false);
          }
        } else {
          await uploadFile.mutateAsync({
            file,
            language: language || undefined,
          });
        }
      }
    },
    [uploadFile, createDoc, language],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPT,
    maxSize: 100 * 1024 * 1024,
  });

  const isBusy = uploadFile.isPending || pdfUploading;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* -- Header -- */}
      <div className="flex items-center gap-3 px-6 h-14 border-b border-border bg-surface flex-shrink-0">
        <h1 className="font-semibold text-sm">Upload Files</h1>
        <span className="text-xs text-muted">
          PDF · Audio · Video — max 100 MB
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6 flex flex-col gap-6">
        {/* -- Drop zone -- */}
        <Card>
          <CardHeader>
            <span className="font-semibold text-sm">Drop or browse files</span>
            <input
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              placeholder="Lang hint e.g. en"
              className="w-32 h-8 text-xs bg-surface3 border border-border rounded-lg px-3 outline-none focus:border-accent/60 text-text placeholder-muted"
            />
          </CardHeader>

          <div className="p-5">
            <div
              {...getRootProps()}
              className={cn(
                "relative border-2 border-dashed rounded-xl p-10 text-center transition-all cursor-pointer",
                isDragActive
                  ? "border-accent bg-accent/5"
                  : "border-border2 hover:border-accent/50 hover:bg-surface3/50",
              )}
            >
              <input {...getInputProps()} />
              <div className="flex flex-col items-center gap-3">
                <div className="text-4xl">
                  {isBusy ? "⏳" : isDragActive ? "📂" : "⬆️"}
                </div>
                <div>
                  <p className="font-semibold text-sm text-text">
                    {isBusy
                      ? "Uploading…"
                      : isDragActive
                        ? "Drop to upload"
                        : "Drag & drop files here"}
                  </p>
                  <p className="text-xs text-muted mt-1">
                    PDF, MP3, WAV, FLAC, M4A, OGG, MP4, MOV, AVI, MKV, WebM
                  </p>
                </div>
                {!isBusy && (
                  <span className="text-xs px-4 py-1.5 rounded-full border border-border2 text-muted2 hover:border-accent/50 hover:text-accent transition-all">
                    Browse files
                  </span>
                )}
                {isBusy && <Spinner size={20} />}
              </div>
            </div>

            {/* What happens to each type */}
            <div className="mt-4 grid grid-cols-3 gap-3">
              {[
                {
                  icon: "📋",
                  type: "PDF",
                  desc: "Text extracted -> stored as document",
                },
                {
                  icon: "🎵",
                  type: "Audio",
                  desc: "Transcribed via Gemini / Google STT",
                },
                {
                  icon: "🎬",
                  type: "Video",
                  desc: "Audio extracted -> transcribed + saved",
                },
              ].map(({ icon, type, desc }) => (
                <div
                  key={type}
                  className="bg-surface3 border border-border rounded-xl p-3 text-center"
                >
                  <p className="text-2xl mb-1">{icon}</p>
                  <p className="text-xs font-semibold text-text">{type}</p>
                  <p className="text-[10px] text-muted mt-0.5 leading-relaxed">
                    {desc}
                  </p>
                </div>
              ))}
            </div>

            {/* Errors */}
            {(uploadFile.isError || pdfError) && (
              <div className="mt-3 bg-red-light border border-red/20 text-red rounded-lg px-4 py-2 text-xs">
                {uploadFile.error?.message ?? pdfError}
              </div>
            )}
            {(uploadFile.isSuccess || createDoc.isSuccess) && (
              <div className="mt-3 bg-green-light border border-green/20 text-green rounded-lg px-4 py-2 text-xs">
                ✓ Uploaded successfully
                {uploadFile.isSuccess &&
                  " — transcription running in background"}
              </div>
            )}
          </div>
        </Card>

        {/* -- Transcription history -- */}
        <Card>
          <CardHeader>
            <span className="font-semibold text-sm">Transcription History</span>
            <span className="text-xs text-muted">{data?.total ?? 0} files</span>
          </CardHeader>

          {isLoading ? (
            <div className="flex justify-center py-12">
              <Spinner size={24} />
            </div>
          ) : items.length === 0 ? (
            <Empty
              icon="🎙️"
              title="No transcriptions yet"
              sub="Upload an audio or video file to get started"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    {[
                      "File",
                      "Type",
                      "Status",
                      "Language",
                      "Duration",
                      "Size",
                      "Uploaded",
                      "",
                    ].map((h) => (
                      <th
                        key={h}
                        className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted px-4 py-3 whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((t) => (
                    <tr
                      key={t.id}
                      onClick={() => setSelectedId(t.id)}
                      className="border-b border-border/60 last:border-0 hover:bg-surface2 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3 max-w-[180px]">
                        <p className="text-xs text-text truncate">
                          {t.file_name}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={
                            t.file_name.includes(".")
                              ? t.file_name.split(".").pop()!
                              : "audio"
                          }
                        >
                          {t.file_name.split(".").pop()?.toUpperCase()}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={t.status} />
                      </td>
                      <td className="px-4 py-3 text-xs text-muted2">
                        {t.language ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-muted2">
                        {formatDuration(t.duration_seconds)}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted2">
                        {formatBytes(t.file_size)}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted2 whitespace-nowrap">
                        {formatDate(t.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteItem.mutate(t.id);
                          }}
                          className="w-7 h-7 rounded-lg bg-transparent hover:bg-red-light text-muted hover:text-red flex items-center justify-center text-xs transition-all cursor-pointer border-0"
                          title="Delete"
                        >
                          🗑
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* Detail modal */}
      {selectedId && (
        <TranscriptionModal
          id={selectedId}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
