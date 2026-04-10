/* eslint-disable react-refresh/only-export-components */
import * as React from 'react'
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'

export const AlertDialog = AlertDialogPrimitive.Root
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger
export const AlertDialogPortal = AlertDialogPrimitive.Portal
export const AlertDialogAction = AlertDialogPrimitive.Action
export const AlertDialogCancel = AlertDialogPrimitive.Cancel

export const AlertDialogOverlay = React.forwardRef(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Overlay
    ref={ref}
    className={cn('fixed inset-0 z-50 bg-black/45 backdrop-blur-[1px]', className)}
    {...props}
  />
))

export const AlertDialogContent = React.forwardRef(({ className, ...props }, ref) => (
  <AlertDialogPortal>
    <AlertDialogOverlay />
    <AlertDialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-soft',
        className,
      )}
      {...props}
    />
  </AlertDialogPortal>
))

export const AlertDialogHeader = ({ className, ...props }) => (
  <div className={cn('mb-3 space-y-1.5', className)} {...props} />
)

export const AlertDialogTitle = React.forwardRef(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Title ref={ref} className={cn('text-base font-semibold', className)} {...props} />
))

export const AlertDialogDescription = React.forwardRef(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
))

export const AlertDialogFooter = ({ className, ...props }) => (
  <div className={cn('mt-5 flex items-center justify-end gap-2', className)} {...props} />
)

export const AlertDialogConfirmButton = React.forwardRef(({ className, ...props }, ref) => (
  <AlertDialogAction ref={ref} className={cn(buttonVariants({ variant: 'default', size: 'sm' }), className)} {...props} />
))

export const AlertDialogCancelButton = React.forwardRef(({ className, ...props }, ref) => (
  <AlertDialogCancel ref={ref} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), className)} {...props} />
))
