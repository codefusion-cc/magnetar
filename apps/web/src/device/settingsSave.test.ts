import { describe, expect, test } from 'vitest'
import { failureOf, textChange, trimmed, typedPort, withFailure, withoutFailure, type Failures } from './settingsSave.tsx'

const none: Failures = new Map()

describe('save failures', () => {
  test('a failure of one setting keeps another setting\'s', () => {
    const failures = withFailure(withFailure(none, ['smtpHost'], 'host not saved'), ['language'], 'language not saved')
    expect(failureOf(failures, ['smtpHost', 'smtpPort'])).toBe('host not saved')
    expect(failureOf(failures, ['language'])).toBe('language not saved')
  })

  test('a save clears only its own fields', () => {
    const failures = withFailure(withFailure(none, ['smtpHost'], 'host not saved'), ['language'], 'language not saved')
    const after = withoutFailure(failures, ['language'])
    expect(failureOf(after, ['language'])).toBeUndefined()
    expect(failureOf(after, ['smtpHost'])).toBe('host not saved')
  })

  test('a setting of two fields clears when the patch that failed saves', () => {
    const failures = withFailure(none, ['downloadLimit', 'uploadLimit'], 'not saved')
    expect(failureOf(withoutFailure(failures, ['downloadLimit', 'uploadLimit']), ['downloadLimit', 'uploadLimit'])).toBeUndefined()
  })

  test('a later failure of the same field says the newer reason', () => {
    const failures = withFailure(withFailure(none, ['smtpHost'], 'first'), ['smtpHost'], 'second')
    expect(failureOf(failures, ['smtpHost'])).toBe('second')
  })

  test('a save of a field without a failure keeps the same failures', () => {
    const failures = withFailure(none, ['smtpHost'], 'host not saved')
    expect(withoutFailure(failures, ['language'])).toBe(failures)
  })

  test('nothing failed: nothing to say', () => {
    expect(failureOf(none, ['smtpHost'])).toBeUndefined()
    expect(failureOf(withFailure(none, ['smtpHost'], 'x'), [])).toBeUndefined()
  })
})

describe('a text setting left', () => {
  test('untouched saves nothing', () => {
    expect(textChange('smtp.example.com', 'smtp.example.com', trimmed)).toEqual({ draft: 'smtp.example.com', save: null })
  })

  test('spaces around the value it has show the value and save nothing', () => {
    expect(textChange(' smtp.example.com  ', 'smtp.example.com', trimmed)).toEqual({ draft: 'smtp.example.com', save: null })
  })

  test('a new value saves without the spaces around it', () => {
    expect(textChange(' mail.example.com ', 'smtp.example.com', trimmed)).toEqual({ draft: 'mail.example.com', save: 'mail.example.com' })
  })

  test('only spaces clears it', () => {
    expect(textChange('   ', 'smtp.example.com', trimmed)).toEqual({ draft: '', save: '' })
    expect(textChange('   ', '', trimmed)).toEqual({ draft: '', save: null })
  })

  test('a field that keeps spaces saves them', () => {
    expect(textChange(' name ', 'name')).toEqual({ draft: ' name ', save: ' name ' })
  })

  test('unicode and very long values pass through whole', () => {
    const long = 'ż'.repeat(10_000) + '🌟'
    expect(textChange(`  ${long}\t`, '', trimmed)).toEqual({ draft: long, save: long })
  })
})

describe('the mail server port', () => {
  test('whole ports from 1 to 65535', () => {
    expect(typedPort('1')).toBe(1)
    expect(typedPort('587')).toBe(587)
    expect(typedPort('65535')).toBe(65535)
    expect(typedPort(' 25 ')).toBe(25)
  })

  test('not a port', () => {
    for (const typed of ['', ' ', '0', '65536', '-25', '25.5', '1e3', '0x19', 'abc', '２５', 'Infinity']) expect(typedPort(typed), typed).toBeNull()
  })

  test('a port spelled another way shows as the computer keeps it and saves nothing', () => {
    const normalize = (typed: string) => String(typedPort(typed) ?? typed)
    expect(textChange('025', '25', normalize)).toEqual({ draft: '25', save: null })
    expect(textChange('587', '25', normalize)).toEqual({ draft: '587', save: '587' })
    expect(textChange('abc', '25', normalize)).toEqual({ draft: 'abc', save: 'abc' })
  })
})
