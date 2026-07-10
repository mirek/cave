import { useRef, type ChangeEventHandler, type UIEventHandler } from 'react'
import { CaveCode } from './CaveCode.tsx'

export const CaveEditor = ({
  value,
  onChange,
  ariaLabel,
}: {
  value: string
  onChange: ChangeEventHandler<HTMLTextAreaElement>
  ariaLabel: string
}) => {
  const mirror = useRef<HTMLPreElement>(null)
  const syncScroll: UIEventHandler<HTMLTextAreaElement> = event => {
    if (mirror.current === null) return
    mirror.current.scrollTop = event.currentTarget.scrollTop
    mirror.current.scrollLeft = event.currentTarget.scrollLeft
  }

  return (
    <div className="cave-editor">
      <pre ref={mirror} aria-hidden="true"><CaveCode code={value} />{value.endsWith('\n') ? ' ' : null}</pre>
      <textarea
        value={value}
        onChange={onChange}
        onScroll={syncScroll}
        spellCheck={false}
        wrap="off"
        aria-label={ariaLabel}
      />
    </div>
  )
}
