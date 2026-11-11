import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMockData } from '../context/mock-data-context'
import { useUI } from '../context/ui-context'
import { useRuntimeMode } from '../context/runtime-mode-context'
import { Icon, type IconName } from './Icon'

const QUICK_ACTIONS: Array<{
  type: 'water' | 'food' | 'fitness' | 'study'
  label: string
  icon: IconName
}> = [
  { type: 'water', label: '饮水', icon: 'water' },
  { type: 'food', label: '饮食', icon: 'food' },
  { type: 'fitness', label: '训练', icon: 'fitness' },
  { type: 'study', label: '学习', icon: 'study' },
]

export function QuickRecordSheet() {
  const { quickOpen, closeQuickRecord, showToast } = useUI()
  const runtime = useRuntimeMode()
  const { addWater } = useMockData()
  const navigate = useNavigate()

  useEffect(() => {
    if (!quickOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeQuickRecord()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [closeQuickRecord, quickOpen])

  const handleQuickAction = (type: (typeof QUICK_ACTIONS)[number]['type']) => {
    if (runtime.readOnly) {
      showToast('演示模式为只读，不能新增记录。')
      return
    }
    if (type === 'water') {
      addWater(250)
      showToast('已记录 250 ml 饮水')
    } else if (type === 'food') {
      navigate('/diet?new=1')
      showToast('已进入饮食记录')
    } else if (type === 'fitness') {
      navigate('/fitness?new=1')
      showToast('已进入训练记录')
    } else {
      navigate('/study?new=1')
      showToast('已进入学习记录')
    }
    closeQuickRecord()
  }

  return (
    <div
      className={quickOpen ? 'backdrop open' : 'backdrop'}
      aria-hidden={!quickOpen}
      onClick={(event) => {
        if (event.target === event.currentTarget) closeQuickRecord()
      }}
    >
      <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="quickTitle">
        <div className="handle" />
        <div className="sheet-head">
          <h2 id="quickTitle">记录什么？</h2>
          <button className="icon-btn" type="button" aria-label="关闭" onClick={closeQuickRecord}>
            <Icon name="close" className="icon-sm" />
          </button>
        </div>
        <div className="quick-grid">
          {QUICK_ACTIONS.map((action) => (
            <button
              className={`quick ${action.type}`}
              key={action.type}
              type="button"
              onClick={() => handleQuickAction(action.type)}
            >
              <span className="quick-icon">
                <Icon name={action.icon} />
              </span>
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
