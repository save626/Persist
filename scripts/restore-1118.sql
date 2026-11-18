-- 从 03:00 干净快照复活被误删的 9 条实体
-- 墓碑只清空了 payload_json，业务列（date/category/milliliters 等）都还在
ATTACH '/var/lib/persist/backups/persist-20261118-030032-scheduled.sqlite' AS bk;

BEGIN IMMEDIATE;

-- 1) 学习 2 条：原样取回 payload 与 updated_at
UPDATE study_records SET
  payload_json = (SELECT b.payload_json FROM bk.study_records b WHERE b.id = 'study-1794885635306'),
  updated_at   = (SELECT b.updated_at   FROM bk.study_records b WHERE b.id = 'study-1794885635306'),
  deleted_at = NULL, rev = 86
WHERE id = 'study-1794885635306';

UPDATE study_records SET
  payload_json = (SELECT b.payload_json FROM bk.study_records b WHERE b.id = 'study-1794885618826'),
  updated_at   = (SELECT b.updated_at   FROM bk.study_records b WHERE b.id = 'study-1794885618826'),
  deleted_at = NULL, rev = 87
WHERE id = 'study-1794885618826';

-- 2) 饮水 11-17 两条：原样取回
UPDATE water_logs SET
  payload_json = (SELECT b.payload_json FROM bk.water_logs b WHERE b.id = 'water-1794885385564'),
  updated_at   = (SELECT b.updated_at   FROM bk.water_logs b WHERE b.id = 'water-1794885385564'),
  deleted_at = NULL, rev = 88
WHERE id = 'water-1794885385564';

UPDATE water_logs SET
  payload_json = (SELECT b.payload_json FROM bk.water_logs b WHERE b.id = 'water-1794886499603'),
  updated_at   = (SELECT b.updated_at   FROM bk.water_logs b WHERE b.id = 'water-1794886499603'),
  deleted_at = NULL, rev = 89
WHERE id = 'water-1794886499603';

-- 3) 饮水 11-18 两条：03:00 快照里还没有，但列里保留了 250ml 与日期，按 id 内嵌时间戳重建
--    1794969842076 / 1794969843289 → 2026-11-18 10:44
UPDATE water_logs SET
  payload_json = '{"id":"water-1794969842076","milliliters":250,"time":"10:44","date":"2026-11-18"}',
  updated_at = 1794969842076,
  deleted_at = NULL, rev = 90
WHERE id = 'water-1794969842076';

UPDATE water_logs SET
  payload_json = '{"id":"water-1794969843289","milliliters":250,"time":"10:44","date":"2026-11-18"}',
  updated_at = 1794969843289,
  deleted_at = NULL, rev = 91
WHERE id = 'water-1794969843289';

-- 4) 计划
UPDATE plan_items SET
  payload_json = (SELECT b.payload_json FROM bk.plan_items b WHERE b.id = 'brief-hydration-check'),
  updated_at   = (SELECT b.updated_at   FROM bk.plan_items b WHERE b.id = 'brief-hydration-check'),
  deleted_at = NULL, rev = 92
WHERE id = 'brief-hydration-check';

-- 5) 饮食
UPDATE diet_entries SET
  payload_json = (SELECT b.payload_json FROM bk.diet_entries b WHERE b.id = 'ai-1794885588719'),
  updated_at   = (SELECT b.updated_at   FROM bk.diet_entries b WHERE b.id = 'ai-1794885588719'),
  deleted_at = NULL, rev = 93
WHERE id = 'ai-1794885588719';

-- 6) 训练
UPDATE fitness_sessions SET
  payload_json = (SELECT b.payload_json FROM bk.fitness_sessions b WHERE b.id = 'workout-1794885557945'),
  updated_at   = (SELECT b.updated_at   FROM bk.fitness_sessions b WHERE b.id = 'workout-1794885557945'),
  deleted_at = NULL, rev = 94
WHERE id = 'workout-1794885557945';

-- 7) 序列推进到本次分配到的最大 rev，保证客户端 pull 能拿到
UPDATE sync_seq SET value = 94 WHERE id = 1;

COMMIT;
DETACH bk;
