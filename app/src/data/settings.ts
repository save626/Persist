import type { MockSettings } from '../types'

export const INITIAL_SETTINGS: MockSettings = {
  reminders: [
    {
      id: 'water',
      title: '饮水提醒',
      detail: '训练日每 2 小时提醒一次，晚间不打扰。',
      time: '09:00',
      enabled: true,
      icon: 'water',
    },
    {
      id: 'training',
      title: '训练提醒',
      detail: '在计划训练开始前 30 分钟提醒。',
      time: '18:00',
      enabled: true,
      icon: 'fitness',
    },
    {
      id: 'review',
      title: '晚间复盘提醒',
      detail: '提醒补充精力、状态和今日备注。',
      time: '21:45',
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
  /** 每日简报默认关闭；开启后由服务端每天在 21:00 聚合最近 7 天并归档。 */
  dailyBrief: {
    enabled: false,
    at: '21:00',
  },
}
