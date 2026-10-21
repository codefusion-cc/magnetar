import type { DownloadDto, DownloadFileDto, SearchResultDto, SourceDto, SourceOutcomeDto, SeriesTaskDto, WatchDto, FolderRootsDto, FolderPageDto } from '@magnetar/protocol'

interface DesignRow { title: string; st: 'down' | 'paused' | 'error' | 'seed' | 'done'; pct: number; size: string; speed?: string }

// The reference data is kept here so tests do not depend on review files.
const downloads: DesignRow[] = [
  {"title": "Sintel (2010) 1080p BluRay", "st": "down", "pct": 64, "size": "1.9 GB", "speed": "3.4 MB/s"},
  {"title": "ubuntu-26.04.1-desktop-amd64.iso", "st": "down", "pct": 91, "size": "5.9 GB", "speed": "8.2 MB/s"},
  {"title": "Tears of Steel (2012) 4K", "st": "down", "pct": 18, "size": "6.3 GB", "speed": "1.1 MB/s"},
  {"title": "Cosmos Laundromat", "st": "paused", "pct": 40, "size": "210 MB"},
  {"title": "Night of the Living Dead (1968)", "st": "error", "pct": 0, "size": ""},
  {"title": "Big Buck Bunny 1080p", "st": "seed", "pct": 100, "size": "276 MB"},
  {"title": "Elephants Dream", "st": "done", "pct": 100, "size": "425 MB"},
]
const many: DesignRow[] = [
  ...downloads.slice(0, 3),
  {"title": "Dragnet S03E10 720p HDTV", "st": "down", "pct": 40, "size": "410 MB", "speed": "2.6 MB/s"},
  {"title": "Fedora-Server-dvd-x86_64-44.iso", "st": "down", "pct": 77, "size": "2.9 GB", "speed": "9.8 MB/s"},
  {"title": "The Cabinet of Dr. Caligari (1920) 4K", "st": "down", "pct": 6, "size": "11.2 GB", "speed": "6.3 MB/s"},
  downloads[3]!,
  {"title": "Safety Last (1923) 1080p", "st": "paused", "pct": 72, "size": "1.8 GB", "speed": "0.9 MB/s"},
  downloads[4]!,
  {"title": "A Trip to the Moon (1902) in colour", "st": "error", "pct": 0, "size": ""},
  {"title": "Big Buck Bunny 1080p", "st": "seed", "pct": 100, "size": "276 MB"},
  {"title": "Elephants Dream", "st": "done", "pct": 100, "size": "425 MB"},
  {"title": "Spring (2019) 4K", "st": "done", "pct": 100, "size": "1.4 GB"},
  {"title": "Agent 327: Operation Barbershop", "st": "done", "pct": 100, "size": "310 MB"},
  {"title": "Hero (2018)", "st": "seed", "pct": 100, "size": "520 MB"},
  {"title": "Coffee Run", "st": "done", "pct": 100, "size": "190 MB"},
  {"title": "Charge (2022) 4K", "st": "done", "pct": 100, "size": "2.2 GB"},
  {"title": "Sprite Fright 1080p", "st": "done", "pct": 100, "size": "640 MB"},
  {"title": "Caminandes 3: Llamigos", "st": "seed", "pct": 100, "size": "95 MB"},
  {"title": "Glass Half", "st": "done", "pct": 100, "size": "120 MB"},
  {"title": "The Daily Dweebs", "st": "done", "pct": 100, "size": "88 MB"},
  {"title": "Nosferatu (1922) 1080p", "st": "done", "pct": 100, "size": "1.6 GB"},
  {"title": "The General (1926)", "st": "seed", "pct": 100, "size": "1.1 GB"},
  {"title": "Metropolis (1927) restored 1080p", "st": "done", "pct": 100, "size": "3.8 GB"},
  {"title": "His Girl Friday (1940)", "st": "done", "pct": 100, "size": "1.3 GB"},
  {"title": "Charade (1963) 720p", "st": "done", "pct": 100, "size": "900 MB"},
  {"title": "The Kid (1921)", "st": "seed", "pct": 100, "size": "720 MB"},
  {"title": "Sherlock Jr. (1924)", "st": "done", "pct": 100, "size": "610 MB"},
  {"title": "Plan 9 from Outer Space (1957)", "st": "done", "pct": 100, "size": "1.0 GB"},
  {"title": "debian-13.1.0-amd64-netinst.iso", "st": "done", "pct": 100, "size": "790 MB"},
  {"title": "archlinux-2026.10.01-x86_64.iso", "st": "seed", "pct": 100, "size": "1.2 GB"},
  {"title": "Fedora-Workstation-Live-44.iso", "st": "done", "pct": 100, "size": "2.4 GB"},
  {"title": "Pioneer One S01E05 1080p WEB", "st": "done", "pct": 100, "size": "1.5 GB"},
  {"title": "Pioneer One S01E06 1080p WEB", "st": "done", "pct": 100, "size": "1.5 GB"},
]
const rows = { downloads, many }

