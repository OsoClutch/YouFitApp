// Keep the kiosk awake.
//
// A Screen Wake Lock is released by the browser whenever the page is hidden --
// including a screensaver kicking in, which is precisely the case we are
// trying to prevent. So it has to be re-acquired on visibilitychange rather
// than taken once at startup.
//
// Returns its own teardown, so it drops straight into a useEffect.

export function setupWakeLock() {
  let sentinel = null
  let released = false

  async function acquire() {
    if (released || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return
    try {
      sentinel = await navigator.wakeLock.request('screen')
      sentinel.addEventListener('release', () => {
        sentinel = null
      })
    } catch (err) {
      // Denied on unfocused tabs and on browsers without the API. The Chrome
      // kiosk flags cover the demo path regardless.
      console.warn('Wake lock unavailable:', err?.message || err)
    }
  }

  function onVisibility() {
    if (document.visibilityState === 'visible' && !sentinel) acquire()
  }

  acquire()
  document.addEventListener('visibilitychange', onVisibility)

  return () => {
    released = true
    document.removeEventListener('visibilitychange', onVisibility)
    sentinel?.release().catch(() => {})
    sentinel = null
  }
}
