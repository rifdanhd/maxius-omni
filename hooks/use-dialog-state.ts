import { useState, useCallback } from 'react'

export function useDialogState(initialOpen = false) {
  const [open, setOpen] = useState(initialOpen)

  const onOpenChange = useCallback((value: boolean) => {
    setOpen(value)
  }, [])

  return [open, onOpenChange] as const
}
