'use client'

import { useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { ConfirmDialog } from '@/components/confirm-dialog'

interface SignOutDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SignOutDialog({ open, onOpenChange }: SignOutDialogProps) {
  const router = useRouter()
  const pathname = usePathname()
  const { auth } = useAuthStore()
  const [isLoading, setIsLoading] = useState(false)

  const handleSignOut = async () => {
    if (isLoading) return
    setIsLoading(true)
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      if (!response.ok) throw new Error('Logout failed')
      auth.reset()
      onOpenChange(false)
      router.replace('/login?redirect=' + encodeURIComponent(pathname))
    } catch {
      toast.error('Gagal keluar. Silakan coba lagi.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title='Keluar'
      desc='Yakin ingin keluar? Anda perlu masuk kembali untuk mengakses akun.'
      confirmText='Keluar'
      cancelBtnText='Batal'
      isLoading={isLoading}
      destructive
      handleConfirm={handleSignOut}
      className='sm:max-w-sm'
    />
  )
}
