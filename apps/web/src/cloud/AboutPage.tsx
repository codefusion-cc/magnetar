import { cloud } from '../lib/cloudApi.ts'
import { useFormatDate, useT } from '../lib/i18n.tsx'
import { latestRelease } from '../lib/releases.ts'
import { BUILD } from '../lib/updates.ts'
import { BuildVersion } from '@codefusion-cc/app-update/react'
import { MAGNETAR_REPO } from '@magnetar/protocol/cloud'
import { Changelog } from '../ui/Changelog.tsx'
import { SettingSection } from '../ui/settings.tsx'
import { CloudFrame } from './CloudFrame.tsx'
import { DownloadApp } from './DownloadApp.tsx'

/** `/about`: which build the website runs, the newest app with its downloads, and what every release brought. */
export function AboutPage() {
  const t = useT()
  const formatDate = useFormatDate()
  const latest = latestRelease.useLatest()
  return (
    <CloudFrame>
      <div className="site-page">
        <h1>{t('about.title')}</h1>
        <div className="settings-panel">
          <SettingSection title={t('about.website')} hint={t('about.websiteHint')}>
            <p className="setting-value"><BuildVersion repo={MAGNETAR_REPO} className="tabular-nums" commitClassName="site-commit" version={BUILD.version} commit={BUILD.commit} /></p>
          </SettingSection>
          <SettingSection title={t('about.latestApp')}
            hint={latest ? (latest.publishedAt ? t('about.latestAppHint', latest.version, formatDate(latest.publishedAt)) : t('settings.version', latest.version))
              : latest === null ? t('releases.unavailable') : t('changelog.loading')}>
            {latest && <p className="setting-value">v{latest.version}</p>}
          </SettingSection>
          <SettingSection title={t('about.download')}>
            <DownloadApp />
          </SettingSection>
          <SettingSection title={t('changelog.title')} hint={t('changelog.hint')}>
            <Changelog load={cloud.releases} />
          </SettingSection>
        </div>
      </div>
    </CloudFrame>
  )
}
