// application module
// File: C:\Users\yango\Desktop\Chat\src\components\chat\LoadingDots.jsx
export function LoadingDots() {
  return (
    <div className='flex items-center gap-1'>
      <span className='h-2 w-2 animate-dot-bounce rounded-full bg-muted-foreground [animation-delay:-0.2s]' />
      <span className='h-2 w-2 animate-dot-bounce rounded-full bg-muted-foreground [animation-delay:-0.1s]' />
      <span className='h-2 w-2 animate-dot-bounce rounded-full bg-muted-foreground' />
    </div>
  )
}
