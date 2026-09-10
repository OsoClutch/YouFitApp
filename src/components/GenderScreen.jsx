/**
 * The attract screen. Camera runs live behind it, with the framing guide on
 * top, so people are already standing correctly by the time they pick.
 */
export default function GenderScreen({ onPick, error, cameraReady, framingHint, framingReady }) {
  return (
    <div className="gender-screen">
      <div className="gender-screen-top">
        <h1 className="youfit-title">YOUFIT</h1>
        <p className="youfit-sub">Holographic AI Try-On</p>
      </div>

      <div className="gender-screen-bottom">
        {error && <p className="error-banner">{error}</p>}
        {!error && !cameraReady && <p className="prompt-text">Starting camera...</p>}
        {/* Grouped with the other instructions rather than floated over the
            camera, so it can never land on top of the buttons. */}
        {!error && framingHint && (
          <p className={'framing-hint' + (framingReady ? ' good' : '')}>{framingHint}</p>
        )}
        <p className="prompt-text">Who is shopping today?</p>
        <div className="gender-buttons">
          <button className="gender-btn" onClick={() => onPick('male')}>
            Men
          </button>
          <button className="gender-btn" onClick={() => onPick('female')}>
            Women
          </button>
        </div>
      </div>
    </div>
  )
}