const size = (value: string) => {
  const [n, unit] = value.split(' ')
  return Number(n) * ({ GB: 1e9, MB: 1e6, KB: 1e3 }[unit ?? ''] ?? 1) || 0
}

export type InfallScreen = 'downloads' | 'many' | 'details' | 'details-fail' | 'held' | 'loading' | 'downloads-fail' | 'search' | 'search-start' | 'watchlist' | 'files' | 'set-general' | 'set-dl' | 'set-notify' | 'set-sources' | 'settings'

export function infallDownloads(screen: InfallScreen): DownloadDto[] {
  const source = screen === 'many' ? rows.many : screen === 'held' ? rows.downloads.filter(d => d.st === 'down' || d.st === 'paused') : rows.downloads
  return source.map((row, i) => ({
    id: i + 1, name: screen === 'watchlist' && i === 0 ? 'Dragnet S03E10 720p HDTV' : row.title, status: ({ down: 'Downloading', paused: 'Paused', seed: 'Seeding', done: 'Completed', error: 'Error' } as const)[row.st],
    progress: screen === 'watchlist' && i === 0 ? 40 : row.pct, totalBytes: size(row.size), downloadSpeed: row.speed && row.st === 'down' ? size(row.speed.replace('/s', '')) : 0,
    uploadSpeed: 0, peers: 0, source: row.st === 'error' ? 'EZTV' : 'The Pirate Bay',
    savePath: row.st === 'error' ? '/Users/alex/Movies' : '/Users/alex/Movies/Sintel',
    addedAt: screen === 'details-fail' && row.st === 'error' ? '2026-10-14T20:31:00+02:00' : new Date(new Date('2026-10-14T20:14:00+02:00').getTime() - i * 1000).toISOString(),
    completedAt: row.st === 'seed' ? '2026-10-14T14:02:00+02:00' : row.st === 'done' ? '2026-10-13T14:02:00+02:00' : null,
    error: row.st === 'error' ? 'No peers found — the torrent may be dead or have no seeders.' : null, seriesTaskId: screen === 'watchlist' && i === 0 ? 1 : null, uploadedBytes: i === 0 ? 230e6 : 0, partialFiles: null,
  }))
}

export function infallFiles(): DownloadFileDto[] {
  return [
    { index: 0, path: 'Sintel.2010.1080p.BluRay.mkv', size: 1.9e9, done: 1.216e9, selected: true, media: 'video' },
    { index: 1, path: 'Sintel.en.srt', size: 1600, done: 1600, selected: true, media: null },
    { index: 2, path: 'Sintel.pl.srt', size: 1700, done: 1700, selected: true, media: null },
    { index: 3, path: 'Sintel.de.srt', size: 1600, done: 0, selected: false, media: null },
    { index: 4, path: 'Sample.mkv', size: 38e6, done: 0, selected: false, media: 'video' },
  ]
}

