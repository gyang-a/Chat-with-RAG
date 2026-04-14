import { useEffect, useRef } from 'react'

export function useHotkeys({ onNewConversation, onSend }) {
  const callbacksRef = useRef({ onNewConversation, onSend })
  // 保持回调引用最新，避免依赖项变化导致重新绑定
  useEffect(() => {
    callbacksRef.current = { onNewConversation, onSend }
  })

  useEffect(() => {
    const handleKeyDown = (event) => {
      // 识别输入类节点，避免非输入区域误触发送。
      const target = event.target
      const isInput = target.tagName === 'INPUT' || 
                      target.tagName === 'TEXTAREA' || 
                      target.isContentEditable
      
      const ctrlOrCmd = event.ctrlKey || event.metaKey
      const key = String(event.key || '').toLowerCase()

      // Ctrl/Cmd + Alt + N: 新建会话（避免与浏览器 Ctrl/Cmd+N 新窗口冲突）。
      if (ctrlOrCmd && event.altKey && key === 'n') {
        if (event.cancelable) {
          event.preventDefault()
        }
        event.stopPropagation()
        callbacksRef.current.onNewConversation?.()
        return
      }

      // Cmd/Ctrl + Enter: 发送消息（允许在输入框内使用）
      if (ctrlOrCmd && event.key === 'Enter') {
        // 如果不在输入框内，则忽略
        if (!isInput) return
        
        callbacksRef.current.onSend?.()
      }

      // Enter: 发送消息（仅输入框内，且没有按修饰键）
      if (event.key === 'Enter' && !event.shiftKey && !ctrlOrCmd) {
        if (!isInput) return
        
        callbacksRef.current.onSend?.()
      }
    }

    // 使用捕获阶段，尽量在浏览器默认行为前拦截快捷键。
    window.addEventListener('keydown', handleKeyDown, true)
    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      document.removeEventListener('keydown', handleKeyDown, true)
    }
  }, []) // 空依赖数组，只绑定一次
}