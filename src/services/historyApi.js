// 模块说明：历史快照接口服务，负责读取与保存当前用户会话历史。
import { useAuthStore } from '@/stores/authStore'

const API_HISTORY_URL = import.meta.env.VITE_HISTORY_API_URL || '/api/history'

function buildAuthHeaders() {
  // 统一拼装鉴权头，避免每个请求重复读取 token。
  const token = useAuthStore.getState().token
  return token
    ? {
        Authorization: `Bearer ${token}`,
      }
    : {}
}

function handleUnauthorized(response) {
  if (response.status !== 401) return false
  useAuthStore.getState().clearAuth?.()
  return true
}

export async function fetchHistorySnapshot() {
  // 从后端加载历史快照并做基础结构兜底。
  const response = await fetch(API_HISTORY_URL, {
    method: 'GET',
    headers: {
      ...buildAuthHeaders(),
    },
  })

  if (!response.ok) {
    if (handleUnauthorized(response)) {
      throw new Error('登录已失效，请重新登录')
    }
    throw new Error('读取历史记录失败')
  }

  const data = await response.json()
  return {
    conversations: Array.isArray(data?.conversations) ? data.conversations : [],
    currentConversationId: data?.currentConversationId || null,
    messagesByConversation: data?.messagesByConversation && typeof data.messagesByConversation === 'object'
      ? data.messagesByConversation
      : {},
  }
}

export async function saveHistorySnapshot(snapshot) {
  // 持久化本地历史快照到后端。
  const response = await fetch(API_HISTORY_URL, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...buildAuthHeaders(),
    },
    body: JSON.stringify(snapshot || {}),
  })

  if (!response.ok) {
    if (handleUnauthorized(response)) {
      throw new Error('登录已失效，请重新登录')
    }
    throw new Error('保存历史记录失败')
  }
}
