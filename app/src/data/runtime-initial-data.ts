import type { RuntimeMode } from '../lib/runtime-mode'
import type { ImportableMockData } from '../types'
import { createCompleteDemoData } from './complete-mock-data'
import { createEmptyMockData } from './empty-mock-data'

/**
 * owner 的空白起点：不注入任何目标、计划、训练、饮食、学习、档案或报告。
 * 保留完整模式此前确认的设置偏好与真实 AI 能力，用户第一次记录时再产生业务数据。
 */
function createOwnerInitialData(): ImportableMockData {
  const empty = createEmptyMockData()
  return {
    ...empty,
    profile: { ...empty.profile, aiConsent: true },
    aiConsent: true,
  }
}

/**
 * 三种入口的首次启动与「清空本机数据」统一基线。
 * demo 使用完整预置数据；owner / guest 均从没有业务占位的空白状态开始。
 */
export function createInitialDataForRuntimeMode(
  mode: RuntimeMode,
  now: Date = new Date(),
): ImportableMockData {
  if (mode === 'demo') return createCompleteDemoData(now)
  if (mode === 'owner') return createOwnerInitialData()
  return createEmptyMockData()
}
