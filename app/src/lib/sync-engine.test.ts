import { describe, expect, it, vi } from 'vitest'
import type { AccountDeleteResponse } from '@persist/shared/contract/account'
import { createCompleteMockData } from '../data/complete-mock-data'
import type { ImportableMockData } from '../types'
import type { BootstrapBody, PullEntity, PushBody, PushResult } from './sync-contract'
import { SyncRequestError, type SyncClient } from './sync-client'
import { SyncEngine, type SyncEngineDeps } from './sync-engine'
import { createEmptySyncMeta, type OutboxRecord, type SyncMetaRecord } from './sync-store'

const NOW = new Date(2026, 10, 5, 9, 0, 0)
const NOW_MS = NOW.getTime()

const ACCOUNT_DELETE_RESULT = {
  deleted: true,
  deletedAt: NOW_MS,
  counts: {
    profile: 0,
    settings: 0,
    planItems: 0,
    studyRecords: 0,
    fitnessSessions: 0,
    dietEntries: 0,
    waterLogs: 0,
    goals: 0,
    longTermPlans: 0,
    analysisReports: 0,
    jobRuns: 0,
    syncOps: 0,
    devices: 0,
    backupFiles: 0,
  },
} satisfies AccountDeleteResponse

function sampleData(): ImportableMockData {
  return createCompleteMockData(NOW)
}

async function tick() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

function createScheduler() {
  const timers = new Map<number, { handler: () => void; delay: number }>()
  let nextId = 1
  return {
    setTimer: (handler: () => void, delay: number) => {
      const id = nextId
      nextId += 1
      timers.set(id, { handler, delay })
      return id as unknown as ReturnType<typeof setTimeout>
    },
    clearTimer: (timer: ReturnType<typeof setTimeout>) => {
      timers.delete(Number(timer))
    },
    delays: () => [...timers.values()].map((timer) => timer.delay),
    run: async (delay?: number) => {
      const entries = [...timers.entries()].filter(
        ([, timer]) => delay === undefined || timer.delay === delay,
      )
      for (const [id, timer] of entries) {
        timers.delete(id)
        timer.handler()
      }
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    },
    pending: () => timers.size,
  }
}

function createStorage(initial: OutboxRecord[] = []) {
  let records = initial.map((record) => ({ ...record }))
  return {
    async loadOutbox() {
      return records.map((record) => ({ ...record }))
    },
    async saveOutbox(next: OutboxRecord[]) {
      for (const record of next) {
        const index = records.findIndex((existing) => existing.id === record.id)
        if (index >= 0) records[index] = { ...record }
        else records.push({ ...record })
      }
    },
    async removeOutbox(ids: string[]) {
      const remove = new Set(ids)
      records = records.filter((record) => !remove.has(record.id))
    },
    snapshot: () => records.map((record) => ({ ...record })),
  }
}

interface FakeClientState {
  pushError: Error | null
  deleteAccountError: Error | null
  pushResults: PushResult[]
  pullBatches: PullEntity[][]
  bootstrapResult: PushResult
}

function createFakeClient(state: FakeClientState) {
  const client = {
    register: vi.fn(async () => ({
      userId: 'u1',
      deviceId: 'd1',
      token: 'token-1',
      recoveryCode: 'a'.repeat(32),
    })),
    restore: vi.fn(async () => ({ userId: 'u1', deviceId: 'd2', token: 'token-2' })),
    revoke: vi.fn(async () => ({ revoked: true, deviceId: 'd1' })),
    deleteAccount: vi.fn(async (_token: string) => {
      if (state.deleteAccountError) throw state.deleteAccountError
      return ACCOUNT_DELETE_RESULT
    }),
    bootstrap: vi.fn(async (_token: string, _body: BootstrapBody) => state.bootstrapResult),
    push: vi.fn(async (_token: string, _body: PushBody): Promise<PushResult> => {
      if (state.pushError) throw state.pushError
      return state.pushResults.shift() ?? { applied: 0, skipped: [], serverRev: 0 }
    }),
    pull: vi.fn(async () => {
      const entities = state.pullBatches.shift() ?? []
      return { entities, nextSince: entities.at(-1)?.rev ?? 0, hasMore: false }
    }),
  }
  return client satisfies SyncClient
}

