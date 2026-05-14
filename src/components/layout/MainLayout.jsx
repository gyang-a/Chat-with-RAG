// 模块说明：应用主布局，组织侧栏、聊天窗口与辅助面板，并接入交互 Hook。
import { useEffect, useRef, useState } from 'react'
import { Toaster } from 'sonner'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Sidebar } from '@/components/sidebar/Sidebar'
import { ChatWindow } from '@/components/chat/ChatWindow'
import { AuxPanel } from '@/components/panel/AuxPanel'
import { useAutoScroll } from '@/hooks/useAutoScroll'
import { useSSEChat } from '@/hooks/useSSEChat'
import { useHotkeys } from '@/hooks/useHotkeys'
import { fetchHistorySnapshot, saveHistorySnapshot } from '@/services/historyApi'
import { fetchAvailableModels } from '@/services/modelApi'
import { useAuthStore } from '@/stores/authStore'
import { useChatStore } from '@/stores/chatStore'
import { useUIStore } from '@/stores/uiStore'

// 生成历史快照签名：用于判断是否需要把本地历史写回后端，避免重复保存。
function buildHistorySignature({ conversations, currentConversationId, messagesByConversation }) {
  const conversationMeta = (conversations || []).map((item) => [
    item.id,
    item.updatedAt,
    Number(Boolean(item.pinned)),
    item.title,
    item.lastPreview,
  ])
  const messageMeta = Object.entries(messagesByConversation || {})
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([conversationId, list]) => {
      const last = Array.isArray(list) && list.length > 0 ? list[list.length - 1] : null
      return [conversationId, Array.isArray(list) ? list.length : 0, last?.id || '', last?.createdAt || 0]
    })

  return JSON.stringify({
    currentConversationId,
    conversationMeta,
    messageMeta,
  })
}

