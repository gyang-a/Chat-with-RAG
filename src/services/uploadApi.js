// 模块说明：聊天附件上传接口服务，封装文件上传与鉴权失败处理。
import { useAuthStore } from '@/stores/authStore'

const API_UPLOAD_URL = import.meta.env.VITE_UPLOAD_API_URL || '/api/upload'

// 文件上传接口预留：后端接入时仅需替换 URL 与字段映射
export async function uploadDocument(file) {
  // 上传附件并返回后端标准化文件元数据。
  const token = useAuthStore.getState().token
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch(API_UPLOAD_URL, {
    method: 'POST',
    headers: token
      ? {
          Authorization: `Bearer ${token}`,
        }
      : undefined,
    body: formData,
  })

  if (!response.ok) {
    if (response.status === 401) {
      useAuthStore.getState().logout().catch(() => null)
      throw new Error('登录已失效，请重新登录后上传文件')
    }
    throw new Error('文件上传失败，请稍后重试')
  }

  return response.json()
}
