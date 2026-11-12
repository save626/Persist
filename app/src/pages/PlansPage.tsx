import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { ConfirmDialog } from '../components/PageSheet'
import { PlanChatSheet, type PlanChatReviewPayload } from '../components/PlanChatSheet'
import { PlanDraftSheet } from '../components/PlanDraftSheet'
import { useMockData } from '../context/mock-data-context'
import { useRuntimeMode } from '../context/runtime-mode-context'
import { useUI } from '../context/ui-context'
import {
  describeDroppedProfileFields,
  emptyPlanDraft,
  planToDraft,
  proposalToDraft,
} from '../lib/plan-draft'
import {
  activePlan,
  cadenceLabel,
  deriveWeeklyAchievements,
  getWeekRange,
  overallProgress,
  planStatusLabel,
  summarizeWeekProgress,
  type LongTermPlanDraft,
} from '../lib/long-term-plan'
import { sanitizeProfilePatch } from '../lib/profile-rules'
import type { LongTermPlan, ProfileData } from '../types'

/**
 * 长期计划页：AI 建档对话 → 草案确认 → 启用 / 归档 / 重新启用。
 *
 * 这里只做「编排 + 展示」：对话和草案表单各自持有临时状态，
 * 页面负责把用户确认后的草案落库、归档旧计划、同步档案并给出提示。
 * 进度一律按本周已有记录估算，界面上必须写明。
 */

interface PlansDraftState {
  initial: LongTermPlanDraft
  patch: Partial<ProfileData>
  mode: 'ai' | 'manual'
  replaceId?: string
}

