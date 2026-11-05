import { describe, expect, it } from 'vitest'
import type { DietDay, FitnessSessionState, Meal, MealId, PlanItem, WaterLogEntry } from '../types'
import {
  addDaysToDateKey,
  createDateWindow,
  createFitnessSessionRecord,
  dateKeyLabel,
  dateKeysBetween,
  dayMeals,
  isDateKeyInWindow,
  mealsForDate,
  patchMealsForDate,
  patchPlanItemsForDate,
  planItemsForDate,
  sortFitnessHistoryDesc,
  todayDateKey,
  waterForDate,
} from './history'

const MEAL = (label: string, id: MealId = 'breakfast'): Meal => ({
  id,
  label,
  time: '08:00',
  entries: [],
})

describe('todayDateKey', () => {
  it('取本地时区的自然日，UTC+8 的凌晨不会被算到前一天', () => {
    // 2026-11-04 00:30（本地）：toISOString() 会得到 2026-11-03，这里必须是 2026-11-04。
    expect(todayDateKey(new Date(2026, 10, 4, 0, 30))).toBe('2026-11-04')
  })

  it('晚上 23:30 仍属于当天，不滚到第二天', () => {
    expect(todayDateKey(new Date(2026, 10, 4, 23, 30))).toBe('2026-11-04')
  })
})

describe('dateKeyLabel', () => {
  it('日期键转成界面文案，星期按本地时区计算', () => {
    expect(dateKeyLabel('2026-11-04')).toEqual({ date: '11 月 4 日', weekday: '周三' })
    expect(dateKeyLabel('2026-01-01')).toEqual({ date: '1 月 1 日', weekday: '周四' })
  })

  it('非法日期键原样返回，星期留空让界面兜底', () => {
    expect(dateKeyLabel('2026/11/04')).toEqual({ date: '2026/11/04', weekday: '' })
  })
})

