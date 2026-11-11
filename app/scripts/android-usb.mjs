import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { readAndroidApiBase } from './android-env.mjs'

const checkOnly = process.argv.includes('--check')
const syncOnly = process.argv.includes('--sync')
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const gradleCommand = process.platform === 'win32' ? 'gradlew.bat' : './gradlew'
const adbExecutable = process.platform === 'win32' ? 'adb.exe' : 'adb'

function run(command, args, cwd = process.cwd()) {
  const shell = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command)
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} 失败`)
}

function javaExecutable() {
  const home = process.env.JAVA_HOME?.trim()
  if (!home) return 'java'
  const executable = join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
  return existsSync(executable) ? executable : 'java'
}

function javaMajor() {
  const result = spawnSync(javaExecutable(), ['-version'], { encoding: 'utf8' })
  if (result.error) return null
  const text = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  const match = text.match(/version "(?:1\.)?(\d+)/)
  return match ? Number.parseInt(match[1], 10) : null
}

function adbCandidates() {
  const candidates = [adbExecutable]
  const roots = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT]
  for (const root of roots) {
    if (root?.trim()) candidates.push(join(root.trim(), 'platform-tools', adbExecutable))
  }
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    candidates.push(
      join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', adbExecutable),
    )
  }
  return candidates
}

function findAdb() {
  for (const candidate of adbCandidates()) {
    const result = spawnSync(candidate, ['version'], { encoding: 'utf8' })
    if (!result.error && result.status === 0) return candidate
  }
  return null
}

function connectedDevices(adb) {
  const result = spawnSync(adb, ['devices'], { encoding: 'utf8' })
  if (result.error) throw result.error
  const output = result.stdout ?? ''
  const devices = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[^\s]+\s+device$/.test(line))
  return { devices, output: output.trim() }
}

try {
  readAndroidApiBase()

  if (syncOnly) {
    run(npmCommand, ['run', 'build:mobile'])
    run(npxCommand, ['cap', 'sync', 'android'])
    console.log('Android Web 资源已同步。')
    process.exit(0)
  }

  const major = javaMajor()
  if (major === null || major < 21) {
    throw new Error(
      '构建 Capacitor 8 需要 JDK 21+；建议把 JAVA_HOME 指向 Android Studio 自带 JBR。',
    )
  }

  const androidDir = join(process.cwd(), 'android')
  if (!existsSync(join(androidDir, 'gradlew.bat')) && !existsSync(join(androidDir, 'gradlew'))) {
    throw new Error('缺少 Android Gradle Wrapper。')
  }

  const adb = findAdb()
  if (!adb) {
    throw new Error(
      '未找到 adb。请安装 Android Studio，把 SDK Platform-Tools 加入 PATH，或设置 ANDROID_HOME / ANDROID_SDK_ROOT。',
    )
  }
  const { devices, output } = connectedDevices(adb)
  if (devices.length === 0) {
    throw new Error(
      `没有已授权的 USB 设备。请连接手机、开启 USB 调试，并在手机上允许调试。\nadb devices:\n${output || '(空)'}`,
    )
  }
  if (devices.length > 1) {
    throw new Error('检测到多台 USB 设备；请只保留一台目标手机后再部署。')
  }

  console.log('Android 工具链与 USB 设备已就绪。')
  if (checkOnly) process.exit(0)

  run(npmCommand, ['run', 'build:mobile'])
  run(npxCommand, ['cap', 'sync', 'android'])
  run(gradleCommand, ['installDebug'], androidDir)
  console.log('Debug APK 已安装。输出：app/android/app/build/outputs/apk/debug/app-debug.apk')
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
