// 模块说明：认证服务层，封装登录/注册/登出、资料读取与头像上传接口。
const API_AUTH_LOGIN_URL = import.meta.env.VITE_AUTH_LOGIN_API_URL || '/api/auth/login'
const API_AUTH_REGISTER_URL = import.meta.env.VITE_AUTH_REGISTER_API_URL || '/api/auth/register'
const API_AUTH_LOGOUT_URL = import.meta.env.VITE_AUTH_LOGOUT_API_URL || '/api/auth/logout'
// 当前登录用户资料接口（用于拉取头像等信息）
const API_AUTH_ME_URL = import.meta.env.VITE_AUTH_ME_API_URL || '/api/auth/me'
// 当前登录用户头像上传接口
const API_AUTH_AVATAR_URL = import.meta.env.VITE_AUTH_AVATAR_API_URL || '/api/auth/avatar'

async function parseErrorMessage(response, fallbackMessage) {
  // 统一提取后端 message 字段，避免各接口重复写错误解析逻辑
  try {
    const data = await response.json()
    return data?.message || fallbackMessage
  } catch {
    return fallbackMessage
  }
}

export async function loginByPassword({ username, password }) {
  // 用户名密码登录
  const response = await fetch(API_AUTH_LOGIN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username, password }),
  })

  if (!response.ok) {
    const message = await parseErrorMessage(response, '登录失败，请重试')
    throw new Error(message)
  }

  return response.json()
}

export async function registerByPassword({ username, password }) {
  // 用户名密码注册
  const response = await fetch(API_AUTH_REGISTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username, password }),
  })

  if (!response.ok) {
    const message = await parseErrorMessage(response, '注册失败，请重试')
    throw new Error(message)
  }

  return response.json()
}

export async function logoutByToken(token) {
  // 退出登录接口：失败不抛错，避免影响本地登出流程
  await fetch(API_AUTH_LOGOUT_URL, {
    method: 'POST',
    headers: token
      ? {
          Authorization: `Bearer ${token}`,
        }
      : undefined,
  }).catch(() => null)
}

export async function fetchAuthProfile(token) {
  // 通过 token 获取当前用户资料，避免仅靠本地缓存导致头像不同步
  const response = await fetch(API_AUTH_ME_URL, {
    headers: token
      ? {
          Authorization: `Bearer ${token}`,
        }
      : undefined,
  })

  if (!response.ok) {
    const message = await parseErrorMessage(response, '获取用户信息失败')
    throw new Error(message)
  }

  return response.json()
}

export async function uploadAuthAvatar({ token, file }) {
  // 头像上传使用 multipart/form-data，不手动设置 Content-Type
  const formData = new FormData()
  formData.append('avatar', file)

  const response = await fetch(API_AUTH_AVATAR_URL, {
    method: 'POST',
    headers: token
      ? {
          Authorization: `Bearer ${token}`,
        }
      : undefined,
    body: formData,
  })

  if (!response.ok) {
    const message = await parseErrorMessage(response, '上传头像失败，请重试')
    throw new Error(message)
  }

  return response.json()
}
