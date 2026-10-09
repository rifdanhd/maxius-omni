import { SearchIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSearch } from '@/context/search-provider'
import { Button } from './ui/button'

export function Search({
  className = '',
  placeholder = 'Search',
  ...props
}: React.ComponentProps<'button'> & { placeholder?: string }) {
  const { setOpen } = useSearch()
  return (
    <Button
      {...props}
      variant='outline'
      className={cn(
        'group relative size-11 shrink-0 justify-center rounded-md bg-muted/25 p-0 text-sm font-normal text-muted-foreground shadow-none hover:bg-accent sm:h-8 sm:w-40 sm:justify-start sm:ps-8 sm:pe-12 lg:w-52 xl:w-64',
        className
      )}
      aria-label={props['aria-label'] ?? placeholder}
      aria-keyshortcuts='Meta+K Control+K'
      onClick={() => setOpen(true)}
    >
      <SearchIcon
        aria-hidden='true'
        className='sm:absolute sm:left-2 sm:top-1/2 sm:-translate-y-1/2'
        size={16}
      />
      <span className='hidden sm:inline'>{placeholder}</span>
      <kbd className='pointer-events-none absolute inset-e-[0.3rem] top-[0.3rem] hidden h-5 items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 select-none group-hover:bg-accent sm:flex'>
        <span className='text-xs'>⌘</span>K
      </kbd>
    </Button>
  )
}
