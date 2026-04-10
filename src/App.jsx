// application module
// File: C:\Users\yango\Desktop\Chat\src\App.jsx
import { useEffect } from 'react'
import { MainLayout } from '@/components/layout/MainLayout'
import { LoginPage } from '@/components/auth/LoginPage'
import { useAuthStore } from '@/stores/authStore'
import { useChatStore } from '@/stores/chatStore'
import { useUIStore } from '@/stores/uiStore'

function App() {
  const darkMode = useUIStore((s) => s.darkMode)
  const token = useAuthStore((s) => s.token)
  const username = useAuthStore((s) => s.username)
  const refreshProfile = useAuthStore((s) => s.refreshProfile)
  const syncAuthOwner = useChatStore((s) => s.syncAuthOwner)
  const isLoggedIn = Boolean(token)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
  }, [darkMode])

  useEffect(() => {
    syncAuthOwner(isLoggedIn ? username : '')
  }, [isLoggedIn, syncAuthOwner, username])

  useEffect(() => {
    // 登录后刷新一次用户资料，确保头像等字段与服务端一致
    if (!isLoggedIn) return
    refreshProfile().catch(() => null)
  }, [isLoggedIn, refreshProfile])

  return isLoggedIn ? <MainLayout /> : <LoginPage />
}

export default App
