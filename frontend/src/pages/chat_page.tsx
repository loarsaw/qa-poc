import { useState, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { useQueryClient } from '@tanstack/react-query'
import {
  useSession, useMessages, useSendMessage,
  useCreateSession, useDocuments,
} from '@/hooks'
import { chatApi } from '@/api'
import { formatDate, cn } from '@/lib/utils'
import { Spinner, Badge } from '@/components/ui'

export default function ChatPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate      = useNavigate()
  const queryClient   = useQueryClient()

  const [input,         setInput]         = useState('')
  const [useRag,        setUseRag]        = useState(false)
  const [docPickerOpen, setDocPickerOpen] = useState(false)
  const [selectedDocs,  setSelectedDocs]  = useState<string[]>([])
  const [isSending,     setIsSending]     = useState(false)
  const [sendError,     setSendError]     = useState<string | null>(null)

  const bottomRef   = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const { data: session }                          = useSession(sessionId ?? '')
  const { data: messages = [], isLoading: msgsLoading } = useMessages(sessionId ?? '')
  const { data: docsData }                         = useDocuments(1)
  const createSession                              = useCreateSession()
  const sendMessage                                = useSendMessage(sessionId ?? '')

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 180) + 'px'
  }, [input])

  async function handleSend() {
    const content = input.trim()
    if (!content || isSending) return

    setIsSending(true)
    setSendError(null)
    setInput('')

    try {
      if (!sessionId) {
        const newSession = await createSession.mutateAsync({})
        const sid = newSession.id

        navigate(`/chat/${sid}`, { replace: true })

        await chatApi.sendMessage(sid, {
          content,
          use_rag: useRag,
          document_ids: selectedDocs.length ? selectedDocs : undefined,
        })

        queryClient.invalidateQueries({ queryKey: ['messages', sid] })
        queryClient.invalidateQueries({ queryKey: ['sessions'] })
      } else {
        await sendMessage.mutateAsync({
          content,
          use_rag: useRag,
          document_ids: selectedDocs.length ? selectedDocs : undefined,
        })
      }
    } catch (e: unknown) {
      setSendError(e instanceof Error ? e.message : 'Failed to send message')
    } finally {
      setIsSending(false)
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  function toggleDoc(id: string) {
    setSelectedDocs(prev => prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id])
  }

  const allDocs = docsData?.items ?? []
  const isEmpty = !sessionId || (!msgsLoading && messages.length === 0)
  const pending = isSending || sendMessage.isPending

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* -- Header -- */}
      <div className="flex items-center gap-3 px-6 h-14 border-b border-border bg-surface flex-shrink-0">
        <h1 className="font-semibold text-sm text-text">
          {session?.title ?? (sessionId ? 'Chat' : 'New Chat')}
        </h1>
        {session && (
          <span className="text-xs text-muted">
            {session.message_count} messages · {session.model ?? 'gemini-3.1-flash-lite-preview'}
          </span>
        )}
      </div>

      {/* -- Messages -- */}
      <div className="flex-1 overflow-y-auto px-6 py-6 flex flex-col gap-5">
        {isEmpty ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center">
            <div className="w-16 h-16 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center text-3xl">✦</div>
            <div>
              <p className="font-semibold text-base text-text">Ask anything</p>
              <p className="text-xs text-muted mt-1 max-w-xs">
                Enable RAG to ground answers in your uploaded documents and transcripts.
              </p>
            </div>
            <div className="flex gap-2 flex-wrap justify-center mt-2">
              {['Summarize my documents', 'What topics were discussed?', 'Find key timestamps'].map(q => (
                <button
                  key={q}
                  onClick={() => setInput(q)}
                  className="text-xs px-3 py-1.5 rounded-full border border-border hover:border-accent/50 hover:text-accent text-muted2 transition-all cursor-pointer bg-transparent"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map(msg => (
            <div key={msg.id} className={cn('flex gap-3 animate-fade-up', msg.role === 'user' && 'flex-row-reverse')}>
              <div className={cn(
                'w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold',
                msg.role === 'user' ? 'bg-accent text-white' : 'bg-surface3 border border-border text-muted2',
              )}>
                {msg.role === 'user' ? 'U' : '✦'}
              </div>

              <div className={cn('flex flex-col gap-1 max-w-[72%]', msg.role === 'user' && 'items-end')}>
                <div className={cn(
                  'px-4 py-3 rounded-2xl text-sm leading-relaxed',
                  msg.role === 'user'
                    ? 'bg-accent text-white rounded-br-sm'
                    : 'bg-surface2 border border-border text-text rounded-bl-sm',
                )}>
                  {msg.role === 'assistant' ? (
                    <div className="prose prose-invert prose-sm max-w-none
                      prose-p:my-1 prose-pre:bg-bg prose-pre:border prose-pre:border-border
                      prose-code:text-accent prose-code:bg-bg prose-code:px-1 prose-code:rounded
                      prose-a:text-accent">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : msg.content}

                  {msg.source_documents?.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-white/20">
                      <p className="text-[10px] uppercase tracking-wider opacity-70 mb-1.5">📎 Sources</p>
                      {msg.source_documents.map((d, i) => (
                        <div key={i} className="text-[11px] bg-black/20 rounded px-2 py-1 mt-1 border-l-2 border-white/30 opacity-80">
                          {d.content}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex gap-2 text-[10px] text-muted px-1">
                  <span>{formatDate(msg.created_at)}</span>
                  {msg.token_count > 0 && <span>{msg.token_count} tok</span>}
                  {msg.latency_ms   && <span>{msg.latency_ms}ms</span>}
                </div>
              </div>
            </div>
          ))
        )}

        {/* Thinking indicator */}
        {pending && (
          <div className="flex gap-3 animate-fade-up">
            <div className="w-8 h-8 rounded-full bg-surface3 border border-border flex items-center justify-center text-xs text-muted2">✦</div>
            <div className="bg-surface2 border border-border rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-2">
              <Spinner size={14} />
              <span className="text-xs text-muted">Thinking…</span>
            </div>
          </div>
        )}

        {sendError && (
          <div className="bg-red-light border border-red/20 text-red text-xs rounded-lg px-4 py-2">
            {sendError}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* -- RAG doc picker -- */}
      {docPickerOpen && allDocs.length > 0 && (
        <div className="mx-6 mb-2 bg-surface2 border border-border rounded-xl p-3 flex flex-col gap-2 max-h-48 overflow-y-auto">
          <p className="text-[10px] uppercase tracking-wider text-muted font-semibold">
            Select documents to ground answers
          </p>
          {allDocs.map(doc => (
            <label key={doc.id} className="flex items-center gap-2.5 cursor-pointer group">
              <input
                type="checkbox"
                checked={selectedDocs.includes(doc.id)}
                onChange={() => toggleDoc(doc.id)}
                className="w-3.5 h-3.5 rounded accent-accent"
              />
              <span className="text-xs text-text group-hover:text-accent transition-colors truncate">
                {doc.title}
              </span>
              <Badge variant={doc.source_type} className="ml-auto flex-shrink-0">{doc.source_type}</Badge>
            </label>
          ))}
        </div>
      )}

      {/* -- Input bar -- */}
      <div className="flex-shrink-0 px-6 pb-5 pt-3 bg-surface border-t border-border">
        <div className="flex gap-3 items-end">
          <div className="flex-1 bg-surface2 border border-border focus-within:border-accent/60 rounded-2xl transition-all overflow-hidden">
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Message… (Enter to send, Shift+Enter for newline)"
              className="w-full bg-transparent resize-none px-4 pt-3 pb-2 text-sm text-text placeholder-muted outline-none font-sans"
            />
            <div className="flex items-center gap-3 px-4 pb-2.5">
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <div
                  onClick={() => setUseRag(v => !v)}
                  className={cn(
                    'w-7 h-4 rounded-full transition-all relative cursor-pointer',
                    useRag ? 'bg-accent' : 'bg-border2',
                  )}
                >
                  <div className={cn(
                    'absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all',
                    useRag ? 'left-3.5' : 'left-0.5',
                  )} />
                </div>
                <span className="text-[11px] text-muted2">Use docs (RAG)</span>
              </label>

              {useRag && (
                <button
                  onClick={() => setDocPickerOpen(v => !v)}
                  className={cn(
                    'text-[11px] px-2 py-0.5 rounded border transition-all cursor-pointer bg-transparent',
                    docPickerOpen
                      ? 'border-accent text-accent'
                      : 'border-border text-muted2 hover:border-accent/50',
                  )}
                >
                  {selectedDocs.length ? `${selectedDocs.length} selected` : 'Pick docs'}
                </button>
              )}
            </div>
          </div>

          <button
            onClick={handleSend}
            disabled={!input.trim() || pending}
            className="w-11 h-11 rounded-full bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-white flex items-center justify-center text-lg transition-all cursor-pointer border-0 flex-shrink-0"
          >
            {pending ? <Spinner size={16} /> : '↑'}
          </button>
        </div>
      </div>
    </div>
  )
}