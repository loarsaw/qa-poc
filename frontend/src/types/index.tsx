export type MessageRole = 'user' | 'assistant' | 'system'

export interface ChatMessage {
  id: string
  session_id: string
  role: MessageRole
  content: string
  token_count: number
  model?: string
  finish_reason?: string
  latency_ms?: number
  source_documents: { content: string }[]
  created_at: string
}

export interface ChatSession {
  id: string
  title?: string
  model?: string
  system_prompt?: string
  message_count: number
  created_at: string
  updated_at?: string
  messages: ChatMessage[]
}

export interface ChatSessionListItem {
  id: string
  title?: string
  model?: string
  message_count: number
  created_at: string
  updated_at?: string
}

export interface SendMessagePayload {
  content: string
  use_rag?: boolean
  document_ids?: string[]
}

export interface Document {
  id: string
  title: string
  content: string
  source_type: string
  file_name?: string
  file_size?: number
  mime_type?: string
  metadata?: Record<string, unknown>
  chunk_count: number
  created_at: string
  updated_at?: string
}

export interface DocumentListItem {
  id: string
  title: string
  source_type: string
  file_name?: string
  file_size?: number
  chunk_count: number
  created_at: string
}

export interface DocumentSearchResult {
  document_id: string
  title: string
  source_type: string
  relevance_score: number
  matched_chunk?: string
}

export type TranscriptionStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface TranscriptionSegment {
  id: number
  start: number
  end: number
  text: string
}

export interface Transcription {
  id: string
  document_id?: string
  file_name: string
  file_size?: number
  mime_type?: string
  status: TranscriptionStatus
  transcript_text?: string
  language?: string
  duration_seconds?: number
  segments: TranscriptionSegment[]
  error_message?: string
  whisper_model?: string
  created_at: string
  updated_at?: string
}

export interface TranscriptionListItem {
  id: string
  document_id?: string
  file_name: string
  file_size?: number
  status: TranscriptionStatus
  language?: string
  duration_seconds?: number
  created_at: string
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  page_size: number
  pages: number
}

export interface HealthResponse {
  status: string
  version: string
  database: string
}

// Summary generated from content
export interface ContentSummary {
  title: string
  summary: string
  key_topics: string[]
  word_count: number
  source_type: string
}