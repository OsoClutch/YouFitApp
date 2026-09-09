/**
 * The catalog strip, plus the confirm step.
 *
 * Selecting and running are deliberately two taps. A single tap used to fire a
 * generation straight away, so a passer-by brushing the panel cost a full
 * inference -- real money, and a result nobody asked for.
 */
export default function GarmentBar({
  garments,
  selected,
  onSelect,
  onConfirm,
  onTryAnother,
  onBack,
  hasResult,
  busy,
  error,
}) {
  const canConfirm = selected && !busy && !hasResult

  return (
    <div className="bottom-bar">
      <div className="bottom-bar-header">
        <p className="catalog-title">Choose your look</p>
        <div className="bar-actions">
          {hasResult && (
            <button className="back-btn" onClick={onTryAnother}>
              Try Another
            </button>
          )}
          <button className="back-btn" onClick={onBack}>
            Back
          </button>
        </div>
      </div>

      <div className="outfit-carousel">
        {garments.map((item) => (
          <button
            key={item.id}
            type="button"
            className={'outfit-card' + (selected?.id === item.id ? ' selected' : '')}
            onClick={() => onSelect(item)}
            disabled={busy}
          >
            <img src={item.url} alt={item.name} className="outfit-image" />
            <span className="outfit-label">{item.label}</span>
          </button>
        ))}
      </div>

      {canConfirm && (
        <button className="confirm-btn" onClick={onConfirm}>
          Try on the {selected.name}
        </button>
      )}

      {error && <p className="bar-error">{error}</p>}
    </div>
  )
}
