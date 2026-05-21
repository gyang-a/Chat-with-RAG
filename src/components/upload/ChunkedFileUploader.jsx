import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2,
  FileUp,
  FolderOpen,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  UploadCloud,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn, createId } from '@/lib/utils'

const DEFAULT_CHUNK_SIZE = 2 * 1024 * 1024
const DEFAULT_MAX_FILES = 5
const DEFAULT_MAX_FILE_SIZE = 1024 * 1024 * 1024
const DEFAULT_CONCURRENT_CHUNKS = 3
const RESUME_PREFIX = 'chunked-upload:'

function formatFileSize(size = 0) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function getFileExt(fileName = '') {
  const index = String(fileName).lastIndexOf('.')
  return index >= 0 ? String(fileName).slice(index + 1).toLowerCase() : ''
}

function buildFileFingerprint(file) {
  return [
    file.name,
    file.size,
    file.lastModified,
    file.type || 'unknown',
  ].join(':')
}

function readResumeState(fingerprint) {
  try {
    const raw = window.localStorage.getItem(`${RESUME_PREFIX}${fingerprint}`)
    const parsed = raw ? JSON.parse(raw) : null
    return Array.isArray(parsed?.uploadedChunks) ? parsed.uploadedChunks : []
  } catch {
    return []
  }
}

function writeResumeState(fingerprint, uploadedChunks) {
  try {
    window.localStorage.setItem(
      `${RESUME_PREFIX}${fingerprint}`,
      JSON.stringify({ uploadedChunks: [...new Set(uploadedChunks)], updatedAt: Date.now() }),
    )
  } catch {
    // localStorage may be unavailable in private mode.
  }
}

function clearResumeState(fingerprint) {
  try {
    window.localStorage.removeItem(`${RESUME_PREFIX}${fingerprint}`)
  } catch {
    // noop
  }
}

function mergeUploadedChunks(...lists) {
  return [...new Set(lists.flat().map((item) => Number(item)).filter((item) => Number.isInteger(item) && item >= 0))]
}

function requestJSON(url, { method = 'POST', headers = {}, body } = {}) {
  return fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (response) => {
    const text = await response.text()
    const data = text ? JSON.parse(text) : {}
    if (!response.ok) {
      throw new Error(data?.message || `请求失败: ${response.status}`)
    }
    return data
  })
}

function uploadChunkByXHR({ url, fileItem, chunkIndex, chunkSize, headers, signal, onProgress }) {
  if (!url) {
    return Promise.reject(new Error('缺少 chunkUploadUrl 或 uploadChunk 处理函数'))
  }

  const { file, uploadId, fingerprint, totalChunks } = fileItem
  const start = chunkIndex * chunkSize
  const end = Math.min(file.size, start + chunkSize)
  const formData = new FormData()
  formData.append('fileName', file.name)
  formData.append('fileSize', String(file.size))
  formData.append('fileType', file.type || '')
  formData.append('fingerprint', fingerprint)
  formData.append('uploadId', uploadId || fingerprint)
  formData.append('chunkIndex', String(chunkIndex))
  formData.append('totalChunks', String(totalChunks))
  formData.append('chunk', file.slice(start, end), `${file.name}.part${chunkIndex}`)

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url, true)

    Object.entries(headers || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null) xhr.setRequestHeader(key, String(value))
    })

    const abort = () => {
      xhr.abort()
      reject(new DOMException('上传已暂停', 'AbortError'))
    }

    if (signal?.aborted) {
      abort()
      return
    }
    signal?.addEventListener('abort', abort, { once: true })

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return
      onProgress?.(chunkIndex, event.loaded, event.total)
    }

    xhr.onerror = () => reject(new Error('分片上传失败，请检查网络后重试'))
    xhr.onload = () => {
      signal?.removeEventListener('abort', abort)
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ chunkIndex })
        return
      }

      let message = `分片上传失败: ${xhr.status}`
      try {
        message = JSON.parse(xhr.responseText || '{}')?.message || message
      } catch {
        // keep default message
      }
      reject(new Error(message))
    }

    xhr.send(formData)
  })
}

