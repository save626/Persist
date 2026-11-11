import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.save626.persist',
  appName: 'Persist',
  webDir: 'dist-mobile',
  backgroundColor: '#f4f7f9',
  android: {
    backgroundColor: '#f4f7f9',
    // 当前服务器仍是 IP + HTTP；切到域名与 HTTPS 后应移除这两项。
    allowMixedContent: true,
  },
  server: {
    androidScheme: 'https',
    hostname: 'localhost',
    cleartext: true,
  },
}

export default config