describe('addDaysToDateKey', () => {
  it('跨月与跨年都按自然日推进', () => {
    expect(addDaysToDateKey('2026-11-30', 1)).toBe('2026-12-01')
    expect(addDaysToDateKey('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDaysToDateKey('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('闰年 2 月正确处理', () => {
    expect(addDaysToDateKey('2028-02-28', 1)).toBe('2028-02-29')
  })

  it('非法日期键或非整数天数原样返回，不扩散 NaN', () => {
    expect(addDaysToDateKey('2026/11/04', 1)).toBe('2026/11/04')
    expect(addDaysToDateKey('2026-11-04', 1.5)).toBe('2026-11-04')
  })
})

describe('dateKeysBetween', () => {
  it('闭区间、升序，包含首尾两天', () => {
    expect(dateKeysBetween('2026-10-30', '2026-11-02')).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ])
  })

  it('同一天只返回一个键', () => {
    expect(dateKeysBetween('2026-11-04', '2026-11-04')).toEqual(['2026-11-04'])
  })

  it('起止倒置时返回空数组', () => {
    expect(dateKeysBetween('2026-11-04', '2026-11-01')).toEqual([])
  })
})

describe('饮食按日读写', () => {
  const dietDays: DietDay[] = [
    { date: '2026-11-03', meals: [MEAL('早餐')] },
    { date: '2026-11-04', meals: [MEAL('早餐'), MEAL('午餐', 'lunch')] },
  ]

  it('按日期取餐次，缺日返回空数组', () => {
    expect(mealsForDate(dietDays, '2026-11-04')).toHaveLength(2)
    expect(mealsForDate(dietDays, '2026-11-05')).toEqual([])
  })

  it('替换目标日不影响其他日期', () => {
    const next = patchMealsForDate(dietDays, '2026-11-04', () => [MEAL('新的早餐')])

    expect(mealsForDate(next, '2026-11-04')).toHaveLength(1)
    expect(mealsForDate(next, '2026-11-03')).toHaveLength(1)
    expect(dietDays).toHaveLength(2)
  })

  it('目标日不存在时追加', () => {
    const next = patchMealsForDate(dietDays, '2026-11-05', () => [MEAL('新的一天')])

    expect(mealsForDate(next, '2026-11-05')).toHaveLength(1)
    expect(next).toHaveLength(3)
  })

  it('写入空餐次时移除这一天，避免历史里堆空壳', () => {
    const next = patchMealsForDate(dietDays, '2026-11-03', () => [])

    expect(next).toHaveLength(1)
    expect(next.some((day) => day.date === '2026-11-03')).toBe(false)
  })
})

describe('dayMeals（跨日后的可写骨架）', () => {
  const dietDays: DietDay[] = [
    { date: '2026-11-04', meals: [MEAL('早餐'), MEAL('午餐', 'lunch')] },
  ]

  it('当天没有记录时给出四个空餐次，让「记录下一餐」与 AI 登记有落点', () => {
    const meals = dayMeals(dietDays, '2026-11-05')

    expect(meals.map((meal) => meal.id)).toEqual(['breakfast', 'lunch', 'dinner', 'snack'])
    expect(meals.map((meal) => meal.label)).toEqual(['早餐', '午餐', '晚餐', '加餐'])
    expect(meals.every((meal) => meal.entries.length === 0)).toBe(true)
  })

  it('当天有记录时原样返回，不额外注入骨架', () => {
    expect(dayMeals(dietDays, '2026-11-04').map((meal) => meal.id)).toEqual(['breakfast', 'lunch'])
  })

  it('每次调用返回独立对象，改一个餐次不会污染下一次读取', () => {
    const first = dayMeals([], '2026-11-05')
    first[0]?.entries.push({
      id: 'x',
      name: '测试',
      portion: '1 份',
      calories: 100,
      protein: 1,
      carbs: 1,
      fat: 1,
    })

    expect(dayMeals([], '2026-11-05')[0]?.entries).toHaveLength(0)
  })
})

describe('饮水与计划按日筛选', () => {
  const waterLog: WaterLogEntry[] = [
    { id: 'w1', milliliters: 250, time: '09:00', date: '2026-11-03' },
    { id: 'w2', milliliters: 300, time: '10:00', date: '2026-11-04' },
    { id: 'w3', milliliters: 400, time: '15:00', date: '2026-11-04' },
  ]
  const planItems: PlanItem[] = [
    {
      id: 'p1',
      name: '昨日计划',
      time: '08:00',
      detail: '',
      kind: 'default',
      done: true,
      date: '2026-11-03',
    },
    {
      id: 'p2',
      name: '今日计划',
      time: '09:00',
      detail: '',
      kind: 'study',
      done: false,
      date: '2026-11-04',
    },
  ]

  it('饮水按日期筛选且保持写入顺序', () => {
    expect(waterForDate(waterLog, '2026-11-04').map((entry) => entry.id)).toEqual(['w2', 'w3'])
    expect(waterForDate(waterLog, '2026-11-05')).toEqual([])
  })

  it('计划按日期筛选', () => {
    expect(planItemsForDate(planItems, '2026-11-04').map((item) => item.id)).toEqual(['p2'])
    expect(planItemsForDate(planItems, '2026-11-05')).toEqual([])
  })

  it('改写某天计划时其他日期原样保留', () => {
    const next = patchPlanItemsForDate(planItems, '2026-11-04', (items) =>
      items.map((item) => ({ ...item, done: true })),
    )

    expect(next.find((item) => item.id === 'p2')?.done).toBe(true)
    expect(next.find((item) => item.id === 'p1')).toEqual(planItems[0])
    expect(next).toHaveLength(2)
  })

  it('清空某天计划时不留下其他日期的重复条目', () => {
    const next = patchPlanItemsForDate(planItems, '2026-11-04', () => [])

    expect(next.map((item) => item.id)).toEqual(['p1'])
  })
})

describe('createFitnessSessionRecord', () => {
  const session: FitnessSessionState = {
    sessionStatus: 'completed',
    activeTemplateId: 'upper-a',
    elapsedSeconds: 2_400,
    exercises: [
      {
        id: 'bench',
        name: '杠铃平板卧推',
        muscle: '胸',
        equipment: '杠铃',
        targetReps: '8',
        rest: '90 秒',
        kind: 'strength',
        sets: [{ id: 'set-1', weight: 60, reps: 8, done: true }],
      },
    ],
  }

  it('日期取完成当天、保留完成时刻与动作快照', () => {
    const now = new Date(2026, 10, 4, 22, 10)
    const record = createFitnessSessionRecord(session, now)

    expect(record.id).toBe(`workout-${now.getTime()}`)
    expect(record.date).toBe('2026-11-04')
    expect(record.completedAt).toBe(now.toISOString())
    expect(record.templateId).toBe('upper-a')
    expect(record.elapsedSeconds).toBe(2_400)
    expect(record.exercises).toEqual(session.exercises)
  })
})

describe('sortFitnessHistoryDesc', () => {
  const base = {
    templateId: 'upper-a',
    elapsedSeconds: 60,
    exercises: [],
  }

  it('按完成时刻倒序，最新在前', () => {
    const sorted = sortFitnessHistoryDesc([
      { ...base, id: 'a', date: '2026-11-01', completedAt: '2026-11-01T10:00:00.000Z' },
      { ...base, id: 'c', date: '2026-11-04', completedAt: '2026-11-04T10:00:00.000Z' },
      { ...base, id: 'b', date: '2026-11-02', completedAt: '2026-11-02T10:00:00.000Z' },
    ])

    expect(sorted.map((record) => record.id)).toEqual(['c', 'b', 'a'])
  })

  it('不修改入参数组', () => {
    const input = [
      { ...base, id: 'a', date: '2026-11-01', completedAt: '2026-11-01T10:00:00.000Z' },
    ]
    sortFitnessHistoryDesc(input)

    expect(input).toHaveLength(1)
  })
})

describe('createDateWindow', () => {
  it('以结束日为最后一天，向前覆盖 days 天（含首尾）', () => {
    expect(createDateWindow(7, '2026-11-04')).toEqual({
      startKey: '2026-10-29',
      endKey: '2026-11-04',
      days: 7,
    })
    expect(createDateWindow(1, '2026-11-04')).toEqual({
      startKey: '2026-11-04',
      endKey: '2026-11-04',
      days: 1,
    })
  })

  it('天数被夹到 1..366，脏参数不会拉出超长窗口', () => {
    expect(createDateWindow(0, '2026-11-04').days).toBe(1)
    expect(createDateWindow(-5, '2026-11-04').days).toBe(1)
    expect(createDateWindow(2.9, '2026-11-04').days).toBe(2)
    expect(createDateWindow(9999, '2026-11-04').days).toBe(366)
    expect(createDateWindow(Number.NaN, '2026-11-04').days).toBe(1)
  })
})

describe('isDateKeyInWindow', () => {
  const window = createDateWindow(7, '2026-11-04')

  it('首尾两天都算在窗口内', () => {
    expect(isDateKeyInWindow('2026-10-29', window)).toBe(true)
    expect(isDateKeyInWindow('2026-11-04', window)).toBe(true)
  })

  it('窗口外一天不算', () => {
    expect(isDateKeyInWindow('2026-10-28', window)).toBe(false)
    expect(isDateKeyInWindow('2026-11-05', window)).toBe(false)
  })
})
