import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// jsdom не умеет createObjectURL — превью фото на тестах не нужны.
Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:test', writable: true })
Object.defineProperty(URL, 'revokeObjectURL', { value: () => {}, writable: true })
