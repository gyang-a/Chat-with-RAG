// 模块说明：模型列表接口服务，负责读取可用模型与默认模型。
import { useAuthStore } from '@/stores/authStore'

const API_MODELS_URL = import.meta.env.VITE_MODELS_API_URL || '/api/models'

export async function fetchAvailableModels() {
  // 获取当前账号可用模型，供输入区模型下拉框使用。
  const token = useAuthStore.getState().token
  const response = await fetch(API_MODELS_URL, {
    headers: token
      ? {
          Authorization: `Bearer ${token}`,
        }
      : undefined,
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
