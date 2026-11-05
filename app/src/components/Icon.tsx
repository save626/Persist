import { cn } from '../lib/cn'

export type IconName =
  | 'today'
  | 'fitness'
  | 'food'
  | 'study'
  | 'settings'
  | 'plus'
  | 'chev'
  | 'water'
  | 'spark'
  | 'check'
  | 'clock'
  | 'edit'
  | 'undo'
  | 'lock'
  | 'close'

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg className={cn('icon', className)} aria-hidden="true">
      <use href={`#${name}`} />
    </svg>
  )
}

export function IconSprite() {
  return (
    <svg className="sprite" aria-hidden="true">
      <symbol id="today" viewBox="0 0 24 24">
        <rect x="3" y="4.5" width="18" height="16" rx="4" />
        <path d="M8 3v4M16 3v4M3 9.5h18" />
        <circle cx="12" cy="14.5" r="2" />
      </symbol>
      <symbol id="fitness" viewBox="0 0 24 24">
        <path d="M7 8v8M17 8v8M4 10v4M20 10v4M7 12h10M4 12h3M17 12h3" />
      </symbol>
      <symbol id="food" viewBox="0 0 24 24">
        <path d="M4 11h16M5 11c.7 4.4 3.4 6.8 7 6.8s6.3-2.4 7-6.8M9 7.5c0-1.4 1-1.8 1-3M13 7.5c0-1.4 1-1.8 1-3M17 7.5c0-1.4.8-1.8.8-2.7" />
      </symbol>
      <symbol id="study" viewBox="0 0 24 24">
        <path d="M4 5.5c2.8-1.3 5.5-1.2 8 0 2.5-1.2 5.2-1.3 8 0v12c-2.8-1.3-5.5-1.2-8 0-2.5-1.2-5.2-1.3-8 0zM12 5.7v11.6" />
      </symbol>
      <symbol id="settings" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.55v-.1A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 4.1 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2.3V9.55h.1A1.7 1.7 0 0 0 4.1 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06L6.56 3.7l.06.06A1.7 1.7 0 0 0 8.5 4.1a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1v-.1h4.1v.1A1.7 1.7 0 0 0 15 4.1a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19.4 8.5a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.1.4h.1v4.1h-.1A1.7 1.7 0 0 0 19.4 15z" />
      </symbol>
      <symbol id="plus" viewBox="0 0 24 24">
        <path d="M12 5v14M5 12h14" />
      </symbol>
      <symbol id="chev" viewBox="0 0 24 24">
        <path d="M9 18l6-6-6-6" />
      </symbol>
      <symbol id="water" viewBox="0 0 24 24">
        <path d="M12 3.5s6 6.4 6 10.5a6 6 0 0 1-12 0c0-4.1 6-10.5 6-10.5z" />
      </symbol>
      <symbol id="spark" viewBox="0 0 24 24">
        <path d="M12 3.5l1.65 5.35L19 10.5l-5.35 1.65L12 17.5l-1.65-5.35L5 10.5l5.35-1.65zM19 16.5l.7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7z" />
      </symbol>
      <symbol id="check" viewBox="0 0 24 24">
        <path d="M5 12.5l4.3 4.2L19 7.5" />
      </symbol>
      <symbol id="clock" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5V12l3 2" />
      </symbol>
      <symbol id="edit" viewBox="0 0 24 24">
        <path d="M13.5 5.5l5 5M5 19l3.7-.8L19 7.9a2.1 2.1 0 0 0-3-3L5.8 15.2z" />
      </symbol>
      <symbol id="undo" viewBox="0 0 24 24">
        <path d="M8 7H4v-4M4.5 7.5A8 8 0 1 1 5 16" />
      </symbol>
      <symbol id="lock" viewBox="0 0 24 24">
        <rect x="5" y="10" width="14" height="10" rx="3" />
        <path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10" />
      </symbol>
      <symbol id="close" viewBox="0 0 24 24">
        <path d="M6 6l12 12M18 6L6 18" />
      </symbol>
    </svg>
  )
}
