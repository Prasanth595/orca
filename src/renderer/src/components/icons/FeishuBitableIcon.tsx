// Why: Feishu Bitable's product mark is a cell grid; flattened to match
// Orca's monochrome provider icons instead of a branded tile. Referenced from
// settings and the Tasks page, so a single source avoids path drift.
export function FeishuBitableIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <path
        fillRule="evenodd"
        d="M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm1 2v3h6V6H5Zm8 0v3h6V6h-6ZM5 11v3h6v-3H5Zm8 0v3h6v-3h-6ZM5 16v2h6v-2H5Zm8 0v2h6v-2h-6Z"
      />
    </svg>
  )
}
