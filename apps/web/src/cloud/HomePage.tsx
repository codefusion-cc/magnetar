import { Link } from 'react-router'
import { useT } from '../lib/i18n.tsx'
import { HeroSky } from '../ui/sky/Sky.tsx'
import { CloudFrame } from './CloudFrame.tsx'
import { useGetApp } from './DownloadApp.tsx'

/** The sources the app searches, in the order the picture's streams take them. */
const SOURCES = ['The Pirate Bay', 'Knaben', 'RARBG', 'Torrents-CSV', 'Nyaa', 'EZTV']

/** `/` for someone signed out: what Magnetar is, the app to get, and the way in. */
export function HomePage() {
  const t = useT()
  const app = useGetApp('infall-button big')
  return (
    <CloudFrame>
      <section className="home-hero">
        <div className="home-text">
          <h1>{t('home.title')}</h1>
          <p className="site-lead">{t('home.lead')}</p>
          <div className="infall-acts">
            {app.button}
            <Link to="/login" className="infall-button quiet big">{t('cloud.signInLink')}</Link>
          </div>
          <p className="fine">{app.note}</p>
        </div>
        <HeroSky sources={SOURCES} label={t('home.sources')} />
      </section>
      <section className="home-three">
        <div><h2>{t('home.computer')}</h2><p>{t('home.computerText')}</p></div>
        <div><h2>{t('home.series')}</h2><p>{t('home.seriesText')}</p></div>
        <div><h2>{t('home.private')}</h2><p>{t('home.privateText')}</p></div>
      </section>
    </CloudFrame>
  )
}
