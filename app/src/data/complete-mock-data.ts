import type {
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
import { formatTrainingSummary, getExerciseKind, summarizeFitness } from '../lib/fitness'

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

  const planItems: PlanItem[] = [
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

  const waterLog: WaterLogEntry[] = [
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
      photoName: 'complete-demo-breakfast.jpg',
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
      photoName: 'complete-demo-lunch.jpg',
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
  const strengthDoneSets = fitnessSession.exercises
    .filter((exercise) => getExerciseKind(exercise) === 'strength')
    .reduce((total, exercise) => total + exercise.sets.filter((set) => set.done).length, 0)
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
  const reportNow = dateAtOffset(0, now)

  const reports: ReportRecord[] = [
    {
      id: 'report-week-current',
      type: '每周复盘',
      title: '完整演示：训练稳定，学习与补水节奏清晰',
      date: reportDate(reportNow),
      updatedAt: reportDateTime(reportNow, '16:45'),
      period: `${reportDate(dateAtOffset(-6, now))} — ${reportDate(reportNow)}`,
      summary: `完整演示数据覆盖 ${studyRecords.length} 条学习记录、4 个餐次、${doneSets} 个已完成训练组和 7 天目标。力量、跳绳与骑行记录可以同步进入今日页和报告页。`,
      status: '跨模块可验证',
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
      conclusions: [
        '训练会话同时包含力量、跳绳和骑行，可以验证容量、时长与距离的跨页面汇总。',
        '学习记录覆盖英语与高数、今天与过去 6 天，可以验证新增、编辑、筛选和报告引用。',
        '四个餐次、餐照附件和多个饮水事件均已准备，可以直接验证营养与饮水联动。',
      ],
      actions: [
        '把高数练习提前到晚饭前，避免与疲劳叠加。',
        '训练后 2 小时内完成含蛋白质的晚餐。',
        '晚间复盘只整理高数错题，不额外追加训练量。',
      ],
      evidence: [
        `训练记录：${formatTrainingSummary(fitnessSession.exercises)}`,
        `学习记录：共 ${studyRecords.length} 条，英语 ${englishRecords.length} 条、高数 ${mathRecords.length} 条，累计 ${totalStudyMinutes} 分钟`,
        `饮食记录：4 个有食物的餐次，共 ${foodEntryCount} 个食物条目，蛋白质 ${totalProtein} g`,
        `饮水记录：3 段新增事件，叠加晨间基线后 ${totalWaterLiters.toFixed(2)} L`,
        '个人档案：14 / 14 项已填写，含过敏、作息与压力信息',
      ],
    },
    {
      id: 'report-fitness-1024',
      type: '训练建议',
      title: '上肢训练进入中段，下一组优先保持动作质量',
      date: reportDate(dateAtOffset(-1, now)),
      updatedAt: reportDateTime(dateAtOffset(-1, now), '19:20'),
      period: '单次训练复盘',
      summary:
        '当前会话已完成卧推、上斜推举和三头动作的主要工作组，强度逐步上升。剩余动作应保持重量，不追加强度。',
      status: '强度可控',
      metric: [
        { label: '训练时长', value: '32 min', detail: '计划 45 min' },
        {
          label: '有效组数',
          value: `${strengthDoneSets} 组`,
          detail: `${fitnessSession.exercises.reduce((total, exercise) => total + exercise.sets.length, 0)} 组计划`,
        },
        {
          label: '训练容量',
          value: `${fitnessSummary.strengthVolume.toLocaleString('zh-CN')} kg`,
          detail: '来自已完成力量组',
        },
        { label: '最高 RPE', value: '8.0', detail: '剩余工作组尚未结束' },
      ],
      conclusions: [
        '已完成组的主要重量稳定，没有记录疼痛或动作失效。',
        '剩余组数量足够，不需要通过增加重量制造额外疲劳。',
        '训练后补水与蛋白质补充仍是当前最优先的恢复动作。',
      ],
      actions: [
        '下一组卧推保持 62.5 kg，不追加次数。',
        '训练后 2 小时内完成一餐含蛋白质的主食。',
        '剩余肩部动作控制在 RPE 8 左右。',
      ],
      evidence: [
        '杠铃平板卧推完成前 3 组，RPE 为 7.0、7.5、8.0',
        '上斜哑铃卧推完成 2 组，重量 22.5 kg',
        '当前训练会话仍在进行，未完成组已保留',
      ],
    },
    {
      id: 'report-study-1025',
      type: '学习观察',
      title: '英语与高数均有连续记录，晚间任务需要减量',
      date: reportDate(dateAtOffset(-2, now)),
      updatedAt: reportDateTime(dateAtOffset(-2, now), '21:10'),
      period: '近 7 天学习记录',
      summary: `过去 7 天已有 ${studyRecords.length} 条学习记录，英语与高数各 ${englishRecords.length} 条和 ${mathRecords.length} 条。记录结构足够验证分类、错题、听力和投入趋势。`,
      status: '节奏可优化',
      metric: [
        {
          label: '英语投入',
          value: `${englishRecords.reduce((total, record) => total + record.duration, 0)} min`,
          detail: '覆盖单词、听力与真题',
        },
        {
          label: '高数投入',
          value: `${mathRecords.reduce((total, record) => total + record.duration, 0)} min`,
          detail: '覆盖章节与错题',
        },
        {
          label: '有效记录',
          value: `${studyRecords.length} 条`,
          detail: `英语 ${englishRecords.length} / 高数 ${mathRecords.length}`,
        },
        { label: '记录天数', value: '7 天', detail: '含今日记录' },
      ],
      conclusions: [
        '英语记录包含新词、复习词、正确率与听力，字段覆盖完整。',
        '高数记录包含章节、题量与错题数，可以验证过滤和编辑流程。',
        '晚间学习应只保留一次轻量复盘，避免与训练恢复冲突。',
      ],
      actions: [
        '高数主练习安排在晚饭前，晚间只复盘错题。',
        '英语保持每日最小任务，不追加密集打卡。',
        '每条学习记录只保留一次完整结果。',
      ],
      evidence: [
        `近 7 天学习记录 ${studyRecords.length} 条，覆盖 7 个日期`,
        `英语 ${englishRecords.length} 条，高数 ${mathRecords.length} 条`,
        `累计学习 ${totalStudyMinutes} 分钟`,
      ],
    },
    {
      id: 'report-diet-1022',
      type: '饮食观察',
      title: '餐次记录完整，晚餐蛋白质与饮水节奏可继续核对',
      date: reportDate(dateAtOffset(-3, now)),
      updatedAt: reportDateTime(dateAtOffset(-3, now), '20:40'),
      period: '今日饮食记录',
      summary:
        '早餐、午餐、晚餐和加餐都已记录，其中两餐附有照片。当前数据可以验证热量、宏量营养、餐次编辑和饮水补录。',
      status: '结构可验证',
      metric: [
        {
          label: '总热量',
          value: `${totalCalories.toLocaleString('zh-CN')} kcal`,
          detail: '来自 4 个餐次',
        },
        { label: '蛋白质', value: `${totalProtein} g`, detail: '早餐、午餐与晚餐均有覆盖' },
        { label: '食物条目', value: `${foodEntryCount} 个`, detail: '每餐均至少 2 项' },
        { label: '饮水', value: `${totalWaterLiters.toFixed(2)} L`, detail: '已达到 2.0 L 目标' },
      ],
      conclusions: [
        '四个餐次均有食物，可以直接验证编辑、删除和 AI 热量登记流程。',
        '照片附件只作为本地元数据展示，不参与营养计算。',
        '饮水已达到目标，仍可通过快捷按钮验证新增、撤销和自定义补录。',
      ],
      actions: [
        '晚餐优先补齐蛋白质和蔬菜。',
        '训练前 30 分钟补充 250 ml 水。',
        '保持当前餐次结构，不额外追加热量。',
      ],
      evidence: [
        '早餐、午餐、晚餐和加餐均已记录食物',
        `食物条目共 ${foodEntryCount} 个，2 个餐次含照片附件`,
        `总热量 ${totalCalories.toLocaleString('zh-CN')} kcal，蛋白质 ${totalProtein} g`,
        `饮水 ${totalWaterLiters.toFixed(2)} L，含 3 段新增饮水事件`,
      ],
    },
  ]

  return {
    goals,
    planItems,
    waterLog,
    studyRecords,
    meals,
    fitnessSession,
    profile,
    settings,
    aiConsent: true,
    eveningReview,
    reports,
  }
}
