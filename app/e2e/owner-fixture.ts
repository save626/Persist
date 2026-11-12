import { expect, type Page } from '@playwright/test'
import { INITIAL_MEALS } from '../src/data/diet'
import { INITIAL_PROFILE } from '../src/data/profile'
import { INITIAL_REPORTS } from '../src/data/reports'
import { INITIAL_SETTINGS } from '../src/data/settings'
import { INITIAL_STUDY_RECORDS } from '../src/data/study'
import { todayDateKey } from '../src/lib/history'
import { serializeMockBackup } from '../src/lib/mock-data-transfer'
import type { Exercise, Goal, ImportableMockData, PlanItem } from '../src/types'

const FIXTURE_GOALS: Goal[] = [
  {
    id: 'goal-1',
    title: '高数阶段测验',
    date: '2027-01-15',
    time: '19:00',
    enabled: true,
    tone: 'primary',
  },
  {
    id: 'goal-2',
    title: '英语六级考试',
    date: '2027-02-19',
    time: '09:00',
    enabled: true,
    tone: 'alt',
  },
]

const FIXTURE_PLAN: Array<Omit<PlanItem, 'date'>> = [
  {
    id: 'morning',
    name: '早餐与晨间记录',
    time: '08:20',
    detail: '380 kcal · 睡眠 7 小时 10 分',
    kind: 'default',
    done: true,
  },
  {
    id: 'lunch',
    name: '午餐记录',
    time: '12:25',
    detail: '鸡胸肉藜麦碗 · 620 kcal',
    kind: 'food',
    done: true,
  },
  {
    id: 'water',
    name: '午后补水',
    time: '15:40',
    detail: '250 ml · 今日累计 1.2 L',
    kind: 'water',
    done: true,
  },
  {
    id: 'training',
    name: '上肢力量训练',
    time: '18:30',
    detail: '45 分钟 · 胸 / 肩 / 三头',
    kind: 'default',
    done: false,
    actionable: true,
  },
  {
    id: 'math',
    name: '高数：极限与连续',
    time: '20:30',
    detail: '45 分钟 · 练习 12 题',
    kind: 'study',
    done: false,
  },
]

const FIXTURE_EXERCISES: Exercise[] = [
  {
    id: 'upper-a-bench-press',
    name: '杠铃平板卧推',
    kind: 'strength',
    muscle: '胸',
    equipment: '杠铃',
    targetReps: '8–10 次',
    rest: '90 秒',
    sets: [
      { id: 'upper-a-bench-press-1', weight: 60, reps: 8, rpe: 7, done: true },
      { id: 'upper-a-bench-press-2', weight: 60, reps: 8, rpe: 7.5, done: true },
      { id: 'upper-a-bench-press-3', weight: 60, reps: 7, rpe: 8, done: true },
      { id: 'upper-a-bench-press-4', weight: 60, reps: 8, rpe: 8, done: false },
    ],
  },
  {
    id: 'upper-a-incline-press',
    name: '上斜哑铃卧推',
    kind: 'strength',
    muscle: '胸 / 肩前束',
    equipment: '哑铃',
    targetReps: '10–12 次',
    rest: '75 秒',
    sets: [
      { id: 'upper-a-incline-press-1', weight: 22.5, reps: 10, done: false },
      { id: 'upper-a-incline-press-2', weight: 22.5, reps: 10, done: false },
      { id: 'upper-a-incline-press-3', weight: 22.5, reps: 9, done: false },
    ],
  },
  {
    id: 'upper-a-cable-pushdown',
    name: '绳索下压',
    kind: 'strength',
    muscle: '三头',
    equipment: '绳索',
    targetReps: '12–15 次',
    rest: '60 秒',
    sets: [
      { id: 'upper-a-cable-pushdown-1', weight: 25, reps: 12, done: false },
      { id: 'upper-a-cable-pushdown-2', weight: 25, reps: 12, done: false },
      { id: 'upper-a-cable-pushdown-3', weight: 25, reps: 11, done: false },
    ],
  },
  {
    id: 'upper-a-lateral-raise',
    name: '哑铃侧平举',
    kind: 'strength',
    muscle: '肩中束',
    equipment: '哑铃',
    targetReps: '15 次',
    rest: '45 秒',
    sets: [
      { id: 'upper-a-lateral-raise-1', weight: 8, reps: 15, done: false },
      { id: 'upper-a-lateral-raise-2', weight: 8, reps: 15, done: false },
      { id: 'upper-a-lateral-raise-3', weight: 8, reps: 14, done: false },
      { id: 'upper-a-lateral-raise-4', weight: 8, reps: 12, done: false },
    ],
  },
]

/** E2E 专用夹具：模拟已经有历史数据的 owner；产品首启本身不再注入这些内容。 */
export function createOwnerFixture(now = new Date()): ImportableMockData {
  const today = todayDateKey(now)
  return {
    goals: FIXTURE_GOALS.map((goal) => ({ ...goal })),
    planItems: FIXTURE_PLAN.map((item) => ({
      ...item,
      date: today,
      detail: `${item.detail} · E2E 夹具`,
    })),
    waterLog: [{ id: 'water-fixture-baseline', milliliters: 1_200, time: '09:00', date: today }],
    studyRecords: INITIAL_STUDY_RECORDS.map((record) => ({
      ...record,
      id: `fixture-${record.id}`,
    })),
    dietDays: [
      {
        date: today,
        meals: INITIAL_MEALS.map((meal) => ({
          ...meal,
          entries: meal.entries.map((entry) => ({ ...entry, id: `fixture-${entry.id}` })),
        })),
      },
    ],
    fitnessSession: {
      activeTemplateId: 'upper-a',
      sessionStatus: 'active',
      elapsedSeconds: 12 * 60 + 48,
      exercises: FIXTURE_EXERCISES.map((exercise) => ({
        ...exercise,
        sets: exercise.sets.map((set) => ({ ...set })),
      })),
    },
    fitnessHistory: [],
    profile: { ...INITIAL_PROFILE, allergies: '无' },
    settings: {
      ...INITIAL_SETTINGS,
      reminders: INITIAL_SETTINGS.reminders.map((reminder) => ({
        ...reminder,
        time: reminder.id === 'review' ? '21:50' : reminder.time,
      })),
      sources: { ...INITIAL_SETTINGS.sources },
      dailyBrief: { ...(INITIAL_SETTINGS.dailyBrief ?? { enabled: false, at: '21:00' }) },
    },
    aiConsent: true,
    eveningReview: null,
    reports: INITIAL_REPORTS.map((report) => ({
      ...report,
      period: `${report.period} · E2E 夹具`,
    })),
    longTermPlans: [],
  }
}

/** 通过真实导入链路写入 E2E 夹具，避免直接操作 IndexedDB 造成启动竞争。 */
export async function seedOwnerFixture(page: Page, data = createOwnerFixture()) {
  const payload = serializeMockBackup(data)
  await page.goto('/settings')
  await page.locator('.settings-file-input').setInputFiles({
    name: 'persist-owner-fixture.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(payload), 'utf8'),
  })
  await expect(page.getByText(/Mock 备份已导入/)).toBeVisible()
  await page.waitForTimeout(450)
}
