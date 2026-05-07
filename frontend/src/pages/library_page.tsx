import { useState } from "react";
import {
  useDocuments,
  useDocument,
  useDeleteDocument,
  useSearchDocuments,
  useCreateDocument,
} from "@/hooks";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Spinner,
  Empty,
  Modal,
} from "@/components/ui";
import { formatBytes, formatDate, sourceIcon, truncate, cn } from "@/lib/utils";
import type { DocumentListItem } from "@/types";

function DocumentModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isLoading } = useDocument(id);
  const [summary, setSummary] = useState<string | null>(null);
  const [topics, setTopics] = useState<string[]>([]);
  const [summLoading, setSummLoading] = useState(false);
  const [summDone, setSummDone] = useState(false);
  const createDoc = useCreateDocument();

  async function generateSummary() {
    if (!data) return;
    setSummLoading(true);
    try {
      const { chatApi } = await import("@/api");
      const session = await chatApi.createSession({
        system_prompt:
          "You are a summarisation assistant. Respond ONLY with valid JSON (no markdown fences) " +
          'with keys: "summary" (2-3 sentences) and "key_topics" (array of 4-6 strings).',
      });
      const resp = await chatApi.sendMessage(session.id, {
        content: `Summarise:\n\n${data.content.slice(0, 6000)}`,
      });
      let parsed: { summary?: string; key_topics?: string[] } = {};
      try {
        parsed = JSON.parse(resp.message.content);
      } catch {
        /* fallback */
      }
      setSummary(parsed.summary ?? resp.message.content);
      setTopics(parsed.key_topics ?? []);
      setSummDone(true);
    } catch (e: unknown) {
      setSummary("Failed: " + (e instanceof Error ? e.message : ""));
      setSummDone(true);
    } finally {
      setSummLoading(false);
    }
  }

  if (isLoading || !data) {
    return (
      <Modal
        onClose={onClose}
        className="items-center justify-center min-h-[180px]"
      >
        <Spinner size={28} />
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose} className="max-w-2xl bg-white">
      {/* Title */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-base">{data.title}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Badge variant={data.source_type}>{data.source_type}</Badge>
            <span className="text-xs text-muted">
              {data.chunk_count} chunks
            </span>
            {data.file_size && (
              <span className="text-xs text-muted">
                {formatBytes(data.file_size)}
              </span>
            )}
            <span className="text-xs text-muted">
              {formatDate(data.created_at)}
            </span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-muted hover:text-text text-lg leading-none cursor-pointer bg-transparent border-0"
        >
          ✕
        </button>
      </div>

      {/* Content preview */}
      <div>
        <p className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-2">
          Content
        </p>
        <div className="bg-surface3 border border-border rounded-xl px-4 py-3 max-h-52 overflow-y-auto text-sm leading-relaxed text-text whitespace-pre-wrap">
          {data.content}
        </div>
      </div>

      {/* AI Summary */}
      <div className="bg-surface3 border border-border rounded-xl p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold text-muted2 uppercase tracking-wider">
            ✨ AI Summary
          </p>
          {!summDone && (
            <Button
              variant="subtle"
              className="text-xs py-1 px-3 h-auto"
              onClick={generateSummary}
              disabled={summLoading}
            >
              {summLoading ? (
                <>
                  <Spinner size={12} /> Generating…
                </>
              ) : (
                "Generate"
              )}
            </Button>
          )}
          {summDone && summary && (
            <Button
              variant="ghost"
              className="text-xs py-1 px-3 h-auto"
              onClick={async () => {
                await createDoc.mutateAsync({
                  title: `Summary: ${data.title}`,
                  content:
                    summary +
                    (topics.length
                      ? "\n\nKey topics: " + topics.join(", ")
                      : ""),
                  source_type: "text",
                });
              }}
              disabled={createDoc.isPending}
            >
              {createDoc.isPending ? <Spinner size={12} /> : "💾 Save summary"}
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

        {!summDone && !summLoading && (
          <p className="text-xs text-muted">
            Click Generate to summarise this document with Gemini.
          </p>
        )}
      </div>
    </Modal>
  );
}

function AddDocModal({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const createDoc = useCreateDocument();

  async function handleSave() {
    if (!title.trim() || !content.trim()) return;
    await createDoc.mutateAsync({ title, content, source_type: "text" });
    onClose();
  }

  return (
    <Modal onClose={onClose}>
      <p className="font-semibold text-base">📄 Add Text Document</p>

      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] text-muted2 uppercase tracking-wider font-semibold">
          Title
        </label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Document title"
          className="bg-surface3 border border-border rounded-lg px-3 py-2 text-sm text-text placeholder-muted outline-none focus:border-accent/60"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] text-muted2 uppercase tracking-wider font-semibold">
          Content
        </label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Paste or type your document content…"
          rows={8}
          className="bg-surface3 border border-border rounded-lg px-3 py-2 text-sm text-text placeholder-muted outline-none focus:border-accent/60 resize-y"
        />
      </div>

      {createDoc.isError && (
        <div className="bg-red-light border border-red/20 text-red rounded-lg px-4 py-2 text-xs">
          {createDoc.error?.message}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          disabled={!title.trim() || !content.trim() || createDoc.isPending}
        >
          {createDoc.isPending ? <Spinner size={14} /> : "Save Document"}
        </Button>
      </div>
    </Modal>
  );
}

export default function LibraryPage() {
  const [page, setPage] = useState(1);
  const [sourceType, setSourceType] = useState<string | undefined>();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const { data, isLoading } = useDocuments(page, sourceType);
  const deleteDoc = useDeleteDocument();
  const searchDocs = useSearchDocuments();

  const items: DocumentListItem[] = data?.items ?? [];

  async function handleSearch() {
    if (!searchQuery.trim()) return;
    await searchDocs.mutateAsync({ query: searchQuery, limit: 10 });
  }

  const searchResults = searchDocs.data;
  const showSearch = searchResults != null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* -- Header -- */}
      <div className="flex items-center gap-3 px-6 h-14 border-b border-border bg-surface flex-shrink-0">
        <h1 className="font-semibold text-sm">Library</h1>
        <span className="text-xs text-muted">{data?.total ?? 0} documents</span>
        <div className="ml-auto">
          <Button
            onClick={() => setShowAdd(true)}
            className="text-xs py-1.5 px-3 h-auto"
          >
            + Add Document
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6 flex flex-col gap-5">
        {/* -- Search -- */}
        <Card>
          <CardHeader>
            <span className="font-semibold text-sm">🔍 Semantic Search</span>
          </CardHeader>
          <div className="px-5 py-4 flex flex-col gap-3">
            <div className="flex gap-2">
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="Search across all documents…"
                className="flex-1 bg-surface3 border border-border rounded-lg px-3 py-2 text-sm text-text placeholder-muted outline-none focus:border-accent/60"
              />
              <Button
                onClick={handleSearch}
                disabled={!searchQuery.trim() || searchDocs.isPending}
                className="py-2 px-4 h-auto text-sm"
              >
                {searchDocs.isPending ? <Spinner size={14} /> : "Search"}
              </Button>
              {showSearch && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    searchDocs.reset();
                    setSearchQuery("");
                  }}
                  className="py-2 px-3 h-auto text-sm"
                >
                  Clear
                </Button>
              )}
            </div>

            {/* Search results */}
            {showSearch && (
              <div className="flex flex-col gap-2">
                {searchResults.length === 0 ? (
                  <p className="text-xs text-muted py-2">No results found.</p>
                ) : (
                  searchResults.map((r) => (
                    <div
                      key={r.document_id}
                      onClick={() => setSelectedId(r.document_id)}
                      className="flex flex-col gap-1 bg-surface3 border border-border hover:border-accent/40 rounded-xl px-4 py-3 cursor-pointer transition-all"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-text">
                          {r.title}
                        </span>
                        <span className="text-[11px] text-green font-semibold flex-shrink-0">
                          {(r.relevance_score * 100).toFixed(0)}% match
                        </span>
                      </div>
                      {r.matched_chunk && (
                        <p className="text-xs text-muted2 leading-relaxed">
                          {truncate(r.matched_chunk, 200)}
                        </p>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </Card>

        {/* -- Document list -- */}
        <Card>
          <CardHeader>
            <span className="font-semibold text-sm">All Documents</span>
            <div className="flex items-center gap-2">
              <select
                value={sourceType ?? ""}
                onChange={(e) => {
                  setSourceType(e.target.value || undefined);
                  setPage(1);
                }}
                className="bg-surface3 border border-border rounded-lg px-2 py-1.5 text-xs text-text outline-none focus:border-accent/60"
              >
                <option value="">All types</option>
                <option value="text">Text</option>
                <option value="audio">Audio</option>
                <option value="video">Video</option>
                <option value="pdf">PDF</option>
              </select>
            </div>
          </CardHeader>

          {isLoading ? (
            <div className="flex justify-center py-12">
              <Spinner size={24} />
            </div>
          ) : items.length === 0 ? (
            <Empty
              icon="📚"
              title="No documents yet"
              sub="Add a text document or upload a PDF / audio / video file"
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      {["Title", "Type", "Chunks", "Size", "Uploaded", ""].map(
                        (h) => (
                          <th
                            key={h}
                            className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted px-4 py-3 whitespace-nowrap"
                          >
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((doc) => (
                      <tr
                        key={doc.id}
                        onClick={() => setSelectedId(doc.id)}
                        className="border-b border-border/60 last:border-0 hover:bg-surface2 cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-3 max-w-[220px]">
                          <div className="flex items-center gap-2">
                            <span className="text-base flex-shrink-0">
                              {sourceIcon(doc.source_type)}
                            </span>
                            <span className="text-xs text-text truncate">
                              {doc.title}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={doc.source_type}>
                            {doc.source_type}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted2">
                          {doc.chunk_count}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted2">
                          {formatBytes(doc.file_size)}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted2 whitespace-nowrap">
                          {formatDate(doc.created_at)}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteDoc.mutate(doc.id);
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

              {/* Pagination */}
              {(data?.pages ?? 1) > 1 && (
                <div className="flex items-center justify-center gap-3 py-4 border-t border-border">
                  <Button
                    variant="ghost"
                    className="text-xs py-1 px-3 h-auto"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                  >
                    ← Prev
                  </Button>
                  <span className="text-xs text-muted">
                    Page {page} of {data?.pages}
                  </span>
                  <Button
                    variant="ghost"
                    className="text-xs py-1 px-3 h-auto"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={page >= (data?.pages ?? 1)}
                  >
                    Next 
                  </Button>
                </div>
              )}
            </>
          )}
        </Card>
      </div>

      {selectedId && (
        <DocumentModal id={selectedId} onClose={() => setSelectedId(null)} />
      )}
      {showAdd && <AddDocModal onClose={() => setShowAdd(false)} />}
    </div>
  );
}
