// A solid five-point gold star for VIP guests (the icon set only has an outlined one).
export function GoldStar({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="#E5A914" stroke="#C48B00" strokeWidth="1" strokeLinejoin="round">
      <path d="M12 2.5l2.9 6.1 6.6.9-4.8 4.6 1.2 6.6L12 17.6 6.1 20.7l1.2-6.6L2.5 9.5l6.6-.9L12 2.5z" />
    </svg>
  )
}
