import type { StudyRecord } from '../types'

function todayInputValue(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function offsetDate(offset: number) {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return todayInputValue(date)
}

export const INITIAL_STUDY_RECORDS: StudyRecord[] = [
  {
    id: 'study-english-today',
    category: 'english',
    source: '百词斩',
    date: todayInputValue(),
    startTime: '09:10',
    duration: 35,
    note: '六级核心词第二组，复习时重点看了熟词僻义。',
    newWords: 20,
    reviewWords: 35,
    accuracy: 86,
    listening: 15,
  },
  {
    id: 'study-math-today',
    category: 'math',
    source: '高数练习',
    date: todayInputValue(),
    startTime: '20:30',
    duration: 20,
    note: '极限与连续课后题，错题留到晚复盘统一整理。',
    chapter: '极限与连续',
    questions: 12,
    wrong: 3,
  },
  {
    id: 'study-english-yesterday',
    category: 'english',
    source: '不背单词',
    date: offsetDate(-1),
    startTime: '08:45',
    duration: 42,
    note: '完成复习任务，听力只做了一组精听。',
    newWords: 15,
    reviewWords: 48,
    accuracy: 82,
    listening: 12,
  },
  {
    id: 'study-math-yesterday',
    category: 'math',
    source: '高数练习',
    date: offsetDate(-1),
    startTime: '20:10',
    duration: 38,
    note: '导数基础题，计算错误比概念错误多。',
    chapter: '导数与微分',
    questions: 18,
    wrong: 4,
  },
  {
    id: 'study-english-older',
    category: 'english',
    source: '百词斩',
    date: offsetDate(-2),
    startTime: '09:30',
    duration: 31,
    note: '只记录投入，不补造外部 App 的精确数据。',
    newWords: 24,
    reviewWords: 31,
    accuracy: 89,
    listening: 0,
  },
]
