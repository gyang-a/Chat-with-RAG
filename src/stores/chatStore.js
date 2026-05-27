// 模块说明：聊天状态仓库，管理会话列表、消息流与多账号历史隔离。
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createId } from '@/lib/utils'

const EMPTY_MESSAGES = []

const quickCards = [
  '帮我总结今天的技术新闻',
  '给我写一份产品需求文档模板',
  '解释一下SSE和WebSocket的区别',
  '帮我润色一段中文邮件',
]
// 统一将各种 content 结构归一成字符串，避免渲染阶段类型分支膨胀。
function normalizeTextContent(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map((item) => normalizeTextContent(item)).join('')

  if (typeof value === 'object') {
    if (typeof value.text === 'string') return value.text
    if (typeof value.content === 'string') return value.content
    if (Array.isArray(value.content)) return value.content.map((item) => normalizeTextContent(item)).join('')
    return ''
  }

  return ''
}
// 修复历史数据中可能出现的非字符串 content，保证恢复后的消息可直接渲染。
function normalizePersistedMessages(messagesByConversation = {}) {
  const next = {}
  for (const [conversationId, list] of Object.entries(messagesByConversation)) {
    next[conversationId] = Array.isArray(list)
      ? list.map((message) => ({
          ...message,
          content: normalizeTextContent(message?.content),
        }))
      : []
  }
  return next
}
// 构建新会话默认结构。
function buildNewConversation() {
  const id = createId('conv')
  return {
    id,
    title: '新对话',
    pinned: false,
    updatedAt: Date.now(),
    createdAt: Date.now(),
    lastPreview: '',
    contextDocs: [],
    refs: [],
  }
}
 // 构建空历史快照，供初始化与清空场景复用。
function buildEmptyChatSnapshot() {
  const conversation = buildNewConversation()
  return {
    conversations: [conversation],
    currentConversationId: conversation.id,
    messagesByConversation: {},
    streamError: '',
    generating: false,
  }
}
// 对远端或本地快照做容错归一，避免脏数据破坏 UI。
function normalizeChatSnapshot(snapshot) {
  const safeConversations =
    Array.isArray(snapshot?.conversations) && snapshot.conversations.length > 0
      ? snapshot.conversations
      : buildEmptyChatSnapshot().conversations
  const safeCurrentConversationId =
    snapshot?.currentConversationId &&
    safeConversations.some((item) => item.id === snapshot.currentConversationId)
      ? snapshot.currentConversationId
      : safeConversations[0].id

  return {
    conversations: safeConversations,
    currentConversationId: safeCurrentConversationId,
    messagesByConversation: normalizePersistedMessages(snapshot?.messagesByConversation || {}),
    streamError: typeof snapshot?.streamError === 'string' ? snapshot.streamError : '',
    generating: Boolean(snapshot?.generating),
  }
}

