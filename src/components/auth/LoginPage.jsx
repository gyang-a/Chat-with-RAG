// 模块说明：登录/注册页面，负责账号鉴权入口与基础表单交互。
import { useMemo, useState } from 'react'
import { Eye, EyeOff, KeyRound, ShieldCheck, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/authStore'

export function LoginPage() {
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const login = useAuthStore((s) => s.login)
  const register = useAuthStore((s) => s.register)
  const rememberMe = useAuthStore((s) => s.rememberMe)
  const setRememberMe = useAuthStore((s) => s.setRememberMe)
  const submitting = useAuthStore((s) => s.submitting)
  const authError = useAuthStore((s) => s.authError)
  const setAuthError = useAuthStore((s) => s.setAuthError)

  const isLoginMode = mode === 'login'

  const canSubmit = useMemo(() => {
    const baseValid = username.trim().length > 0 && password.trim().length > 0 && !submitting
    if (!baseValid) return false
    if (isLoginMode) return true
    return confirmPassword.trim().length > 0
  }, [username, password, confirmPassword, submitting, isLoginMode])

  const clearLocalForm = () => {
    setPassword('')
    setConfirmPassword('')
  }

  const submitCurrent = async () => {
    if (!canSubmit) return

    const safeUsername = username.trim()
    if (!isLoginMode && password !== confirmPassword) {
      setAuthError('两次输入的密码不一致')
      return
    }

    try {
      if (isLoginMode) {
        await login({ username: safeUsername, password, rememberMe })
      } else {
        await register({ username: safeUsername, password, rememberMe })
      }
      clearLocalForm()
    } catch {
      // 错误消息由 store 统一维护
    }
  }

  const onSubmit = async (event) => {
    event.preventDefault()
    await submitCurrent()
  }

  const onInputKeyDown = (event) => {
    if (event.key !== 'Enter') return
    if (event.nativeEvent?.isComposing) return
    if (event.shiftKey) return
    event.preventDefault()
    if (!submitting) {
      submitCurrent()
    }
  }

  return (
    <div className='relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-slate-100 via-sky-100 to-cyan-100 px-4 py-8 text-slate-900'>
      <div className='pointer-events-none absolute -left-24 top-12 h-72 w-72 rounded-full bg-cyan-300/20 blur-3xl' />
      <div className='pointer-events-none absolute -right-20 bottom-10 h-72 w-72 rounded-full bg-sky-300/30 blur-3xl' />

      <div className='relative w-full max-w-md rounded-3xl border border-slate-200/70 bg-white/85 p-6 shadow-2xl backdrop-blur-md sm:p-8'>
        <div className='mb-6 text-center'>
          <div className='mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-600 text-white shadow-lg shadow-sky-400/40'>
            <ShieldCheck className='h-6 w-6' />
          </div>
          <h1 className='text-2xl font-semibold tracking-tight text-slate-900'>Kira AI 账号中心</h1>
          <p className='mt-2 text-sm text-slate-600'>未登录不可聊天，请先登录或注册。</p>
        </div>

        <div className='mb-4 grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1'>
          <button
            type='button'
            className={`rounded-lg px-3 py-2 text-sm transition ${
              isLoginMode ? 'bg-white font-medium text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
            onClick={() => {
              setMode('login')
              setAuthError('')
              clearLocalForm()
            }}
          >
            登录
          </button>
          <button
            type='button'
            className={`rounded-lg px-3 py-2 text-sm transition ${
              !isLoginMode ? 'bg-white font-medium text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
            onClick={() => {
              setMode('register')
              setAuthError('')
              clearLocalForm()
            }}
          >
            注册
          </button>
        </div>

        <form className='space-y-4' onSubmit={onSubmit}>
          <label className='block'>
            <span className='mb-1.5 inline-block text-xs font-medium text-slate-600'>用户名</span>
            <div className='flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 focus-within:border-sky-400'>
              <UserRound className='h-4 w-4 text-slate-500' />
              <input
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value)
                  if (authError) setAuthError('')
                }}
                placeholder='请输入用户名'
                autoComplete='username'
                onKeyDown={onInputKeyDown}
                className='w-full bg-transparent text-sm outline-none placeholder:text-slate-400'
              />
            </div>
          </label>

          <label className='block'>
            <span className='mb-1.5 inline-block text-xs font-medium text-slate-600'>瀵嗙爜</span>
            <div className='flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 focus-within:border-sky-400'>
              <KeyRound className='h-4 w-4 text-slate-500' />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  if (authError) setAuthError('')
                }}
                placeholder='请输入密码'
                autoComplete='current-password'
                onKeyDown={onInputKeyDown}
                className='w-full bg-transparent text-sm outline-none placeholder:text-slate-400'
              />
              <button
                type='button'
                className='text-slate-500 transition hover:text-slate-700'
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? '隐藏密码' : '显示密码'}
                title={showPassword ? '隐藏密码' : '显示密码'}
              >
                {showPassword ? <EyeOff className='h-4 w-4' /> : <Eye className='h-4 w-4' />}
              </button>
            </div>
          </label>

          {!isLoginMode && (
            <label className='block'>
              <span className='mb-1.5 inline-block text-xs font-medium text-slate-600'>确认密码</span>
              <div className='flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 focus-within:border-sky-400'>
                <KeyRound className='h-4 w-4 text-slate-500' />
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value)
                    if (authError) setAuthError('')
                  }}
                  placeholder='请再次输入密码'
                  autoComplete='new-password'
                  onKeyDown={onInputKeyDown}
                  className='w-full bg-transparent text-sm outline-none placeholder:text-slate-400'
                />
                <button
                  type='button'
                  className='text-slate-500 transition hover:text-slate-700'
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  aria-label={showConfirmPassword ? '隐藏确认密码' : '显示确认密码'}
                  title={showConfirmPassword ? '隐藏确认密码' : '显示确认密码'}
                >
                  {showConfirmPassword ? <EyeOff className='h-4 w-4' /> : <Eye className='h-4 w-4' />}
                </button>
              </div>
            </label>
          )}

          <label className='flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700'>
            <span>记住我</span>
            <input
              type='checkbox'
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className='h-4 w-4 accent-sky-600'
            />
          </label>

          {authError && <p className='rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600'>{authError}</p>}

          <Button type='submit' className='h-11 w-full rounded-xl bg-sky-600 text-white hover:bg-sky-700' disabled={!canSubmit}>
            {submitting ? '提交中...' : isLoginMode ? '登录并开始聊天' : '注册并进入聊天'}
          </Button>

          <p className='text-center text-xs text-slate-500'>支持回车快速提交，中文输入法组合键不会误触提交</p>
        </form>
      </div>
    </div>
  )
}

