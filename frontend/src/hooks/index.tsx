import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { chatApi, documentsApi, transcriptionApi, healthApi } from '@/api'

export function useHealth() {
  return useQuery({ queryKey: ['health'], queryFn: healthApi.check, refetchInterval: 30000 })
}

export function useSessions() {
  return useQuery({ queryKey: ['sessions'], queryFn: () => chatApi.listSessions() })
}

export function useSession(id: string) {
  return useQuery({
    queryKey: ['session', id],
    queryFn: () => chatApi.getSession(id),
    enabled: !!id,
  })
}

export function useMessages(sessionId: string) {
  return useQuery({
    queryKey: ['messages', sessionId],
    queryFn: () => chatApi.getMessages(sessionId),
    enabled: !!sessionId,
  })
}

export function useCreateSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: chatApi.createSession,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  })
}

export function useDeleteSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: chatApi.deleteSession,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  })
}

export function useSendMessage(sessionId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: Parameters<typeof chatApi.sendMessage>[1]) =>
      chatApi.sendMessage(sessionId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messages', sessionId] })
      qc.invalidateQueries({ queryKey: ['sessions'] })
    },
  })
}

export function useDocuments(page = 1, sourceType?: string) {
  return useQuery({
    queryKey: ['documents', page, sourceType],
    queryFn: () => documentsApi.list(page, sourceType),
  })
}

export function useDocument(id: string) {
  return useQuery({
    queryKey: ['document', id],
    queryFn: () => documentsApi.get(id),
    enabled: !!id,
  })
}

export function useCreateDocument() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: documentsApi.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents'] }),
  })
}

export function useDeleteDocument() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: documentsApi.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents'] }),
  })
}

export function useSearchDocuments() {
  return useMutation({
    mutationFn: ({ query, limit, sourceTypes }: { query: string; limit?: number; sourceTypes?: string[] }) =>
      documentsApi.search(query, limit, sourceTypes),
  })
}

export function useTranscriptions(page = 1) {
  return useQuery({
    queryKey: ['transcriptions', page],
    queryFn: () => transcriptionApi.list(page),
    refetchInterval: (q) => {
      const busy = (q.state.data?.items ?? []).some(
        t => t.status === 'pending' || t.status === 'processing'
      )
      return busy ? 3000 : false
    },
  })
}

export function useTranscription(id: string) {
  return useQuery({
    queryKey: ['transcription', id],
    queryFn: () => transcriptionApi.get(id),
    enabled: !!id,
    refetchInterval: (q) => {
      const s = q.state.data?.status
      return s === 'pending' || s === 'processing' ? 2000 : false
    },
  })
}

export function useUploadFile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ file, language }: { file: File; language?: string }) =>
      transcriptionApi.upload(file, language, true),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transcriptions'] })
      qc.invalidateQueries({ queryKey: ['documents'] })
    },
  })
}

export function useDeleteTranscription() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: transcriptionApi.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transcriptions'] }),
  })
}