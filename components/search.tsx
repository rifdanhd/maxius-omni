'use client'

import { SearchIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSearch } from '@/context/search-provider'
import { Button } from './ui/button'

export function Search({
  className = '',
  placeholder = 'Cari',
  ...props
}: React.ComponentProps<'button'> & { placeholder?: string }) {
  const { setOpen } = useSearch()
  return (
    <Button
      {...props}
      variant='outline'
      className={cn(
        'group size-11 shrink-0 justify-center gap-2 rounded-md bg-muted/25 p-0 text-sm font-normal text-muted-foreground shadow-none hover:bg-accent sm:h-8 sm:w-40 sm:justify-start sm:px-2 lg:w-52 xl:w-64',
        className
      )}
      aria-label={props['aria-label'] ?? placeholder}
      aria-keyshortcuts='Meta+K Control+K'
      onClick={() => setOpen(true)}
    >
      <SearchIcon
        aria-hidden='true'
        className='shrink-0'
        size={16}
      />
      <span className='hidden min-w-0 flex-1 truncate text-left sm:block'>{placeholder}</span>
      <kbd className='pointer-events-none ml-auto hidden h-5 shrink-0 items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium select-none group-hover:bg-accent sm:flex'>
        <span className='text-xs'>⌘</span>K
      </kbd>
    </Button>
  )
}
