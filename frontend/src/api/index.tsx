import axios from 'axios'
import type {
  ChatSession, ChatSessionListItem, ChatMessage,
  SendMessagePayload, Document, DocumentListItem,
  DocumentSearchResult, Transcription, TranscriptionListItem,
  PaginatedResponse, HealthResponse,
} from '@/types'

const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
  timeout: 90000,
})

api.interceptors.response.use(
  (r) => r,
  (err) => Promise.reject(new Error(
    err.response?.data?.detail ?? err.message ?? 'Unknown error'
  ))
)

export default api

export const healthApi = {
  check: () => api.get<HealthResponse>('/health').then(r => r.data),
}

export const chatApi = {
  createSession: (payload: { title?: string; system_prompt?: string; model?: string } = {}) =>
    api.post<ChatSession>('/chat/sessions', payload).then(r => r.data),

  listSessions: (page = 1) =>
    api.get<PaginatedResponse<ChatSessionListItem>>('/chat/sessions', { params: { page, page_size: 40 } }).then(r => r.data),

  getSession: (id: string) =>
    api.get<ChatSession>(`/chat/sessions/${id}`).then(r => r.data),

  deleteSession: (id: string) =>
    api.delete(`/chat/sessions/${id}`),

  sendMessage: (sessionId: string, payload: SendMessagePayload) =>
    api.post<{ message: ChatMessage; session: ChatSessionListItem }>(
      `/chat/sessions/${sessionId}/messages`, payload
    ).then(r => r.data),

  getMessages: (sessionId: string) =>
    api.get<ChatMessage[]>(`/chat/sessions/${sessionId}/messages`, { params: { limit: 200 } }).then(r => r.data),
}

export const documentsApi = {
  create: (payload: { title: string; content: string; source_type?: string; metadata?: Record<string, unknown> }) =>
    api.post<Document>('/documents/', payload).then(r => r.data),

  list: (page = 1, sourceType?: string) =>
    api.get<PaginatedResponse<DocumentListItem>>('/documents/', {
      params: { page, page_size: 20, source_type: sourceType }
    }).then(r => r.data),

  get: (id: string) =>
    api.get<Document>(`/documents/${id}`).then(r => r.data),

  delete: (id: string) =>
    api.delete(`/documents/${id}`),

  search: (query: string, limit = 5, sourceTypes?: string[]) =>
    api.post<DocumentSearchResult[]>('/documents/search', {
      query, limit, source_types: sourceTypes,
    }).then(r => r.data),
}

export const transcriptionApi = {
  upload: (file: File, language?: string, saveAsDocument = true) => {
    const form = new FormData()
    form.append('file', file)
    if (language) form.append('language', language)
    form.append('save_as_document', String(saveAsDocument))
    return api.post<Transcription>('/transcription/', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },

  list: (page = 1, statusFilter?: string) =>
    api.get<PaginatedResponse<TranscriptionListItem>>('/transcription/', {
      params: { page, page_size: 20, status_filter: statusFilter }
    }).then(r => r.data),

  get: (id: string) =>
    api.get<Transcription>(`/transcription/${id}`).then(r => r.data),

  delete: (id: string) =>
    api.delete(`/transcription/${id}`),
}