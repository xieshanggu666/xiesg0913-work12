import type { ForgeBridge } from './types'

declare global {
  interface Window {
    forge?: ForgeBridge
  }
}

export {}
