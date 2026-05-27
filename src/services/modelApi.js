// 模块说明：模型列表接口服务，负责读取可用模型与默认模型。
import { useAuthStore } from '@/stores/authStore'

const API_MODELS_URL = import.meta.env.VITE_MODELS_API_URL || '/api/models'
const API_CUSTOM_MODELS_URL = '/api/models/custom'
const API_EMBEDDING_MODELS_URL = '/api/models/embedding'
const API_EMBEDDING_SOURCE_URL = '/api/models/embedding/source'

function getAuthHeaders() {
  const token = useAuthStore.getState().token
  return token
    ? {
        Authorization: `Bearer ${token}`,
      }
    : undefined
}

function handleUnauthorized(response) {
  if (response.status !== 401) return false
  useAuthStore.getState().clearAuth?.()
  return true
}

export async function fetchAvailableModels() {
  // 获取当前账号可用模型，供输入区模型下拉框使用。
  const response = await fetch(API_MODELS_URL, {
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
    if (handleUnauthorized(response)) {
      throw new Error('登录已失效，请重新登录')
    }
    throw new Error('读取模型列表失败')
  }

  const data = await response.json()
  return {
    models: Array.isArray(data?.models) ? data.models : [],
    defaultModel: String(data?.defaultModel || '').trim(),
  }
}

export async function fetchCustomModels() {
  const response = await fetch(API_CUSTOM_MODELS_URL, {
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
    throw new Error('读取自定义模型失败')
  }

  const data = await response.json()
  return Array.isArray(data?.models) ? data.models : []
}

export async function createCustomModel({ modelName, apiKey, endpoint }) {
  const response = await fetch(API_CUSTOM_MODELS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(getAuthHeaders() || {}),
    },
    body: JSON.stringify({ modelName, apiKey, endpoint }),
  })

  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new Error(data?.message || '保存自定义模型失败')
  }

  const data = await response.json()
  return data?.model || null
}

export async function deleteCustomModel(modelName = '') {
  const safeName = encodeURIComponent(String(modelName || '').trim())
  if (!safeName) {
    throw new Error('模型名称不能为空')
  }

  const response = await fetch(`${API_CUSTOM_MODELS_URL}/${safeName}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new Error(data?.message || '删除自定义模型失败')
  }
}

// ========== 自定义嵌入模型 API ==========

export async function fetchCustomEmbeddingModels() {
  const response = await fetch(API_EMBEDDING_MODELS_URL, {
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
    throw new Error('读取自定义嵌入模型失败')
  }

  const data = await response.json()
  return Array.isArray(data?.models) ? data.models : []
}

export async function createCustomEmbeddingModel({ modelName, apiKey, endpoint }) {
  const response = await fetch(API_EMBEDDING_MODELS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(getAuthHeaders() || {}),
    },
    body: JSON.stringify({ modelName, apiKey, endpoint }),
  })

  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new Error(data?.message || '保存自定义嵌入模型失败')
  }

  const data = await response.json()
  return data?.model || null
}

export async function deleteCustomEmbeddingModel(modelName = '') {
  const safeName = encodeURIComponent(String(modelName || '').trim())
  if (!safeName) {
    throw new Error('模型名称不能为空')
  }

  const response = await fetch(`${API_EMBEDDING_MODELS_URL}/${safeName}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new Error(data?.message || '删除自定义嵌入模型失败')
  }
}

export async function setDefaultEmbeddingModel(modelName = '') {
  const safeName = encodeURIComponent(String(modelName || '').trim())
  if (!safeName) {
    throw new Error('模型名称不能为空')
  }

  const response = await fetch(`${API_EMBEDDING_MODELS_URL}/${safeName}/default`, {
    method: 'PUT',
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new Error(data?.message || '设置默认嵌入模型失败')
  }
}

export async function fetchEmbeddingModelSource() {
  const response = await fetch(API_EMBEDDING_SOURCE_URL, {
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new Error(data?.message || '读取嵌入模型来源失败')
  }

  const data = await response.json()
  return {
    selectedSource: String(data?.selectedSource || 'auto'),
    effectiveSource: String(data?.effectiveSource || 'global'),
    globalConfigured: Boolean(data?.globalConfigured),
    hasCustomModels: Boolean(data?.hasCustomModels),
  }
}

export async function updateEmbeddingModelSource(source = 'auto') {
  const response = await fetch(API_EMBEDDING_SOURCE_URL, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(getAuthHeaders() || {}),
    },
    body: JSON.stringify({ source: String(source || 'auto') }),
  })

  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new Error(data?.message || '更新嵌入模型来源失败')
  }

  const data = await response.json()
  return {
    selectedSource: String(data?.selectedSource || 'auto'),
    effectiveSource: String(data?.effectiveSource || 'global'),
    configured: Boolean(data?.configured),
    model: String(data?.model || ''),
  }
}
