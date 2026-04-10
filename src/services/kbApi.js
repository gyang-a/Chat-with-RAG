// 模块说明：知识库接口服务，封装文档列表、上传、重建与删除操作。
import { useAuthStore } from '@/stores/authStore'

const API_KB_DOCS_URL = import.meta.env.VITE_KB_DOCS_API_URL || '/api/kb/docs'
const API_KB_UPLOAD_URL = import.meta.env.VITE_KB_UPLOAD_API_URL || '/api/kb/upload'

function buildAuthHeaders() {
  // 统一拼装鉴权头，避免各接口重复代码。
  const token = useAuthStore.getState().token
  return token
    ? {
        Authorization: `Bearer ${token}`,
      }
    : {}
}

function handleUnauthorized(response) {
  // 401 统一处理：清理登录态并提示重新登录。
  if (response.status === 401) {
    useAuthStore.getState().logout().catch(() => null)
    throw new Error('登录已失效，请重新登录')
  }
}

async function parseApiErrorMessage(response, fallbackMessage) {
  // 优先读取 JSON message，失败时回退到文本或默认提示。
  const statusText = response?.status ? `(${response.status})` : ''

  try {
    const data = await response.json()
    const message = String(data?.message || '').trim()
    if (message) return `${message}${statusText}`
  } catch {
    // 非 JSON 响应（如 HTML 404）走文本兜底。
  }

  try {
    const text = String(await response.text()).trim()
    if (text) {
      if (text.startsWith('<!DOCTYPE') || text.startsWith('<html')) {
        return `${fallbackMessage}${statusText}`
      }
      return `${text}${statusText}`
    }
  } catch {
    // 文本读取失败时使用兜底信息。
  }

  return `${fallbackMessage}${statusText}`
}

export async function fetchKbDocuments() {
  // 读取知识库文档列表。
  const response = await fetch(API_KB_DOCS_URL, {
    method: 'GET',
    headers: {
      ...buildAuthHeaders(),
    },
  })

  if (!response.ok) {
    handleUnauthorized(response)
    throw new Error(await parseApiErrorMessage(response, '读取知识库文档失败'))
  }

  const data = await response.json()
  return Array.isArray(data?.docs) ? data.docs : []
}

export async function reindexKbDocument(docId) {
  // 触发单文档重建索引。
  const safeDocId = encodeURIComponent(String(docId || '').trim())
  const response = await fetch(`${API_KB_DOCS_URL}/${safeDocId}/reindex`, {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(),
    },
  })

  if (!response.ok) {
    handleUnauthorized(response)
    throw new Error(await parseApiErrorMessage(response, '重建索引失败'))
  }

  return response.json()
}

export async function deleteKbDocument(docId) {
  // 删除单个知识库文档。
  const safeDocId = encodeURIComponent(String(docId || '').trim())
  const response = await fetch(`${API_KB_DOCS_URL}/${safeDocId}`, {
    method: 'DELETE',
    headers: {
      ...buildAuthHeaders(),
    },
  })

  if (!response.ok) {
    handleUnauthorized(response)
    throw new Error(await parseApiErrorMessage(response, '删除文档失败'))
  }

  return response.json()
}

export async function clearFailedKbDocuments() {
  // 批量清理解析失败文档。
  const response = await fetch(`${API_KB_DOCS_URL}?status=failed`, {
    method: 'DELETE',
    headers: {
      ...buildAuthHeaders(),
    },
  })

  if (!response.ok) {
    handleUnauthorized(response)
    throw new Error(await parseApiErrorMessage(response, '清理失败文档失败'))
  }

  return response.json()
}

export async function uploadKbDocument(file) {
  // 上传知识库文档，后端会异步解析并入索引。
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch(API_KB_UPLOAD_URL, {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(),
    },
    body: formData,
  })

  if (!response.ok) {
    handleUnauthorized(response)
    throw new Error(await parseApiErrorMessage(response, '知识库文档上传失败'))
  }

  // 上传成功时返回 file 信息，供面板刷新与状态提示使用。
  return response.json()
}
