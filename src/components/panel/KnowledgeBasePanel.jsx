// 模块说明：知识库管理面板，负责上传、筛选、重建与删除文档。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, Search, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  clearFailedKbDocuments,
  deleteKbDocument,
  fetchKbDocuments,
  reindexKbDocument,
  uploadKbDocument,
} from '@/services/kbApi'

const ALLOWED_TYPES = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]
const MAX_FILE_SIZE = 10 * 1024 * 1024

// 将时间戳转为本地可读时间，用于文档列表展示。
function formatTime(value) {
  const time = Number(value || 0)
  if (!time) return '未知时间'
  const date = new Date(time)
  if (Number.isNaN(date.getTime())) return '未知时间'
  return date.toLocaleString('zh-CN', { hour12: false })
}

// 解析状态映射为用户可读文案。
function statusLabel(parseStatus) {
  if (parseStatus === 'queued') return '排队中'
  if (parseStatus === 'parsing') return '解析中'
  if (parseStatus === 'indexed') return '已建索引'
  if (parseStatus === 'ok') return '已建索引'
  if (parseStatus === 'empty') return '已建索引'
  if (parseStatus === 'failed') return '解析失败'
  return '待处理'
}

export function KnowledgeBasePanel({ compact = false }) {
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [filter, setFilter] = useState('all')
  const [keyword, setKeyword] = useState('')
  const [confirmState, setConfirmState] = useState({
    open: false,
    type: '',
    doc: null,
  })
  const [confirmSubmitting, setConfirmSubmitting] = useState(false)
  const [busyMap, setBusyMap] = useState({})
  const [loadError, setLoadError] = useState('')
  const initializedRef = useRef(false)
  const inFlightRef = useRef(false)
  const fileInputRef = useRef(null)

  // 拉取文档列表；通过 inFlight 锁避免并发请求导致状态错乱。
  const refreshDocs = useCallback(async ({ silentError = false } = {}) => {
    // 避免严格模式和重复点击导致并发请求，减少重复报错与状态抖动。
    if (inFlightRef.current) return
    inFlightRef.current = true
    setLoading(true)
    setLoadError('')
    try {
      const list = await fetchKbDocuments()
      setDocs(list)
    } catch (error) {
      const message = error.message || '读取知识库失败'
      setLoadError(message)
      if (!silentError) {
        toast.error(message)
      }
    } finally {
      inFlightRef.current = false
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // 初次挂载时静默加载：失败仅在面板内展示，不弹出重复提示。
    if (initializedRef.current) return
    initializedRef.current = true
    refreshDocs({ silentError: true })
  }, [refreshDocs])

  const hasProcessingDocs = useMemo(
    () => docs.some((doc) => doc?.parseStatus === 'queued' || doc?.parseStatus === 'parsing'),
    [docs],
  )

  useEffect(() => {
    // 有后台解析任务时自动轮询，保持面板状态实时更新。
    if (!hasProcessingDocs) return
    const timer = setInterval(() => {
      refreshDocs({ silentError: true })
    }, 2500)
    return () => clearInterval(timer)
  }, [hasProcessingDocs, refreshDocs])

  useEffect(() => {
    // 阻止浏览器默认接管拖拽文件（会直接打开文件页）。
    const preventBrowserDrop = (event) => {
      event.preventDefault()
    }

    window.addEventListener('dragover', preventBrowserDrop)
    window.addEventListener('drop', preventBrowserDrop)

    return () => {
      window.removeEventListener('dragover', preventBrowserDrop)
      window.removeEventListener('drop', preventBrowserDrop)
    }
  }, [])

  const runningCount = useMemo(() => Object.values(busyMap).filter(Boolean).length, [busyMap])
  const processingCount = useMemo(
    () => docs.filter((doc) => doc?.parseStatus === 'queued' || doc?.parseStatus === 'parsing').length,
    [docs],
  )
  const failedCount = useMemo(
    () => docs.filter((doc) => doc?.parseStatus === 'failed').length,
    [docs],
  )

  // 按状态与关键词过滤文档列表，减少渲染时重复计算。
  const filteredDocs = useMemo(() => {
    const query = keyword.trim().toLowerCase()
    const withKeyword = query
      ? docs.filter((doc) => String(doc?.name || '').toLowerCase().includes(query))
      : docs

    if (filter === 'processing') {
      return withKeyword.filter((doc) => doc?.parseStatus === 'queued' || doc?.parseStatus === 'parsing')
    }
    if (filter === 'failed') {
      return withKeyword.filter((doc) => doc?.parseStatus === 'failed')
    }
    return withKeyword
  }, [docs, filter, keyword])

  // 标记单个文档的忙碌状态（重建/删除中）。
  const setDocBusy = (docId, busy) => {
    setBusyMap((prev) => ({
      ...prev,
      [docId]: busy,
    }))
  }

  // 对单个文档发起重建索引。
  const handleReindex = async (doc) => {
    const docId = String(doc?.docId || '').trim()
    if (!docId) return

    setDocBusy(docId, true)
    try {
      const result = await reindexKbDocument(docId)
      const queued = result?.result?.parseStatus === 'queued'
      toast.success(queued ? `已加入重建队列: ${doc.name || '未命名文档'}` : `已重建索引: ${doc.name || '未命名文档'}`)
      await refreshDocs({ silentError: true })
    } catch (error) {
      toast.error(error.message || '重建索引失败')
    } finally {
      setDocBusy(docId, false)
    }
  }

  // 删除操作先走确认弹窗，避免误删。
  const handleDelete = async (doc) => {
    const docId = String(doc?.docId || '').trim()
    if (!docId) return

    setConfirmState({
      open: true,
      type: 'delete-doc',
      doc,
    })
  }

  // 上传前校验文件类型与大小，失败返回可展示的错误文案。
  function validateUploadFile(file) {
    const isMd = file.name.toLowerCase().endsWith('.md')
    const isDoc = file.name.toLowerCase().endsWith('.doc')
    const isDocx = file.name.toLowerCase().endsWith('.docx')
    if (!ALLOWED_TYPES.includes(file.type) && !isMd && !isDoc && !isDocx) {
      return '仅支持 PDF/TXT/Markdown/DOC/DOCX 文件'
    }

    if (file.size > MAX_FILE_SIZE) {
      return '文件大小不能超过 10MB'
    }

    return ''
  }

  // 批量上传文档并在成功后刷新列表。
  const uploadFiles = useCallback(
    async (files) => {
      const list = Array.from(files || [])
      if (list.length === 0) return

      setUploading(true)
      let successCount = 0

      // 批量上传串行执行，避免并发过高导致浏览器和后端压力突增。
      for (const file of list) {
        const validationError = validateUploadFile(file)
        if (validationError) {
          toast.error(`${file.name}: ${validationError}`)
          continue
        }

        try {
          await uploadKbDocument(file)
          successCount += 1
        } catch (error) {
          toast.error(`${file.name}: ${error.message || '知识库文档上传失败'}`)
        }
      }

      if (successCount > 0) {
        toast.success(`已上传 ${successCount} 个文档`)
        await refreshDocs({ silentError: true })
      }

      setUploading(false)
    },
    [refreshDocs],
  )

  // 选择文件后立即清空 input，确保同一文件可重复选择。
  const handleSelectUpload = async (event) => {
    // 先拷贝文件列表，再清空 input，避免 FileList 被重置后上传拿到空数组。
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (files.length === 0) return
    await uploadFiles(files)
  }

  // 触发“清理失败文档”确认流程。
  const handleClearFailed = async () => {
    if (failedCount <= 0) return

    setConfirmState({
      open: true,
      type: 'clear-failed',
      doc: null,
    })
  }

  // 统一执行确认弹窗中的动作（删单个/清失败）。
  const handleConfirmAction = async () => {
    if (!confirmState?.type) return

    setConfirmSubmitting(true)
    try {
      if (confirmState.type === 'delete-doc') {
        const doc = confirmState.doc
        const docId = String(doc?.docId || '').trim()
        if (docId) {
          setDocBusy(docId, true)
          await deleteKbDocument(docId)
          toast.success(`已删除: ${doc?.name || '未命名文档'}`)
          setDocs((prev) => prev.filter((item) => item.docId !== docId))
        }
      }

      if (confirmState.type === 'clear-failed') {
        const result = await clearFailedKbDocuments()
        const deletedCount = Number(result?.result?.deletedCount || 0)
        toast.success(`已清理 ${deletedCount} 个失败文档`)
        await refreshDocs({ silentError: true })
      }

      setConfirmState({ open: false, type: '', doc: null })
    } catch (error) {
      if (confirmState.type === 'delete-doc') {
        toast.error(error.message || '删除文档失败')
      } else {
        toast.error(error.message || '清理失败文档失败')
      }
    } finally {
      const docId = String(confirmState?.doc?.docId || '').trim()
      if (docId) setDocBusy(docId, false)
      setConfirmSubmitting(false)
    }
  }

  return (
    <section className={compact ? '' : 'mt-4'}>
      <div className='mb-2 flex items-center justify-between'>
        <h3 className='text-sm font-semibold'>知识库管理</h3>
        <Button
          size='sm'
          variant='ghost'
          className='h-7 px-2 text-xs'
          disabled={loading || uploading}
          onClick={() => refreshDocs()}
        >
          <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </Button>
      </div>

      <div
        className={`mb-2 rounded-lg border border-dashed p-2 text-xs text-muted-foreground ${
          dragging ? 'border-primary bg-primary/5' : 'border-border'
        }`}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={async (event) => {
          event.preventDefault()
          setDragging(false)
          if (uploading) return
          await uploadFiles(event.dataTransfer?.files)
        }}
      >
        <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
          <span
            className='text-[11px] leading-5 break-words text-muted-foreground'
            title='支持 PDF/TXT/Markdown/DOC/DOCX，单文件最大 10MB，可拖拽或批量上传'
          >
            支持 PDF/TXT/Markdown/DOC/DOCX，单文件最大 10MB，可拖拽或批量上传
          </span>
          <Button
            size='sm'
            className='h-7 px-2 text-xs'
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className='mr-1 h-3.5 w-3.5' />
            {uploading ? '上传中...' : '上传文档'}
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type='file'
          multiple
          accept='.pdf,.txt,.md,.doc,.docx,text/plain,application/pdf,text/markdown,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          className='hidden'
          onChange={handleSelectUpload}
        />
      </div>

      <div className='mb-2 space-y-2'>
        <div className='flex flex-wrap items-center gap-2'>
          <Button
            size='sm'
            variant={filter === 'all' ? 'default' : 'outline'}
            className='h-7 px-2 text-xs'
            onClick={() => setFilter('all')}
          >
            全部
          </Button>
          <Button
            size='sm'
            variant={filter === 'processing' ? 'default' : 'outline'}
            className='h-7 px-2 text-xs'
            onClick={() => setFilter('processing')}
          >
            处理中
          </Button>
          <Button
            size='sm'
            variant={filter === 'failed' ? 'default' : 'outline'}
            className='h-7 px-2 text-xs'
            onClick={() => setFilter('failed')}
          >
            失败
          </Button>
        </div>
        <div className='flex justify-end'>
          <Button
            size='sm'
            variant='ghost'
            className='h-7 px-2 text-xs text-red-500 hover:text-red-500'
            disabled={failedCount <= 0}
            onClick={handleClearFailed}
          >
            清理失败项
          </Button>
        </div>
      </div>

      <label className='mb-2 flex items-center gap-2 rounded-lg border border-border bg-card px-2 py-1.5'>
        <Search className='h-3.5 w-3.5 text-muted-foreground' />
        <input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder='搜索文档名'
          className='w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground'
        />
      </label>

      {loadError && (
        <p className='mb-2 rounded-lg border border-red-300/60 bg-red-50 p-2 text-xs text-red-600 dark:bg-red-950/30 dark:text-red-300'>
          {loadError}
        </p>
      )}

      <div className='space-y-2'>
        {filteredDocs.length === 0 ? (
          <p className='rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground'>
            {loading ? '加载中...' : filter === 'all' ? '暂无文档，请先上传文件建立知识库' : '当前筛选下暂无文档'}
          </p>
        ) : (
          filteredDocs.map((doc) => {
            const busy = Boolean(busyMap[doc.docId])
            return (
              <div key={doc.docId} className='rounded-lg border border-border bg-card p-3'>
                <p className='truncate text-xs font-medium text-foreground'>{doc.name || '未命名文档'}</p>
                <p className='mt-1 text-xs text-muted-foreground'>状态: {statusLabel(doc.parseStatus)}</p>
                <p className='mt-1 text-xs text-muted-foreground'>分块数: {Number(doc.chunkCount || 0)}</p>
                <p className='mt-1 text-xs text-muted-foreground'>更新时间: {formatTime(doc.updatedAt)}</p>
                {doc.parseStatus === 'failed' && doc.parseError && (
                  <p className='mt-1 text-xs text-red-500'>失败原因: {doc.parseError}</p>
                )}

                <div className='mt-2 flex items-center gap-2'>
                  <Button
                    size='sm'
                    variant='outline'
                    className='h-7 px-2 text-xs'
                    disabled={busy}
                    onClick={() => handleReindex(doc)}
                  >
                    {busy ? '处理中...' : doc.parseStatus === 'failed' ? '重试解析' : '重建索引'}
                  </Button>
                  <Button
                    size='sm'
                    variant='ghost'
                    className='h-7 px-2 text-xs text-red-500 hover:text-red-500'
                    disabled={busy}
                    onClick={() => handleDelete(doc)}
                  >
                    <Trash2 className='mr-1 h-3.5 w-3.5' />删除
                  </Button>
                </div>
              </div>
            )
          })
        )}
      </div>

      {runningCount > 0 && (
        <p className='mt-2 text-xs text-muted-foreground'>当前有 {runningCount} 个文档任务处理中</p>
      )}
      {processingCount > 0 && (
        <p className='mt-1 text-xs text-muted-foreground'>知识库后台解析中: {processingCount} 个</p>
      )}
      {failedCount > 0 && (
        <p className='mt-1 text-xs text-muted-foreground'>当前失败文档: {failedCount} 个</p>
      )}

      <AlertDialog open={confirmState.open} onOpenChange={(open) => setConfirmState((prev) => ({ ...prev, open }))}>
        <AlertDialogContent className='top-[42%]'>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmState.type === 'delete-doc' ? '确认删除文档' : '确认清理失败项'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmState.type === 'delete-doc'
                ? `将删除文档“${confirmState?.doc?.name || '未命名文档'}”及其索引数据，此操作不可撤销。`
                : `将清理 ${failedCount} 个失败文档及其残留数据，此操作不可撤销。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancelButton disabled={confirmSubmitting}>取消</AlertDialogCancelButton>
            <AlertDialogConfirmButton disabled={confirmSubmitting} onClick={handleConfirmAction}>
              {confirmSubmitting ? '处理中...' : '确认'}
            </AlertDialogConfirmButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
