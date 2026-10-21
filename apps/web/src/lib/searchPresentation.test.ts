import fc from 'fast-check'
import type { SourceOutcomeDto } from '@magnetar/protocol'
import { expect, test } from 'vitest'
import english from '../i18n/en.json'
import polish from '../i18n/pl.json'
import { searchCount, searchSummary, outcomeTitle, outcomeCount } from './searchPresentation.ts'

const translate = (strings: Record<string, string>) => (key: string, ...args: (string | number)[]) => (strings[key] ?? key).replace(/\{(\d+)\}/g, (_, n) => String(args[Number(n)]))
const en = translate(english.strings), pl = translate(polish.strings)
const sources: SourceOutcomeDto[] = ['The Pirate Bay','Torrents-CSV','RARBG','Nyaa','EZTV','1337x'].map((source,i) => ({source,status:i===5?'failed':'ok',returned:[22,13,8,0,0,0][i]!,filtered:0,error:null}))
const state = {outcomes:sources,total:6,sourceCount:6,searching:false,ran:true,query:'sintel'}

test('source totals, empty answers and failures give the reference sentence in both languages', () => {
  expect(searchSummary(en,'en',state)).toEqual({line:'43 results from 3 of 6 sources. Nyaa and EZTV found nothing, 1337x did not answer.',allFailed:false})
  expect(searchSummary(pl,'pl',state)).toEqual({line:'43 wyniki z 3 z 6 źródeł. Źródła Nyaa i EZTV nic nie znalazły, a źródło 1337x nie odpowiedziało.',allFailed:false})
})
test('out-of-order answers produce the same source counts and filtered matches do not count', () => {
  const shuffled = [sources[2]!,sources[0]!,sources[1]!]
  expect(searchSummary(en,'en',{...state,outcomes:shuffled,searching:true}).line).toBe('43 results so far. Three sources are still answering.')
  const filtered = [{...sources[0]!,filtered:21}]
  expect(searchSummary(en,'en',{...state,outcomes:filtered}).line).toBe('1 result from 1 of 6 sources.')
  expect(searchSummary(pl,'pl',{...state,outcomes:filtered}).line).toBe('1 wynik z 1 z 6 źródeł.')
})
test('an empty result is not a failed search, and six failures are not an empty answer', () => {
  const outcomes = sources.map(o=>({...o,status:'ok' as const,returned:0}))
  expect(searchSummary(en,'en',{...state,outcomes,total:0})).toEqual({line:'Nothing found for “sintel”.',allFailed:false})
  expect(searchSummary(en,'en',{...state,outcomes:outcomes.map(o=>({...o,status:'failed' as const})),total:0})).toEqual({line:'No source answered.',allFailed:true})
})
test('Polish result and seeder counts follow one, few, many and the teens', () => {
  expect([0,1,2,4,5,12,21,22,112].map(n=>searchCount(pl,'pl','results',n))).toEqual(['0 wyników','1 wynik','2 wyniki','4 wyniki','5 wyników','12 wyników','21 wyników','22 wyniki','112 wyników'])
  expect([1,2,5].map(n=>searchCount(pl,'pl','seeders',n))).toEqual(['1 seed','2 seedy','5 seedów'])
  expect(searchCount(en,'en','seeders',1)).toBe('1 seeder')
})
test('the returned count is invariant under permutations of source replies', () => {
  fc.assert(fc.property(fc.shuffledSubarray(sources,{minLength:6,maxLength:6}), outcomes => {
    expect(searchSummary(en,'en',{...state,outcomes}).line).toMatch(/^43 results from 3 of 6 sources\./)
  }))
})

test('a source filter uses a singular source, including the Polish wording', () => {
  const one = {...state,sourceCount:1,outcomes:[{...sources[0]!,returned:1}]}
  expect(searchSummary(en,'en',{...one,ran:false}).line).toBe('One source is asked. Results appear when it answers.')
  expect(searchSummary(en,'en',one).line).toBe('1 result from one source.')
  expect(searchSummary(pl,'pl',one).line).toBe('1 wynik z jednego źródła.')
})

test('source details and counts distinguish pending, failed, filtered and empty replies', () => {
  const filtered = { ...sources[0]!, returned: 8, filtered: 3 }
  expect(outcomeTitle(en, undefined)).toBeUndefined()
  expect(outcomeCount(en, undefined, false)).toBe('')
  expect(outcomeCount(en, undefined, true)).toBe('asking')
  expect(outcomeCount(en, sources[5], false)).toBe('no answer')
  expect(outcomeTitle(en, { ...sources[5]!, error: 'timeout' })).toBe('This source could not be reached (timeout). Its results are missing from the list below.')
  for (const error of [undefined, null, '', '  ']) {
    expect(outcomeTitle(en, { ...sources[5]!, error } as SourceOutcomeDto)).toBe('This source could not be reached. Its results are missing from the list below.')
    expect(outcomeTitle(pl, { ...sources[5]!, error } as SourceOutcomeDto)).toBe('Nie udało się połączyć z tym źródłem. Jego wyników nie ma na liście poniżej.')
  }
  expect(outcomeCount(en, filtered, false)).toBe(5)
  expect(outcomeTitle(en, filtered)).toBe("Showing 5 of 8 results. 3 were left out because their title didn't match every word of your query.")
  expect(outcomeTitle(en, { ...sources[0]!, returned: 0 })).toBe('0 results from this source.')
})