function createEngine(overrides: Partial<SyncEngineDeps> = {}) {
  let data = sampleData()
  const meta: SyncMetaRecord = createEmptySyncMeta()
  const storage = createStorage()
  const scheduler = createScheduler()
  const state: FakeClientState = {
    pushError: null,
    deleteAccountError: null,
    pushResults: [],
    pullBatches: [],
    bootstrapResult: { applied: 0, skipped: [], serverRev: 0 },
  }
  const client = createFakeClient(state)
  const statuses: Array<{ state: string; pending: number }> = []
  const applyData = vi.fn<(next: ImportableMockData) => void>((next) => {
    data = next
  })

  const engine = new SyncEngine({
    client,
    metaStorage: {
      loadMeta: async () => ({ ...meta }),
      saveMeta: async (next) => {
        Object.assign(meta, next)
      },
    },
    queueStorage: storage,
    getData: () => data,
    applyData,
    now: () => NOW_MS,
    random: () => 0,
    isOnline: () => true,
    onChange: (status) => statuses.push({ state: status.state, pending: status.pending }),
    setTimer: scheduler.setTimer,
    clearTimer: scheduler.clearTimer,
    ...overrides,
  })

  return {
    engine,
    client,
    state,
    storage,
    scheduler,
    statuses,
    applyData,
    meta,
    getData: () => data,
    setData: (next: ImportableMockData) => {
      data = next
    },
  }
}

