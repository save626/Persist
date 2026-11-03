import { Icon, type IconName } from '../components/Icon'
import { useUI } from '../context/ui-context'

interface Metric {
  icon: IconName
  label: string
  value: string
  target: string
  progress: number
}

interface PreviewRow {
  title: string
  detail: string
  value: string
}

interface PreviewConfig {
  eyebrow: string
  title: string
  titleAccent: string
  subtitle: string
  metrics: Metric[]
  mainTitle: string
  mainSubtitle: string
  rows: PreviewRow[]
  sideTitle: string
  sideSubtitle: string
  bars: number[]
  note: string
}

const PAGES = {
  diet: {
    eyebrow: '饮食 · 饮水记录',
    title: '吃得清楚，',
    titleAccent: '不必吃得紧张。',
    subtitle: '手动登记热量与营养，保留照片附件；饮水继续沿用轻量、快速的记录方式。',
    metrics: [
      { icon: 'food', label: '热量摄入', value: '1,420', target: '/ 2,100 kcal', progress: 67.6 },
      { icon: 'food', label: '蛋白质', value: '86', target: '/ 140 g', progress: 61.4 },
      { icon: 'water', label: '饮水', value: '1.2', target: '/ 2.0 L', progress: 60 },
      { icon: 'check', label: '饮食记录', value: '3', target: '/ 4 餐', progress: 75 },
    ],
    mainTitle: '今天的饮食',
    mainSubtitle: '热量来自外部 AI 识别结果，由你确认后登记。',
    rows: [
      { title: '早餐', detail: '燕麦、鸡蛋与黑咖啡 · 08:35', value: '380 kcal' },
      { title: '午餐', detail: '鸡胸肉藜麦碗 · 12:25', value: '620 kcal' },
      { title: '加餐', detail: '无糖酸奶与蓝莓 · 16:10', value: '180 kcal' },
      { title: '晚餐', detail: '尚未登记', value: '待记录' },
    ],
    sideTitle: '近 7 天饮水',
    sideSubtitle: '快速记录：125 ml / 250 ml / 自定义',
    bars: [54, 72, 66, 84, 78, 92, 60],
    note: '下一阶段会把 125 ml、250 ml、自定义容量、撤销与 7 天趋势整合成独立饮水组件，并复用旧饮水工具的数据逻辑。',
  },
  study: {
    eyebrow: '学习 · 统计记录',
    title: '记录投入，',
    titleAccent: '而不是追赶数字。',
    subtitle: '英语与高数统一纳入学习统计；单词背诵继续在外部 App 完成，这里只记录结果。',
    metrics: [
      { icon: 'study', label: '今日学习', value: '55', target: '/ 90 min', progress: 61.1 },
      { icon: 'study', label: '英语', value: '35', target: 'min', progress: 70 },
      { icon: 'study', label: '高数', value: '20', target: 'min', progress: 40 },
      { icon: 'spark', label: '连续记录', value: '7', target: '天', progress: 100 },
    ],
    mainTitle: '今日学习记录',
    mainSubtitle: '只做统计和复盘，不在 Persist 内重建单词书。',
    rows: [
      { title: '百词斩', detail: '新学 20 · 复习 35 · 09:10', value: '35 min' },
      { title: '高等数学', detail: '极限与连续 · 练习 12 题 · 20:30', value: '20 min' },
      { title: '英语听力', detail: '六级真题 Section A', value: '待记录' },
      { title: '错题整理', detail: '高数错题 3 道', value: '待记录' },
    ],
    sideTitle: '近 7 天学习',
    sideSubtitle: '英语与高数投入时间',
    bars: [48, 66, 52, 80, 74, 88, 61],
    note: '第一版不抓取“不背单词”或“百词斩”的数据。单词书与日计划将在后续以 CSV / Excel / JSON 导入方式完成。',
  },
} satisfies Record<string, PreviewConfig>

