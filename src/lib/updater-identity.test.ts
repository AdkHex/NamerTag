import { describe, expect, it } from 'vitest'
import tauriConfig from '../../src-tauri/tauri.conf.json'

/**
 * Windows identifies an installed app by the MSI UpgradeCode. Tauri derives that code from
 * `<productName>.exe.app.x64`, so renaming the product silently changes it — Windows then
 * treats the next update as a *different* app, installs it alongside the old one, and the
 * original shortcut keeps launching the stale build. It reports an update forever.
 *
 * That happened once (NamerTag -> NameTagger in 1.8.0). These lock the fix in place.
 */
describe('Windows update identity', () => {
  // Derived from the ORIGINAL product name, "NamerTag". Every installed copy keys off this.
  const PINNED_UPGRADE_CODE = '4761b9dc-b542-5db3-a2d7-e4d14a325527'

  it('pins the MSI upgrade code explicitly', () => {
    expect(tauriConfig.bundle?.windows?.wix?.upgradeCode).toBe(
      PINNED_UPGRADE_CODE
    )
  })

  it('keeps the bundle identifier stable', () => {
    // The identifier is the app's identity to the OS; changing it strands existing installs.
    expect(tauriConfig.identifier).toBe('com.adkhex.namertag')
  })
})
