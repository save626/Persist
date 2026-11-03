import type { Meal } from '../types'

export const INITIAL_MEALS: Meal[] = [
  {
    id: 'breakfast',
    label: '早餐',
    time: '08:35',
    entries: [
      {
        id: 'breakfast-oat',
        name: '燕麦酸奶碗',
        portion: '1 碗 · 280 g',
        calories: 260,
        protein: 12,
        carbs: 38,
        fat: 7,
      },
      {
        id: 'breakfast-egg',
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
    time: '12:25',
    entries: [
      {
        id: 'lunch-chicken',
        name: '香煎鸡胸藜麦碗',
        portion: '1 份 · 420 g',
        calories: 620,
        protein: 48,
        carbs: 66,
        fat: 17,
      },
    ],
  },
  {
    id: 'dinner',
    label: '晚餐',
    time: '18:30',
    entries: [],
  },
  {
    id: 'snack',
    label: '加餐',
    time: '15:40',
    entries: [
      {
        id: 'snack-yogurt',
        name: '香蕉与希腊酸奶',
        portion: '1 份 · 210 g',
        calories: 180,
        protein: 12,
        carbs: 27,
        fat: 3,
      },
    ],
  },
]
