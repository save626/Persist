import { readAndroidApiBase } from './android-env.mjs'

try {
  readAndroidApiBase()
  console.log('Android API base: configured')
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