export const useChatStore = create(
  persist(
    (set, get) => ({
      ownerUsername: '',
      historiesByUser: {},
      ...buildEmptyChatSnapshot(),
      generating: false,
      streamError: '',
      quickCards,


// 账号切换时保存旧账号历史并加载新账号历史桶
      syncAuthOwner: (username) => {
        const safeUsername = String(username || '').trim()
        const {
          ownerUsername,
          historiesByUser,
          conversations,
          currentConversationId,
          messagesByConversation,
          streamError,
          generating,
        } = get()
        if (ownerUsername === safeUsername) return

        const nextHistoriesByUser = { ...historiesByUser }
        if (ownerUsername) {
          nextHistoriesByUser[ownerUsername] = {
            conversations,
            currentConversationId,
            messagesByConversation,
            streamError,
            generating,
          }
        }

        const nextSnapshot = safeUsername
          ? normalizeChatSnapshot(nextHistoriesByUser[safeUsername] || buildEmptyChatSnapshot())
          : buildEmptyChatSnapshot()

        set({
          ownerUsername: safeUsername,
          historiesByUser: nextHistoriesByUser,
          ...nextSnapshot,
        })
      },

      initCurrentConversation: () => {
        const { conversations, currentConversationId } = get()
        if (!currentConversationId && conversations.length > 0) {
          set({ currentConversationId: conversations[0].id })
        }
      },

      createConversation: () => {
        // 新建会话并切换到该会话。
        const conversation = buildNewConversation()
        set((state) => ({
          conversations: [conversation, ...state.conversations],
          currentConversationId: conversation.id,
        }))
      },

      setCurrentConversation: (id) => set({ currentConversationId: id }),

      renameConversation: (id, title) => {
        const nextTitle = title.trim() || '未命名对话'
        set((state) => ({
          conversations: state.conversations.map((item) =>
            item.id === id ? { ...item, title: nextTitle } : item,
          ),
        }))
      },

      togglePinConversation: (id) => {
        set((state) => ({
          conversations: [...state.conversations]
            .map((item) =>
              item.id === id ? { ...item, pinned: !item.pinned, updatedAt: Date.now() } : item,
            )
            .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt),
        }))
      },

      deleteConversation: (id) => {
        set((state) => {
          const remain = state.conversations.filter((item) => item.id !== id)
          const nextConversations = remain.length > 0 ? remain : [buildNewConversation()]
          const nextCurrent =
            state.currentConversationId === id ? nextConversations[0].id : state.currentConversationId

          const { [id]: _, ...restMessages } = state.messagesByConversation
          return {
            conversations: nextConversations,
            currentConversationId: nextCurrent,
            messagesByConversation: restMessages,
          }
        })
      },

      clearAllHistories: () => {
        const conversation = buildNewConversation()
        set({
          conversations: [conversation],
          currentConversationId: conversation.id,
          messagesByConversation: {},
          streamError: '',
        })
      },

      clearCurrentUserHistoryBucket: () => {
        set((state) => {
          const ownerUsername = String(state.ownerUsername || '').trim()
          const emptySnapshot = buildEmptyChatSnapshot()

          if (!ownerUsername) { 
            return {
              ...emptySnapshot,
            }
          }

          return {
            historiesByUser: {
              ...state.historiesByUser,
              [ownerUsername]: emptySnapshot,
            },
            ...emptySnapshot,
          }
        })
      },
      // 注入远端历史快照，用于登录后同步服务器保存的历史数据。
      applyRemoteHistorySnapshot: (snapshot) => {
        const normalized = normalizeChatSnapshot(snapshot)
        set((state) => {
          const ownerUsername = String(state.ownerUsername || '').trim()
          const nextHistoriesByUser = ownerUsername
            ? {
                ...state.historiesByUser,
                [ownerUsername]: normalized,
              }
            : state.historiesByUser

          return {
            historiesByUser: nextHistoriesByUser,
            ...normalized,
          }
        })
      },

      getPersistableHistorySnapshot: () => {
        const { conversations, currentConversationId, messagesByConversation } = get()
        return {
          conversations,
          currentConversationId,
          messagesByConversation,
        }
      },

      getCurrentConversation: () => {
        const { conversations, currentConversationId } = get()
        return conversations.find((item) => item.id === currentConversationId) || null
      },

      getCurrentMessages: () => {
        const { currentConversationId, messagesByConversation } = get()
        if (!currentConversationId) return EMPTY_MESSAGES
        return messagesByConversation[currentConversationId] || EMPTY_MESSAGES
      },

      appendUserMessage: (content, attachments = [], model = '') => {
        // 追加用户消息，并更新会话预览与更新时间。
        const conversationId = get().currentConversationId
        if (!conversationId) return null

        const message = {
          id: createId('msg_u'),
          role: 'user',
          content: normalizeTextContent(content),
          attachments,
          model: String(model || ''),
          createdAt: Date.now(),
        }

        set((state) => {
          const list = state.messagesByConversation[conversationId] || []
          const nextList = [...list, message]
          return {
            messagesByConversation: {
              ...state.messagesByConversation,
              [conversationId]: nextList,
            },
            conversations: state.conversations
              .map((conv) =>
                conv.id === conversationId
                  ? {
                      ...conv,
                      title:
                        conv.title === '新对话'
                          ? normalizeTextContent(content).slice(0, 18) || '新对话'
                          : conv.title,
                      updatedAt: Date.now(),
                      lastPreview: normalizeTextContent(content),
                    }
                  : conv,
              )
              .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt),
          }
        })

        return message
      },

      startAssistantMessage: () => {
        // 创建 assistant 占位消息，流式输出会不断 patch 该条消息。
        const conversationId = get().currentConversationId
        if (!conversationId) return null

        const message = {
          id: createId('msg_ai'),
          role: 'assistant',
          content: '',
          createdAt: Date.now(),
          refs: [],
          contextDocs: [],
          feedback: 'none',
        }

        set((state) => {
          const list = state.messagesByConversation[conversationId] || []
          return {
            generating: true,
            streamError: '',
            messagesByConversation: {
              ...state.messagesByConversation,
              [conversationId]: [...list, message],
            },
          }
        })

        return message
      },

      patchAssistantMessage: (messageId, patch, options = {}) => {
        // 更新 assistant 消息；可选轻量模式用于流式热路径降噪。
        const conversationId = get().currentConversationId
        if (!conversationId) return

        const updateConversationMeta = options?.updateConversationMeta !== false

        set((state) => {
          const list = state.messagesByConversation[conversationId] || []
          const safePatch = {
            ...patch,
            ...(Object.prototype.hasOwnProperty.call(patch || {}, 'content')
              ? { content: normalizeTextContent(patch.content) }
              : {}),
          }
          const nextList = list.map((msg) => (msg.id === messageId ? { ...msg, ...safePatch } : msg))

          // 流式阶段仅更新消息正文，避免每个分片都触发会话列表的重渲染
          if (!updateConversationMeta) {
            return {
              messagesByConversation: {
                ...state.messagesByConversation,
                [conversationId]: nextList,
              },
            }
          }
          //更新会话预览与更新时间，确保新消息能正确反映在会话列表上。
          const assistantLast = [...nextList].reverse().find((msg) => msg.role === 'assistant')
          return {
            messagesByConversation: {
              ...state.messagesByConversation,
              [conversationId]: nextList,
            },
            conversations: state.conversations.map((conv) =>
              conv.id === conversationId
                ? {
                    ...conv,
                    updatedAt: Date.now(),
                    lastPreview: assistantLast?.content || conv.lastPreview,
                    refs: assistantLast?.refs || conv.refs,
                    contextDocs: assistantLast?.contextDocs || conv.contextDocs,
                  }
                : conv,
            ),
          }
        })
      },

      setGenerating: (generating) => set({ generating }),
      setStreamError: (streamError) => set({ streamError }),

      clearCurrentConversationMessages: () => {
        const conversationId = get().currentConversationId
        if (!conversationId) return

        set((state) => ({
          messagesByConversation: {
            ...state.messagesByConversation,
            [conversationId]: [],
          },
          conversations: state.conversations.map((conv) =>
            conv.id === conversationId ? { ...conv, lastPreview: '', refs: [], contextDocs: [] } : conv,
          ),
        }))
      },

      setMessageFeedback: (messageId, feedback) => {
        const conversationId = get().currentConversationId
        if (!conversationId) return

        set((state) => {
          const list = state.messagesByConversation[conversationId] || []
          return {
            messagesByConversation: {
              ...state.messagesByConversation,
              [conversationId]: list.map((msg) =>
                msg.id === messageId ? { ...msg, feedback: msg.feedback === feedback ? 'none' : feedback } : msg,
              ),
            },
          }
        })
      },
    }),
    {
      name: '灵犀',
      version: 3,
      partialize: (state) => ({
        ownerUsername: state.ownerUsername,
        historiesByUser: state.historiesByUser,
        conversations: state.conversations,
        currentConversationId: state.currentConversationId,
        messagesByConversation: state.messagesByConversation,
        streamError: state.streamError,
        generating: state.generating,
      }),
      migrate: (persistedState) => {
        const state = persistedState || {}
        const normalizedCurrent = normalizeChatSnapshot(state)
        const historiesByUser =
          state.historiesByUser && typeof state.historiesByUser === 'object' ? state.historiesByUser : {}

        const normalizedHistoriesByUser = Object.fromEntries(
          Object.entries(historiesByUser)
            .map(([username, snapshot]) => [String(username || '').trim(), normalizeChatSnapshot(snapshot)])
            .filter(([username]) => Boolean(username)),
        )

        const ownerUsername = String(state.ownerUsername || '')
        if (ownerUsername) {
          normalizedHistoriesByUser[ownerUsername] = normalizedCurrent
        }

        return {
          ...state,
          ownerUsername,
          historiesByUser: normalizedHistoriesByUser,
          ...normalizedCurrent,
        }
      },
      onRehydrateStorage: () => (state) => {
        state?.initCurrentConversation?.()
      },
    },
  ),
)
