// 模块说明：认证状态仓库，管理 token、用户资料与头像上传后的本地同步。
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import {
  fetchAuthProfile,
  loginByPassword,
  logoutByToken,
  registerByPassword,
  uploadAuthAvatar,
} from '@/services/authApi'

const AUTH_LOCAL_KEY = '灵犀_auth_v1_local'
const AUTH_SESSION_KEY = '灵犀_auth_v1_session'
// 根据 rememberMe 在 localStorage/sessionStorage 之间切换持久化位置
function resolveAuthStorage() {
  return {
    getItem: () => {
      if (typeof window === 'undefined') return null
      return window.localStorage.getItem(AUTH_LOCAL_KEY) || window.sessionStorage.getItem(AUTH_SESSION_KEY)
    },
    setItem: (_, value) => {
      if (typeof window === 'undefined') return

      let rememberMe = true
      try {
        const parsed = JSON.parse(value)
        rememberMe = Boolean(parsed?.state?.rememberMe)
      } catch {
        rememberMe = true
      }

      if (rememberMe) {
        window.localStorage.setItem(AUTH_LOCAL_KEY, value)
        window.sessionStorage.removeItem(AUTH_SESSION_KEY)
      } else {
        window.sessionStorage.setItem(AUTH_SESSION_KEY, value)
        window.localStorage.removeItem(AUTH_LOCAL_KEY)
      }
    },
    removeItem: () => {
      if (typeof window === 'undefined') return
      window.localStorage.removeItem(AUTH_LOCAL_KEY)
      window.sessionStorage.removeItem(AUTH_SESSION_KEY)
    },
  }
}

export const useAuthStore = create(
  persist(
    (set, get) => ({
      token: '',
      username: '',
      // 用户头像的公开访问地址（如 /uploads/avatars/xxx.png）
      avatarUrl: '',
      rememberMe: true,
      authError: '',
      submitting: false,
      setAuthError: (authError) => set({ authError }),
      setRememberMe: (rememberMe) => set({ rememberMe: Boolean(rememberMe) }),

      // 登录动作：请求后端并更新本地认证状态。
      login: async ({ username, password, rememberMe = true }) => {
        // 登录成功后写入 token、用户名和头像地址
        set({ submitting: true, authError: '' })
        try {
          const result = await loginByPassword({ username, password })
          const nextToken = String(result?.token || '').trim()
          const nextUsername = String(result?.user?.username || username || '').trim()
          const nextAvatarUrl = String(result?.user?.avatarUrl || '').trim()

          if (!nextToken) {
            throw new Error('登录返回数据异常')
          }

          set({
            token: nextToken,
            username: nextUsername,
            avatarUrl: nextAvatarUrl,
            rememberMe: Boolean(rememberMe),
            authError: '',
            submitting: false,
          })
        } catch (error) {
          set({
            submitting: false,
            authError: error?.message || '登录失败，请重试',
          })
          throw error
        }
      },
      // 注册动作：成功后直接进入登录态，减少额外步骤。
      register: async ({ username, password, rememberMe = true }) => {
        // 注册成功后沿用登录态写入流程，保证行为一致
        set({ submitting: true, authError: '' })
        try {
          const result = await registerByPassword({ username, password })
          const nextToken = String(result?.token || '').trim()
          const nextUsername = String(result?.user?.username || username || '').trim()
          const nextAvatarUrl = String(result?.user?.avatarUrl || '').trim()

          if (!nextToken) {
            throw new Error('注册返回数据异常')
          }

          set({
            token: nextToken,
            username: nextUsername,
            avatarUrl: nextAvatarUrl,
            rememberMe: Boolean(rememberMe),
            authError: '',
            submitting: false,
          })
        } catch (error) {
          set({
            submitting: false,
            authError: error?.message || '注册失败，请重试',
          })
          throw error
        }
      },
      // 登出动作：清本地状态并通知后端会话失效。
      logout: async () => {
        // 先清本地状态，再通知后端登出
        const token = get().token
        set({ token: '', username: '', avatarUrl: '', submitting: false, authError: '' })
        await logoutByToken(token)
      },
      // 刷新用户资料：用于恢复会话后同步头像等服务端字段。
      refreshProfile: async () => {
        // 登录后主动拉一次资料，确保持久化会话也能拿到最新头像
        const token = get().token
        if (!token) return
        const result = await fetchAuthProfile(token)
        set({
          username: String(result?.user?.username || get().username || '').trim(),
          avatarUrl: String(result?.user?.avatarUrl || '').trim(),
        })
      },
      // 上传头像并更新本地 avatarUrl，供 UI 立即展示。
      uploadAvatar: async (file) => {
        // 头像上传成功后，仅更新头像字段，避免影响其他认证状态
        const token = get().token
        if (!token) {
          throw new Error('登录已失效，请重新登录')
        }
        const result = await uploadAuthAvatar({ token, file })
        const nextAvatarUrl = String(result?.user?.avatarUrl || '').trim()
        set({ avatarUrl: nextAvatarUrl })
        return nextAvatarUrl
      },
    }),
    {
      name: '灵犀_auth',
      storage: createJSONStorage(resolveAuthStorage),
      partialize: (state) => ({
        token: state.token,
        username: state.username,
        avatarUrl: state.avatarUrl,
        rememberMe: state.rememberMe,
      }),
    },
  ),
)
