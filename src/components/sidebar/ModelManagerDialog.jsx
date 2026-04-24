// 模块说明：模型管理弹窗，支持新增/查看/删除用户自定义模型。
import { useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { createCustomModel, deleteCustomModel, fetchCustomModels } from '@/services/modelApi'

function formatTime(value) {
  const time = Number(value || 0)
  if (!time) return '--'
  const date = new Date(time)
  if (Number.isNaN(date.getTime())) return '--'
  return date.toLocaleString('zh-CN', { hour12: false })
}

export function ModelManagerDialog({ open, onOpenChange }) {
  const [modelName, setModelName] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [models, setModels] = useState([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [deletingName, setDeletingName] = useState('')

  const canSubmit = useMemo(() => {
    return modelName.trim().length > 0 && apiKey.trim().length > 0 && !submitting
  }, [apiKey, modelName, submitting])

  const refreshModels = async () => {
    setLoading(true)
    try {
      const list = await fetchCustomModels()
      setModels(Array.isArray(list) ? list : [])
    } catch (error) {
      toast.error(error?.message || '读取自定义模型失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    refreshModels().catch(() => null)
  }, [open])

  // 新增成功后发出事件，让聊天区模型下拉即时刷新。
  const notifyModelsUpdated = () => {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new Event('kria:models-updated'))
  }

  const handleSubmit = async () => {
    if (!canSubmit) return

    setSubmitting(true)
    try {
      const result = await createCustomModel({
        modelName: modelName.trim(),
        apiKey: apiKey.trim(),
      })
      toast.success(result?.updated ? '模型已更新' : '模型已添加')
      setApiKey('')
      await refreshModels()
      notifyModelsUpdated()
    } catch (error) {
      toast.error(error?.message || '保存模型失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (name = '') => {
    if (!name) return
    setDeletingName(name)
    try {
      await deleteCustomModel(name)
      toast.success('模型已删除')
      await refreshModels()
      notifyModelsUpdated()
    } catch (error) {
      toast.error(error?.message || '删除模型失败')
    } finally {
      setDeletingName('')
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className='max-w-[560px]'>
        <AlertDialogHeader>
          <AlertDialogTitle>模型管理</AlertDialogTitle>
          <AlertDialogDescription>
            输入模型名称和 API Key 即可添加模型。自定义模型默认使用服务器当前 OpenAI 兼容上游地址。
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className='space-y-3'>
          <div className='grid grid-cols-1 gap-2 md:grid-cols-[1.4fr,1fr]'>
            <label className='space-y-1'>
              <span className='text-xs text-muted-foreground'>模型名称</span>
              <input
                value={modelName}
                onChange={(event) => setModelName(event.target.value)}
                placeholder='例如: gpt-4o-mini'
                className='h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground'
              />
            </label>

            <label className='space-y-1'>
              <span className='text-xs text-muted-foreground'>API Key</span>
              <input
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder='输入模型 API Key'
                className='h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground'
                type='password'
              />
            </label>
          </div>

          <div className='flex justify-end'>
            <Button size='sm' className='h-8 rounded-lg' disabled={!canSubmit} onClick={handleSubmit}>
              {submitting ? (
                <>
                  <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />保存中
                </>
              ) : (
                <>
                  <Plus className='mr-1.5 h-3.5 w-3.5' />保存模型
                </>
              )}
            </Button>
          </div>

          <div className='max-h-[260px] space-y-2 overflow-y-auto rounded-lg border border-border bg-muted/25 p-2'>
            {loading ? (
              <p className='text-xs text-muted-foreground'>加载中...</p>
            ) : models.length === 0 ? (
              <p className='text-xs text-muted-foreground'>还没有自定义模型，先添加一个吧。</p>
            ) : (
              models.map((item) => (
                <div key={item.name} className='rounded-lg border border-border bg-card px-3 py-2'>
                  <div className='flex items-center justify-between gap-2'>
                    <div className='min-w-0'>
                      <p className='truncate text-sm font-medium'>{item.name}</p>
                      <p className='text-[11px] text-muted-foreground'>更新时间: {formatTime(item.updatedAt)}</p>
                    </div>

                    <Button
                      size='sm'
                      variant='ghost'
                      className='h-7 px-2 text-xs text-red-500 hover:text-red-500'
                      disabled={Boolean(deletingName) && deletingName === item.name}
                      onClick={() => handleDelete(item.name)}
                    >
                      <Trash2 className='mr-1 h-3.5 w-3.5' />
                      {deletingName === item.name ? '删除中' : '删除'}
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancelButton>关闭</AlertDialogCancelButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