export function MainLayout() {
  const token = useAuthStore((s) => s.token)
  const ownerUsername = useChatStore((s) => s.ownerUsername)
  const generating = useChatStore((s) => s.generating)
  const currentConversationId = useChatStore((s) => s.currentConversationId)
  const conversations = useChatStore((s) => s.conversations)
  const messagesByConversation = useChatStore((s) => s.messagesByConversation)
  const applyRemoteHistorySnapshot = useChatStore((s) => s.applyRemoteHistorySnapshot)
  const initCurrentConversation = useChatStore((s) => s.initCurrentConversation)
  const createConversation = useChatStore((s) => s.createConversation)
  const mobileSidebarOpen = useUIStore((s) => s.mobileSidebarOpen)
  const setMobileSidebarOpen = useUIStore((s) => s.setMobileSidebarOpen)
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen)
  const setRightPanelOpen = useUIStore((s) => s.setRightPanelOpen)
  const hydratedOwnerRef = useRef('')
  const suppressSaveRef = useRef(false)
  const saveTimerRef = useRef(null)
  const lastSavedSignatureRef = useRef('')
  const [availableModels, setAvailableModels] = useState([])
  const [selectedModel, setSelectedModel] = useState('')
  const [isMobileRightPanelViewport, setIsMobileRightPanelViewport] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.innerWidth < 1280
  })

  const { sendMessage, stopGenerating, regenerateLast } = useSSEChat()
  const { autoScrollEnabled, onAtBottomStateChange, forceEnableAutoScroll } = useAutoScroll()

  // 初始化当前会话，防止首次进入时 currentConversationId 为空。
  useEffect(() => {
    initCurrentConversation()
  }, [initCurrentConversation])

  useHotkeys({
    onNewConversation: createConversation,
    onSend: () => {},
  })

  // 切换会话后重新启用自动滚动，保证新会话从底部跟随输出。
  useEffect(() => {
    forceEnableAutoScroll()
  }, [currentConversationId, forceEnableAutoScroll])

  // 登录后拉取远端历史并注入本地状态，期间暂停自动保存避免“拉取后马上回写”。
  useEffect(() => {
    if (!token || !ownerUsername) return

    let cancelled = false
    // 切换账号时先暂停保存，等新历史拉取并注入后再恢复。
    suppressSaveRef.current = true
    hydratedOwnerRef.current = ''
     // 拉取服务端信息并应用到本地状态
    fetchHistorySnapshot()
      .then((snapshot) => {
        if (cancelled) return
        applyRemoteHistorySnapshot(snapshot)
        lastSavedSignatureRef.current = buildHistorySignature(snapshot)
        hydratedOwnerRef.current = ownerUsername
      })
      .catch(() => {
        if (cancelled) return
        hydratedOwnerRef.current = ownerUsername
      })
      .finally(() => {
        if (cancelled) return
        setTimeout(() => {
          suppressSaveRef.current = false// 恢复保存
        }, 0)
      })

    return () => {
      cancelled = true
    }
  }, [applyRemoteHistorySnapshot, ownerUsername, token])

  // 本地历史有变化时延迟保存到后端；生成中不保存，降低高频写入压力。
  useEffect(() => {
    if (!token || !ownerUsername) return
    if (hydratedOwnerRef.current !== ownerUsername) return
    if (suppressSaveRef.current) return
    if (generating) return

    const snapshot = {
      conversations,
      currentConversationId,
      messagesByConversation,
    }
    const signature = buildHistorySignature(snapshot)
    if (signature === lastSavedSignatureRef.current) return

    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveHistorySnapshot(snapshot)
        .then(() => {
          lastSavedSignatureRef.current = signature
        })
        .catch(() => null)
    }, 700)

    return () => {
      clearTimeout(saveTimerRef.current)
    }
  }, [conversations, currentConversationId, generating, messagesByConversation, ownerUsername, token])

  // 模型列表在登录后与窗口回焦时刷新，确保新增/变更模型可及时生效。
  useEffect(() => {
    if (!token || !ownerUsername) return

    let cancelled = false

    const refreshModels = () => {
      fetchAvailableModels()
        .then(({ models, defaultModel }) => {
          if (cancelled) return
          setAvailableModels(models)

          const storageKey = `Kria_model_${ownerUsername}`
          const cached = window.localStorage.getItem(storageKey) || ''
          const next =
            (cached && models.includes(cached) && cached) ||
            (defaultModel && models.includes(defaultModel) && defaultModel) ||
            models[0] ||
            ''
          setSelectedModel(next)
        })
        .catch(() => {
          if (cancelled) return
          setAvailableModels([])
          setSelectedModel('')
        })
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshModels()
      }
    }

    const onModelsUpdated = () => {
      refreshModels()
    }

    refreshModels()
    window.addEventListener('focus', refreshModels)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('kria:models-updated', onModelsUpdated)

    return () => {
      cancelled = true
      window.removeEventListener('focus', refreshModels)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('kria:models-updated', onModelsUpdated)
    }
  }, [ownerUsername, token])

  // 记住当前账号选中的模型，下一次进入时优先恢复。
  useEffect(() => {
    if (!ownerUsername || !selectedModel) return
    window.localStorage.setItem(`Kria_model_${ownerUsername}`, selectedModel)
  }, [ownerUsername, selectedModel])

  // 监听视口宽度，决定右侧 RAG 面板使用抽屉还是常驻面板。
  useEffect(() => {
    if (typeof window === 'undefined') return

    const media = window.matchMedia('(max-width: 1279px)')
    const sync = () => setIsMobileRightPanelViewport(media.matches)
    sync()

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', sync)
      return () => media.removeEventListener('change', sync)
    }

    media.addListener(sync)
    return () => media.removeListener(sync)
  }, [])

  return (
    <div className='h-screen w-full bg-[radial-gradient(1400px_700px_at_-15%_-25%,rgba(91,123,255,0.18),transparent),radial-gradient(1100px_580px_at_115%_-10%,rgba(78,195,255,0.16),transparent),#f4f6fb] p-2 text-foreground md:p-3'>
      <div className='flex h-full w-full overflow-hidden rounded-[24px] border border-[#dce2f1] bg-card/85 shadow-[0_12px_45px_rgba(26,41,82,0.08)] backdrop-blur'>
        <div className='hidden md:block'>
          <Sidebar />
        </div>

        <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
          <SheetContent
            title='会话侧边栏'
            overlayClassName='md:hidden'
            className='w-[300px] border-r border-sidebar-border bg-sidebar p-0 md:hidden'
          >
            <Sidebar mobile />
          </SheetContent>
        </Sheet>

        {isMobileRightPanelViewport && (
          <Sheet open={rightPanelOpen} onOpenChange={setRightPanelOpen}>
            <SheetContent
              title='RAG 辅助面板'
              overlayClassName='xl:hidden'
              className='left-auto right-0 w-[94vw] max-w-[360px] border-r-0 border-l border-border bg-background p-0 text-foreground xl:hidden'
            >
              <AuxPanel mobile />
            </SheetContent>
          </Sheet>
        )}

        <div className='flex min-w-0 flex-1'>
          <ChatWindow
            autoScrollEnabled={autoScrollEnabled}
            onAtBottomStateChange={onAtBottomStateChange}
            onSend={sendMessage}
            onStop={stopGenerating}
            onRegenerate={regenerateLast}
            availableModels={availableModels}
            selectedModel={selectedModel}
            onSelectModel={setSelectedModel}
          />

          <AuxPanel />
        </div>
      </div>

      <Toaster richColors position='top-center' />
    </div>
  )
}
