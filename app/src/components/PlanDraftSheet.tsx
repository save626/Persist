import { useState } from 'react'
import { DatePickerField } from './DateTimePicker'
import { Icon } from './Icon'
import { PageSheet } from './PageSheet'
import {
  PLAN_MODULES,
  WEEKLY_TARGET_UNITS,
  type LongTermPlanDraft,
  type LongTermPlanTargetDraft,
} from '../lib/long-term-plan'
import { describeDroppedProfileFields, profilePatchEntries, validateDraft } from '../lib/plan-draft'
import { sanitizeProfilePatch } from '../lib/profile-rules'
import type { PlanCadence, PlanModule, ProfileData } from '../types'

/**
 * 草案确认/编辑面板。
 *
 * 表单里的值始终是本地状态，只有点「确认并启用」时才会交给页面去写入：
 * 页面负责「落库 → 启用 → 归档旧计划 → toast 提示」，这里只做校验。
 */

const MODULE_LABELS: Record<PlanModule, string> = {
  fitness: '健身',
  study: '学习',
  diet: '饮食',
  other: '其他',
}

interface PlanDraftSheetProps {
  initial: LongTermPlanDraft
  patch: Partial<ProfileData>
  profile: ProfileData
  mode: 'ai' | 'manual'
  onClose: () => void
  onConfirm: (draft: LongTermPlanDraft) => void
}

function clampPerWeekInput(value: string): number {
  const digits = value.replace(/[^\d]/g, '')
  if (!digits) return 0
  return Math.min(Number(digits), 999)
}

