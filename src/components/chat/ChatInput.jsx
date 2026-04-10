// 模块说明：聊天输入区组件，负责文本输入、附件选择上传与发送控制。
import { useMemo, useRef, useState } from 'react'
import { Eraser, Paperclip, Plus, SendHorizonal, Square, Trash2, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { uploadDocument } from '@/services/uploadApi'
import { useChatStore } from '@/stores/chatStore'
import { createId } from '@/lib/utils'

const ALLOWED_TYPES = ['application/pdf', 'text/plain', 'text/markdown']
const MAX_FILES = 5
const MAX_FILE_SIZE = 10 * 1024 * 1024

// 格式化文件体积显示，统一附件列表中的单位表现。
function formatFileSize(size = 0) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export function ChatInput({
  onSend,
  onStop,
  availableModels = [],
  selectedModel = '',
  onSelectModel,
  modelsLoading = false,
}) {
  const [text, setText] = useState('')
  const [pendingFiles, setPendingFiles] = useState([])
  const generating = useChatStore((s) => s.generating)
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

  // 上传待发送附件并收集后端回传的附件元数据。
  const uploadPendingFiles = async () => {
    const filesToUpload = pendingFiles.filter((item) => item.status !== 'success')
    const uploadedMeta = pendingFiles
      .filter((item) => item.status === 'success' && item.uploaded)
      .map((item) => item.uploaded)

    // 单文件上传任务：状态写回 pendingFiles，用于前端可视反馈。
    const uploadOne = async (item) => {
      updatePendingFile(item.id, { status: 'uploading', error: '' })
      try {
        const result = await uploadDocument(item.file)
        const ext = item.file.name.includes('.') ? item.file.name.split('.').pop()?.toLowerCase() || '' : ''
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

        updatePendingFile(item.id, { status: 'success', uploaded: meta, error: '' })
        return { ok: true, meta }
      } catch (error) {
        updatePendingFile(item.id, { status: 'error', error: error.message || '上传失败' })
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
      await onSend({ text: draftText, attachments, model: selectedModel })
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
      const isMd = file.name.toLowerCase().endsWith('.md')
      if (!ALLOWED_TYPES.includes(file.type) && !isMd) {
        toast.error(`文件 ${file.name} 类型不支持，仅支持 PDF/TXT/Markdown`)
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
        error: '',
        uploaded: null,
      })
    }

    if (accepted.length > 0) {
      setPendingFiles((prev) => [...prev, ...accepted])
    }

    event.target.value = ''
  }

  // 从待上传队列移除指定附件。
  const removePending = (id) => {
    setPendingFiles((prev) => prev.filter((item) => item.id !== id))
  }

  // 将失败附件重置为待上传状态，允许用户重试。
  const retryPending = (id) => {
    updatePendingFile(id, { status: 'pending', error: '' })
  }

  return (
    <footer className='border-t border-border bg-background/98 px-3 pb-3 pt-2 backdrop-blur md:px-5'>
      <div className='mx-auto w-full max-w-[980px]'>
        <div className='rounded-2xl border border-border bg-card p-2 shadow-soft'>
          {pendingFiles.length > 0 && (
            <div className='mb-2 flex flex-wrap gap-2 rounded-lg border border-border/70 bg-muted/40 p-2'>
              {pendingFiles.map((item) => (
                <div key={item.id} className='group flex max-w-full items-center gap-2 rounded-md bg-card px-2 py-1 text-xs'>
                  <span className='truncate text-foreground'>{item.file.name}</span>
                  <span className='text-muted-foreground'>{formatFileSize(item.file.size)}</span>
                  {item.status === 'uploading' && <span className='text-primary'>上传中</span>}
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

          <div className='mb-2 flex items-center justify-between'>
            <div className='flex items-center gap-1'>
              <input
                ref={fileInputRef}
                className='hidden'
                type='file'
                multiple
                accept='.pdf,.txt,.md,text/markdown'
                onChange={handleSelectFile}
              />
              <Button
                type='button'
                size='icon'
                variant='ghost'
                className='h-8 w-8 cursor-pointer'
                title='上传文件'
                onClick={() => fileInputRef.current?.click()}
              >
                <span>
                  <Paperclip className='h-4 w-4' />
                </span>
              </Button>
              <Button
                size='icon'
                variant='ghost'
                className='h-8 w-8'
                title='清空输入与附件'
                onClick={() => {
                  setText('')
                  setPendingFiles([])
                }}
              >
                <Eraser className='h-4 w-4' />
              </Button>
              <Button size='icon' variant='ghost' className='h-8 w-8' title='更多功能（敬请期待）'>
                <Plus className='h-4 w-4' />
              </Button>

              <label className='ml-1 flex items-center gap-2 rounded-lg border border-border bg-background px-2 py-1 text-xs text-muted-foreground'>
                <span className='whitespace-nowrap'>模型</span>
                <select
                  value={selectedModel}
                  onChange={(event) => onSelectModel?.(event.target.value)}
                  disabled={modelsLoading || availableModels.length === 0}
                  className='max-w-[160px] bg-transparent text-foreground outline-none disabled:opacity-60'
                  title={selectedModel || '选择模型'}
                >
                  {availableModels.length === 0 ? (
                    <option value=''>{modelsLoading ? '加载中...' : '无可用模型'}</option>
                  ) : (
                    availableModels.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))
                  )}
                </select>
              </label>
            </div>

            {generating ? (
              <Button size='sm' variant='outline' onClick={onStop}>
                <Square className='mr-1 h-3.5 w-3.5 fill-current' />停止生成
              </Button>
            ) : (
              <Button size='sm' variant='ghost' className='text-xs text-muted-foreground'>
                回车发送，Shift+回车换行
              </Button>
            )}
          </div>

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
              placeholder='给Kira发送消息...'
              className='max-h-[180px] min-h-[42px] flex-1 resize-none border-0 bg-transparent px-1.5 py-2 text-sm outline-none placeholder:text-muted-foreground'
            />

            <Button
              className='h-10 w-10 rounded-xl'
              size='icon'
              disabled={!canSend || generating}
              onClick={handleSend}
              title='发送消息'
              aria-label='发送消息'
            >
              <SendHorizonal className='h-4 w-4' />
            </Button>
          </div>
        </div>

        <p className='pt-2 text-center text-xs text-muted-foreground'>AI生成内容仅供参考，请仔细核实</p>
      </div>
    </footer>
  )
}
