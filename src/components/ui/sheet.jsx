// application module
// File: C:\Users\yango\Desktop\Chat\src\components\ui\sheet.jsx
import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export const Sheet = DialogPrimitive.Root
export const SheetTrigger = DialogPrimitive.Trigger
export const SheetClose = DialogPrimitive.Close

export const SheetContent = React.forwardRef(
  ({ className, overlayClassName, title = '面板', description = '面板内容区域', children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay
      className={cn('fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]', overlayClassName)}
    />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed inset-y-0 left-0 z-50 w-[300px] border-r border-sidebar-border bg-sidebar p-0 text-sidebar-foreground shadow-soft',
        className,
      )}
      {...props}
    >
      <DialogPrimitive.Title className='sr-only'>{title}</DialogPrimitive.Title>
      <DialogPrimitive.Description className='sr-only'>{description}</DialogPrimitive.Description>
      {children}
      <DialogPrimitive.Close className='absolute right-3 top-3 rounded-md p-1 text-muted-foreground hover:bg-accent'>
        <X className='h-4 w-4' />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
  ),
)
