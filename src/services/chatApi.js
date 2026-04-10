// 模块说明：聊天流式接口服务，负责发起请求并解析 SSE 事件流。
import { useAuthStore } from '@/stores/authStore'

const API_CHAT_URL = import.meta.env.VITE_CHAT_API_URL || '/api/chat/stream'

function parseSSEChunk(chunkText = '') {
  // 将 SSE 原始块按 data 行拆分，输出纯事件文本列表。
  return chunkText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.replace(/^data:\s?/, ''))
}

// SSE 接口预留：后端可按 data: { delta, done, refs, contextDocs } 映射
export async function streamChat({
  conversationId,
  message,
  model = '',
  attachments = [],
  retrievalMode = 'hybrid',
  signal,
  onEvent,
  onError,
}) {
  // 向后端发起流式聊天请求，逐段回调 onEvent 给上层拼接内容。
  const token = useAuthStore.getState().token
  const response = await fetch(API_CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      conversationId,
      message,
      model,
      attachments,
      retrievalMode,
    }),
    signal,
  })

  if (!response.ok || !response.body) {
    let messageText = '聊天服务暂不可用'
    if (response.status === 401) {
      useAuthStore.getState().logout().catch(() => null)
      messageText = '登录已失效，请重新登录'
    } else {
      try {
        const data = await response.json()
        messageText = data?.message || messageText
      } catch {
        messageText = messageText || '聊天服务暂不可用'
      }
    }
    throw new Error(messageText)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split('\n\n')
      buffer = parts.pop() || ''

      for (const part of parts) {
        const events = parseSSEChunk(part)
        for (const eventText of events) {
          if (eventText === '[DONE]') {
            onEvent?.({ done: true })
            continue
          }

          try {
            const payload = JSON.parse(eventText)
            onEvent?.(payload)
          } catch {
            onEvent?.({ delta: eventText })
          }
        }
      }
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      onError?.(error)
      throw error
    }
  } finally {
    reader.releaseLock()
  }
}