export function PlansPage() {
  const runtime = useRuntimeMode()
  const {
    profile,
    updateProfile,
    longTermPlans,
    addLongTermPlan,
    archiveLongTermPlan,
    activatePlan,
    studyRecords,
    fitnessSession,
  } = useMockData()
  const { showToast } = useUI()
  const [searchParams, setSearchParams] = useSearchParams()
  const onboard = searchParams.get('onboard') === '1'

  const [chatOpen, setChatOpen] = useState(onboard)
  const [draftSheet, setDraftSheet] = useState<PlansDraftState | null>(null)
  const [pendingArchive, setPendingArchive] = useState<LongTermPlan | null>(null)
  const [pendingActivate, setPendingActivate] = useState<LongTermPlan | null>(null)

  const current = activePlan(longTermPlans)
  const drafts = useMemo(
    () => longTermPlans.filter((plan) => plan.status === 'draft'),
    [longTermPlans],
  )
  const archived = useMemo(
    () => longTermPlans.filter((plan) => plan.status === 'archived'),
    [longTermPlans],
  )
  const week = getWeekRange()
  const achievements = current
    ? deriveWeeklyAchievements(current, { studyRecords, fitnessSession })
    : null
  const progressRows =
    current && achievements
      ? summarizeWeekProgress(current, achievements.achieved, achievements.estimatedModules)
      : []
  const completion = overallProgress(progressRows)

  const clearOnboardParam = () => {
    if (onboard) setSearchParams({}, { replace: true })
  }

  const closeChat = () => {
    setChatOpen(false)
    clearOnboardParam()
  }

  const openManual = () => {
    setDraftSheet({ initial: emptyPlanDraft(), patch: {}, mode: 'manual' })
  }

  const openDraft = (plan: LongTermPlan) => {
    setDraftSheet({
      initial: planToDraft(plan),
      patch: {},
      mode: plan.source === 'ai-chat' ? 'ai' : 'manual',
      replaceId: plan.id,
    })
  }

  const handleReview = ({ proposal, patch }: PlanChatReviewPayload) => {
    setDraftSheet({ initial: proposalToDraft(proposal), patch, mode: 'ai' })
  }

  const handleConfirmDraft = (draft: LongTermPlanDraft) => {
    if (!draftSheet) return
    const created = addLongTermPlan(draft)
    if (!created) {
      showToast('草案没有保存：标题或每周目标还不完整。')
      return
    }
    if (draftSheet.replaceId) archiveLongTermPlan(draftSheet.replaceId)
    activatePlan(created.id)

    const sanitized = sanitizeProfilePatch(draftSheet.patch)
    const parts = [`已启用长期计划「${created.title}」`]
    if (Object.keys(sanitized.patch).length > 0) {
      updateProfile(sanitized.patch)
      parts.push('档案已同步更新')
    }
    const droppedHint = describeDroppedProfileFields(sanitized.dropped)
    if (droppedHint) parts.push(droppedHint)
    if (current && current.id !== created.id && current.id !== draftSheet.replaceId) {
      parts.push(`已归档「${current.title}」`)
    }

    setDraftSheet(null)
    setChatOpen(false)
    clearOnboardParam()
    showToast(parts.join(' · '))
  }

  const confirmArchive = () => {
    if (!pendingArchive) return
    archiveLongTermPlan(pendingArchive.id)
    showToast(`已归档「${pendingArchive.title}」`)
    setPendingArchive(null)
  }

  const applyActivate = (plan: LongTermPlan) => {
    activatePlan(plan.id)
    setPendingActivate(null)
    showToast(
      current && current.id !== plan.id
        ? `已启用「${plan.title}」，并归档「${current.title}」`
        : `已启用「${plan.title}」`,
    )
  }

  const requestActivate = (plan: LongTermPlan) => {
    if (current && current.id !== plan.id) {
      setPendingActivate(plan)
      return
    }
    applyActivate(plan)
  }

  return (
    <>
      <header className="head plans-head">
        <div className="heading">
          <span className="eyebrow">长期计划</span>
          <h1>把目标拆成每周能做到的事</h1>
          <p className="subtitle">
            AI 建档只负责整理草案，确认后才会写入档案并启用计划；进度按本周已有记录估算。
          </p>
        </div>
        <div className="head-actions plans-head-actions">
          <span className="plans-local-badge">
            <Icon name="lock" className="icon-sm" />
            {runtime.mode === 'demo'
              ? '部署前预生成 · 只读'
              : profile.aiConsent && runtime.ai.chat
                ? 'AI 对话 · Mock 兜底'
                : '本地生成 · Mock 对话'}
          </span>
          <button
            className="btn secondary"
            type="button"
            disabled={runtime.readOnly}
            onClick={openManual}
          >
            <Icon name="plus" className="icon-sm" />
            手工新建
          </button>
          <button className="btn primary" type="button" onClick={() => setChatOpen(true)}>
            <Icon name="spark" className="icon-sm" />
            {runtime.mode === 'demo' ? '查看预置建档' : 'AI 建档'}
          </button>
        </div>
      </header>

      <div className="plans-layout">
        <div className="plans-main-column">
          {current ? (
            <section className="panel plans-current" aria-labelledby="plansCurrentTitle">
              <div className="plans-current-head">
                <div>
                  <span className="plans-kicker">
                    {cadenceLabel(current.cadence)} · {current.startDate}
                    {current.endDate ? ` → ${current.endDate}` : ' 起'}
                  </span>
                  <h2 id="plansCurrentTitle">{current.title}</h2>
                  <p className="plans-goal">{current.goal}</p>
                </div>
                <span className="plans-status is-active">{planStatusLabel(current.status)}</span>
              </div>

              {progressRows.length > 0 && (
                <div className="plans-progress">
                  <div className="plans-progress-head">
                    <span>本周完成度</span>
                    <strong>{completion}%</strong>
                  </div>
                  <div
                    className="plans-progress-track"
                    role="img"
                    aria-label={`本周完成度 ${completion}%`}
                  >
                    <span style={{ width: `${completion}%` }} />
                  </div>
                  <p className="plans-progress-note">
                    统计区间 {week.label} · 依据本周学习记录与健身会话估算。
                  </p>
                </div>
              )}

              <ul className="plans-targets">
                {progressRows.map((row) => (
                  <li className={row.done ? 'is-done' : ''} key={row.target.id}>
                    <div className="plans-target-head">
                      <span>
                        {row.target.label}
                        {row.estimated && <em className="plans-target-tag">估算</em>}
                      </span>
                      <span>
                        {row.achieved} / {row.target.perWeek} {row.target.unit}
                      </span>
                    </div>
                    <div className="plans-target-bar">
                      <span style={{ width: `${Math.round(row.ratio * 100)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>

              {(current.milestones ?? []).length > 0 && (
                <div className="plans-milestones">
                  <span className="plans-kicker">里程碑</span>
                  <ul>
                    {(current.milestones ?? []).map((milestone) => (
                      <li key={`${milestone.date}-${milestone.label}`}>
                        <span className="plans-milestone-date">{milestone.date}</span>
                        <span>{milestone.label}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="plans-actions">
                <button
                  className="btn secondary"
                  type="button"
                  disabled={runtime.readOnly}
                  onClick={() => openDraft(current)}
                >
                  调整计划
                </button>
                <button
                  className="btn secondary"
                  type="button"
                  disabled={runtime.readOnly}
                  onClick={() => setPendingArchive(current)}
                >
                  归档计划
                </button>
              </div>
              <p className="plans-hint">
                调整计划会生成一份新草案，确认后替换当前计划并归档旧的那份。
              </p>
            </section>
          ) : (
            <section className="panel plans-empty" aria-labelledby="plansEmptyTitle">
              <span className="plans-kicker">还没有进行中的长期计划</span>
              <h2 id="plansEmptyTitle">先建档，再定一个能坚持的周期</h2>
              <p>
                AI
                建档会先问几个关键信息，给一版草案；你确认后才会写入档案并启用计划。也可以直接手工新建。
              </p>
              <div className="plans-empty-actions">
                <button className="btn primary" type="button" onClick={() => setChatOpen(true)}>
                  <Icon name="spark" className="icon-sm" />
                  {runtime.mode === 'demo' ? '查看预置建档' : '开始 AI 建档'}
                </button>
                <button
                  className="btn secondary"
                  type="button"
                  disabled={runtime.readOnly}
                  onClick={openManual}
                >
                  手工新建
                </button>
              </div>
            </section>
          )}

          {drafts.length > 0 && (
            <section className="panel plans-list" aria-labelledby="plansDraftTitle">
              <div className="plans-list-head">
                <h2 id="plansDraftTitle">待确认草案</h2>
                <span className="plans-count">{drafts.length}</span>
              </div>
              <ul>
                {drafts.map((plan) => (
                  <li className="plans-row" key={plan.id}>
                    <div className="plans-row-main">
                      <span className="plans-row-title">{plan.title}</span>
                      <span className="plans-row-meta">
                        {cadenceLabel(plan.cadence)} · {plan.startDate}
                        {plan.endDate ? ` → ${plan.endDate}` : ''} · {plan.weeklyTargets.length}{' '}
                        条周目标
                      </span>
                    </div>
                    <span className="plans-status is-draft">{planStatusLabel(plan.status)}</span>
                    <div className="plans-row-actions">
                      <button
                        className="btn secondary"
                        type="button"
                        disabled={runtime.readOnly}
                        onClick={() => openDraft(plan)}
                      >
                        继续确认
                      </button>
                      <button
                        className="btn secondary"
                        type="button"
                        disabled={runtime.readOnly}
                        onClick={() => setPendingArchive(plan)}
                      >
                        归档
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="plans-side-column">
          <section className="panel plans-guide">
            <span className="plans-kicker">怎么用</span>
            <h2>三步建档</h2>
            <ol>
              <li>说清目标、每周能安排几次、有什么器械或时间限制。</li>
              <li>检查草案里的周目标、起止日期和档案改动。</li>
              <li>确认后计划才启用，档案改动也才写入。</li>
            </ol>
            <p className="plans-hint">
              {runtime.mode === 'demo'
                ? '这份 AI 建档对话与长期计划均在部署前真实生成；演示模式只读，不会再次调用模型。'
                : runtime.ai.chat
                  ? '默认使用本地 Mock；在档案页开启 AI 数据授权且服务端可用时，才会经本站代理调用 DeepSeek。确认前不会改档案。'
                  : '桌面体验模式固定使用本地 Mock，不向服务端发送记录。确认前不会改档案。'}
            </p>
          </section>

          {archived.length > 0 && (
            <section className="panel plans-list" aria-labelledby="plansArchivedTitle">
              <div className="plans-list-head">
                <h2 id="plansArchivedTitle">已归档</h2>
                <span className="plans-count">{archived.length}</span>
              </div>
              {archived.length === 0 ? (
                <p className="plans-hint">还没有归档的计划。</p>
              ) : (
                <ul>
                  {archived.map((plan) => (
                    <li className="plans-row" key={plan.id}>
                      <div className="plans-row-main">
                        <span className="plans-row-title">{plan.title}</span>
                        <span className="plans-row-meta">
                          {cadenceLabel(plan.cadence)} · {plan.startDate}
                          {plan.endDate ? ` → ${plan.endDate}` : ''}
                        </span>
                      </div>
                      <span className="plans-status is-archived">
                        {planStatusLabel(plan.status)}
                      </span>
                      <div className="plans-row-actions">
                        <button
                          className="btn secondary"
                          type="button"
                          disabled={runtime.readOnly}
                          onClick={() => requestActivate(plan)}
                        >
                          重新启用
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </aside>
      </div>

      {chatOpen && <PlanChatSheet profile={profile} onClose={closeChat} onReview={handleReview} />}
      {draftSheet && (
        <PlanDraftSheet
          initial={draftSheet.initial}
          patch={draftSheet.patch}
          profile={profile}
          mode={draftSheet.mode}
          onClose={() => setDraftSheet(null)}
          onConfirm={handleConfirmDraft}
        />
      )}
      {pendingArchive && (
        <ConfirmDialog
          title={pendingArchive.status === 'draft' ? '归档这份草案？' : '归档这份计划？'}
          description={
            pendingArchive.status === 'draft'
              ? `「${pendingArchive.title}」会从待确认列表移到已归档，随时可以重新启用。`
              : `「${pendingArchive.title}」会移出进行中，随时可以重新启用。`
          }
          confirmLabel="归档"
          danger
          onConfirm={confirmArchive}
          onClose={() => setPendingArchive(null)}
        />
      )}
      {pendingActivate && (
        <ConfirmDialog
          title="启用这份计划？"
          description={`「${pendingActivate.title}」会开始进行中，当前的「${current?.title ?? ''}」会被归档。`}
          confirmLabel="启用"
          onConfirm={() => applyActivate(pendingActivate)}
          onClose={() => setPendingActivate(null)}
        />
      )}
    </>
  )
}
