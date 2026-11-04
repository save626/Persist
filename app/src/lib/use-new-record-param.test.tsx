import { act, renderHook } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { useNewRecordParam } from './use-new-record-param'

function renderAt(path: string) {
  return renderHook(
    () => ({ param: useNewRecordParam(), location: useLocation() }),
    {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(MemoryRouter, { initialEntries: [path] }, children),
    },
  )
}

describe('useNewRecordParam', () => {
  it('地址栏带 ?new=1 时 active 为 true', () => {
    const { result } = renderAt('/study?new=1')

    expect(result.current.param.active).toBe(true)
    expect(result.current.location.search).toBe('?new=1')
  })

  it('clear() 去掉 new 参数，其它参数保留', () => {
    const { result } = renderAt('/study?new=1&from=quick')

    act(() => result.current.param.clear())

    expect(result.current.param.active).toBe(false)
    expect(result.current.location.search).toBe('?from=quick')
  })

  it('没有 new 参数时 clear() 不改地址栏', () => {
    const { result } = renderAt('/study')

    act(() => result.current.param.clear())

    expect(result.current.param.active).toBe(false)
    expect(result.current.location.search).toBe('')
  })

  it('new 取其它值不算命中，但 clear() 仍会移除该参数', () => {
    const { result } = renderAt('/study?new=2')

    expect(result.current.param.active).toBe(false)

    act(() => result.current.param.clear())

    expect(result.current.location.search).toBe('')
  })
})
