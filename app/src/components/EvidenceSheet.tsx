import { Icon } from './Icon'
import { PageSheet } from './PageSheet'

export interface EvidenceMetric {
  label: string
  value: string
  detail?: string
}

export interface EvidenceItem {
  title: string
  detail: string
  value?: string
}

interface EvidenceSheetProps {
  title: string
  subtitle?: string
  metrics: EvidenceMetric[]
  items: EvidenceItem[]
  note?: string
  onClose: () => void
}

export function EvidenceSheet({
  title,
  subtitle = '这些数据只用于解释当前 Mock 建议，不会自动发送到外部服务。',
  metrics,
  items,
  note,
  onClose,
}: EvidenceSheetProps) {
  return (
    <PageSheet title={title} subtitle={subtitle} onClose={onClose} className="mock-detail-sheet">
      <div className="mock-kpi-grid">
        {metrics.map((metric) => (
          <div className="mock-kpi" key={`${metric.label}-${metric.value}`}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            {metric.detail && <small>{metric.detail}</small>}
          </div>
        ))}
      </div>

      <div className="mock-detail-section">
        <div className="mock-detail-section-head">
          <span className="mock-section-mark">
            <Icon name="spark" className="icon-sm" />
          </span>
          <div>
            <h3>判断依据</h3>
            <p>按影响程度排列，可在后续阶段接入真实模型解释。</p>
          </div>
        </div>
        <div className="mock-detail-list">
          {items.map((item, index) => (
            <article className="mock-detail-row" key={`${item.title}-${index}`}>
              <span className="mock-detail-index">{String(index + 1).padStart(2, '0')}</span>
              <div>
                <strong>{item.title}</strong>
                <p>{item.detail}</p>
              </div>
              {item.value && <span className="mock-detail-value">{item.value}</span>}
            </article>
          ))}
        </div>
      </div>

      <div className="surface-note">
        <Icon name="lock" className="icon-sm" />
        <span>{note ?? '当前为前端 Mock 解释。正式接入 DeepSeek 后，只发送已授权的最小数据摘要。'}</span>
      </div>
    </PageSheet>
  )
}