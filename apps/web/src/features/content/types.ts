import type { FeaturesCopy } from '@codefusion-cc/features-page/react'
import type { BUILT_ON, FeatureIdOf, FeatureShot, GroupId, PRIVACY } from '../outline.ts'

/** A feature in one language: what it gives first, then how, then the points, most important first. */
export interface FeatureText {
  title: string
  gain: string
  text: string
  points: string[]
}

/** Everything the features page says in one language, for exactly the outline's groups, features, shots and entries. */
export interface FeaturesContent {
  meta: { title: string; description: string }
  header: { language: string; signIn: string; devices: string; home: string }
  hero: { title: string; lead: string; primary: string; secondary: string }
  /** The page's own words, and the package's (the disclosure, the title link, the screenshots). */
  copy: FeaturesCopy & { skipToFeatures: string; sectionsLabel: string; overview: { title: string; lead: string } }
  groups: { [G in GroupId]: { title: string; label: string; lead: string; features: Record<FeatureIdOf<G>, FeatureText> } }
  /** What each shot shows: its alt text and caption. */
  shots: Record<FeatureShot, string>
  privacy: { title: string; label: string; lead: string; items: Record<(typeof PRIVACY)[number], { title: string; text: string }> }
  builtOn: { title: string; label: string; lead: string; items: Record<(typeof BUILT_ON)[number], { name: string; text: string }> }
  closing: { title: string; lead: string; signIn: string }
}
