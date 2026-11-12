import type {
  DietDay,
  EveningReviewPayload,
  FitnessSessionState,
  Goal,
  ImportableMockData,
  Meal,
  MockSettings,
  PlanItem,
  ProfileData,
  ReportRecord,
  StudyRecord,
  WaterLogEntry,
} from '../types'
import { formatTrainingSummary, summarizeFitness } from '../lib/fitness'
import { createLongTermPlan } from '../lib/long-term-plan'
import { proposalToDraft } from '../lib/plan-draft'
import {
  PREBUILT_DEMO_AI_METADATA,
  PREBUILT_DEMO_PLAN_CHAT,
  PREBUILT_DEMO_REPORT_CONTENT,
} from './prebuilt-demo-ai'

const WATER_BASELINE_MILLILITERS = 1_200

function dateAtOffset(offset: number, now = new Date()) {
  const date = new Date(now)
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() + offset)
  return date
}

function dateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function reportDate(date: Date) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
  }).format(date)
}

function reportDateTime(date: Date, time: string) {
  return `${reportDate(date)} ${time}`
}

/**
 * Builds a complete frontend-only dataset relative to the current local day.
 * Loading it replaces every mutable MockDataProvider slice so all primary
 * interactions can be exercised without preparing data manually.
 */
export function createCompleteMockData(now = new Date()): ImportableMockData {
  const today = dateKey(dateAtOffset(0, now))
  const goals: Goal[] = [
    {
      id: 'goal-1',
      title: '高数阶段测验',
      date: dateKey(dateAtOffset(18, now)),
      time: '19:00',
      enabled: true,
      tone: 'primary',
    },
    {
      id: 'goal-2',
      title: '英语六级考试',
      date: dateKey(dateAtOffset(51, now)),
      time: '09:00',
      enabled: true,
      tone: 'alt',
    },
  ]

  const planItems: Array<Omit<PlanItem, 'date'>> = [
    {
      id: 'morning',
      name: '早餐与晨间记录',
      time: '08:05',
      detail: '480 kcal · 蛋白质 31 g · 睡眠 7.4 小时',
      kind: 'default',
      done: true,
    },
    {
      id: 'english',
      name: '英语单词与听力',
      time: '09:10',
      detail: '35 分钟 · 24 个新词 · 听力 15 分钟',
      kind: 'study',
      done: true,
    },
    {
      id: 'water',
      name: '上午补水',
      time: '10:15',
      detail: '250 ml · 今日累计 1.20 L',
      kind: 'water',
      done: true,
    },
    {
      id: 'math',
      name: '高数：极限与连续',
      time: '16:30',
      detail: '45 分钟 · 18 题 · 错题 4 道',
      kind: 'study',
      done: false,
    },
    {
      id: 'training',
      name: '上肢力量 A',
      time: '18:30',
      detail: '45 分钟 · 胸 / 肩 / 三头 · 已有进行中会话',
      kind: 'default',
      done: false,
      actionable: true,
    },
    {
      id: 'dinner',
      name: '晚餐与蛋白质补充',
      time: '19:40',
      detail: '训练后 2 小时内完成 · 目标 45 g 蛋白质',
      kind: 'food',
      done: false,
    },
    {
      id: 'review',
      name: '晚间复盘',
      time: '21:40',
      detail: '回看训练强度、饮水与高数错题',
      kind: 'default',
      done: false,
    },
  ]

  const waterLog: Array<Omit<WaterLogEntry, 'date'>> = [
    { id: 'water-demo-1', milliliters: 250, time: '10:15' },
    { id: 'water-demo-2', milliliters: 250, time: '12:40' },
    { id: 'water-demo-3', milliliters: 300, time: '15:30' },
  ]

  const studyRecords: StudyRecord[] = [
    {
      id: 'study-demo-english-today',
      category: 'english',
      source: '百词斩',
      date: today,
      startTime: '09:10',
      duration: 35,
      note: '六级核心词新学一组，复盘熟词僻义。',
      newWords: 24,
      reviewWords: 41,
      accuracy: 88,
      listening: 15,
    },
    {
      id: 'study-demo-math-today',
      category: 'math',
      source: '高数错题复盘',
      date: today,
      startTime: '16:20',
      duration: 45,
      note: '极限与连续章节，计算步骤和错因都已登记。',
      chapter: '极限与连续',
      questions: 18,
      wrong: 4,
    },
    {
      id: 'study-demo-english-1',
      category: 'english',
      source: '不背单词',
      date: dateKey(dateAtOffset(-1, now)),
      startTime: '08:55',
      duration: 30,
      note: '复习旧词并完成一组听力精听。',
      newWords: 12,
      reviewWords: 52,
      accuracy: 84,
      listening: 12,
    },
    {
      id: 'study-demo-math-1',
      category: 'math',
      source: '高数练习',
      date: dateKey(dateAtOffset(-1, now)),
      startTime: '18:40',
      duration: 40,
      note: '导数基础题，计算错误多于概念错误。',
      chapter: '导数与微分',
      questions: 16,
      wrong: 3,
    },
    {
      id: 'study-demo-english-2',
      category: 'english',
      source: '英语真题',
      date: dateKey(dateAtOffset(-2, now)),
      startTime: '10:00',
      duration: 45,
      note: '阅读与听力各完成一套，重点核对定位过程。',
      newWords: 8,
      reviewWords: 36,
      accuracy: 81,
      listening: 25,
    },
    {
      id: 'study-demo-math-2',
      category: 'math',
      source: '章节练习',
      date: dateKey(dateAtOffset(-2, now)),
      startTime: '19:10',
      duration: 50,
      note: '中值定理综合题，保留两道题留到第二天复盘。',
      chapter: '中值定理',
      questions: 14,
      wrong: 5,
    },
    {
      id: 'study-demo-english-3',
      category: 'english',
      source: '百词斩',
      date: dateKey(dateAtOffset(-3, now)),
      startTime: '09:20',
      duration: 28,
      note: '只完成最小任务，保持记录连续。',
      newWords: 18,
      reviewWords: 30,
      accuracy: 87,
      listening: 0,
    },
    {
      id: 'study-demo-math-3',
      category: 'math',
      source: '错题整理',
      date: dateKey(dateAtOffset(-3, now)),
      startTime: '20:30',
      duration: 35,
      note: '把同类错题合并成一张复盘卡。',
      chapter: '不定积分',
      questions: 10,
      wrong: 2,
    },
    {
      id: 'study-demo-english-4',
      category: 'english',
      source: '听力精练',
      date: dateKey(dateAtOffset(-4, now)),
      startTime: '20:05',
      duration: 32,
      note: '两段材料逐句跟读，记录连读问题。',
      newWords: 6,
      reviewWords: 22,
      accuracy: 90,
      listening: 20,
    },
    {
      id: 'study-demo-math-4',
      category: 'math',
      source: '高数练习',
      date: dateKey(dateAtOffset(-4, now)),
      startTime: '21:10',
      duration: 42,
      note: '定积分应用，先保证步骤完整。',
      chapter: '定积分应用',
      questions: 15,
      wrong: 3,
    },
    {
      id: 'study-demo-english-5',
      category: 'english',
      source: '英语真题',
      date: dateKey(dateAtOffset(-5, now)),
      startTime: '15:40',
      duration: 26,
      note: '复盘错题选项，不追加新的套题。',
      newWords: 4,
      reviewWords: 28,
      accuracy: 83,
      listening: 10,
    },
    {
      id: 'study-demo-math-5',
      category: 'math',
      source: '课程学习',
      date: dateKey(dateAtOffset(-6, now)),
      startTime: '19:30',
      duration: 38,
      note: '极限定义与等价无穷小，完成课堂例题。',
      chapter: '极限',
      questions: 12,
      wrong: 1,
    },
  ]

  const meals: Meal[] = [
    {
      id: 'breakfast',
      label: '早餐',
      time: '08:05',
      entries: [
        {
          id: 'demo-breakfast-oats',
          name: '燕麦酸奶碗',
          portion: '1 碗 · 300 g',
          calories: 360,
          protein: 20,
          carbs: 48,
          fat: 10,
        },
        {
          id: 'demo-breakfast-eggs',
          name: '水煮蛋',
          portion: '2 个 · 100 g',
          calories: 120,
          protein: 11,
          carbs: 1,
          fat: 8,
        },
      ],
    },
    {
      id: 'lunch',
      label: '午餐',
      time: '12:30',
      entries: [
        {
          id: 'demo-lunch-chicken',
          name: '香煎鸡胸藜麦碗',
          portion: '1 份 · 430 g',
          calories: 580,
          protein: 49,
          carbs: 61,
          fat: 15,
        },
        {
          id: 'demo-lunch-broccoli',
          name: '蒜香西兰花',
          portion: '1 份 · 160 g',
          calories: 70,
          protein: 5,
          carbs: 10,
          fat: 2,
        },
      ],
    },
    {
      id: 'dinner',
      label: '晚餐',
      time: '19:40',
      entries: [
        {
          id: 'demo-dinner-salmon',
          name: '三文鱼糙米饭',
          portion: '1 份 · 420 g',
          calories: 620,
          protein: 43,
          carbs: 62,
          fat: 22,
        },
        {
          id: 'demo-dinner-avocado',
          name: '牛油果蔬菜沙拉',
          portion: '1 份 · 180 g',
          calories: 140,
          protein: 4,
          carbs: 11,
          fat: 9,
        },
      ],
    },
    {
      id: 'snack',
      label: '加餐',
      time: '16:10',
      entries: [
        {
          id: 'demo-snack-yogurt',
          name: '希腊酸奶',
          portion: '1 杯 · 170 g',
          calories: 150,
          protein: 15,
          carbs: 10,
          fat: 4,
        },
        {
          id: 'demo-snack-banana',
          name: '香蕉',
          portion: '1 根 · 110 g',
          calories: 90,
          protein: 1,
          carbs: 22,
          fat: 0,
        },
      ],
    },
  ]

  const fitnessSession: FitnessSessionState = {
    activeTemplateId: 'upper-a',
    sessionStatus: 'active',
    elapsedSeconds: 32 * 60 + 22,
    exercises: [
      {
        id: 'demo-bench-press',
        name: '杠铃平板卧推',
        kind: 'strength',
        muscle: '胸',
        equipment: '杠铃',
        targetReps: '8–10 次',
        rest: '90 秒',
        sets: [
          { id: 'demo-bench-1', weight: 60, reps: 8, rpe: 7, done: true },
          { id: 'demo-bench-2', weight: 62.5, reps: 8, rpe: 7.5, done: true },
          { id: 'demo-bench-3', weight: 62.5, reps: 8, rpe: 8, done: true },
          { id: 'demo-bench-4', weight: 62.5, reps: 7, rpe: 8.5, done: false },
        ],
      },
      {
        id: 'demo-incline-press',
        name: '上斜哑铃卧推',
        kind: 'strength',
        muscle: '胸 / 肩前束',
        equipment: '哑铃',
        targetReps: '10–12 次',
        rest: '75 秒',
        sets: [
          { id: 'demo-incline-1', weight: 22.5, reps: 10, rpe: 8, done: true },
          { id: 'demo-incline-2', weight: 22.5, reps: 10, rpe: 8, done: true },
          { id: 'demo-incline-3', weight: 22.5, reps: 9, rpe: 8.5, done: false },
        ],
      },
      {
        id: 'demo-pushdown',
        name: '绳索下压',
        kind: 'strength',
        muscle: '三头',
        equipment: '绳索',
        targetReps: '12–15 次',
        rest: '60 秒',
        sets: [
          { id: 'demo-pushdown-1', weight: 25, reps: 12, rpe: 7.5, done: true },
          { id: 'demo-pushdown-2', weight: 27.5, reps: 12, rpe: 8, done: true },
          { id: 'demo-pushdown-3', weight: 27.5, reps: 11, rpe: 8.5, done: false },
        ],
      },
      {
        id: 'demo-lateral-raise',
        name: '哑铃侧平举',
        kind: 'strength',
        muscle: '肩中束',
        equipment: '哑铃',
        targetReps: '15 次',
        rest: '45 秒',
        sets: [
          { id: 'demo-lateral-1', weight: 8, reps: 15, rpe: 8, done: true },
          { id: 'demo-lateral-2', weight: 8, reps: 15, rpe: 8, done: false },
          { id: 'demo-lateral-3', weight: 8, reps: 14, rpe: 8.5, done: false },
          { id: 'demo-lateral-4', weight: 8, reps: 12, rpe: 9, done: false },
        ],
      },
      {
        id: 'demo-jump-rope',
        name: '跳绳',
        kind: 'duration',
        muscle: '有氧',
        equipment: '跳绳',
        targetReps: '12 分钟',
        rest: '按需',
        sets: [{ id: 'demo-jump-rope-1', durationMinutes: 12, rpe: 7, done: true }],
      },
      {
        id: 'demo-cycling',
        name: '骑行',
        kind: 'distance',
        muscle: '距离运动',
        equipment: '自行车',
        targetReps: '8.5 km',
        rest: '按需',
        sets: [
          {
            id: 'demo-cycling-1',
            distanceKm: 8.5,
            durationMinutes: 25,
            rpe: 7,
            done: true,
          },
        ],
      },
    ],
  }

  const profile: ProfileData = {
    age: 24,
    height: 178,
    weight: 72.5,
    targetWeight: 70,
    goal: '增肌同时改善体态',
    experience: '系统训练 2 年',
    frequency: '每周 4 次',
    equipment: '商业健身房',
    dietPreference: '高蛋白、正常碳水',
    allergies: '花生过敏',
    bedtime: '23:15',
    sleepHours: 7.4,
    stress: '中等',
    aiConsent: true,
  }

  const settings: MockSettings = {
    reminders: [
      {
        id: 'water',
        title: '饮水提醒',
        detail: '上午、训练前和晚间分三次提醒，不集中补水。',
        time: '09:30',
        enabled: true,
        icon: 'water',
      },
      {
        id: 'training',
        title: '训练提醒',
        detail: '计划训练开始前 30 分钟提醒一次。',
        time: '18:00',
        enabled: true,
        icon: 'fitness',
      },
      {
        id: 'review',
        title: '复盘提醒',
        detail: '睡前提醒整理今日训练、饮食与学习记录。',
        time: '21:30',
        enabled: true,
        icon: 'clock',
      },
    ],
    summaryOnly: true,
    sources: {
      fitness: true,
      diet: true,
      study: true,
      profile: true,
    },
  }

  const eveningReview: EveningReviewPayload = {
    energy: 4,
    state: '专注度不错',
    note: '训练、饮食和学习记录都已覆盖，准备收尾。',
  }

  const fitnessSummary = summarizeFitness(fitnessSession.exercises)
  const doneSets = fitnessSummary.doneSets
  const englishRecords = studyRecords.filter((record) => record.category === 'english')
  const mathRecords = studyRecords.filter((record) => record.category === 'math')
  const totalStudyMinutes = studyRecords.reduce((total, record) => total + record.duration, 0)
  const totalWaterLiters =
    (WATER_BASELINE_MILLILITERS + waterLog.reduce((total, entry) => total + entry.milliliters, 0)) /
    1000
  const totalCalories = meals.reduce(
    (total, meal) => total + meal.entries.reduce((sum, entry) => sum + entry.calories, 0),
    0,
  )
  const totalProtein = meals.reduce(
    (total, meal) => total + meal.entries.reduce((sum, entry) => sum + entry.protein, 0),
    0,
  )
  const foodEntryCount = meals.reduce((total, meal) => total + meal.entries.length, 0)
  const mealCountLabel = meals.filter((meal) => meal.entries.length > 0).length
  const reportNow = dateAtOffset(0, now)

  const prebuiltMeta = {
    model: PREBUILT_DEMO_AI_METADATA.model,
    generatedAt: PREBUILT_DEMO_AI_METADATA.generatedAt,
  }
  const reports: ReportRecord[] = [
    {
      id: 'report-demo-daily',
      type: '今日简报',
      ...PREBUILT_DEMO_REPORT_CONTENT.daily,
      date: reportDate(reportNow),
      updatedAt: reportDateTime(reportNow, '20:32'),
      period: '近 7 天',
      metric: [
        { label: '训练', value: '进行中', detail: `${doneSets} 组已完成` },
        {
          label: '学习',
          value: `${totalStudyMinutes} min`,
          detail: `${englishRecords.length} 条英语 / ${mathRecords.length} 条高数`,
        },
        {
          label: '饮食',
          value: `${totalCalories.toLocaleString('zh-CN')} kcal`,
          detail: `${foodEntryCount} 个食物条目`,
        },
        { label: '饮水', value: `${totalWaterLiters.toFixed(2)} L`, detail: '已达到 2.0 L 目标' },
      ],
      evidence: [
        `训练记录：${formatTrainingSummary(fitnessSession.exercises)}`,
        `学习记录：共 ${studyRecords.length} 条，英语 ${englishRecords.length} 条、高数 ${mathRecords.length} 条，累计 ${totalStudyMinutes} 分钟`,
        `饮食记录：4 个有食物的餐次，共 ${foodEntryCount} 个食物条目，蛋白质 ${totalProtein} g`,
        `饮水记录：3 段新增事件，叠加晨间基线后 ${totalWaterLiters.toFixed(2)} L`,
        '个人档案：13 / 13 项已填写，含过敏、作息与压力信息',
      ],
      origin: 'prebuilt',
      prebuilt: prebuiltMeta,
    },
    {
      id: 'report-demo-training',
      type: '训练建议',
      ...PREBUILT_DEMO_REPORT_CONTENT.training,
      date: reportDate(dateAtOffset(-1, now)),
      updatedAt: reportDateTime(dateAtOffset(-1, now), '20:32'),
      period: '近 7 天训练记录',
      metric: [
        { label: '完成组数', value: `${doneSets} / 16`, detail: '进行中的上肢力量会话' },
        { label: '力量容量', value: '2680 kg', detail: '仅统计已完成组' },
        { label: '有氧', value: '8.5 km', detail: '跳绳 12 分钟 + 骑行 25 分钟' },
        { label: '动作', value: '6 个', detail: '力量、时长与距离动作均有覆盖' },
      ],
      evidence: [
        '杠铃平板卧推完成前 3 组，重量依次为 60 / 62.5 / 62.5 kg',
        '上斜哑铃卧推完成 2 组，重量均为 22.5 kg',
        '绳索下压完成 2 组，哑铃侧平举完成 1 组',
        '跳绳完成 12 分钟，骑行完成 8.5 km / 25 分钟',
        '个人档案：目标增肌并改善体态，每周可训练 4 次',
      ],
      origin: 'prebuilt',
      prebuilt: prebuiltMeta,
    },
    {
      id: 'report-demo-study',
      type: '学习观察',
      ...PREBUILT_DEMO_REPORT_CONTENT.study,
      date: reportDate(dateAtOffset(-2, now)),
      updatedAt: reportDateTime(dateAtOffset(-2, now), '20:32'),
      period: '近 7 天学习记录',
      metric: [
        {
          label: '英语投入',
          value: `${englishRecords.reduce((total, record) => total + record.duration, 0)} min`,
          detail: `${englishRecords.length} 条记录`,
        },
        {
          label: '高数投入',
          value: `${mathRecords.reduce((total, record) => total + record.duration, 0)} min`,
          detail: `${mathRecords.length} 条记录`,
        },
        {
          label: '有效记录',
          value: `${studyRecords.length} 条`,
          detail: `英语 ${englishRecords.length} / 高数 ${mathRecords.length}`,
        },
        { label: '累计投入', value: `${totalStudyMinutes} min`, detail: '近 7 天学习记录' },
      ],
      evidence: [
        `近 7 天学习记录 ${studyRecords.length} 条，英语 ${englishRecords.length} 条、高数 ${mathRecords.length} 条`,
        `累计学习 ${totalStudyMinutes} 分钟`,
        '英语记录包含新词、复习词、正确率与听力字段',
        '高数记录包含章节、题量与错题字段',
      ],
      origin: 'prebuilt',
      prebuilt: prebuiltMeta,
    },
    {
      id: 'report-demo-diet',
      type: '饮食观察',
      ...PREBUILT_DEMO_REPORT_CONTENT.diet,
      date: reportDate(dateAtOffset(-3, now)),
      updatedAt: reportDateTime(dateAtOffset(-3, now), '20:32'),
      period: '近 7 天饮食与饮水',
      metric: [
        {
          label: '总热量',
          value: `${totalCalories.toLocaleString('zh-CN')} kcal`,
          detail: '来自 4 个餐次',
        },
        { label: '蛋白质', value: `${totalProtein} g`, detail: '早餐、午餐、晚餐与加餐合计' },
        { label: '食物条目', value: `${foodEntryCount} 个`, detail: '每餐均至少 2 项' },
        { label: '饮水', value: `${totalWaterLiters.toFixed(2)} L`, detail: '已达到 2.0 L 目标' },
      ],
      evidence: [
        '早餐、午餐、晚餐和加餐均已记录食物',
        `食物条目共 ${foodEntryCount} 个，分布在 4 个餐次`,
        `总热量 ${totalCalories.toLocaleString('zh-CN')} kcal，蛋白质 ${totalProtein} g`,
        `饮水 ${totalWaterLiters.toFixed(2)} L，含 3 段新增饮水事件`,
        '个人档案：花生过敏，饮食记录与建议均已避开花生',
      ],
      origin: 'prebuilt',
      prebuilt: prebuiltMeta,
    },
    {
      id: 'report-demo-analysis',
      type: '综合分析',
      ...PREBUILT_DEMO_REPORT_CONTENT.analysis,
      date: reportDate(dateAtOffset(-4, now)),
      updatedAt: reportDateTime(dateAtOffset(-4, now), '20:32'),
      period: '近 7 天综合分析',
      metric: [
        { label: '训练', value: '10 / 16 组', detail: '进行中的上肢力量会话' },
        { label: '学习', value: '446 min', detail: '英语与高数各 6 条' },
        { label: '饮食', value: '4 餐', detail: '8 个食物条目' },
        { label: '饮水', value: '0.80 L', detail: '近 7 天 3 个记录节点' },
      ],
      evidence: [
        `训练记录：${formatTrainingSummary(fitnessSession.exercises)}，力量容量 2680 kg`,
        `学习记录：近 7 天 ${studyRecords.length} 条，累计 ${totalStudyMinutes} 分钟`,
        `饮食记录：${mealCountLabel} 个有食物的餐次、${foodEntryCount} 个食物条目`,
        `饮水记录：近 7 天 ${waterLog.length} 次事件，累计 0.80 L`,
        '个人档案：13 / 13 项已填写，目标为增肌同时改善体态',
      ],
      origin: 'prebuilt',
      prebuilt: prebuiltMeta,
    },
  ]

  // 演示数据只覆盖「今天」这一天：计划与饮水盖上当天日期，饮食装进按日台账。
  const todayKey = dateKey(now)
  const dietDays: DietDay[] = [{ date: todayKey, meals }]

  return {
    goals,
    planItems: planItems.map((item) => ({ ...item, date: todayKey })),
    waterLog: waterLog.map((entry) => ({ ...entry, date: todayKey })),
    studyRecords,
    dietDays,
    fitnessSession,
    fitnessHistory: [],
    profile,
    settings,
    aiConsent: true,
    eveningReview,
    reports,
  }
}

/** demo 专用：在完整演示数据上追加部署前通过真实 AI 建档生成的长期计划。 */
export function createCompleteDemoData(now = new Date()): ImportableMockData {
  const data = createCompleteMockData(now)
  const generatedAt = new Date(PREBUILT_DEMO_AI_METADATA.generatedAt)
  const prebuiltPlan = createLongTermPlan(
    proposalToDraft(PREBUILT_DEMO_PLAN_CHAT.proposal, generatedAt),
    generatedAt,
  )
  return {
    ...data,
    longTermPlans: prebuiltPlan
      ? [{ ...prebuiltPlan, id: 'plan-demo-ai-12w', status: 'active' }]
      : [],
  }
}