describe('SyncEngine', () => {
  it('未开启时状态是「未开启」，不发任何请求', async () => {
    const { engine, client } = createEngine()
    const status = await engine.init()

    expect(status.enabled).toBe(false)
    expect(status.state).toBe('未开启')
    expect(status.pending).toBe(0)
    expect(client.register).not.toHaveBeenCalled()
    expect(client.pull).not.toHaveBeenCalled()
  })

  it('enable：注册 → bootstrap 全量上传 → pull，之后状态为已同步', async () => {
    const { engine, client, meta, getData } = createEngine()
    await engine.init()
    await engine.enable('桌面浏览器')

    expect(client.register).toHaveBeenCalledWith({ label: '桌面浏览器' })
    const bootstrapBody = client.bootstrap.mock.calls[0]?.[1]
    expect(bootstrapBody?.entities.length).toBeGreaterThan(0)
    expect(bootstrapBody?.entities.length).toBeLessThanOrEqual(2_000)
    expect(client.pull).toHaveBeenCalled()
    expect(meta.enabled).toBe(true)
    expect(meta.bootstrapDone).toBe(true)
    expect(meta.recoveryCode).toBe('a'.repeat(32))
    expect(Object.keys(meta.entityHashes).length).toBe(bootstrapBody?.entities.length)
    // 首次拉取发现没有远端数据，本地数据不被改动。
    expect(getData().goals).toHaveLength(sampleData().goals.length)

    const status = engine.status()
    expect(status.enabled).toBe(true)
    expect(status.state).toBe('已同步')
    expect(status.lastSyncAt).toBe('2026-11-05 09:00')
    expect(meta.lastSyncAt).not.toBeNull()
  })

  it('本地写入：差分 → outbox → push，成功后清账', async () => {
    const { engine, client, state, getData, setData } = createEngine()
    await engine.init()
    await engine.enable('桌面浏览器')
    client.push.mockClear()

    const changed: ImportableMockData = {
      ...getData(),
      goals: getData().goals.map((goal) =>
        goal.id === 'goal-1' ? { ...goal, title: '改过的目标' } : goal,
      ),
    }
    setData(changed)
    engine.noteDataChange()
    await tick()

    expect(engine.status().pending).toBe(1)
    expect(engine.status().state).toBe('待同步')
    expect(engine.outbox()).toHaveLength(1)

    state.pushResults.push({ applied: 1, skipped: [], serverRev: 4 })
    await engine.flush('test')

    expect(client.push).toHaveBeenCalledTimes(1)
    const body = client.push.mock.calls[0]?.[1]
    expect(body?.entities).toHaveLength(1)
    expect(body?.entities[0]?.id).toBe('goal-1')
    expect(body?.entities[0]?.deleted).toBe(false)
    expect(engine.status().pending).toBe(0)
    expect(engine.status().state).toBe('已同步')
    expect(state.pushResults).toHaveLength(0)
  })

  it('本地删除：发墓碑而不是悄悄消失', async () => {
    const { engine, client, state, getData, setData } = createEngine()
    await engine.init()
    await engine.enable('桌面浏览器')
    client.push.mockClear()

    setData({ ...getData(), waterLog: getData().waterLog.slice(1) })
    engine.noteDataChange()
    await tick()
    state.pushResults.push({ applied: 1, skipped: [], serverRev: 2 })
    await engine.flush('test')

    const body = client.push.mock.calls[0]?.[1]
    expect(body?.entities).toHaveLength(1)
    expect(body?.entities[0]).toMatchObject({ kind: 'water_log', deleted: true })
  })

  it('pull 回来的新数据会合并进本地（LWW），不会再生成本地变更', async () => {
    const { engine, client, state, applyData, getData } = createEngine()
    await engine.init()
    await engine.enable('桌面浏览器')
    client.push.mockClear()

    state.pullBatches.push([
      {
        kind: 'goal',
        id: 'goal-1',
        data: { ...sampleData().goals[0], title: '服务端标题' },
        updatedAt: NOW_MS + 10,
        deleted: false,
        rev: 9,
      },
    ])
    await engine.flush('test')

    expect(applyData).toHaveBeenCalled()
    expect(getData().goals.find((goal) => goal.id === 'goal-1')?.title).toBe('服务端标题')

    // merge 后基线已更新：再跑一次差分不会把服务端数据当成本地新写入。
    engine.noteDataChange()
    await tick()
    expect(engine.status().pending).toBe(0)
    expect(client.push).not.toHaveBeenCalled()
  })

  it('令牌失效：needsAttention，保留 outbox，不自动清本地数据', async () => {
    const { engine, client, state, getData, setData } = createEngine()
    await engine.init()
    await engine.enable('桌面浏览器')

    setData({ ...getData(), waterLog: getData().waterLog.slice(1) })
    engine.noteDataChange()
    await tick()
    state.pushError = new SyncRequestError('unauthorized', '缺少或无效的设备令牌。')

    await engine.flush('test')

    const status = engine.status()
    expect(status.needsAttention).toBe(true)
    expect(status.error).toBe('设备令牌已失效，请用恢复码重新绑定本机。')
    expect(engine.status().pending).toBe(1)
    expect(getData().waterLog.length).toBeGreaterThan(0)
    expect(client.push).toHaveBeenCalled()
  })

  it('网络失败按指数退避重试，成功后清空错误', async () => {
    const { engine, state, scheduler, getData, setData } = createEngine()
    await engine.init()
    await engine.enable('桌面浏览器')

    setData({ ...getData(), waterLog: getData().waterLog.slice(1) })
    engine.noteDataChange()
    await tick()
    state.pushError = new SyncRequestError('network', '网络不可用，暂时连不上同步服务。')

    await engine.flush('test')
    expect(engine.status().pending).toBe(1)
    expect(engine.status().error).toContain('网络不可用')
    expect(scheduler.delays()).toContain(5_000)

    state.pushError = null
    state.pushResults.push({ applied: 1, skipped: [], serverRev: 1 })
    await engine.flush('test')

    expect(engine.status().pending).toBe(0)
    expect(engine.status().error).toBeNull()
  })

  it('离线时只显示「离线」，不发请求', async () => {
    let online = false
    const { engine, client } = createEngine({ isOnline: () => online })
    await engine.init()
    await engine.enable('桌面浏览器')
    client.pull.mockClear()
    client.register.mockClear()

    await engine.flush('test')
    expect(engine.status().state).toBe('离线')
    expect(client.pull).not.toHaveBeenCalled()

    online = true
    await engine.flush('test')
    expect(engine.status().state).toBe('已同步')
  })

  it('disable 之后不再发请求，本地数据与凭据保留', async () => {
    const { engine, client, meta } = createEngine()
    await engine.init()
    await engine.enable('桌面浏览器')
    await engine.disable()

    client.push.mockClear()
    client.pull.mockClear()
    await engine.flush('test')

    expect(engine.status().enabled).toBe(false)
    expect(client.push).not.toHaveBeenCalled()
    expect(client.pull).not.toHaveBeenCalled()
    expect(meta.token).toBe('token-1')
  })

  it('重新打开同步会补发关闭期间的本地写入', async () => {
    const { engine, client, state, getData, setData } = createEngine()
    await engine.init()
    await engine.enable('桌面浏览器')
    await engine.disable()
    client.register.mockClear()
    client.push.mockClear()

    setData({ ...getData(), waterLog: getData().waterLog.slice(1) })
    engine.noteDataChange()
    await tick()
    // 关闭期间不进 outbox，也不发请求。
    expect(engine.status().pending).toBe(0)

    state.pushResults.push({ applied: 1, skipped: [], serverRev: 5 })
    await engine.enable('桌面浏览器')

    expect(client.register).not.toHaveBeenCalled()
    expect(client.push).toHaveBeenCalledTimes(1)
    expect(client.push.mock.calls[0]?.[1].entities[0]).toMatchObject({
      kind: 'water_log',
      deleted: true,
    })
    expect(engine.status().pending).toBe(0)
  })

  it('restore：恢复码换设备，不注册新账号，直接从 rev 0 拉服务端数据', async () => {
    const { engine, client, state, getData } = createEngine()
    await engine.init()
    state.pullBatches.push([
      {
        kind: 'settings',
        id: null,
        data: { ...sampleData().settings, summaryOnly: true },
        updatedAt: NOW_MS + 5,
        deleted: false,
        rev: 3,
      },
    ])

    await engine.restore('b'.repeat(32), '新手机')

    expect(client.register).not.toHaveBeenCalled()
    expect(client.restore).toHaveBeenCalledWith({ recoveryCode: 'b'.repeat(32), label: '新手机' })
    expect(getData().settings.summaryOnly).toBe(true)
    expect(engine.getMeta().bootstrapDone).toBe(true)
    expect(engine.getMeta().deviceId).toBe('d2')
  })

  it('restore 会丢弃上一账号没发完的变更', async () => {
    const { engine, client, storage, getData, setData } = createEngine()
    await engine.init()
    await engine.enable('桌面浏览器')

    setData({ ...getData(), waterLog: getData().waterLog.slice(1) })
    engine.noteDataChange()
    await tick()
    expect(engine.outbox()).toHaveLength(1)
    client.push.mockClear()

    await engine.restore('c'.repeat(32), '备用机')

    expect(storage.snapshot()).toHaveLength(0)
    expect(client.push).not.toHaveBeenCalled()
  })

  it('revoke：吊销令牌后回到未开启状态', async () => {
    const { engine, client, meta } = createEngine()
    await engine.init()
    await engine.enable('桌面浏览器')
    await engine.revokeDevice()

    expect(client.revoke).toHaveBeenCalledWith('token-1', {})
    expect(meta.enabled).toBe(false)
    expect(meta.token).toBeNull()
    expect(engine.status().state).toBe('未开启')
  })

  it('deleteAccount：服务端成功后清空同步凭据与 outbox，但不改业务数据', async () => {
    const { engine, client, meta, storage, getData, setData } = createEngine()
    await engine.init()
    await engine.enable('桌面浏览器')

    const beforeDelete = {
      ...getData(),
      goals: getData().goals.map((goal) =>
        goal.id === 'goal-1' ? { ...goal, title: '待删除前最后一条变更' } : goal,
      ),
    }
    setData(beforeDelete)
    engine.noteDataChange()
    await tick()
    expect(engine.outbox().length).toBeGreaterThan(0)

    const result = await engine.deleteAccount()

    expect(client.deleteAccount).toHaveBeenCalledWith('token-1')
    expect(result.deleted).toBe(true)
    expect(storage.snapshot()).toHaveLength(0)
    expect(meta.token).toBeNull()
    expect(meta.recoveryCode).toBeNull()
    expect(engine.status().state).toBe('未开启')
    expect(getData().goals[0]?.title).toBe('待删除前最后一条变更')
  })

  it('deleteAccount：服务端失败时保留同步凭据与 outbox，允许重试', async () => {
    const { engine, state, meta, storage, getData, setData } = createEngine()
    await engine.init()
    await engine.enable('桌面浏览器')
    setData({ ...getData(), waterLog: getData().waterLog.slice(1) })
    engine.noteDataChange()
    await tick()
    const pendingBefore = engine.outbox().length
    state.deleteAccountError = new SyncRequestError('server', '服务端暂时不可用')

    await expect(engine.deleteAccount()).rejects.toThrow('服务端暂时不可用')

    expect(meta.token).toBe('token-1')
    expect(engine.outbox()).toHaveLength(pendingBefore)
    expect(storage.snapshot()).toHaveLength(pendingBefore)
    expect(engine.status().enabled).toBe(true)
  })

  it('noteDataChange 会安排 5 秒防抖推送', async () => {
    const { engine, scheduler, getData, setData } = createEngine()
    await engine.init()
    await engine.enable('桌面浏览器')

    setData({ ...getData(), waterLog: getData().waterLog.slice(1) })
    engine.noteDataChange()
    await tick()
    expect(scheduler.delays()).toContain(5_000)
  })
})
