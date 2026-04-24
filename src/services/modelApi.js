// 模块说明：模型列表接口服务，负责读取可用模型与默认模型。
import { useAuthStore } from '@/stores/authStore'

const API_MODELS_URL = import.meta.env.VITE_MODELS_API_URL || '/api/models'
const API_CUSTOM_MODELS_URL = '/api/models/custom'

function getAuthHeaders() {
  const token = useAuthStore.getState().token
  return token
    ? {
        Authorization: `Bearer ${token}`,
      }
    : undefined
}

export async function fetchAvailableModels() {
  // 获取当前账号可用模型，供输入区模型下拉框使用。
  const response = await fetch(API_MODELS_URL, {
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
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

export async function createCustomModel({ modelName, apiKey }) {
  const response = await fetch(API_CUSTOM_MODELS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(getAuthHeaders() || {}),
    },
    body: JSON.stringify({ modelName, apiKey }),
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
