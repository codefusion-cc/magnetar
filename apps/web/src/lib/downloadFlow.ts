/** How "always save here" went: saved, or refused with the device's message. */
export type AlwaysOutcome = { saved: true } | { saved: false; error: string }

/** What the folder browser of a download shows: the thing being downloaded, whether it is being added, what went wrong. */
export interface DownloadFlowState<T> {
  choosing: T | null
  busy: boolean
  error: string | null
}

/**
 * The steps from a Download click to the download: straight to the default folder, or through the folder browser
 * first (the setting "ask where to save each download", or Download to…). One download is added at a time, so a
 * second click while one is going adds nothing.
 */
export class DownloadFlow<T> {
  state: DownloadFlowState<T> = { choosing: null, busy: false, error: null }
  private readonly listeners = new Set<() => void>()

  constructor(private readonly options: {
    /** Adds the download; `folder` is undefined for the default one. Rejects when the device refuses. */
    start: (item: T, folder?: string) => Promise<void>
    /** Whether a plain Download opens the browser first. */
    ask: () => boolean
    /** Saves "always here, don't ask again": the folder becomes the download folder and asking is off. Rejects when refused. */
    remember: (folder: string) => Promise<void>
    /** A download added: the item, the folder chosen for it if any, and how "always here" went if it was ticked. */
    started: (item: T, folder?: string, always?: AlwaysOutcome) => void
    /** A failure with no browser open to show it in. */
    failed: (error: unknown) => void
    /** A failure as the browser shows it. */
    describe: (error: unknown) => string
  }) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getState = () => this.state

  private set(next: Partial<DownloadFlowState<T>>) {
    this.state = { ...this.state, ...next }
    for (const listener of this.listeners) listener()
  }

  /** A Download click: adds to the default folder, or opens the browser when asked to or `choose` is set. */
  async request(item: T, choose = false): Promise<void> {
    if (this.state.busy) return
    if (choose || this.options.ask()) return this.set({ choosing: item, error: null })
    this.set({ busy: true })
    let failure: { error: unknown } | null = null
    try {
      await this.options.start(item)
    } catch (error) {
      failure = { error }
    }
    this.set({ busy: false })
    if (failure) this.options.failed(failure.error)
    else this.options.started(item)
  }

  /**
   * "Download here": adds the download being chosen for to `folder`. A failure stays in the browser. With `always`, the
   * folder is then saved as the download folder with asking off, once, and only if the download was added; a refusal
   * there leaves the download added and is told with it.
   */
  async confirm(folder: string, always = false): Promise<void> {
    const { choosing, busy } = this.state
    if (choosing === null || busy || !folder.trim()) return
    this.set({ busy: true, error: null })
    try {
      await this.options.start(choosing, folder)
    } catch (error) {
      return this.set({ busy: false, error: this.options.describe(error) })
    }
    let outcome: AlwaysOutcome | undefined
    if (always) {
      try {
        await this.options.remember(folder.trim())
        outcome = { saved: true }
      } catch (error) {
        outcome = { saved: false, error: this.options.describe(error) }
      }
    }
    this.set({ busy: false, choosing: null })
    this.options.started(choosing, folder, outcome)
  }

  /** Closes the browser, adding nothing. Not while the download is being added. */
  cancel() {
    if (!this.state.busy) this.set({ choosing: null, error: null })
  }
}
