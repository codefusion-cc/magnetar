import { expect, test } from 'vitest'
import { featuresUrl } from './featuresLink.ts'

test('the features link names the dashboard language, without a region', () => {
  expect(featuresUrl('pl')).toBe('https://magnetar.codefusion.cc/features/pl')
  expect(featuresUrl('pt-BR')).toBe('https://magnetar.codefusion.cc/features/pt')
  expect(featuresUrl('DE')).toBe('https://magnetar.codefusion.cc/features/de')
})

test('without a usable language it links the page that picks one itself', () => {
  expect(featuresUrl('')).toBe('https://magnetar.codefusion.cc/features')
  expect(featuresUrl('1x')).toBe('https://magnetar.codefusion.cc/features')
})