export function PlanDraftSheet({
  initial,
  patch,
  profile,
  mode,
  onClose,
  onConfirm,
}: PlanDraftSheetProps) {
  const [title, setTitle] = useState(initial.title)
  const [goal, setGoal] = useState(initial.goal)
  const [cadence, setCadence] = useState<PlanCadence>(initial.cadence)
  const [startDate, setStartDate] = useState(initial.startDate ?? '')
  const [endDate, setEndDate] = useState(initial.endDate ?? '')
  const [targets, setTargets] = useState<LongTermPlanTargetDraft[]>(
    initial.weeklyTargets.length > 0
      ? initial.weeklyTargets.map((target) => ({ ...target }))
      : [{ label: '', unit: '次', perWeek: 3 }],
  )
  const [error, setError] = useState('')

  const milestones = initial.milestones ?? []
  const sanitized = sanitizeProfilePatch(patch)
  const patchEntries = profilePatchEntries(sanitized.patch, profile)
  const droppedHint = describeDroppedProfileFields(sanitized.dropped)

  const updateTarget = (index: number, next: Partial<LongTermPlanTargetDraft>) => {
    setTargets((prev) =>
      prev.map((target, current) => (current === index ? { ...target, ...next } : target)),
    )
  }

  const removeTarget = (index: number) => {
    setTargets((prev) => prev.filter((_, current) => current !== index))
  }

  const addTarget = () => {
    setTargets((prev) => [...prev, { label: '', unit: '次', perWeek: 3 }])
  }

  const handleConfirm = () => {
    const validation = validateDraft({
      title,
      goal,
      cadence,
      startDate,
      endDate: endDate || undefined,
      weeklyTargets: targets,
      milestones,
      source: mode === 'ai' ? 'ai-chat' : 'manual',
    })
    if (!validation.draft) {
      setError(validation.message)
      return
    }
    setError('')
    onConfirm(validation.draft)
  }

  return (
    <PageSheet
      title={mode === 'ai' ? '确认长期计划草案' : '手工新建长期计划'}
      subtitle="确认后会启用这份计划；如果已有进行中的计划，它会被归档。"
      onClose={onClose}
    >
      <div className="plans-form">
        <label className="plans-field">
          <span>计划标题</span>
          <input
            className="plans-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="例如 12 周减脂计划"
          />
        </label>

        <label className="plans-field">
          <span>目标</span>
          <input
            className="plans-input"
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            placeholder="例如 减脂 + 保留力量"
          />
        </label>

        <div className="plans-field">
          <span>节奏</span>
          <div className="segmented" role="group" aria-label="计划节奏">
            <button
              type="button"
              className={cadence === 'weekly' ? 'active' : ''}
              aria-pressed={cadence === 'weekly'}
              onClick={() => setCadence('weekly')}
            >
              周计划
            </button>
            <button
              type="button"
              className={cadence === 'cycle' ? 'active' : ''}
              aria-pressed={cadence === 'cycle'}
              onClick={() => setCadence('cycle')}
            >
              周期计划
            </button>
          </div>
        </div>

        <div className="plans-field-row">
          <DatePickerField
            className="plans-field"
            triggerClassName="plans-input"
            label="开始日期"
            value={startDate}
            onChange={setStartDate}
          />
          <DatePickerField
            className="plans-field"
            triggerClassName="plans-input"
            label="结束日期（可选）"
            value={endDate}
            onChange={setEndDate}
            clearable
          />
        </div>

        <div className="plans-field">
          <span>每周目标</span>
          <div className="plans-target-editor">
            {targets.map((target, index) => (
              <div className="plan-target-row" key={index}>
                <label className="plans-field plans-field-grow">
                  <span>项目 {index + 1}</span>
                  <input
                    className="plans-input"
                    value={target.label}
                    onChange={(event) => updateTarget(index, { label: event.target.value })}
                    placeholder="例如 力量训练"
                  />
                </label>
                <label className="plans-field plans-field-narrow">
                  <span>每周次数</span>
                  <input
                    className="plans-input"
                    inputMode="numeric"
                    value={target.perWeek || ''}
                    onChange={(event) =>
                      updateTarget(index, { perWeek: clampPerWeekInput(event.target.value) })
                    }
                  />
                </label>
                <label className="plans-field plans-field-narrow">
                  <span>单位</span>
                  <select
                    className="plans-input"
                    value={target.unit}
                    onChange={(event) =>
                      updateTarget(index, {
                        unit: event.target.value as LongTermPlanTargetDraft['unit'],
                      })
                    }
                  >
                    {WEEKLY_TARGET_UNITS.map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="plans-field plans-field-narrow">
                  <span>关联模块</span>
                  <select
                    className="plans-input"
                    value={target.module ?? 'other'}
                    onChange={(event) =>
                      updateTarget(index, { module: event.target.value as PlanModule })
                    }
                  >
                    {PLAN_MODULES.map((module) => (
                      <option key={module} value={module}>
                        {MODULE_LABELS[module]}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="icon-btn plan-target-remove"
                  type="button"
                  aria-label={`删除目标 ${index + 1}`}
                  disabled={targets.length <= 1}
                  onClick={() => removeTarget(index)}
                >
                  <Icon name="close" className="icon-sm" />
                </button>
              </div>
            ))}
            <button className="link plans-add-target" type="button" onClick={addTarget}>
              <Icon name="plus" className="icon-sm" />
              添加一条每周目标
            </button>
          </div>
        </div>

        {milestones.length > 0 && (
          <div className="plans-milestone-preview">
            <span className="plans-kicker">里程碑（来自草案，不可编辑）</span>
            <ul>
              {milestones.map((milestone) => (
                <li key={`${milestone.date}-${milestone.label}`}>
                  <span className="plans-milestone-date">{milestone.date}</span>
                  <span>{milestone.label}</span>
                  {milestone.metric && (
                    <span className="plans-milestone-metric">{milestone.metric}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {patchEntries.length > 0 && (
          <div className="plans-patch-preview">
            <span className="plans-kicker">确认后同时写入档案</span>
            <ul>
              {patchEntries.map((entry) => (
                <li key={entry.field}>
                  <span>{entry.label}</span>
                  <span>
                    {entry.previous} → {entry.next}
                  </span>
                </li>
              ))}
            </ul>
            {droppedHint && <p className="plans-hint">{droppedHint}</p>}
          </div>
        )}

        {error && (
          <p className="plans-error" role="alert">
            {error}
          </p>
        )}

        <div className="plans-actions">
          <button className="btn secondary" type="button" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" type="button" onClick={handleConfirm}>
            确认并启用
          </button>
        </div>
      </div>
    </PageSheet>
  )
}