function PreviewPage({ config }: { config: PreviewConfig }) {
  const { showToast } = useUI()
  return (
    <>
      <header className="head">
        <div className="heading">
          <div className="eyebrow">{config.eyebrow}</div>
          <h1>
            {config.title}
            <br />
            {config.titleAccent}
          </h1>
          <p className="subtitle">{config.subtitle}</p>
        </div>
        <div className="preview-head-actions">
          <span className="preview-status">视觉 Mock 骨架</span>
          <button
            className="btn primary"
            type="button"
            onClick={() => showToast('记录表单将在本页下一轮细化')}
          >
            <Icon name="plus" className="icon-sm" />
            新增记录
          </button>
        </div>
      </header>

      <section className="progress" aria-label="板块概览">
        <div className="progress-head">
          <span className="label">今日概览</span>
          <span className="count-note">数据为界面演示，暂未持久化</span>
        </div>
        <div className="metrics">
          {config.metrics.map((metric) => (
            <div className="metric" key={metric.label}>
              <div className="metric-title">
                <Icon name={metric.icon} className="icon-sm" />
                {metric.label}
              </div>
              <div className="metric-value">
                <span className="metric-number">{metric.value}</span>
                <span className="metric-denom">{metric.target}</span>
              </div>
              <div className="track">
                <span style={{ width: `${metric.progress}%` }} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="preview-grid">
        <section className="preview-card">
          <h2>{config.mainTitle}</h2>
          <p>{config.mainSubtitle}</p>
          <div className="preview-list">
            {config.rows.map((row) => (
              <div className="preview-row" key={row.title}>
                <div className="preview-row-main">
                  <strong>{row.title}</strong>
                  <span>{row.detail}</span>
                </div>
                <span className="preview-row-value">{row.value}</span>
              </div>
            ))}
          </div>
          <div className="preview-note">{config.note}</div>
        </section>

        <aside className="preview-card">
          <h2>{config.sideTitle}</h2>
          <p>{config.sideSubtitle}</p>
          <div className="preview-bars" aria-label="近七天记录趋势">
            {config.bars.map((bar, index) => (
              <div className="preview-bar-day" key={index}>
                <span
                  className={`preview-bar${index === config.bars.length - 1 ? 'is-active' : ''}`}
                  style={{ height: `${Math.max(8, bar)}%`, alignSelf: 'end' }}
                />
                <span>{20 + index}</span>
              </div>
            ))}
          </div>
          <div className="preview-note">
            <span className="preview-chip">交互预留</span>
            <p>本页将按统一设计系统继续补充记录表单、筛选、空状态和详情抽屉。</p>
          </div>
        </aside>
      </div>
    </>
  )
}

function UtilityPage({
  eyebrow,
  title,
  accent,
  subtitle,
  rows,
}: {
  eyebrow: string
  title: string
  accent: string
  subtitle: string
  rows: PreviewRow[]
}) {
  const { showToast } = useUI()
  return (
    <>
      <header className="head">
        <div className="heading">
          <div className="eyebrow">{eyebrow}</div>
          <h1>
            {title}
            <br />
            {accent}
          </h1>
          <p className="subtitle">{subtitle}</p>
        </div>
        <div className="preview-head-actions">
          <span className="preview-status">功能预留</span>
          <button
            className="btn primary"
            type="button"
            onClick={() => showToast('该功能将在对应阶段接入')}
          >
            开始设置
          </button>
        </div>
      </header>
      <section className="preview-card">
        <h2>当前模块</h2>
        <p>保留统一的页面结构，后续逐项补齐真实交互与数据。</p>
        <div className="preview-list">
          {rows.map((row) => (
            <div className="preview-row" key={row.title}>
              <div className="preview-row-main">
                <strong>{row.title}</strong>
                <span>{row.detail}</span>
              </div>
              <span className="preview-row-value">{row.value}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}

export function DietPage() {
  return <PreviewPage config={PAGES.diet} />
}
export function StudyPage() {
  return <PreviewPage config={PAGES.study} />
}

export function ProfilePage() {
  return (
    <UtilityPage
      eyebrow="个人档案"
      title="先了解你，"
      accent="再给出建议。"
      subtitle="首次使用时通过 AI 引导建立身体、作息、训练与学习档案，后续建议才有可靠上下文。"
      rows={[
        { title: '基础资料', detail: '年龄、身高、体重与目标', value: '78% 完整' },
        { title: '训练背景', detail: '经验、频率与器械条件', value: '待补充' },
        { title: '饮食偏好', detail: '过敏、忌口与作息', value: '待补充' },
        { title: 'AI 隐私设置', detail: '控制哪些数据可参与分析', value: '仅本地' },
      ]}
    />
  )
}

export function ReportsPage() {
  return (
    <UtilityPage
      eyebrow="AI 报告"
      title="把记录，变成"
      accent="可利用的反馈。"
      subtitle="DeepSeek 只基于已授权的记录生成分析；任何计划修改都必须由你确认。"
      rows={[
        { title: '今日简报', detail: '训练、饮食、饮水与学习综合摘要', value: '待生成' },
        { title: '每周复盘', detail: '趋势、偏差与下一周建议', value: '每周日' },
        { title: '训练建议', detail: '负荷与恢复状态观察', value: '待接入' },
        { title: '历史报告', detail: '按周保存与回看', value: '0 份' },
      ]}
    />
  )
}

export function SettingsPage() {
  return (
    <UtilityPage
      eyebrow="设置"
      title="你的数据，"
      accent="由你决定。"
      subtitle="统一管理提醒、AI 服务、数据导入导出与本地备份。"
      rows={[
        { title: '提醒设置', detail: '饮水、训练与晚间复盘提醒', value: '未开启' },
        { title: '数据管理', detail: 'CSV / Excel / JSON 导入与导出', value: '本地优先' },
        { title: 'AI 服务', detail: 'DeepSeek 服务端代理状态', value: '未连接' },
        { title: '关于 Persist', detail: '版本、隐私与开源许可', value: 'v0.1.0' },
      ]}
    />
  )
}
