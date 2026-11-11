import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../lib/cn'
import { Icon } from './Icon'

type PickerMode = 'date' | 'time'

interface DateTimePickerProps {
  mode: PickerMode
  label: string
  value: string
  onChange: (value: string) => void
  className?: string
  triggerClassName?: string
  ariaLabel?: string
  disabled?: boolean
  clearable?: boolean
  helper?: string
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function toIsoDate(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function parseIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day, 12, 0, 0, 0)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null
  }
  return date
}

function parseTime(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return { hour, minute }
}

function formatDateDisplay(value: string, placeholder: string) {
  const date = parseIsoDate(value)
  if (!date) return placeholder
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

function formatTimeDisplay(value: string, placeholder: string) {
  const time = parseTime(value)
  return time ? `${pad(time.hour)}:${pad(time.minute)}` : placeholder
}


export function DatePickerField({
  label,
  value,
  onChange,
  className,
  triggerClassName,
  ariaLabel,
  disabled,
  clearable,
  helper,
}: Omit<DateTimePickerProps, 'mode'>) {
  return (
    <DateTimePicker
      mode="date"
      label={label}
      value={value}
      onChange={onChange}
      className={className}
      triggerClassName={triggerClassName}
      ariaLabel={ariaLabel}
      disabled={disabled}
      clearable={clearable}
      helper={helper}
    />
  )
}

export function TimePickerField({
  label,
  value,
  onChange,
  className,
  triggerClassName,
  ariaLabel,
  disabled,
  helper,
}: Omit<DateTimePickerProps, 'mode' | 'clearable'>) {
  return (
    <DateTimePicker
      mode="time"
      label={label}
      value={value}
      onChange={onChange}
      className={className}
      triggerClassName={triggerClassName}
      ariaLabel={ariaLabel}
      disabled={disabled}
      helper={helper}
    />
  )
}

function DateTimePicker({
  mode,
  label,
  value,
  onChange,
  className,
  triggerClassName,
  ariaLabel,
  disabled = false,
  clearable = false,
  helper,
}: DateTimePickerProps) {
  const id = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const hourListRef = useRef<HTMLDivElement>(null)
  const minuteListRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [draftDate, setDraftDate] = useState('')
  const [viewMonth, setViewMonth] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1, 12, 0, 0, 0)
  })
  const [todayIso, setTodayIso] = useState('')
  const [draftHour, setDraftHour] = useState(9)
  const [draftMinute, setDraftMinute] = useState(0)

  const labelId = `${id}-label`
  const helperId = `${id}-helper`
  const dialogTitle = `选择${ariaLabel ?? label}`
  const displayValue =
    mode === 'date'
      ? formatDateDisplay(value, '请选择日期')
      : formatTimeDisplay(value, '请选择时间')

  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      window.requestAnimationFrame(() => triggerRef.current?.focus())
    }

    document.addEventListener('keydown', onKeyDown, true)
    window.requestAnimationFrame(() => dialogRef.current?.focus())

    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [open])

  useEffect(() => {
    if (!open || mode !== 'time') return
    const selectedHour = hourListRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]')
    const selectedMinute = minuteListRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]')
    selectedHour?.scrollIntoView?.({ block: 'center' })
    selectedMinute?.scrollIntoView?.({ block: 'center' })
  }, [draftHour, draftMinute, mode, open])

  function openPicker() {
    if (disabled) return

    if (mode === 'date') {
      const today = new Date()
      const selected = parseIsoDate(value) ?? today
      setDraftDate(toIsoDate(selected))
      setTodayIso(toIsoDate(today))
      setViewMonth(new Date(selected.getFullYear(), selected.getMonth(), 1, 12, 0, 0, 0))
    } else {
      const selected = parseTime(value)
      const now = new Date()
      setDraftHour(selected?.hour ?? now.getHours())
      setDraftMinute(selected?.minute ?? now.getMinutes())
    }

    setOpen(true)
  }

  function closePicker() {
    setOpen(false)
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }

  function confirmPicker() {
    onChange(mode === 'date' ? draftDate : `${pad(draftHour)}:${pad(draftMinute)}`)
    closePicker()
  }

  function clearPicker() {
    onChange('')
    closePicker()
  }

  function moveMonth(offset: number) {
    setViewMonth(
      (current) =>
        new Date(current.getFullYear(), current.getMonth() + offset, 1, 12, 0, 0, 0),
    )
  }

  function chooseToday() {
    const today = new Date()
    setDraftDate(toIsoDate(today))
    setTodayIso(toIsoDate(today))
    setViewMonth(new Date(today.getFullYear(), today.getMonth(), 1, 12, 0, 0, 0))
  }

  function chooseNow() {
    const now = new Date()
    setDraftHour(now.getHours())
    setDraftMinute(now.getMinutes())
  }

  const year = viewMonth.getFullYear()
  const month = viewMonth.getMonth()
  const firstWeekday = (new Date(year, month, 1, 12).getDay() + 6) % 7
  const dayCount = new Date(year, month + 1, 0, 12).getDate()
  const cellCount = Math.ceil((firstWeekday + dayCount) / 7) * 7
  const monthTitle = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
  }).format(viewMonth)

  return (
    <>
      <div className={cn('date-time-field', className)}>
        <span id={labelId}>{label}</span>
        <button
          ref={triggerRef}
          className={cn('date-time-trigger', triggerClassName)}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabel ? undefined : labelId}
          aria-describedby={helper ? helperId : undefined}
          disabled={disabled}
          onClick={openPicker}
        >
          <span className={cn('date-time-trigger-value', !value && 'is-placeholder')}>
            {displayValue}
          </span>
          <Icon name={mode === 'date' ? 'today' : 'clock'} className="date-time-trigger-icon" />
        </button>
        {helper && <small id={helperId}>{helper}</small>}
      </div>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="date-time-backdrop open"
            onClick={(event) => event.target === event.currentTarget && closePicker()}
          >
            <section
              ref={dialogRef}
              className={cn('date-time-panel', mode === 'date' ? 'is-date' : 'is-time')}
              role="dialog"
              aria-modal="true"
              aria-label={dialogTitle}
              tabIndex={-1}
            >
              <div className="date-time-handle" />
              <header className="date-time-head">
                <div>
                  <span className="date-time-eyebrow">{mode === 'date' ? '日期' : '时间'}</span>
                  <h2>{mode === 'date' ? '选择日期' : '选择时间'}</h2>
                  <p>{label}</p>
                </div>
                <button
                  className="date-time-close"
                  type="button"
                  aria-label={`关闭${dialogTitle}`}
                  onClick={closePicker}
                >
                  <Icon name="close" className="icon-sm" />
                </button>
              </header>

              {mode === 'date' ? (
                <div className="date-time-calendar" data-view-month={`${year}-${pad(month + 1)}`}>
                  <div className="date-time-calendar-toolbar">
                    <button type="button" aria-label="上个月" onClick={() => moveMonth(-1)}>
                      <Icon name="chev" className="date-time-chevron is-previous" />
                    </button>
                    <strong>{monthTitle}</strong>
                    <button type="button" aria-label="下个月" onClick={() => moveMonth(1)}>
                      <Icon name="chev" className="date-time-chevron" />
                    </button>
                  </div>
                  <div className="date-time-weekdays" aria-hidden="true">
                    {WEEKDAYS.map((weekday) => (
                      <span key={weekday}>{weekday}</span>
                    ))}
                  </div>
                  <div className="date-time-calendar-grid">
                    {Array.from({ length: cellCount }, (_, index) => {
                      const day = index - firstWeekday + 1
                      if (day < 1 || day > dayCount) {
                        return <span className="date-time-day is-blank" key={`blank-${index}`} />
                      }
                      const isoDate = `${year}-${pad(month + 1)}-${pad(day)}`
                      const selected = isoDate === draftDate
                      const today = isoDate === todayIso
                      return (
                        <button
                          className={cn(
                            'date-time-day',
                            selected && 'is-selected',
                            today && 'is-today',
                          )}
                          type="button"
                          key={isoDate}
                          data-date={isoDate}
                          aria-label={`${year}年${month + 1}月${day}日`}
                          aria-pressed={selected}
                          onClick={() => setDraftDate(isoDate)}
                        >
                          {day}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <div className="date-time-time-picker">
                  <div className="date-time-clock" aria-live="polite">
                    <strong>
                      {pad(draftHour)}
                      <span>:</span>
                      {pad(draftMinute)}
                    </strong>
                    <small>24 小时制</small>
                  </div>
                  <div className="date-time-time-columns">
                    <div className="date-time-time-column">
                      <span>小时</span>
                      <div className="date-time-time-list" ref={hourListRef}>
                        {Array.from({ length: 24 }, (_, hour) => (
                          <button
                            className={cn(
                              'date-time-time-option',
                              hour === draftHour && 'is-selected',
                            )}
                            type="button"
                            key={hour}
                            aria-label={`${pad(hour)} 时`}
                            aria-pressed={hour === draftHour}
                            onClick={() => setDraftHour(hour)}
                          >
                            {pad(hour)}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="date-time-time-column">
                      <span>分钟</span>
                      <div className="date-time-time-list" ref={minuteListRef}>
                        {Array.from({ length: 60 }, (_, minute) => (
                          <button
                            className={cn(
                              'date-time-time-option',
                              minute === draftMinute && 'is-selected',
                            )}
                            type="button"
                            key={minute}
                            aria-label={`${pad(minute)} 分`}
                            aria-pressed={minute === draftMinute}
                            onClick={() => setDraftMinute(minute)}
                          >
                            {pad(minute)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <footer className="date-time-actions">
                <div className="date-time-actions-quick">
                  {mode === 'date' ? (
                    <button type="button" onClick={chooseToday}>
                      今天
                    </button>
                  ) : (
                    <button type="button" onClick={chooseNow}>
                      现在
                    </button>
                  )}
                  {mode === 'date' && clearable && (
                    <button type="button" onClick={clearPicker}>
                      清除
                    </button>
                  )}
                </div>
                <div className="date-time-actions-buttons">
                  <button className="btn secondary" type="button" onClick={closePicker}>
                    取消
                  </button>
                  <button className="btn primary" type="button" onClick={confirmPicker}>
                    确定
                  </button>
                </div>
              </footer>
            </section>
          </div>,
          document.body,
        )}
    </>
  )
}