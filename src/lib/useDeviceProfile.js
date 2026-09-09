import { useEffect, useState } from 'react'
import { getDeviceProfile } from './device'

/**
 * The device profile, re-evaluated on resize and orientation change.
 *
 * Continuous rather than read-once: the app has to be right on a phone rotated
 * mid-session as well as on a Proto that never moves.
 */
export function useDeviceProfile() {
  const [profile, setProfile] = useState(() => getDeviceProfile())

  useEffect(() => {
    let frame = 0
    const onResize = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setProfile(getDeviceProfile()))
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
  }, [])

  return profile
}
