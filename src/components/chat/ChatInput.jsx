// 模块说明：聊天输入区组件，负责文本输入、附件选择上传与发送控制。
import { useMemo, useRef, useState } from 'react'
import { Eraser, Globe, Paperclip, RotateCcw, SendHorizonal, Sparkles, Square, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { uploadDocument } from '@/services/uploadApi'
import { useChatStore } from '@/stores/chatStore'
import { useUIStore } from '@/stores/uiStore'
import { createId } from '@/lib/utils'

const ALLOWED_TYPES = ['application/pdf', 'text/plain', 'text/markdown', 'image/jpeg', 'image/png', 'image/gif', 'image/webp']
const ALLOWED_EXTS = new Set(['pdf', 'txt', 'md', 'jpg', 'jpeg', 'png', 'gif', 'webp'])
const MAX_FILES = 5
const MAX_FILE_SIZE = 10 * 1024 * 1024

// 格式化文件体积显示，统一附件列表中的单位表现。
function formatFileSize(size = 0) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function getFileExt(fileName = '') {
  const lower = String(fileName || '').toLowerCase()
  const idx = lower.lastIndexOf('.')
  if (idx < 0) return ''
  return lower.slice(idx + 1)
}

function isAllowedChatFile(file) {
  const mime = String(file?.type || '').toLowerCase()
  const ext = getFileExt(file?.name || '')
  // 兼容部分浏览器对 txt 的 file.type 为空字符串的场景。
  return ALLOWED_TYPES.includes(mime) || ALLOWED_EXTS.has(ext)
}

export function ChatInput({
  onSend,
  onStop,
  selectedModel = '',
}) {
  const [text, setText] = useState('')
  const [pendingFiles, setPendingFiles] = useState([])
  const [isWebSearchEnabled, setIsWebSearchEnabled] = useState(false)
  const generating = useChatStore((s) => s.generating)
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen)
  const toggleRightPanel = useUIStore((s) => s.toggleRightPanel)
  const inputRef = useRef(null)
  const fileInputRef = useRef(null)
  const canSend = useMemo(() => text.trim().length > 0 || pendingFiles.length > 0, [text, pendingFiles.length])

  // 根据内容高度自动拉伸输入框，并限制最大高度避免遮挡消息区。
  const resize = () => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }

  // 局部更新某个待上传文件状态（上传中/成功/失败）。
  const updatePendingFile = (id, patch) => {
    setPendingFiles((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  // 选中文件后立即上传，避免“点击发送时才开始上传”的等待体验。
  const uploadAcceptedFiles = async (items = []) => {
    if (!Array.isArray(items) || items.length === 0) return

    const uploadOne = async (item) => {
      updatePendingFile(item.id, { status: 'uploading', error: '', progress: 0 })
      try {
        const result = await uploadDocument(item.file, {
          onProgress: (percent) => {
            updatePendingFile(item.id, { progress: percent })
          },
        })
        const ext = getFileExt(item.file.name)
        const meta = result?.file
          ? {
              fileId: result.file.fileName,
              name: result.file.originalName,
              url: result.file.url,
              size: result.file.size,
              mimeType: result.file.mimeType,
              docId: result.file.docId || '',
              ext,
              textSnippet: result.file.textSnippet || '',
              textSnippetTruncated: Boolean(result.file.textSnippetTruncated),
            }
          : {
              fileId: item.id,
              name: item.file.name,
              url: '',
              size: item.file.size,
              mimeType: item.file.type,
              docId: '',
              ext,
              textSnippet: '',
              textSnippetTruncated: false,
            }

        updatePendingFile(item.id, { status: 'success', uploaded: meta, error: '', progress: 100 })
      } catch (error) {
        updatePendingFile(item.id, { status: 'error', error: error.message || '上传失败', progress: 0 })
      }
    }

    await Promise.all(items.map((item) => uploadOne(item)))
  }

  // 上传待发送附件并收集后端回传的附件元数据。
  const uploadPendingFiles = async () => {
    const pendingUploading = pendingFiles.filter((item) => item.status === 'uploading').length
    if (pendingUploading > 0) {
      throw new Error('附件仍在上传中，请稍候再发送')
    }

    const filesToUpload = pendingFiles.filter((item) => item.status === 'pending')
    const uploadedMeta = pendingFiles
      .filter((item) => item.status === 'success' && item.uploaded)
      .map((item) => item.uploaded)

    const failedCountBefore = pendingFiles.filter((item) => item.status === 'error').length
    if (failedCountBefore > 0) {
      throw new Error('存在上传失败文件，请重试或移除后再发送')
    }

    // 单文件上传任务：状态写回 pendingFiles，用于前端可视反馈。
    const uploadOne = async (item) => {
      updatePendingFile(item.id, { status: 'uploading', error: '', progress: 0 })
      try {
        const result = await uploadDocument(item.file, {
          onProgress: (percent) => {
            updatePendingFile(item.id, { progress: percent })
          },
        })
        const ext = getFileExt(item.file.name)
        const meta = result?.file
          ? {
              fileId: result.file.fileName,
              name: result.file.originalName,
              url: result.file.url,
              size: result.file.size,
              mimeType: result.file.mimeType,
              docId: result.file.docId || '',
              ext,
              textSnippet: result.file.textSnippet || '',
              textSnippetTruncated: Boolean(result.file.textSnippetTruncated),
            }
          : {
              fileId: item.id,
              name: item.file.name,
              url: '',
              size: item.file.size,
              mimeType: item.file.type,
              docId: '',
              ext,
              textSnippet: '',
              textSnippetTruncated: false,
            }

        updatePendingFile(item.id, { status: 'success', uploaded: meta, error: '', progress: 100 })
        return { ok: true, meta }
      } catch (error) {
        updatePendingFile(item.id, { status: 'error', error: error.message || '上传失败', progress: 0 })
        return { ok: false, id: item.id }
      }
    }

    const results = await Promise.all(filesToUpload.map((item) => uploadOne(item)))
    const successMeta = results.filter((item) => item.ok).map((item) => item.meta)
    const failedCount = results.filter((item) => !item.ok).length
    uploadedMeta.push(...successMeta)

    if (failedCount > 0) {
      throw new Error('存在上传失败文件，请重试或移除后再发送')
    }

    return uploadedMeta
  }

  // 发送入口：先上传附件，再调用聊天发送，失败时回滚输入草稿。
  const handleSend = async () => {
    if (!canSend || generating) return
    const draftText = text
    setText('')
    requestAnimationFrame(resize)

    try {
      const attachments = pendingFiles.length > 0 ? await uploadPendingFiles() : []
      await onSend({ text: draftText, attachments, model: selectedModel, useWebSearch: isWebSearchEnabled })
      setPendingFiles([])
    } catch (error) {
      setText(draftText)
      requestAnimationFrame(resize)
      toast.error(error.message || '发送失败，请稍后重试')
    }
  }

  // 快捷键策略：Ctrl/Cmd+Enter 与 Enter 直接发送，Shift+Enter 换行。
  const onKeyDown = (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault()
      handleSend()
      return
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSend()
    }
  }

  // 处理文件选择并做前置校验（类型、大小、数量）。
  const handleSelectFile = (event) => {
    const selected = Array.from(event.target.files || [])
    if (selected.length === 0) return

    const slots = MAX_FILES - pendingFiles.length
    if (slots <= 0) {
      toast.error(`单次最多上传 ${MAX_FILES} 个文件`)
      event.target.value = ''
      return
    }

    const accepted = []
    for (const file of selected.slice(0, slots)) {
      if (!isAllowedChatFile(file)) {
        toast.error(`文件 ${file.name} 类型不支持，仅支持图片/PDF/TXT/Markdown`)
        continue
      }
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`文件 ${file.name} 超过 10MB 限制`)
        continue
      }
      accepted.push({
        id: createId('pending_file'),
        file,
        status: 'pending',
        progress: 0,
        error: '',
        uploaded: null,
      })
    }

    if (accepted.length > 0) {
      setPendingFiles((prev) => [...prev, ...accepted])
      // 异步触发即时上传，不阻塞文件选择交互。
      queueMicrotask(() => {
        uploadAcceptedFiles(accepted).catch(() => null)
      })
    }

    event.target.value = ''
  }

  // 从待上传队列移除指定附件。
  const removePending = (id) => {
    setPendingFiles((prev) => prev.filter((item) => item.id !== id))
  }

  // 将失败附件重置为待上传状态，允许用户重试。
  const retryPending = (id) => {
    const target = pendingFiles.find((item) => item.id === id)
    if (!target) return
    updatePendingFile(id, { status: 'pending', error: '', progress: 0 })
    queueMicrotask(() => {
      uploadAcceptedFiles([{ ...target, status: 'pending', error: '', progress: 0 }]).catch(() => null)
    })
  }

  return (
    <footer className='border-t border-border/80 bg-background/95 px-3 pb-3 pt-3 backdrop-blur md:px-5'>
      <div className='mx-auto w-full max-w-[1050px]'>
        <div className='rounded-[20px] border border-border bg-card/95 p-2.5 shadow-soft'>
          {pendingFiles.length > 0 && (
            <div className='mb-2 flex flex-wrap gap-2 rounded-xl border border-border/70 bg-muted/40 p-2'>
              {pendingFiles.map((item) => (
                <div key={item.id} className='group flex max-w-full items-center gap-2 rounded-md bg-card px-2 py-1 text-xs'>
                  <span className='truncate text-foreground'>{item.file.name}</span>
                  <span className='text-muted-foreground'>{formatFileSize(item.file.size)}</span>
                  {item.status === 'uploading' && (
                    <span className='text-primary'>上传中 {Number(item.progress || 0)}%</span>
                  )}
                  {item.status === 'success' && <span className='text-green-600'>已上传</span>}
                  {item.status === 'error' && <span className='text-red-500'>失败</span>}

                  {item.status === 'error' && (
                    <Button
                      size='icon'
                      variant='ghost'
                      className='h-6 w-6'
                      title='重试上传'
                      onClick={() => retryPending(item.id)}
                    >
                      <RotateCcw className='h-3.5 w-3.5' />
                    </Button>
                  )}

                  <Button
                    size='icon'
                    variant='ghost'
                    className='h-6 w-6 opacity-70 transition group-hover:opacity-100'
                    title='移除附件'
                    onClick={() => removePending(item.id)}
                  >
                    <Trash2 className='h-3.5 w-3.5' />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className='flex items-end gap-2'>
            <textarea
              ref={inputRef}
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                resize()
              }}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder='输入消息，Enter 发送，Shift + Enter 换行'
              className='max-h-[180px] min-h-[74px] flex-1 resize-none border-0 bg-transparent px-2 py-2.5 text-sm leading-6 outline-none placeholder:text-muted-foreground'
            />

            <Button
              className='mb-1 h-10 w-10 rounded-xl bg-[linear-gradient(135deg,#6578ff,#5b5df2)] text-white shadow-[0_10px_24px_rgba(84,95,234,0.28)] hover:brightness-105'
              size='icon'
              disabled={!canSend || generating}
              onClick={handleSend}
              title='发送消息'
              aria-label='发送消息'
            >
              <SendHorizonal className='h-4 w-4' />
            </Button>
          </div>

          <div className='mt-1.5 flex items-center justify-between gap-2'>
            <div className='flex flex-wrap items-center gap-1.5'>
              <input
                ref={fileInputRef}
                className='hidden'
                type='file'
                multiple
                accept='.pdf,.txt,.md,text/markdown,image/jpeg,image/png,image/gif,image/webp'
                onChange={handleSelectFile}
              />

              <Button
                type='button'
                size='sm'
                variant='ghost'
                className='h-8 rounded-lg px-2 text-xs text-muted-foreground'
                title='上传文件'
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className='mr-1.5 h-3.5 w-3.5' />附件
              </Button>

              <Button
                type='button'
                size='sm'
                variant='ghost'
                className={`h-8 rounded-lg px-2 text-xs transition-colors ${
                  isWebSearchEnabled 
                    ? 'bg-blue-100 text-blue-600 hover:bg-blue-200 dark:bg-blue-900/40 dark:text-blue-400' 
                    : 'text-muted-foreground'
                }`}
                title='联网搜索'
                onClick={() => setIsWebSearchEnabled(!isWebSearchEnabled)}
              >
                <Globe className={`mr-1.5 h-3.5 w-3.5 ${isWebSearchEnabled ? 'text-blue-500' : ''}`} />
                联网搜索
              </Button>

              <Button
                size='sm'
                variant='ghost'
                className='h-8 rounded-lg px-2 text-xs text-primary hover:bg-primary/10'
                // 与顶部按钮保持一致：可打开也可关闭 RAG 面板。
                onClick={toggleRightPanel}
                title={rightPanelOpen ? '关闭RAG面板' : '打开RAG面板'}
              >
                <Sparkles className='mr-1.5 h-3.5 w-3.5' />
                {rightPanelOpen ? '关闭 RAG' : '开启 RAG'}
              </Button>

              <Button
                size='sm'
                variant='ghost'
                className='h-8 rounded-lg px-2 text-xs text-muted-foreground'
                title='清空输入与附件'
                onClick={() => {
                  setText('')
                  setPendingFiles([])
                }}
              >
                <Eraser className='mr-1.5 h-3.5 w-3.5' />清空
              </Button>
            </div>

            {generating ? (
              <Button size='sm' variant='outline' className='h-8 rounded-lg px-2 text-xs' onClick={onStop}>
                <Square className='mr-1 h-3.5 w-3.5 fill-current' />停止生成
              </Button>
            ) : (
              <span className='pr-1 text-xs text-muted-foreground'>当前模型: {selectedModel || '未选择'}</span>
            )}
          </div>
        </div>

        <p className='pt-2 text-center text-xs text-muted-foreground'>AI生成内容仅供参考，请仔细核实</p>
      </div>
    </footer>
  )
}
