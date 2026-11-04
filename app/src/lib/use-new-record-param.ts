import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

export interface NewRecordParam {
  /** 地址栏当前是否带 `?new=1`（快速记录入口的深链标记）。 */
  active: boolean
  /** 从地址栏去掉 `new` 参数（replace 方式，不产生新的历史记录）。 */
  clear: () => void
}

/**
 * 「?new=1」深链的唯一来源：页面用 `active` 派生出是否展开记录表单，
 * 关闭表单时调用 `clear()` 把参数从地址栏移除。
 *
 * 这样地址栏就是真相，不需要在 effect 里 setState（避免级联渲染，
 * 也符合 React 官方「从 URL 派生状态」的建议）。
 */
export function useNewRecordParam(): NewRecordParam {
  const [searchParams, setSearchParams] = useSearchParams()
  const active = searchParams.get('new') === '1'
  const clear = useCallback(() => {
    if (searchParams.get('new') === null) return
    const next = new URLSearchParams(searchParams)
    next.delete('new')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])
  return { active, clear }
}
