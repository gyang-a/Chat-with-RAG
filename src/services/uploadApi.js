// 模块说明：聊天附件上传接口服务，封装文件上传与鉴权失败处理。
import { useAuthStore } from '@/stores/authStore'

const API_UPLOAD_URL = import.meta.env.VITE_UPLOAD_API_URL || '/api/upload'

// 文件上传接口预留：后端接入时仅需替换 URL 与字段映射
export async function uploadDocument(file, { onProgress } = {}) {
  // 上传附件并返回后端标准化文件元数据。
  const token = useAuthStore.getState().token
  const formData = new FormData()
  formData.append('file', file)

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', API_UPLOAD_URL, true)

    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    }

    // 仅上传阶段上报百分比，便于输入区实时显示进度。
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return
      const percent = Math.min(100, Math.max(0, Math.round((event.loaded / event.total) * 100)))
      onProgress?.(percent)
    }

    xhr.onerror = () => {
      reject(new Error('文件上传失败，请稍后重试'))
    }

    xhr.onload = async () => {
      const status = Number(xhr.status || 0)
      const raw = xhr.responseText || ''

      let parsed = null
      try {
        parsed = raw ? JSON.parse(raw) : null
      } catch {
        parsed = null
      }

      if (status >= 200 && status < 300) {
        onProgress?.(100)
        resolve(parsed || {})
        return
      }

      if (status === 401) {
        await useAuthStore.getState().logout().catch(() => null)
        reject(new Error('登录已失效，请重新登录后上传文件'))
        return
      }

      const message = String(parsed?.message || '').trim() || '文件上传失败，请稍后重试'
      reject(new Error(message))
    }

    xhr.send(formData)
  })
}
