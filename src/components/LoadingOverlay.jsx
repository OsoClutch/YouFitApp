/**
 * Shown while a generation is in flight.
 *
 * The queue position comes from fal via our poll route. It exists because the
 * job-shaped API makes it available for free, and a kiosk spinner with no
 * information is the thing people walk away from.
 */
export default function LoadingOverlay({ status, queuePosition, garmentName }) {
  const waiting = status === 'IN_QUEUE' && typeof queuePosition === 'number'

  return (
    <div className="loading-overlay">
      <div className="loading-spinner" />
      <p className="loading-text">Styling your look...</p>
      {garmentName && <p className="loading-sub">{garmentName}</p>}
      {waiting && (
        <p className="loading-sub">
          {queuePosition === 0 ? 'Starting now' : `Queue position ${queuePosition}`}
        </p>
      )}
    </div>
  )
}