export const infallSources: SourceDto[] = ['The Pirate Bay', 'Torrents-CSV', 'RARBG', 'Nyaa', 'EZTV', '1337x'].map((name, i) => ({ id: ['tpb', 'csv', 'rarbg', 'nyaa', 'eztv', '1337x'][i]!, name, enabled: true }))
export function infallSearch(): { results: SearchResultDto[]; outcomes: SourceOutcomeDto[] } {
  const data: [string, number, number, number, string][] = [
    ['Sintel (2010) 1080p BluRay x264', 1.9e9, 124, 3, 'The Pirate Bay'],
    ['Sintel.2010.1080p.WEB.H264', 556e6, 30, 1, 'RARBG'],
    ['Sintel (2010) 720p BluRay', 138e6, 15, 2, 'Torrents-CSV'],
    ['Sintel 4K UHD FLAC ITA ENG', 4.8e9, 5, 11, 'The Pirate Bay'],
    ['Sintel.2010.720p.WEB', 383e6, 11, 1, 'RARBG'],
    ['Sintel, original soundtrack (FLAC)', 441e6, 4, 10, 'The Pirate Bay'],
  ]
  const results = data.map(([title, sizeBytes, seeders, age, source], i) => ({
    resultId: `result${i}`, title, sizeBytes, seeders, leechers: 0, source,
    publishedAt: `20${26-age}-10-14T12:00:00Z`, detailsUrl: null, infoHash: null,
  }))
  const outcomes = infallSources.map((s, i) => ({
    source: s.name, status: (s.name === '1337x' ? 'failed' : 'ok') as 'failed' | 'ok',
    returned: [22,13,8,0,0,0][i]!, filtered: 0, error: null,
  }))
  return { results, outcomes }
}
export function infallSeries(): SeriesTaskDto[] {
  return ['Dragnet','Pioneer One','Caminandes'].map((name, i) => {
    const n = [12,8,3][i]!, got = [9,6,3][i]!, season = i === 0 ? 3 : 1
    return { id: i+1,name,query:name,provider:null,titleFilter:null,season,startEpisode:1,endEpisode:n,lastDownloadedEpisode:got,nextEpisode:got+1,checkIntervalMinutes:60,enabled:true,downloadFolder:null,lastCheckedAt:'2026-10-14T20:20:00+02:00',finished:i===2,resolution:i===0?'720p':i===1?'1080p':null,minSeeders:i===0?5:1,maxSizeMb:null,preferWords:i===1?'WEB':null,excludeWords:null,show:null,
      episodes: { total:n,offset:0,version:'design',airDatesCheckedAt:'2026-10-14T18:00:00Z', episodes: Array.from({length:n},(_,j) => {
        const base = {number:j+1,name:null,airstamp: i===0 && j>=9 ? `2026-10-${j===9?'14':j===10?'19':'26'}T18:00:00Z` : i===1 && j>=6 ? `2026-10-${j===6?'15':'22'}T18:00:00Z` : null}
        return j<got ? {...base,state:'have' as const,downloadId:1} : i===0 && j===9 ? {...base,state:'downloading' as const,downloadId:1} : {...base,state:'expected' as const}
      }) },
    }
  })
}
export function infallRoots(language: string): FolderRootsDto {
  return { canAdd: false, roots: [
    { path:'/Users/alex/Movies',kind:'downloads',available:true,freeBytes:137.8e9 },
    { path:language==='pl'?'/Users/alex/Seriale':'/Users/alex/Series',kind:'added',available:true,freeBytes:null },
    { path:language==='pl'?'/Volumes/Dysk zapasowy':'/Volumes/Backup drive',kind:'added',available:false,freeBytes:null },
  ] }
}
export function infallFolder(path: string): FolderPageDto {
  const entries: FolderPageDto['entries'] = [
    {name:'Dragnet',kind:'folder',size:null,modified:null,media:null,download:null},
    {name:'Pioneer One',kind:'folder',size:null,modified:null,media:null,download:null},
    {name:'Sintel',kind:'folder',size:null,modified:null,media:null,download:{id:1}},
    {name:'ubuntu-26.04.1-desktop-amd64.iso',kind:'file',size:5.9e9,modified:null,media:null,download:{id:2,index:0}},
    {name:'Elephants Dream.mkv',kind:'file',size:425e6,modified:'2026-10-13T12:00:00Z',media:'video',download:{id:7,index:0}},
    {name:'Big Buck Bunny 1080p.mkv',kind:'file',size:276e6,modified:'2026-10-14T12:02:00Z',media:'video',download:{id:6,index:0}},
    {name:'Cosmos Laundromat.mkv',kind:'file',size:210e6,modified:null,media:'video',download:{id:4,index:0}},
  ]
  const root = path.startsWith('/Users/alex/') ? path.split('/').slice(0,4).join('/') : path
  const folder = (name: string): FolderPageDto['entries'] => [{name,kind:'folder',size:null,modified:null,media:null,download:null}]
  const listed = path === '/Users/alex/Movies' ? entries : /^\/Users\/alex\/(Series|Seriale)$/.test(path) ? folder('Dragnet') : path.endsWith('/Dragnet') ? folder(path.includes('/Seriale/') ? 'Sezon 4' : 'Season 4') : []
  return {path,root,separator:'/',entries:listed,offset:0,total:listed.length,truncated:false}
}

export const infallWatches: WatchDto[] = [{
  id: 1, query: 'Sprite Fright', resolution: '2160p', minSeeders: 1, maxSizeMb: null,
  preferWords: null, excludeWords: null, autoDownload: true, checkIntervalMinutes: 360, enabled: true,
  createdAt: '2026-10-01T12:00:00Z', lastCheckedAt: '2026-10-14T20:20:00+02:00', found: null, downloadId: null,
}]
