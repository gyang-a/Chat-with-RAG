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
  conversationId,// 会话ID，用于后端关联上下文
  message,// 用户发送的消息
  model = '',
  attachments = [],// 附件列表
  recentMessages = [],// 最近消息历史（用于上下文）
  retrievalMode = 'hybrid',
  ragTopK,
  signal,//AbortSignal，用于取消请求
  onEvent,// 收到 SSE 事件时的回调
  onError, // 错误回调
}) {
  const safeTopK = Math.min(20, Math.max(1, Number(ragTopK) || 4))

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
      recentMessages,
      retrievalMode,
      ragTopK: safeTopK,
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
// 解析 SSE 流式响应，逐块触发 onEvent 回调，直到流结束或发生错误。
  const reader = response.body.getReader()
  // SSE 事件块格式示例：
  // data: {"delta":"Hello"}
  // data: {"delta":" world!"}
  // data: [DONE]
  const decoder = new TextDecoder('utf-8')//解码器，用于将二进制流转换为文本
  let buffer = ''//缓冲区，用于存储未完整解析的 SSE 块文本

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      //后端什么时候结束流？
      //AI 回答全部生成完毕
      //后端发了最后一段 data: [DONE]
      //后端关闭 HTTP 连接
      //→ 这时前端才会收到 done: true

      buffer += decoder.decode(value, { stream: true })
      //{stream: true} = 保留未解码完的字节，防止中文乱码
      //split('\n\n') → [完整,完整,半截]
      const parts = buffer.split('\n\n')
     //parts.pop()   → 拿走【半截】放回 buffer
      buffer = parts.pop() || ''

      for (const part of parts) {
        const events = parseSSEChunk(part)// 解析 SSE 块，触发事件回调，只保留纯文本内容，去掉 data: 前缀。
        for (const eventText of events) {
          if (eventText === '[DONE]') {
            onEvent?.({ done: true })
            continue//后端发了最后一段 data: [DONE]，通知上层流结束，但不立即 break，允许上层处理完后续逻辑再结束循环。
          }

          try {
            const payload = JSON.parse(eventText)//将JSON格式的事件文本转换为对象，触发事件回调，传递解析后的数据结构，方便上层直接使用。
            onEvent?.(payload)//
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
    reader.releaseLock()// 释放资源，确保连接关闭后不再占用内存。
  }
}