function statusLabel(status) {
  if (status === 'queued') return '待上传'
  if (status === 'uploading') return '上传中'
  if (status === 'paused') return '已暂停'
  if (status === 'success') return '已完成'
  if (status === 'error') return '上传失败'
  return '待上传'
}

function createUploadItem(file, chunkSize, enableResume) {
  const fingerprint = buildFileFingerprint(file)
  const totalChunks = Math.max(1, Math.ceil(file.size / chunkSize))
  const uploadedChunks = enableResume ? readResumeState(fingerprint).filter((index) => index < totalChunks) : []
  const progress = totalChunks > 0 ? Math.floor((uploadedChunks.length / totalChunks) * 100) : 0

  return {
    id: createId('upload'),
    file,
    fingerprint,
    uploadId: fingerprint,
    totalChunks,
    uploadedChunks,
    status: uploadedChunks.length === totalChunks ? 'success' : 'queued',
    progress,
    uploadedBytes: uploadedChunks.length * chunkSize,
    error: '',
    result: null,
  }
}

export function ChunkedFileUploader({
  className,
  accept,
  multiple = true,
  autoUpload = false,
  enableResume = true,
  chunkSize = DEFAULT_CHUNK_SIZE,
  maxFiles = DEFAULT_MAX_FILES,
  maxFileSize = DEFAULT_MAX_FILE_SIZE,
  maxConcurrentChunks = DEFAULT_CONCURRENT_CHUNKS,
  headers,
  checkUploadUrl = '',
  chunkUploadUrl = '',
  completeUploadUrl = '',
  checkUploadedChunks,
  initUpload,
  uploadChunk,
  completeUpload,
  validateFile,
  onFilesChange,
  onUploadSuccess,
  onUploadError,
}) {
  const [items, setItems] = useState([])
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef(null)
  const itemsRef = useRef([])
  const controllersRef = useRef(new Map())
  const progressRef = useRef(new Map())
  const normalizedChunkSize = Math.max(256 * 1024, Number(chunkSize || DEFAULT_CHUNK_SIZE))
  const normalizedMaxConcurrentChunks = Math.max(1, Number(maxConcurrentChunks || DEFAULT_CONCURRENT_CHUNKS))

  const headerValues = useMemo(() => {
    return typeof headers === 'function' ? headers() : (headers || {})
  }, [headers])

  useEffect(() => {
    onFilesChange?.(items)
  }, [items, onFilesChange])

  const updateItems = (updater) => {
    setItems((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      itemsRef.current = next
      return next
    })
  }

  const patchItem = (id, patch) => {
    updateItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  const validateSelectedFile = (file) => {
    if (file.size > maxFileSize) {
      return `文件不能超过 ${formatFileSize(maxFileSize)}`
    }
    const customError = validateFile?.(file)
    return customError || ''
  }

  const addFiles = (fileList) => {
    const selected = Array.from(fileList || [])
    if (selected.length === 0) return

    const availableSlots = Math.max(0, maxFiles - items.length)
    const acceptedFiles = selected.slice(0, availableSlots)
    const nextItems = acceptedFiles.map((file) => {
      const error = validateSelectedFile(file)
      const item = createUploadItem(file, normalizedChunkSize, enableResume)
      return error ? { ...item, status: 'error', error } : item
    })

    updateItems((prev) => [...prev, ...nextItems])
    if (autoUpload) {
      window.setTimeout(() => {
        nextItems.filter((item) => item.status === 'queued').forEach((item) => startUpload(item.id))
      }, 0)
    }
  }

  const resolveUploadedChunks = async (item) => {
    const localChunks = enableResume ? readResumeState(item.fingerprint) : []

    if (checkUploadedChunks) {
      const remote = await checkUploadedChunks(item)
      return mergeUploadedChunks(localChunks, remote)
    }

    if (checkUploadUrl) {
      const params = new URLSearchParams({
        fingerprint: item.fingerprint,
        fileName: item.file.name,
        fileSize: String(item.file.size),
        totalChunks: String(item.totalChunks),
      })
      const data = await requestJSON(`${checkUploadUrl}?${params.toString()}`, {
        method: 'GET',
        headers: headerValues,
      })
      return mergeUploadedChunks(localChunks, data?.uploadedChunks)
    }

    return localChunks
  }

  const runInitUpload = async (item, uploadedChunks) => {
    if (initUpload) {
      return initUpload({ ...item, uploadedChunks })
    }
    return {
      uploadId: item.uploadId || item.fingerprint,
      uploadedChunks,
    }
  }

  const runCompleteUpload = async (item) => {
    if (completeUpload) return completeUpload(item)
    if (!completeUploadUrl) return { ok: true, uploadId: item.uploadId || item.fingerprint }

    return requestJSON(completeUploadUrl, {
      method: 'POST',
      headers: headerValues,
      body: {
        uploadId: item.uploadId || item.fingerprint,
        fingerprint: item.fingerprint,
        fileName: item.file.name,
        fileSize: item.file.size,
        fileType: item.file.type || '',
        totalChunks: item.totalChunks,
      },
    })
  }

  const runUploadChunk = (item, chunkIndex, signal) => {
    if (uploadChunk) {
      return uploadChunk({
        item,
        file: item.file,
        chunkIndex,
        totalChunks: item.totalChunks,
        chunkSize: normalizedChunkSize,
        uploadId: item.uploadId || item.fingerprint,
        fingerprint: item.fingerprint,
        signal,
        onProgress: (loaded, total) => updateChunkProgress(item.id, chunkIndex, loaded, total),
      })
    }

    return uploadChunkByXHR({
      url: chunkUploadUrl,
      fileItem: item,
      chunkIndex,
      chunkSize: normalizedChunkSize,
      headers: headerValues,
      signal,
      onProgress: (index, loaded, total) => updateChunkProgress(item.id, index, loaded, total),
    })
  }

  const updateChunkProgress = (id, chunkIndex, loaded, total) => {
    const progressKey = `${id}:${chunkIndex}`
    progressRef.current.set(progressKey, Math.min(loaded, total))

    updateItems((prev) => prev.map((item) => {
      if (item.id !== id) return item

      let activeBytes = 0
      for (const [key, value] of progressRef.current.entries()) {
        if (key.startsWith(`${id}:`)) activeBytes += Number(value || 0)
      }

      const uploadedBytes = item.uploadedChunks.reduce((sum, index) => {
        const start = index * normalizedChunkSize
        const end = Math.min(item.file.size, start + normalizedChunkSize)
        return sum + Math.max(0, end - start)
      }, 0)
      const progress = Math.min(99, Math.floor(((uploadedBytes + activeBytes) / item.file.size) * 100))
      return { ...item, progress, uploadedBytes: uploadedBytes + activeBytes }
    }))
  }

  const startUpload = async (id) => {
    const current = itemsRef.current.find((item) => item.id === id)
    if (!current || current.status === 'uploading' || current.status === 'success') return

    const controller = new AbortController()
    controllersRef.current.set(id, controller)
    progressRef.current = new Map([...progressRef.current.entries()].filter(([key]) => !key.startsWith(`${id}:`)))
    patchItem(id, { status: 'uploading', error: '' })

    try {
      const remoteChunks = await resolveUploadedChunks(current)
      const uploadedChunks = mergeUploadedChunks(current.uploadedChunks, remoteChunks).filter((index) => index < current.totalChunks)
      const initResult = await runInitUpload(current, uploadedChunks)
      let workingItem = {
        ...current,
        uploadId: initResult?.uploadId || current.uploadId || current.fingerprint,
        uploadedChunks: mergeUploadedChunks(uploadedChunks, initResult?.uploadedChunks).filter((index) => index < current.totalChunks),
      }

      patchItem(id, {
        uploadId: workingItem.uploadId,
        uploadedChunks: workingItem.uploadedChunks,
        progress: Math.floor((workingItem.uploadedChunks.length / workingItem.totalChunks) * 100),
      })

      const uploadedSet = new Set(workingItem.uploadedChunks)
      const pendingIndexes = Array.from({ length: workingItem.totalChunks }, (_, index) => index).filter((index) => !uploadedSet.has(index))
      let cursor = 0

      const worker = async () => {
        while (cursor < pendingIndexes.length) {
          if (controller.signal.aborted) return
          const chunkIndex = pendingIndexes[cursor]
          cursor += 1
          await runUploadChunk(workingItem, chunkIndex, controller.signal)
          progressRef.current.delete(`${id}:${chunkIndex}`)
          uploadedSet.add(chunkIndex)
          const nextUploadedChunks = [...uploadedSet].sort((a, b) => a - b)
          if (enableResume) writeResumeState(workingItem.fingerprint, nextUploadedChunks)
          workingItem = { ...workingItem, uploadedChunks: nextUploadedChunks }
          patchItem(id, {
            uploadedChunks: nextUploadedChunks,
            progress: Math.min(99, Math.floor((nextUploadedChunks.length / workingItem.totalChunks) * 100)),
          })
        }
      }

      await Promise.all(
        Array.from({ length: Math.min(normalizedMaxConcurrentChunks, pendingIndexes.length || 1) }, () => worker()),
      )

      if (controller.signal.aborted) return

      const completedItem = { ...workingItem, uploadedChunks: [...uploadedSet].sort((a, b) => a - b) }
      const result = await runCompleteUpload(completedItem)
      clearResumeState(completedItem.fingerprint)
      patchItem(id, { status: 'success', progress: 100, uploadedBytes: completedItem.file.size, result })
      onUploadSuccess?.(completedItem, result)
    } catch (error) {
      if (error?.name === 'AbortError') {
        patchItem(id, { status: 'paused', error: '' })
        return
      }

      const failedItem = itemsRef.current.find((item) => item.id === id) || current
      patchItem(id, { status: 'error', error: error?.message || '上传失败' })
      onUploadError?.(failedItem, error)
    } finally {
      controllersRef.current.delete(id)
      progressRef.current = new Map([...progressRef.current.entries()].filter(([key]) => !key.startsWith(`${id}:`)))
    }
  }

  const pauseUpload = (id) => {
    controllersRef.current.get(id)?.abort()
  }

  const retryUpload = (id) => {
    patchItem(id, { status: 'queued', error: '' })
    window.setTimeout(() => startUpload(id), 0)
  }

  const removeItem = (id) => {
    const item = itemsRef.current.find((entry) => entry.id === id)
    controllersRef.current.get(id)?.abort()
    if (item) clearResumeState(item.fingerprint)
    updateItems((prev) => prev.filter((entry) => entry.id !== id))
  }

  const clearCompleted = () => {
    updateItems((prev) => prev.filter((item) => item.status !== 'success'))
  }

  const queuedCount = items.filter((item) => item.status === 'queued' || item.status === 'paused' || item.status === 'error').length
  const uploadingCount = items.filter((item) => item.status === 'uploading').length

  return (
    <section className={cn('rounded-lg border border-border bg-card p-3', className)}>
      <div
        className={cn(
          'flex min-h-36 flex-col items-center justify-center rounded-lg border border-dashed p-4 text-center transition-colors',
          dragging ? 'border-primary bg-primary/5' : 'border-border bg-background',
        )}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          addFiles(event.dataTransfer?.files)
        }}
      >
        <UploadCloud className='mb-2 h-8 w-8 text-muted-foreground' />
        <p className='text-sm font-medium text-foreground'>拖拽文件到此处上传</p>
        <p className='mt-1 text-xs text-muted-foreground'>
          支持分片上传与断点续传，单文件最大 {formatFileSize(maxFileSize)}
        </p>
        <Button
          type='button'
          size='sm'
          variant='outline'
          className='mt-3'
          onClick={() => inputRef.current?.click()}
        >
          <FolderOpen className='mr-1.5 h-4 w-4' />
          选择文件
        </Button>
        <input
          ref={inputRef}
          type='file'
          multiple={multiple}
          accept={accept}
          className='hidden'
          onChange={(event) => {
            addFiles(event.target.files)
            event.target.value = ''
          }}
        />
      </div>

      {items.length > 0 && (
        <div className='mt-3 flex flex-wrap items-center justify-between gap-2'>
          <p className='text-xs text-muted-foreground'>
            共 {items.length} 个文件，{uploadingCount} 个上传中
          </p>
          <div className='flex items-center gap-2'>
            <Button
              type='button'
              size='sm'
              variant='outline'
              disabled={queuedCount === 0}
              onClick={() => {
                items
                  .filter((item) => item.status === 'queued' || item.status === 'paused' || item.status === 'error')
                  .forEach((item) => startUpload(item.id))
              }}
            >
              <FileUp className='mr-1.5 h-4 w-4' />
              开始上传
            </Button>
            <Button type='button' size='sm' variant='ghost' onClick={clearCompleted}>
              清除完成
            </Button>
          </div>
        </div>
      )}

      <div className='mt-3 space-y-2'>
        {items.map((item) => {
          const ext = getFileExt(item.file.name)
          const canStart = item.status === 'queued' || item.status === 'paused'
          const canRetry = item.status === 'error'

          return (
            <article key={item.id} className='rounded-lg border border-border bg-background p-3'>
              <div className='flex items-start gap-3'>
                <div className='flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent text-xs font-semibold uppercase text-muted-foreground'>
                  {ext || 'file'}
                </div>
                <div className='min-w-0 flex-1'>
                  <div className='flex items-start justify-between gap-3'>
                    <div className='min-w-0'>
                      <p className='truncate text-sm font-medium text-foreground'>{item.file.name}</p>
                      <p className='mt-0.5 text-xs text-muted-foreground'>
                        {formatFileSize(item.file.size)} · {item.totalChunks} 个分片 · {statusLabel(item.status)}
                      </p>
                    </div>
                    <div className='flex shrink-0 items-center gap-1'>
                      {item.status === 'success' && <CheckCircle2 className='h-4 w-4 text-emerald-500' />}
                      {item.status === 'error' && <XCircle className='h-4 w-4 text-red-500' />}
                      {canStart && (
                        <Button type='button' size='icon' variant='ghost' className='h-8 w-8' onClick={() => startUpload(item.id)} title='继续上传'>
                          <Play className='h-4 w-4' />
                        </Button>
                      )}
                      {item.status === 'uploading' && (
                        <Button type='button' size='icon' variant='ghost' className='h-8 w-8' onClick={() => pauseUpload(item.id)} title='暂停'>
                          <Pause className='h-4 w-4' />
                        </Button>
                      )}
                      {canRetry && (
                        <Button type='button' size='icon' variant='ghost' className='h-8 w-8' onClick={() => retryUpload(item.id)} title='重试'>
                          <RotateCcw className='h-4 w-4' />
                        </Button>
                      )}
                      <Button type='button' size='icon' variant='ghost' className='h-8 w-8 text-red-500 hover:text-red-500' onClick={() => removeItem(item.id)} title='移除'>
                        <Trash2 className='h-4 w-4' />
                      </Button>
                    </div>
                  </div>

                  <div className='mt-2 h-2 overflow-hidden rounded-full bg-muted'>
                    <div className='h-full rounded-full bg-primary transition-all' style={{ width: `${item.progress}%` }} />
                  </div>
                  <div className='mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground'>
                    <span>{item.progress}%</span>
                    <span>{item.uploadedChunks.length}/{item.totalChunks}</span>
                  </div>
                  {item.error && <p className='mt-1 text-xs text-red-500'>{item.error}</p>}
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

export default ChunkedFileUploader
