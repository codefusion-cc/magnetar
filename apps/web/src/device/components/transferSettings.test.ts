import { describe, expect, test } from 'vitest'
import { numberText, numberToSave, speedText, speedToSave, typedSpeed } from './transferSettings.tsx'

describe('a speed cap left', () => {
  test('untouched saves nothing, whatever its rounding', () => {
    for (const bytes of [0, 50_000, 524_288, 32_768, 1_000_000, 1_048_576, 123_456_789]) {
      for (const language of ['en', 'pl']) expect(speedToSave(speedText(bytes, language), bytes, language), `${bytes} ${language}`).toBeNull()
    }
  })

  test('a typed cap saves in bytes a second, in either decimal mark', () => {
    expect(speedToSave('2.5', 524_288, 'en')).toBe(2_500_000)
    expect(speedToSave('2,5', 524_288, 'pl')).toBe(2_500_000)
    expect(speedToSave(' 0.524 ', 524_288, 'en')).toBe(524_000)
  })

  test('blank or 0 is no cap', () => {
    expect(speedToSave('', 524_288, 'en')).toBe(0)
    expect(speedToSave('0', 524_288, 'en')).toBe(0)
    expect(speedToSave('', 0, 'en')).toBeNull()
  })

  test('not a number stays not a number', () => {
    expect(typedSpeed('fast')).toBeNaN()
    expect(typedSpeed('1..2')).toBeNaN()
  })
})

describe('a seed ratio left', () => {
  test('untouched saves nothing, whatever its rounding', () => {
    for (const ratio of [0.1, 1, 1.5, 1.555, 2.004, 100]) {
      for (const language of ['en', 'pl']) expect(numberToSave(numberText(ratio, language), ratio, language), `${ratio} ${language}`).toBeNull()
    }
  })

  test('a typed ratio saves, in either decimal mark', () => {
    expect(numberToSave('1.57', 1.555, 'en')).toBe(1.57)
    expect(numberToSave('2,5', 1.555, 'pl')).toBe(2.5)
    expect(numberToSave('1.5', 1.5, 'en')).toBeNull()
  })
})
