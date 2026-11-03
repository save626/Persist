import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { EvidenceSheet } from '../components/EvidenceSheet'
import { Icon } from '../components/Icon'
import { useMockData } from '../context/mock-data-context'
import { useUI } from '../context/ui-context'
import type { FoodEntry, Meal, MealId } from '../types'

interface ParsedNutrition {
  name: string
  calories: string
  protein: string
  carbs: string
  fat: string
}

const MEAL_LABELS: Record<MealId, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐',
}

const TARGETS = {
  calories: 2_100,
  protein: 140,
  carbs: 245,
  fat: 65,
  waterLiters: 2,
}

const WATER_TREND = [1.4, 1.8, 1.6, 2.2, 1.7, 1.9, 1.2]

function todayLabel() {
  const date = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
    .format(new Date())
    .replace(/\s/g, '')
  const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'long' }).format(new Date())
  return `${date} · ${weekday}`
}

function numberFromText(text: string, labels: string[]) {
  for (const label of labels) {
    const match = text.match(new RegExp(`${label}\\s*[:：]?\\s*(\\d+(?:\\.\\d+)?)`, 'i'))
    if (match) return match[1]
  }
  return ''
}

function parseNutritionText(text: string): ParsedNutrition {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const descriptor = /热量|蛋白质|碳水|脂肪|kcal|大卡/i
  const nameLine = lines.find((line) => !descriptor.test(line)) ?? ''
  const name = nameLine.replace(/^(食物|名称|餐名)\s*[:：]\s*/, '').slice(0, 36)
  const calories =
    numberFromText(text, ['热量', '能量', '总热量']) ||
    text.match(/(\d+(?:\.\d+)?)\s*(?:kcal|大卡)/i)?.[1] ||
    ''

  return {
    name,
    calories,
    protein: numberFromText(text, ['蛋白质', '蛋白']),
    carbs: numberFromText(text, ['碳水化合物', '碳水']),
    fat: numberFromText(text, ['脂肪']),
  }
}
function MealEditor({
  meal,
  onClose,
  onAdd,
  onRemove,
  onPhotoChange,
}: {
  meal: Meal
  onClose: () => void
  onAdd: (entry: FoodEntry) => void
  onRemove: (entryId: string) => void
  onPhotoChange: (photoName: string) => void
}) {
  const [name, setName] = useState('')
  const [portion, setPortion] = useState('1 份')
  const [calories, setCalories] = useState('')
  const [protein, setProtein] = useState('')
  const [carbs, setCarbs] = useState('')
  const [fat, setFat] = useState('')

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const totals = meal.entries.reduce(
    (total, entry) => ({
      calories: total.calories + entry.calories,
      protein: total.protein + entry.protein,
    }),
    { calories: 0, protein: 0 },
  )

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const parsedCalories = Number(calories)
    if (!name.trim() || parsedCalories <= 0) return
    onAdd({
      id: `${meal.id}-${Date.now()}`,
      name: name.trim(),
      portion: portion.trim() || '1 份',
      calories: parsedCalories,
      protein: Number(protein) || 0,
      carbs: Number(carbs) || 0,
      fat: Number(fat) || 0,
    })
    setName('')
    setPortion('1 份')
    setCalories('')
    setProtein('')
    setCarbs('')
    setFat('')
  }

  const handlePhoto = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) onPhotoChange(file.name)
  }

  return (
    <div
      className="backdrop open"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="sheet diet-meal-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mealEditorTitle"
      >
        <div className="handle" />
        <div className="sheet-head">
          <div>
            <h2 id="mealEditorTitle">编辑{meal.label}</h2>
            <p className="diet-sheet-sub">逐项登记食物，热量与营养数据以你的核对结果为准。</p>
          </div>
          <button className="icon-btn" type="button" aria-label="关闭餐次编辑" onClick={onClose}>
            <Icon name="close" className="icon-sm" />
          </button>
        </div>

        <div className="diet-photo-row">
          <label className="diet-photo-pick" htmlFor={`meal-photo-${meal.id}`}>
            <span className="diet-photo-icon">
              <Icon name="camera" className="icon-sm" />
            </span>
            <span>
              <strong>{meal.photoName ? '已添加餐次照片' : '拍照或选择照片'}</strong>
              <small>{meal.photoName ?? '作为附件保存，本版不自动识别'}</small>
            </span>
          </label>
          <input
            className="diet-file-input"
            id={`meal-photo-${meal.id}`}
            type="file"
            accept="image/*"
            capture="environment"
            aria-label="拍照或选择餐次照片"
            onChange={handlePhoto}
          />
        </div>

        {meal.entries.length > 0 ? (
          <div className="diet-editor-list" aria-label={`${meal.label}已记录食物`}>
            {meal.entries.map((entry) => (
              <div className="diet-editor-entry" key={entry.id}>
                <span className="diet-entry-dot" />
                <span className="diet-editor-copy">
                  <strong>{entry.name}</strong>
                  <small>
                    {entry.portion} · 蛋白质 {entry.protein} g
                  </small>
                </span>
                <span className="diet-editor-kcal">{entry.calories} kcal</span>
                <button
                  className="diet-remove-entry"
                  type="button"
                  aria-label={`删除${entry.name}`}
                  onClick={() => onRemove(entry.id)}
                >
                  <Icon name="close" className="icon-sm" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="diet-editor-empty">
            <Icon name="food" />
            <span>这餐还没有记录，先从一项食物开始。</span>
          </div>
        )}

        <form className="diet-food-form" onSubmit={handleSubmit}>
          <div className="diet-food-grid">
            <label className="form-field diet-food-name">
              <span>食物名称</span>
              <input
                className="form-input"
                required
                placeholder="例如：鸡胸肉藜麦碗"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="form-field">
              <span>份量</span>
              <input
                className="form-input"
                placeholder="1 份 · 420 g"
                value={portion}
                onChange={(event) => setPortion(event.target.value)}
              />
            </label>
            <label className="form-field">
              <span>热量 / kcal</span>
              <input
                className="form-input"
                type="number"
                min="1"
                inputMode="numeric"
                required
                placeholder="620"
                value={calories}
                onChange={(event) => setCalories(event.target.value)}
              />
            </label>
            <label className="form-field">
              <span>蛋白质 / g</span>
              <input
                className="form-input"
                type="number"
                min="0"
                step="0.1"
                inputMode="decimal"
                placeholder="48"
                value={protein}
                onChange={(event) => setProtein(event.target.value)}
              />
            </label>
            <label className="form-field">
              <span>碳水 / g</span>
              <input
                className="form-input"
                type="number"
                min="0"
                step="0.1"
                inputMode="decimal"
                placeholder="66"
                value={carbs}
                onChange={(event) => setCarbs(event.target.value)}
              />
            </label>
            <label className="form-field">
              <span>脂肪 / g</span>
              <input
                className="form-input"
                type="number"
                min="0"
                step="0.1"
                inputMode="decimal"
                placeholder="17"
                value={fat}
                onChange={(event) => setFat(event.target.value)}
              />
            </label>
          </div>
          <div className="diet-editor-foot">
            <span>
              当前 {totals.calories} kcal · 蛋白质 {totals.protein} g
            </span>
            <button className="btn primary" type="submit">
              <Icon name="plus" className="icon-sm" />
              添加到{meal.label}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
const EMPTY_NUTRITION: ParsedNutrition = {
  name: '',
  calories: '',
  protein: '',
  carbs: '',
  fat: '',
}

function AiNutritionSheet({
  meals,
  onClose,
  onRegister,
}: {
  meals: Meal[]
  onClose: () => void
  onRegister: (mealId: MealId, entry: FoodEntry) => void
}) {
  const [sourceText, setSourceText] = useState('')
  const [mealId, setMealId] = useState<MealId>('dinner')
  const [draft, setDraft] = useState<ParsedNutrition>(EMPTY_NUTRITION)
  const [parsed, setParsed] = useState(false)
  const [parseError, setParseError] = useState('')

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const updateDraft = (field: keyof ParsedNutrition, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  const handleParse = () => {
    const parsedDraft = parseNutritionText(sourceText)
    if (!parsedDraft.calories) {
      setParsed(false)
      setParseError('没有识别到热量。请保留“热量 620 kcal”这样的字段后再试。')
      return
    }
    setDraft({ ...parsedDraft, name: parsedDraft.name || 'AI 识别食物' })
    setParsed(true)
    setParseError('')
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const calories = Number(draft.calories)
    if (!draft.name.trim() || calories <= 0) {
      setParseError('食物名称和热量不能为空。')
      return
    }
    onRegister(mealId, {
      id: `ai-${Date.now()}`,
      name: draft.name.trim(),
      portion: '1 份 · AI 识别结果',
      calories,
      protein: Number(draft.protein) || 0,
      carbs: Number(draft.carbs) || 0,
      fat: Number(draft.fat) || 0,
    })
    onClose()
  }

  return (
    <div
      className="backdrop open"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <form
        className="sheet diet-ai-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="aiNutritionTitle"
        onSubmit={handleSubmit}
      >
        <div className="handle" />
        <div className="sheet-head">
          <div>
            <h2 id="aiNutritionTitle">AI 热量登记</h2>
            <p className="diet-sheet-sub">
              粘贴外部 AI 的识别结果，解析后由你核对，再写入对应餐次。
            </p>
          </div>
          <button
            className="icon-btn"
            type="button"
            aria-label="关闭 AI 热量登记"
            onClick={onClose}
          >
            <Icon name="close" className="icon-sm" />
          </button>
        </div>

        <label className="form-field diet-ai-source">
          <span>AI 识别结果</span>
          <textarea
            className="form-input"
            rows={5}
            placeholder={'鸡胸肉藜麦碗\n热量 620 kcal，蛋白质 48 g，碳水 66 g，脂肪 17 g'}
            value={sourceText}
            onChange={(event) => setSourceText(event.target.value)}
          />
        </label>

        <div className="diet-parse-row">
          <button className="btn secondary" type="button" onClick={handleParse}>
            <Icon name="spark" className="icon-sm" />
            解析营养信息
          </button>
          <span className={parsed ? 'diet-parse-state parsed' : 'diet-parse-state'}>
            <span className="dot" />
            {parsed ? '已解析，请核对' : '等待粘贴文本'}
          </span>
        </div>

        {parseError && (
          <p className="diet-form-error" role="alert">
            {parseError}
          </p>
        )}

        <div className="diet-ai-divider">
          <span>核对后登记</span>
        </div>

        <div className="diet-food-grid diet-ai-grid">
          <label className="form-field">
            <span>登记到餐次</span>
            <select
              className="form-input"
              value={mealId}
              onChange={(event) => setMealId(event.target.value as MealId)}
            >
              {meals.map((meal) => (
                <option key={meal.id} value={meal.id}>
                  {meal.label}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field diet-food-name">
            <span>食物名称</span>
            <input
              className="form-input"
              required
              value={draft.name}
              onChange={(event) => updateDraft('name', event.target.value)}
            />
          </label>
          <label className="form-field">
            <span>热量 / kcal</span>
            <input
              className="form-input"
              type="number"
              min="1"
              inputMode="numeric"
              required
              value={draft.calories}
              onChange={(event) => updateDraft('calories', event.target.value)}
            />
          </label>
          <label className="form-field">
            <span>蛋白质 / g</span>
            <input
              className="form-input"
              type="number"
              min="0"
              step="0.1"
              inputMode="decimal"
              value={draft.protein}
              onChange={(event) => updateDraft('protein', event.target.value)}
            />
          </label>
          <label className="form-field">
            <span>碳水 / g</span>
            <input
              className="form-input"
              type="number"
              min="0"
              step="0.1"
              inputMode="decimal"
              value={draft.carbs}
              onChange={(event) => updateDraft('carbs', event.target.value)}
            />
          </label>
          <label className="form-field">
            <span>脂肪 / g</span>
            <input
              className="form-input"
              type="number"
              min="0"
              step="0.1"
              inputMode="decimal"
              value={draft.fat}
              onChange={(event) => updateDraft('fat', event.target.value)}
            />
          </label>
        </div>

        <div className="form-actions diet-ai-actions">
          <button className="btn secondary" type="button" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" type="submit">
            <Icon name="check" className="icon-sm" />
            确认登记
          </button>
        </div>
      </form>
    </div>
  )
}
export function DietPage() {
  const { meals, setMeals, waterLiters, addWater, lastWaterMilliliters, undoWater } = useMockData()
  const { showToast } = useUI()
  const [searchParams, setSearchParams] = useSearchParams()
  const [editingMealId, setEditingMealId] = useState<MealId | null>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [customWater, setCustomWater] = useState('')

  useEffect(() => {
    if (searchParams.get('new') !== '1') return
    setAiOpen(true)
    const next = new URLSearchParams(searchParams)
    next.delete('new')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  const totals = useMemo(
    () =>
      meals.reduce(
        (day, meal) =>
          meal.entries.reduce(
            (mealTotal, entry) => ({
              calories: mealTotal.calories + entry.calories,
              protein: mealTotal.protein + entry.protein,
              carbs: mealTotal.carbs + entry.carbs,
              fat: mealTotal.fat + entry.fat,
            }),
            day,
          ),
        { calories: 0, protein: 0, carbs: 0, fat: 0 },
      ),
    [meals],
  )

  const mealCount = meals.filter((meal) => meal.entries.length > 0).length
  const editingMeal = meals.find((meal) => meal.id === editingMealId) ?? null
  const nextMeal = meals.find((meal) => meal.entries.length === 0) ?? meals[0]
  const waterMilliliters = Math.round(waterLiters * 1000)
  const waterProgress = Math.min(100, (waterLiters / TARGETS.waterLiters) * 100)
  const waterDisplayLiters = (Math.round(waterMilliliters / 10) / 100).toFixed(2)
  const macroCalories = totals.protein * 4 + totals.carbs * 4 + totals.fat * 9
  const proteinShare = macroCalories ? (totals.protein * 4 * 100) / macroCalories : 0
  const carbsShare = macroCalories ? (totals.carbs * 4 * 100) / macroCalories : 0
  const fatShare = macroCalories ? (totals.fat * 9 * 100) / macroCalories : 0
  const remainingCalories = Math.max(0, TARGETS.calories - totals.calories)
  const remainingProtein = Math.max(0, TARGETS.protein - totals.protein)
  const chartValues = [...WATER_TREND.slice(0, -1), waterLiters]
  const chartMax = Math.max(...chartValues, TARGETS.waterLiters)
  const foodEntryCount = meals.reduce((total, meal) => total + meal.entries.length, 0)
  const photoAttachmentCount = meals.filter((meal) => meal.photoName).length

  const recordWater = (milliliters: number) => {
    addWater(milliliters)
    showToast(`已记录 ${milliliters} ml 饮水`)
  }

  const handleUndoWater = () => {
    if (lastWaterMilliliters === null) return
    undoWater()
    showToast(`已撤销 ${lastWaterMilliliters} ml 饮水`)
  }

  const handleCustomWater = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const milliliters = Number(customWater)
    if (!Number.isFinite(milliliters) || milliliters <= 0 || milliliters > 3_000) {
      showToast('请输入 1–3000 ml 之间的饮水量')
      return
    }
    recordWater(Math.round(milliliters))
    setCustomWater('')
  }

  const addFood = (mealId: MealId, entry: FoodEntry) => {
    setMeals((current) =>
      current.map((meal) =>
        meal.id === mealId ? { ...meal, entries: [...meal.entries, entry] } : meal,
      ),
    )
    showToast(`已将 ${entry.name} 添加到${MEAL_LABELS[mealId]}`)
  }

  const removeFood = (mealId: MealId, entryId: string) => {
    const removed = meals
      .find((meal) => meal.id === mealId)
      ?.entries.find((entry) => entry.id === entryId)
    setMeals((current) =>
      current.map((meal) =>
        meal.id === mealId
          ? { ...meal, entries: meal.entries.filter((entry) => entry.id !== entryId) }
          : meal,
      ),
    )
    if (removed) showToast(`已移除 ${removed.name}`)
  }

  const updateMealPhoto = (mealId: MealId, photoName: string) => {
    setMeals((current) =>
      current.map((meal) => (meal.id === mealId ? { ...meal, photoName } : meal)),
    )
    showToast('已添加餐次照片附件')
  }

  const registerAiFood = (mealId: MealId, entry: FoodEntry) => {
    addFood(mealId, entry)
    showToast(`已核对并登记 ${entry.name}`)
  }

  return (
    <>
      <header className="head">
        <div className="heading">
          <div className="eyebrow">{todayLabel()}</div>
          <h1>
            吃得清楚，
            <br />
            不必吃得紧张。
          </h1>
          <p className="subtitle">
            手动登记或粘贴外部 AI 的热量结果，核对以后再计入。记录是为了理解，而不是制造负担。
          </p>
        </div>
        <div className="head-actions">
          <span className="status">
            <span className="dot" />
            {mealCount} / 4 餐已记录
          </span>
          <button className="btn primary" type="button" onClick={() => setAiOpen(true)}>
            <Icon name="spark" className="icon-sm" />
            AI 热量登记
          </button>
        </div>
      </header>

      <section className="progress" aria-label="今日营养进度">
        <div className="progress-head">
          <span className="label">今日营养进度</span>
          <span className="count-note">根据 {mealCount} 条餐次记录自动汇总</span>
        </div>
        <div className="metrics">
          <div className="metric">
            <div className="metric-title">
              <Icon name="food" className="icon-sm" />
              热量摄入
            </div>
            <div className="metric-value">
              <span className="metric-number">{totals.calories.toLocaleString('zh-CN')}</span>
              <span className="metric-denom">
                / {TARGETS.calories.toLocaleString('zh-CN')} kcal
              </span>
            </div>
            <div className="track">
              <span
                style={{ width: `${Math.min(100, (totals.calories / TARGETS.calories) * 100)}%` }}
              />
            </div>
          </div>
          <div className="metric">
            <div className="metric-title">
              <Icon name="spark" className="icon-sm" />
              蛋白质
            </div>
            <div className="metric-value">
              <span className="metric-number">{Math.round(totals.protein)}</span>
              <span className="metric-denom">/ {TARGETS.protein} g</span>
            </div>
            <div className="track">
              <span
                style={{ width: `${Math.min(100, (totals.protein / TARGETS.protein) * 100)}%` }}
              />
            </div>
          </div>
          <div className="metric">
            <div className="metric-title">
              <Icon name="water" className="icon-sm" />
              饮水
            </div>
            <div className="metric-value">
              <span className="metric-number">
                {(Math.round(waterMilliliters / 100) / 10).toFixed(1)}
              </span>
              <span className="metric-denom">/ {TARGETS.waterLiters.toFixed(1)} L</span>
            </div>
            <div className="track">
              <span style={{ width: `${waterProgress}%` }} />
            </div>
          </div>
          <div className="metric">
            <div className="metric-title">
              <Icon name="check" className="icon-sm" />
              饮食记录
            </div>
            <div className="metric-value">
              <span className="metric-number">{mealCount}</span>
              <span className="metric-denom">/ 4 餐</span>
            </div>
            <div className="track">
              <span style={{ width: `${(mealCount / 4) * 100}%` }} />
            </div>
          </div>
        </div>
      </section>

      <div className="diet-layout">
        <div className="diet-main-column">
          <section className="panel diet-meals" aria-labelledby="dietMealsTitle">
            <div className="panel-head">
              <div>
                <div className="panel-title-row">
                  <h2 className="panel-title" id="dietMealsTitle">
                    今日餐次
                  </h2>
                  <span className="badge">{mealCount} / 4</span>
                </div>
                <p className="panel-sub">每餐可以添加多项食物，也可以只保留一张照片。</p>
              </div>
              <button
                className="btn quiet"
                type="button"
                onClick={() => setEditingMealId(nextMeal.id)}
              >
                记录下一餐
                <Icon name="chev" className="icon-sm" />
              </button>
            </div>

            <div className="diet-meal-list">
              {meals.map((meal) => {
                const mealCalories = meal.entries.reduce(
                  (total, entry) => total + entry.calories,
                  0,
                )
                const mealProtein = meal.entries.reduce((total, entry) => total + entry.protein, 0)
                const mealCarbs = meal.entries.reduce((total, entry) => total + entry.carbs, 0)
                const mealFat = meal.entries.reduce((total, entry) => total + entry.fat, 0)
                const empty = meal.entries.length === 0

                return (
                  <article
                    className={empty ? 'diet-meal empty' : 'diet-meal'}
                    key={meal.id}
                    aria-labelledby={`meal-${meal.id}-title`}
                  >
                    <div className="diet-meal-head">
                      <div className="diet-meal-title">
                        <span className="diet-meal-icon">
                          <Icon name="food" className="icon-sm" />
                        </span>
                        <span>
                          <h3 id={`meal-${meal.id}-title`}>{meal.label}</h3>
                          <small>
                            {meal.time} · {empty ? '等待记录' : `${meal.entries.length} 项食物`}
                          </small>
                        </span>
                      </div>
                      <strong className="diet-meal-kcal">
                        {mealCalories}
                        <small> kcal</small>
                      </strong>
                    </div>

                    {empty ? (
                      <div className="diet-meal-empty">
                        <span className="diet-empty-icon">
                          <Icon name="plus" className="icon-sm" />
                        </span>
                        <span>
                          <strong>{meal.label}还没有记录</strong>
                          <small>可以直接登记食物，或先添加今天的餐次照片。</small>
                        </span>
                      </div>
                    ) : (
                      <div className="diet-entry-list">
                        {meal.entries.map((entry) => (
                          <div className="diet-entry-row" key={entry.id}>
                            <span className="diet-entry-dot" />
                            <span className="diet-entry-copy">
                              <strong>{entry.name}</strong>
                              <small>
                                {entry.portion} · 蛋白质 {entry.protein} g · 碳水 {entry.carbs} g ·
                                脂肪 {entry.fat} g
                              </small>
                            </span>
                            <span className="diet-entry-kcal">
                              {entry.calories}
                              <small> kcal</small>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="diet-meal-foot">
                      <span className="diet-meal-macros">
                        蛋白质 {Math.round(mealProtein)} g · 碳水 {Math.round(mealCarbs)} g · 脂肪{' '}
                        {Math.round(mealFat)} g
                      </span>
                      {meal.photoName && (
                        <span className="diet-photo-chip" title={meal.photoName}>
                          <Icon name="camera" className="icon-sm" />
                          {meal.photoName}
                        </span>
                      )}
                      <button
                        className="diet-edit-meal"
                        type="button"
                        aria-label={`编辑${meal.label}`}
                        onClick={() => setEditingMealId(meal.id)}
                      >
                        <Icon name="edit" className="icon-sm" />
                        {empty ? '添加' : '编辑'}
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        </div>

        <aside className="diet-side-column">
          {' '}
          <section className="panel diet-water" aria-labelledby="dietWaterTitle">
            <div className="panel-head diet-side-head">
              <div>
                <div className="panel-title-row">
                  <h2 className="panel-title" id="dietWaterTitle">
                    饮水记录
                  </h2>
                  <span className="badge">{Math.round(waterProgress)}%</span>
                </div>
                <p className="panel-sub">每次记录都会即刻汇总到今日进度。</p>
              </div>
            </div>

            <div className="diet-water-body">
              <div className="diet-water-summary">
                <span className="diet-water-icon">
                  <Icon name="water" />
                </span>
                <div className="diet-water-copy">
                  <strong>
                    {waterDisplayLiters}
                    <small> L</small>
                  </strong>
                  <span>
                    今日已喝 {waterMilliliters.toLocaleString('zh-CN')} ml · 目标{' '}
                    {TARGETS.waterLiters.toFixed(1)} L
                  </span>
                </div>
              </div>

              <div
                className="diet-water-track"
                role="progressbar"
                aria-label="今日饮水进度"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(waterProgress)}
              >
                <span style={{ width: `${waterProgress}%` }} />
              </div>

              <div className="diet-water-actions">
                <button className="diet-water-add" type="button" onClick={() => recordWater(125)}>
                  + 125 ml
                </button>
                <button className="diet-water-add" type="button" onClick={() => recordWater(250)}>
                  + 250 ml
                </button>
                <button
                  className="diet-water-undo"
                  type="button"
                  aria-label="撤销上一条饮水"
                  disabled={lastWaterMilliliters === null}
                  onClick={handleUndoWater}
                >
                  <Icon name="undo" className="icon-sm" />
                  撤销
                </button>
              </div>

              <form className="diet-water-custom" onSubmit={handleCustomWater}>
                <input
                  className="form-input"
                  type="number"
                  min="1"
                  max="3000"
                  inputMode="numeric"
                  aria-label="自定义饮水量"
                  placeholder="自定义 ml"
                  value={customWater}
                  onChange={(event) => setCustomWater(event.target.value)}
                />
                <button className="btn secondary" type="submit">
                  记录
                </button>
              </form>

              <div className="diet-water-chart" aria-label="近 7 天饮水趋势">
                <div className="diet-water-bars">
                  {chartValues.map((value, index) => (
                    <div
                      className={
                        index === chartValues.length - 1 ? 'diet-water-day today' : 'diet-water-day'
                      }
                      key={`${index}-${value}`}
                    >
                      <span
                        title={`${value.toFixed(1)} L`}
                        style={{ height: `${Math.max(10, (value / chartMax) * 100)}%` }}
                      />
                      <small>{['一', '二', '三', '四', '五', '六', '今'][index]}</small>
                    </div>
                  ))}
                </div>
                <div className="diet-water-chart-foot">
                  <span>近 7 天</span>
                  <span>今日仍在记录中</span>
                </div>
              </div>
            </div>
          </section>
          <section className="panel diet-macro-panel" aria-labelledby="dietMacroTitle">
            <div className="panel-head diet-side-head">
              <div>
                <div className="panel-title-row">
                  <h2 className="panel-title" id="dietMacroTitle">
                    营养结构
                  </h2>
                  <span className="badge">{Math.round(macroCalories)} kcal</span>
                </div>
                <p className="panel-sub">按蛋白质、碳水与脂肪的实际供能占比计算。</p>
              </div>
            </div>

            <div className="diet-macro-body">
              <div className="diet-macro-stack" aria-hidden="true">
                <span className="protein" style={{ width: `${proteinShare}%` }} />
                <span className="carbs" style={{ width: `${carbsShare}%` }} />
                <span className="fat" style={{ width: `${fatShare}%` }} />
              </div>

              <div className="diet-macro-list">
                <div className="diet-macro-row">
                  <span className="diet-macro-name">
                    <span className="diet-macro-dot protein" />
                    蛋白质
                  </span>
                  <span className="diet-macro-amount">{Math.round(totals.protein)} g</span>
                  <strong>{Math.round(proteinShare)}%</strong>
                </div>
                <div className="diet-macro-row">
                  <span className="diet-macro-name">
                    <span className="diet-macro-dot carbs" />
                    碳水
                  </span>
                  <span className="diet-macro-amount">{Math.round(totals.carbs)} g</span>
                  <strong>{Math.round(carbsShare)}%</strong>
                </div>
                <div className="diet-macro-row">
                  <span className="diet-macro-name">
                    <span className="diet-macro-dot fat" />
                    脂肪
                  </span>
                  <span className="diet-macro-amount">{Math.round(totals.fat)} g</span>
                  <strong>{Math.round(fatShare)}%</strong>
                </div>
              </div>

              <div className="diet-macro-remaining">
                <div>
                  <span>剩余热量</span>
                  <strong>{remainingCalories} kcal</strong>
                </div>
                <div>
                  <span>剩余蛋白质</span>
                  <strong>{Math.round(remainingProtein)} g</strong>
                </div>
              </div>
            </div>
          </section>
          <section className="panel diet-ai-observation" aria-labelledby="dietObservationTitle">
            <div className="diet-observation-head">
              <span className="diet-observation-icon">
                <Icon name="spark" />
              </span>
              <div>
                <span className="diet-observation-kicker">Persist AI · 今日观察</span>
                <h2 id="dietObservationTitle">晚餐优先补齐蛋白质</h2>
              </div>
            </div>
            <p>
              目前蛋白质摄入约占目标的 {Math.round((totals.protein / TARGETS.protein) * 100)}%。
              晚餐可以安排一份鱼、虾或豆制品，同时保留蔬菜和适量主食。
            </p>
            <div className="diet-observation-note">
              <span className="dot" />
              这是基于今日记录的 Mock 建议，接入个人档案后会考虑训练与恢复情况。
            </div>
            <button
              className="diet-observation-link"
              type="button"
              onClick={() => setEvidenceOpen(true)}
            >
              查看分析依据
              <Icon name="chev" className="icon-sm" />
            </button>
          </section>
          <section className="panel diet-guidance" aria-labelledby="dietGuidanceTitle">
            <div className="panel-head diet-side-head">
              <div>
                <h2 className="panel-title" id="dietGuidanceTitle">
                  记录原则
                </h2>
                <p className="panel-sub">先准确，再连续；不为估算制造额外压力。</p>
              </div>
            </div>
            <div className="diet-guidance-list">
              <div>
                <span>01</span>
                <p>照片只作餐次附件，不在此版本自动识别热量。</p>
              </div>
              <div>
                <span>02</span>
                <p>外部 AI 的结果先解析，再由你核对后写入餐次。</p>
              </div>
              <div>
                <span>03</span>
                <p>漏记一餐不必补造数据，保持真实比保持完美更重要。</p>
              </div>
            </div>
          </section>
        </aside>
      </div>

      {editingMeal && (
        <MealEditor
          key={editingMeal.id}
          meal={editingMeal}
          onClose={() => setEditingMealId(null)}
          onAdd={(entry) => addFood(editingMeal.id, entry)}
          onRemove={(entryId) => removeFood(editingMeal.id, entryId)}
          onPhotoChange={(photoName) => updateMealPhoto(editingMeal.id, photoName)}
        />
      )}

      {aiOpen && (
        <AiNutritionSheet
          meals={meals}
          onClose={() => setAiOpen(false)}
          onRegister={registerAiFood}
        />
      )}

      {evidenceOpen && (
        <EvidenceSheet
          title="饮食分析依据"
          subtitle="按今日已登记的餐次与饮水记录汇总，照片不会参与热量计算。"
          metrics={[
            {
              label: '今日热量',
              value: `${totals.calories.toLocaleString('zh-CN')} kcal`,
              detail: `目标 ${TARGETS.calories.toLocaleString('zh-CN')} kcal`,
            },
            {
              label: '蛋白质',
              value: `${Math.round(totals.protein)} g`,
              detail: `目标 ${TARGETS.protein} g`,
            },
            {
              label: '碳水 / 脂肪',
              value: `${Math.round(totals.carbs)} / ${Math.round(totals.fat)} g`,
              detail: '来自已登记食物',
            },
            {
              label: '饮水量',
              value: `${waterDisplayLiters} L`,
              detail: `目标 ${TARGETS.waterLiters.toFixed(1)} L`,
            },
            {
              label: '已记录餐次',
              value: `${mealCount} / 4`,
              detail: `${foodEntryCount} 个食物条目`,
            },
          ]}
          items={[
            {
              title: '热量与宏量营养',
              detail: `今日共登记 ${foodEntryCount} 个食物条目，建议使用各餐次的蛋白质缺口安排晚餐。`,
              value: `${Math.round(remainingProtein)} g 待补`,
            },
            {
              title: '外部 AI 文本登记',
              detail:
                '热量信息来自你主动粘贴并核对的 AI 结果；本页面只解析文本，不自行发起识别请求。',
              value: '已确认后写入',
            },
            {
              title: '照片附件',
              detail: `当前有 ${photoAttachmentCount} 顿餐食附有照片。照片仅保留为本地附件，不参与营养估算或发送给分析服务。`,
              value: `${photoAttachmentCount} 张`,
            },
            {
              title: '饮水记录',
              detail: `饮水由全局记录同步，当前累计 ${waterMilliliters} ml，撤销只影响最后一条快捷记录。`,
              value: `${waterMilliliters} ml`,
            },
          ]}
          note="当前为前端 Mock 依据。接入 DeepSeek 后，仍只会发送已授权的营养摘要，不会上传原始餐食照片。"
          onClose={() => setEvidenceOpen(false)}
        />
      )}
    </>
  )
}
