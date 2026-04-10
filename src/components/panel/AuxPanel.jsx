// application module
// File: C:\Users\yango\Desktop\Chat\src\components\panel\AuxPanel.jsx
import { useMemo } from 'react'
import { SourcePanel } from '@/components/panel/SourcePanel'
import { ContextPanel } from '@/components/panel/ContextPanel'
import { KnowledgeBasePanel } from '@/components/panel/KnowledgeBasePanel'
import { useChatStore } from '@/stores/chatStore'
import { useUIStore } from '@/stores/uiStore'
import { cn } from '@/lib/utils'

function AuxPanelSections({ refs, docs }) {
  return (
    <>
      <SourcePanel refs={refs} />
      <ContextPanel docs={docs} />
      <KnowledgeBasePanel />
    </>
  )
}

export function AuxPanel({ mobile = false }) {
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen)
  const conversation = useChatStore((s) => s.getCurrentConversation())

  const refs = useMemo(() => conversation?.refs || [], [conversation?.refs])
  const docs = useMemo(() => conversation?.contextDocs || [], [conversation?.contextDocs])

  if (mobile) {
    return (
      <div className='h-full overflow-y-auto bg-background p-3 text-foreground'>
        <AuxPanelSections refs={refs} docs={docs} />
      </div>
    )
  }

  return (
    <aside
      className={cn(
        'hidden h-full border-l border-border bg-background transition-all duration-300 xl:block',
        rightPanelOpen ? 'w-[320px] opacity-100' : 'w-0 opacity-0',
      )}
    >
      {rightPanelOpen && (
        <div className='h-full overflow-y-auto p-3'>
          <AuxPanelSections refs={refs} docs={docs} />
        </div>
      )}
    </aside>
  )
}
