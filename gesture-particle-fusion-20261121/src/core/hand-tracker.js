/**
 * 摄像头 + MediaPipe 手部 21 点。
 *
 * 三条纪律：
 *  1. **懒加载**：不点「开启手势」就不 import MediaPipe、不申请摄像头。首屏只加载花朵。
 *  2. **本地优先**：所有 wasm / 模型都从 `vendor/mediapipe/` 同源取，不碰 CDN。
 *     缺文件时给出明确提示（而不是让页面白屏或静默失败）。
 *  3. **错误可读**：把 `getUserMedia` 与模型加载的失败翻译成一句人话 + 一条修复建议。
 */

/** 摄像头权限/设备错误 → 人话。`name` 来自 DOMException。 */
const CAMERA_ERRORS = {
  NotAllowedError: {
    message: '摄像头权限被拒绝',
    hint: '在地址栏的相机图标里允许访问，然后刷新页面；也可以用鼠标/自动模式继续看效果。',
  },
  NotFoundError: {
    message: '没有找到可用的摄像头',
    hint: '接一个摄像头，或直接用自动模式（花朵会自己呼吸绽放）。',
  },
  NotReadableError: {
    message: '摄像头被其他程序占用',
    hint: '关掉正在用摄像头的会议/直播软件，再点一次「开启手势」。',
  },
  OverconstrainedError: {
    message: '摄像头不支持所需的分辨率',
    hint: '换一个摄像头，或降低约束后重试。',
  },
  SecurityError: {
    message: '当前页面不是安全上下文',
    hint: '摄像头只在 https 或 http://localhost 下可用。请用 `node bloom/serve.mjs` 启动本地服务。',
  },
  AbortError: {
    message: '摄像头启动被中断',
    hint: '再点一次「开启手势」即可重试。',
  },
}

export class HandTracker {
  /**
   * @param {{base?:string, numHands?:number, delegate?:'GPU'|'CPU',
   *          minDetection?:number, minPresence?:number, minTracking?:number}} options
   */
  constructor(options = {}) {
    this.base = options.base || './vendor/mediapipe'
    this.numHands = options.numHands || 2
    this.delegate = options.delegate || 'GPU'
    this.minDetection = options.minDetection ?? 0.5
    this.minPresence = options.minPresence ?? 0.55
    this.minTracking = options.minTracking ?? 0.5

    this.landmarker = null
    this.stream = null
    this.video = null
    this.ready = false
    this.lastResult = null
    this.lastDetectAt = -Infinity
    /**
     * 检测间隔是**自适应**的。
     *
     * MediaPipe 的 `detectForVideo` 是同步的：它会占住主线程。GPU 下通常 5–15ms，
     * 但软件渲染（无 GPU 的机器、远程桌面、部分安卓机）能到 1–3 秒。
     * 一旦单帧检测超过阈值，就降到 10fps；否则按 24fps 跑 ——
     * 宁可手势跟手慢一点，也不能让粒子花朵卡成幻灯片。
     */
    this.detectIntervalMs = 1000 / 30
    this.slowThresholdMs = 60
    /** 上一次 detect 的实际耗时，供 HUD / 诊断看 */
    this.lastCostMs = 0
    this.stats = { detections: 0, detectCalls: 0, loadMs: 0, delegate: null, slowFrames: 0 }
  }

  /** 环境自检：没有 getUserMedia 就不必往下走。 */
  static capability() {
    const secure = typeof window !== 'undefined' && window.isSecureContext
    const hasVideo = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
    if (!secure) {
      return {
        ok: false,
        message: '当前页面不是安全上下文',
        hint: '摄像头需要 https 或 http://localhost。请用 `node bloom/serve.mjs` 打开，不要直接双击 html。',
      }
    }
    if (!hasVideo) {
      return { ok: false, message: '浏览器不支持摄像头 API', hint: '换 Chrome / Edge / Safari 的新版本。' }
    }
    return { ok: true }
  }

