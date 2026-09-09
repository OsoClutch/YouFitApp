import { FRAMING_HINTS } from '../lib/useFramingGuide'

/**
 * The silhouette overlay on the attract screen.
 *
 * `region` is the slice of the visible frame that will actually be sent for
 * inference, so the box is not decoration -- standing inside it is the whole
 * instruction. Person framing is the largest remaining lever on fit now that
 * FASHN's maskless mode has removed masking as a failure mode.
 */
export default function FramingGuide({ region, verdict, dimmed }) {
  const hint = FRAMING_HINTS[verdict] || 'Step into frame'
  const good = verdict === 'ready'

  const style = region
    ? {
        left: `${region.left * 100}%`,
        top: `${region.top * 100}%`,
        width: `${region.width * 100}%`,
        height: `${region.height * 100}%`,
      }
    : { left: '5%', top: '8%', width: '90%', height: '84%' }

  return (
    <div className={'framing-guide' + (dimmed ? ' dimmed' : '')} style={style} aria-hidden="true">
      <svg className="framing-silhouette" viewBox="0 0 200 300" preserveAspectRatio="xMidYMid meet">
        {/* Head, shoulders, torso to mid-thigh -- the region the model sees. */}
        <circle cx="100" cy="46" r="26" />
        <path d="M100 74 C74 74 56 88 50 112 L38 186 L62 194 L70 258 L130 258 L138 194 L162 186 L150 112 C144 88 126 74 100 74 Z" />
        {/* Arms at the sides, which is what the hint asks for. */}
        <path d="M50 112 L30 190 L44 194" />
        <path d="M150 112 L170 190 L156 194" />
      </svg>
      <p className={'framing-hint' + (good ? ' good' : '')}>{hint}</p>
    </div>
  )
}
