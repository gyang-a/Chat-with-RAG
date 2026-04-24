// 导入React核心Hook
import { useCallback, useEffect, useRef } from 'react'
import { layout, prepare } from '@chenglou/pretext'
// 导入SSE流式聊天接口
import { streamChat } from '@/services/chatApi'
// 导入用户输入内容过滤工具（防XSS/非法字符）
import { sanitizeUserInput } from '@/lib/sanitize'
// 导入聊天状态管理库（Zustand）
import { useChatStore } from '@/stores/chatStore'
import { useUIStore } from '@/stores/uiStore'

/**
 * 工具函数：归一化流式返回的文本片段
 * 处理后端SSE推送的各种格式数据，统一返回纯字符串
 * @param {any} value - 后端推送的delta数据
 * @returns {string} 格式化后的纯文本
 */
function normalizeDeltaText(value) {
  // 空值返回空字符串
  if (value == null) return ''
  // 字符串直接返回
  if (typeof value === 'string') return value
  // 数字/布尔值转字符串
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)

  // 数组递归处理，拼接成字符串
  if (Array.isArray(value)) {
    return value.map((item) => normalizeDeltaText(item)).join('')
  }

  // 对象类型：提取text/content字段
  if (typeof value === 'object') {
    if (typeof value.text === 'string') return value.text
    if (typeof value.content === 'string') return value.content
    if (Array.isArray(value.content)) return value.content.map((item) => normalizeDeltaText(item)).join('')
    return ''
  }

  return ''
}

// 预估流式文本展示高度时使用的字体与布局参数（需与消息气泡样式尽量保持一致）
const STREAM_LAYOUT_FONT = '400 14px "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif'
const STREAM_LAYOUT_LINE_HEIGHT = 28  //行高，影响文本高度计算，需根据实际消息气泡样式调整
const STREAM_LAYOUT_MAX_WIDTH = 700  // 流式文本最大宽度，需根据实际消息气泡样式调整，影响换行和高度计算
const STREAM_LAYOUT_PADDING_Y = 24   // 上下内边距总和，影响最小高度计算
const STREAM_LAYOUT_MIN_HEIGHT = 46  // 最小高度，保证气泡初始状态不至于过于扁平
const STREAM_FLUSH_MIN_INTERVAL = 56 // 流式文本最小刷新间隔，单位ms，过短可能导致性能问题，过长可能感觉卡顿，需根据实际测试调整
const STREAM_MEASURE_MIN_INTERVAL = 120   // 流式文本高度测量的最小间隔，单位ms，避免过于频繁测量导致性能问题
const STREAM_HEIGHT_UPDATE_THRESHOLD = 8 // 仅当高度变化超过8px时才更新，避免频繁微调导致的视觉抖动

// 预估流式文本的展示高度，动态调整消息气泡大小，提升视觉体验。
function estimateStreamingHeight(text = '') {
  if (!text) return STREAM_LAYOUT_MIN_HEIGHT

  try {
    const prepared = prepare(text, STREAM_LAYOUT_FONT, { whiteSpace: 'pre-wrap' })
    const { height } = layout(prepared, STREAM_LAYOUT_MAX_WIDTH, STREAM_LAYOUT_LINE_HEIGHT)
    return Math.max(STREAM_LAYOUT_MIN_HEIGHT, Math.ceil(height + STREAM_LAYOUT_PADDING_Y))
  } catch {
    return STREAM_LAYOUT_MIN_HEIGHT
  }
}

/**
 * 自定义Hook：处理AI聊天的 SSE 流式响应
 * 核心功能：发送消息、流式接收AI回复、中断生成、重新生成回复
 * @returns {Object} 暴露 sendMessage/stopGenerating/regenerateLast 方法
 */
