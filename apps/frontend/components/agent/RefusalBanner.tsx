import { AlertTriangle } from 'lucide-react'

interface Props {
  refusals: string[]
}

export default function RefusalBanner({ refusals }: Props) {
  if (!refusals || refusals.length === 0) return null

  return (
    <div className="mt-3 flex items-start gap-3 border border-amber-200 bg-amber-50 p-3 text-amber-800">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
      <div className="text-xs font-semibold leading-5">
        <span className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-amber-600">
          Notice / refusal:{' '}
        </span>
        {refusals.join(' / ')}
      </div>
    </div>
  )
}
