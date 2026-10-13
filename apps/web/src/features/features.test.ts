import { featuresProblems, outlineProblems } from '@codefusion-cc/features-page/testing'
import { describe, expect, test } from 'vitest'
import { LANGUAGES } from '../lib/languages.ts'
import { builtOnEntries, featureGroups, FEATURE_LANGUAGES, loadContent, privacyEntries } from './content/index.ts'
import type { FeaturesContent } from './content/types.ts'
import { HERO_SHOT } from './outline.ts'
import SIZES from './shots.json'

const FILES = Object.keys(import.meta.glob('./shots/*.webp'))
/** The page's own anchors besides the features: the overview, its sections and the download. */
const SECTIONS = ['overview', 'privacy', 'built-on', 'get-app']

/** Long dashes, the middle dot and the bullet. */
const MARKS = /[\u2013\u2014\u00b7\u2022]/
/** The dashboard's words the page shows: the download card's. */
const PAGE_KEYS = /^(get\.|devices\.download$)/
const CATALOGS = import.meta.glob<{ strings: Record<string, string> }>('../i18n/*.json', { eager: true, import: 'default' })
const PAGE_SOURCES = import.meta.glob<string>(['./FeaturesPage.tsx', '../cloud/DownloadApp.tsx'], { eager: true, query: '?raw', import: 'default' })

const contents = Object.fromEntries(await Promise.all(FEATURE_LANGUAGES.map(async code => [code, (await loadContent(code)).content] as const))) as Record<string, FeaturesContent>
const { en } = contents

/** Every string in the content, with where it is, functions called with a few numbers. */
function strings(value: unknown, path = ''): [string, string][] {
  if (typeof value === 'string') return [[path, value]]
  if (typeof value === 'function') return [1, 2, 5].flatMap(n => strings(value(n, 3), `${path}(${n})`))
  if (Array.isArray(value)) return value.flatMap((item, index) => strings(item, `${path}[${index}]`))
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, item]) => strings(item, path ? `${path}.${key}` : key))
  return []
}

describe('the features page', () => {
  test('is written in every language the dashboard has', () => {
    expect([...FEATURE_LANGUAGES].sort()).toEqual(LANGUAGES.map(language => language.code).sort())
  })

  test.each(FEATURE_LANGUAGES)('has every screenshot it shows, in both themes, and something to say of each feature (%s)', code => {
    expect(featuresProblems({ groups: featureGroups(contents[code]!), sizes: SIZES, files: FILES, sections: SECTIONS })).toEqual([])
  })

  test.each(FEATURE_LANGUAGES)('describes the shot beside the opening with the feature that shows it (%s)', code => {
    const alts = featureGroups(contents[code]!).flatMap(group => group.features.flatMap(feature => feature.shots ?? [])).filter(shot => shot.src === HERO_SHOT).map(shot => shot.alt)
    expect(alts).toHaveLength(1)
  })

  test.each(FEATURE_LANGUAGES)('gives what it keeps and what it runs on an entry each, with anchors no feature has (%s)', code => {
    const content = contents[code]!
    const features = [...privacyEntries(content), ...builtOnEntries(content)]
    expect(featuresProblems({ features })).toEqual([])
    const anchors = [...SECTIONS, ...featureGroups(content).flatMap(group => [group.id, ...group.features.map(feature => `${group.id}-${feature.id}`)]), ...features.map(feature => feature.id!)]
    expect(anchors.filter((anchor, index) => anchors.indexOf(anchor) !== index)).toEqual([])
  })

  test.each(FEATURE_LANGUAGES.filter(code => code !== 'en'))('says in %s what it says in English, point for point', code => {
    expect(outlineProblems(featureGroups(en!), featureGroups(contents[code]!))).toEqual([])
    const blank = strings(contents[code]).filter(([, text]) => !text.trim())
    expect(blank).toEqual([])
    // A translation, not English left in place: product names aside, the titles differ.
    const titles = (content: FeaturesContent) => featureGroups(content).flatMap(group => group.features.map(feature => feature.title))
    const same = titles(contents[code]!).filter((title, index) => title === titles(en!)[index])
    expect(same).toEqual([])
  })

  test.each(FEATURE_LANGUAGES)('uses none of the marks that make a page read as generated (%s)', code => {
    const marks = strings(contents[code]).filter(([, text]) => MARKS.test(text))
    expect(marks).toEqual([])
  })

  test.each(FEATURE_LANGUAGES)('shows none of those marks from the dashboard\'s words or its own markup either (%s)', code => {
    const catalog = CATALOGS[`../i18n/${code}.json`]!.strings
    const words = Object.entries(catalog).filter(([key, text]) => PAGE_KEYS.test(key) && MARKS.test(text))
    expect(words).toEqual([])
    const markup = Object.entries(PAGE_SOURCES).filter(([, source]) => MARKS.test(source)).map(([file]) => file)
    expect(markup).toEqual([])
  })

  test.each(FEATURE_LANGUAGES)('loads %s as itself, not as English', async code => {
    expect((await loadContent(code)).language).toBe(code)
  })

  test('falls back to English for a language it has no words in', async () => {
    expect(await loadContent('xx')).toEqual({ language: 'en', content: en })
  })
})
