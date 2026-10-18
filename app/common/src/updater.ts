/** @file Types shared by the Electron updater and the GUI's update dialog. */

/** `auto`: the app updates itself. `manual`: it only links to the download (dev, unsigned macOS, …). */
export type UpdateMode = 'auto' | 'manual'

/** Where an automatic update has got to. */
export type UpdateStatus =
  | { readonly state: 'idle' }
  | { readonly state: 'checking' }
  | { readonly state: 'none' }
  | {
      readonly state: 'available'
      readonly version: string
      readonly releaseDate: string
    }
  | {
      readonly state: 'downloading'
      readonly version: string
      readonly percent: number
    }
  | { readonly state: 'ready'; readonly version: string }
  | {
      readonly state: 'error'
      readonly message: string
      readonly version: string | null
    }
