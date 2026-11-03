import { useEffect, useId, type ReactNode } from 'react'
import { cn } from '../lib/cn'
import { Icon } from './Icon'

interface PageSheetProps {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  className?: string
}

export function PageSheet({ title, subtitle, onClose, children, className }: PageSheetProps) {
  const titleId = useId()
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className="surface-backdrop open"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className={`surface-sheet${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="handle" />
        <div className="surface-sheet-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-btn" type="button" aria-label="关闭" onClick={onClose}>
            <Icon name="close" className="icon-sm" />
          </button>
        </div>
        <div className="surface-sheet-body">{children}</div>
      </section>
    </div>
  )
}

interface ConfirmDialogProps {
  title: string
  description: string
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel = '确认',
  danger = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className="surface-backdrop confirm-backdrop open"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <span className={cn('confirm-mark', danger && 'danger')}>
          <Icon name={danger ? 'close' : 'check'} />
        </span>
        <h2 id={titleId}>{title}</h2>
        <p id={descriptionId}>{description}</p>
        <div className="confirm-actions">
          <button className="btn secondary" type="button" onClick={onClose}>
            取消
          </button>
          <button
            className={`btn ${danger ? 'danger' : 'primary'}`}
            type="button"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}