export function useSSEChat() {
  // 存储中断控制器实例，用于手动终止流式请求
  const abortRef = useRef(null)

  // ========== 从全局状态库中获取状态和操作方法 ==========
  // 当前对话ID
  const currentConversationId = useChatStore((s) => s.currentConversationId)
  // 添加用户消息到列表
  const appendUserMessage = useChatStore((s) => s.appendUserMessage)
  // 创建AI消息占位（开始流式回复）
  const startAssistantMessage = useChatStore((s) => s.startAssistantMessage)
  // 更新AI消息内容（流式拼接文字）
  const patchAssistantMessage = useChatStore((s) => s.patchAssistantMessage)
  // 设置是否正在生成中（加载状态）
  const setGenerating = useChatStore((s) => s.setGenerating)
  // 设置流式请求错误信息
  const setStreamError = useChatStore((s) => s.setStreamError)
  // 检索模式（文本 / 语义 / 混合）
  const retrievalMode = useUIStore((s) => s.retrievalMode)
  const ragEnabled = useUIStore((s) => s.ragEnabled)
  const ragTopK = useUIStore((s) => s.ragTopK)

  /**
   * 停止AI流式生成
   * 中断当前请求，重置状态
   */
  const stopGenerating = useCallback(() => {
    // 调用中断控制器终止请求
    abortRef.current?.abort()
    abortRef.current = null
    // 关闭加载状态
    setGenerating(false)
  }, [setGenerating])

  /**
   * 核心方法：发送用户消息，接收流式响应
   * @param {Object|string} payload - 消息内容/附件
   */
  const sendMessage = useCallback(
    async (payload) => {
      // 1. 解析用户输入的文本和附件
      const rawText = typeof payload === 'string' ? payload : payload?.text || ''
      const attachments = Array.isArray(payload?.attachments) ? payload.attachments : []
      const model = typeof payload === 'object' ? String(payload?.model || '').trim() : ''
      // 关闭 RAG 后统一降级为模型直答。
      const effectiveRetrievalMode = ragEnabled ? retrievalMode : 'direct'
      // Top K 从 UI 状态读取并在发送前做一次兜底校验。
      const safeRagTopK = Math.min(20, Math.max(1, Number(ragTopK) || 4))
      // 过滤用户输入（安全处理）
      const text = sanitizeUserInput(rawText)
      // 最终发送的文本（无文字但有附件时，默认提示语）
      const finalText = text || (attachments.length > 0 ? '请结合我上传的附件给出回答。' : '')
      
      // 无有效内容/无对话ID，直接终止
      if (!finalText || !currentConversationId) return

      // 读取发送前的当前会话历史，供后端构建多轮上下文。
      const recentMessages = useChatStore
        .getState()
        .getCurrentMessages()
        .map((item) => ({
          role: String(item?.role || ''),
          content: String(item?.content || ''),
        }))
        .filter((item) => (item.role === 'user' || item.role === 'assistant') && item.content)

      // 清空之前的错误信息
      setStreamError('')
      // 2. 将用户消息添加到聊天列表
      appendUserMessage(finalText, attachments, model)
      // 3. 创建AI消息占位符（准备接收流式文字）
      const assistant = startAssistantMessage()
      if (!assistant) return

      // 4. 创建中断控制器，用于手动终止请求
      const controller = new AbortController()
      abortRef.current = controller

      // 流式文本缓冲池：缓存后端推送的文字片段，减少渲染次数
      let deltaBuffer = ''
      // 使用rAF将多次delta合并到同一帧，降低主线程抖动
      let rafId = null
      let latestMeasuredAt = 0
      let latestMeasuredHeight = STREAM_LAYOUT_MIN_HEIGHT
      let latestFlushAt = 0
      let pendingHeightPatch = false

      /**
       * 刷新缓冲：将缓存的文字更新到AI消息
       */
      const flushDelta = () => {
        if (!assistant?.id || !deltaBuffer) return
        const nextChunk = deltaBuffer
        deltaBuffer = '' // 清空缓冲
        const nextContent = (assistant.content || '') + nextChunk

        // 高度测量做轻节流，避免每一帧都触发文本测量
        const now = Date.now()
        if (now - latestMeasuredAt >= STREAM_MEASURE_MIN_INTERVAL || nextChunk.length >= 120) {
          const measuredHeight = estimateStreamingHeight(nextContent)
          if (Math.abs(measuredHeight - latestMeasuredHeight) >= STREAM_HEIGHT_UPDATE_THRESHOLD) {
            latestMeasuredHeight = measuredHeight
            pendingHeightPatch = true
          }
          latestMeasuredAt = now
        }

        // 更新全局状态，渲染文字
        patchAssistantMessage(assistant.id, {
          content: nextContent,
          ...(pendingHeightPatch ? { streamLayoutHeight: latestMeasuredHeight } : {}),
        }, { updateConversationMeta: false })
        // 同步更新本地缓存的消息内容
        assistant.content = nextContent
        if (pendingHeightPatch) {
          assistant.streamLayoutHeight = latestMeasuredHeight
          pendingHeightPatch = false
        }
        latestFlushAt = now
      }

      /**
       * 调度刷新：节流执行，40ms内只更新一次
       */
      const scheduleFlush = () => {
        if (rafId != null) return
        rafId = requestAnimationFrame(() => {
          rafId = null
          const now = Date.now()
          if (now - latestFlushAt < STREAM_FLUSH_MIN_INTERVAL) {
            scheduleFlush()
            return
          }
          flushDelta()
        })
      }

      try {
        // 5. 调用SSE流式接口，发送请求
        await streamChat({
          conversationId: currentConversationId,
          message: finalText,
          model,
          attachments,
          recentMessages,
          retrievalMode: effectiveRetrievalMode,
          ragTopK: safeRagTopK,
          signal: controller.signal, // 绑定中断信号
          // 接收后端推送的事件
          onEvent: (event) => {
            if (!assistant?.id) return

            // 流式传输完成
            if (event.done) {
              if (rafId != null) {
                cancelAnimationFrame(rafId)
                rafId = null
              }

              // 完成前强制再测一次，保证最后高度准确
              if (assistant.content) {
                latestMeasuredHeight = estimateStreamingHeight(assistant.content)
              }

              flushDelta() // 刷新剩余缓冲
              patchAssistantMessage(assistant.id, {
                streamLayoutHeight: latestMeasuredHeight,
              })
              setGenerating(false) // 关闭加载状态
              return
            }

            // 后端返回错误
            if (event.error) {
              throw new Error(event.error)
            }

            // 格式化文本片段
            const deltaText = normalizeDeltaText(event.delta)
            if (deltaText) {
              deltaBuffer += deltaText // 加入缓冲池
              // 首次返回文字，立即渲染；后续文字节流渲染
              if (!assistant.content) {
                flushDelta()
              } else {
                scheduleFlush()
              }
            }

            // 更新引用文献/上下文文档
            if (
              (event.refs && event.refs.length > 0) ||
              (event.contextDocs && event.contextDocs.length > 0) ||
              event.retrievalModeUsed
            ) {
              patchAssistantMessage(assistant.id, {
                refs: event.refs || [],
                contextDocs: event.contextDocs || [],
                retrievalModeUsed: String(event.retrievalModeUsed || ''),
              }, { updateConversationMeta: false })
            }
          },
          // 网络错误处理
          onError: () => {
            if (rafId != null) {
              cancelAnimationFrame(rafId)
              rafId = null
            }
            flushDelta()
            setStreamError('网络异常，已中断生成')
            setGenerating(false)
          },
        })
      } catch (error) {
        // 清理定时器和缓冲
        if (rafId != null) {
          cancelAnimationFrame(rafId)
          rafId = null
        }
        flushDelta()

        // 非手动中断的错误，展示错误提示
        if (error.name !== 'AbortError') {
          patchAssistantMessage(assistant.id, {
            content: assistant.content || '请求失败，请重试。',
          })
          setStreamError(error.message || '请求失败，请重试')
          setGenerating(false)
        }
      } finally {
        // 请求结束，重置中断控制器
        abortRef.current = null
      }
    },
    // 依赖项：保证useCallback正常更新
    [
      appendUserMessage,
      currentConversationId,
      patchAssistantMessage,
      setGenerating,
      setStreamError,
      startAssistantMessage,
      ragEnabled,
      ragTopK,
      retrievalMode,
    ],
  )

  /**
   * 重新生成最后一条AI回复
   * 找到最后一条用户消息，重新发送请求
   */
  const regenerateLast = useCallback(async () => {
    // 获取当前对话的所有消息
    const list = useChatStore.getState().getCurrentMessages()
    // 倒序查找最后一条用户消息
    const latestUser = [...list].reverse().find((item) => item.role === 'user')
    // 找到则重新发送消息
    if (latestUser) {
      await sendMessage({
        text: latestUser.content,
        attachments: latestUser.attachments || [],
        model: latestUser.model || '',
      })
    }
  }, [sendMessage])

  /**
   * 副作用：组件卸载时，自动中断正在进行的流式请求
   * 防止内存泄漏
   */
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  // 暴露三个核心方法
  return {
    sendMessage,      // 发送消息
    stopGenerating,   // 停止生成
    regenerateLast,   // 重新生成最后一条回复
  }

}