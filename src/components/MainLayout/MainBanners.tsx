interface Props {
  hookActivity: string | null
  rateLimit: string | null
  turnError: string | null
  onDismissRateLimit: () => void
}

/**
 * Slim row of transient status banners that sit between the header and
 * the main panel group. Each banner shows iff its source state is set;
 * order matches the original rendering: hook → rate-limit → turn-error.
 */
export function MainBanners({
  hookActivity,
  rateLimit,
  turnError,
  onDismissRateLimit,
}: Props) {
  return (
    <div className="app__banners">
      {hookActivity && (
        <div className="app__hook-banner">⚙ {hookActivity}</div>
      )}
      {rateLimit && (
        <div className="app__rate-limit-banner" role="alert">
          <span>⚠ {rateLimit}</span>
          <button
            type="button"
            className="app__rate-limit-dismiss"
            onClick={onDismissRateLimit}
          >
            닫기
          </button>
        </div>
      )}
      {turnError && (
        <div className="app__turn-error-banner" role="status">
          <span>⚠ {turnError}</span>
        </div>
      )}
    </div>
  )
}
