const STAR = "M12 2.5l2.9 6.1 6.6.9-4.8 4.6 1.2 6.6L12 17.6 6.1 20.7l1.2-6.6L2.5 9.5l6.6-.9L12 2.5z"

// A solid five-point gold star for VIP guests and "primary" markers (the icon set only has
// an outlined star, whose outline breaks into dashes at small sizes).
export function GoldStar({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="#E5A914" stroke="#C48B00" strokeWidth="1" strokeLinejoin="round">
      <path d={STAR} />
    </svg>
  )
}

// The same star as an on/off toggle (primary, favourite): solid gold when on, a plain
// unbroken outline in the current text colour when off.
export function StarToggle({ active, className }: { active?: boolean; className?: string }) {
  return active ? (
    <GoldStar className={className} />
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <path d={STAR} />
    </svg>
  )
}