  /** 申请摄像头并挂到 `<video>` 上。视频不显示也可以（播放器要 `muted + playsinline` 才不卡）。 */
  async startCamera(video) {
    const cap = HandTracker.capability()
    if (!cap.ok) throw Object.assign(new Error(cap.message), { hint: cap.hint })

    this.video = video
    const constraints = {
      audio: false,
      video: {
        facingMode: 'user',
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 30, max: 60 },
      },
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints)
    } catch (err) {
      const known = CAMERA_ERRORS[err?.name]
      throw Object.assign(
        new Error(known ? known.message : `摄像头启动失败：${err?.name || err?.message || err}`),
        { hint: known ? known.hint : '检查系统相机隐私设置后重试。', cause: err },
      )
    }

    video.srcObject = this.stream
    video.muted = true
    video.playsInline = true
    await video.play().catch(() => {
      /* 自动播放被拦时由用户点击触发，这里不致命 */
    })
    return this.stream
  }

  /**
   * 载入 MediaPipe 并建 `HandLandmarker`。
   * 走的是 vendored 路径：`vendor/mediapipe/vision_bundle.mjs` + `wasm/` + `hand_landmarker.task`。
   */
  async loadModel() {
    const t0 = performance.now()
    let mod
    try {
      // 用变量拼路径：让打包器不去静态分析它，缺文件时报错可控
      const url = new URL(`${this.base}/vision_bundle.mjs`, location.href).href
      mod = await import(/* @vite-ignore */ url)
    } catch (err) {
      throw Object.assign(
        new Error('手势模型还没安装到 vendor/mediapipe/'),
        {
          hint: '运行 `node bloom/scripts/vendor-mediapipe.mjs` 把 wasm 与模型取到本地；在那之前请用自动模式。',
          cause: err,
        },
      )
    }

    const { FilesetResolver, HandLandmarker } = mod
    if (!FilesetResolver || !HandLandmarker) {
      throw Object.assign(new Error('vendor 里的 MediaPipe 包结构不对（缺 FilesetResolver / HandLandmarker）'), {
        hint: '重新跑 `node bloom/scripts/vendor-mediapipe.mjs`。',
      })
    }

    const wasmBase = new URL(`${this.base}/wasm`, location.href).href
    const modelPath = new URL(`${this.base}/hand_landmarker.task`, location.href).href
    const vision = await FilesetResolver.forVisionTasks(wasmBase)

    const build = (delegate) =>
      HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: modelPath, delegate },
        runningMode: 'VIDEO',
        numHands: this.numHands,
        minHandDetectionConfidence: this.minDetection,
        minHandPresenceConfidence: this.minPresence,
        minTrackingConfidence: this.minTracking,
      })

    try {
      this.landmarker = await build(this.delegate)
      this.stats.delegate = this.delegate
    } catch (err) {
      // 移动端 / 老显卡上 WebGL delegate 可能建不起来，退回 CPU
      if (this.delegate !== 'CPU') {
        this.landmarker = await build('CPU')
        this.stats.delegate = 'CPU'
      } else {
        throw Object.assign(new Error('手势模型初始化失败'), {
          hint: '换 Chrome/Edge 新版本，或检查是否开启了硬件加速。',
          cause: err,
        })
      }
    }

    this.stats.loadMs = Math.round(performance.now() - t0)
    this.ready = true
    return this.landmarker
  }

  async start(video) {
    await this.startCamera(video)
    await this.loadModel()
    return this
  }

  /**
   * 每帧调用。内部自适应限频：检测慢的设备自动降到约 10fps，避免拖垮渲染。
   * @returns {{landmarks:Array|null, handedness:string|null, at:number}}
   */
  detect(nowMs) {
    if (!this.ready || !this.video || this.video.readyState < 2) {
      return { landmarks: null, handedness: null, at: nowMs }
    }
    if (nowMs - this.lastDetectAt < this.detectIntervalMs) {
      return this.lastResult || { landmarks: null, handedness: null, at: nowMs }
    }
    this.lastDetectAt = nowMs

    let result
    const t0 = performance.now()
    try {
      result = this.landmarker.detectForVideo(this.video, nowMs)
    } catch (err) {
      // 单帧失败不应该让整个动画挂掉
      return { landmarks: null, handedness: null, at: nowMs, error: err }
    } finally {
      this.lastCostMs = performance.now() - t0
      // 连续慢帧就降频；恢复得快再升回去
      if (this.lastCostMs > this.slowThresholdMs) {
        this.stats.slowFrames++
        this.detectIntervalMs = Math.min(1000 / 8, Math.max(1000 / 10, this.lastCostMs * 1.6))
      } else {
        this.detectIntervalMs = 1000 / 30
      }
    }

    const hands = result?.landmarks || []
    const landmarks = hands[0] || null
    this.stats.detectCalls++
    this.lastResult = {
      landmarks,
      // 双手模式：把全部手的 21 点都带出去，供「双手张合」度量使用
      hands,
      handedness: result?.handednesses?.[0]?.[0]?.categoryName || null,
      at: nowMs,
    }
    if (landmarks) this.stats.detections++
    return this.lastResult
  }

  stop() {
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop()
      this.stream = null
    }
    if (this.video) {
      this.video.srcObject = null
    }
    if (this.landmarker?.close) {
      try {
        this.landmarker.close()
      } catch {
        /* 已关闭 */
      }
    }
    this.landmarker = null
    this.ready = false
    this.lastResult = null
    this.lastDetectAt = -Infinity
  }
}
