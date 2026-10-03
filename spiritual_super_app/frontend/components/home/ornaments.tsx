export function Mandala({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 200 200"
      className={`pointer-events-none absolute text-[#d9bd7a] ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="0.8"
      aria-hidden
    >
      <circle cx="100" cy="100" r="28" />
      <circle cx="100" cy="100" r="44" strokeDasharray="2 4" />
      <circle cx="100" cy="100" r="92" />
      {Array.from({ length: 16 }, (_, i) => (
        <path key={i} transform={`rotate(${i * 22.5} 100 100)`} d="M100 56c10 10 12 22 0 34-12-12-10-24 0-34Z" />
      ))}
      {Array.from({ length: 24 }, (_, i) => (
        <path key={`o${i}`} transform={`rotate(${i * 15} 100 100)`} d="M100 8c6 8 6 16 0 24-6-8-6-16 0-24Z" />
      ))}
    </svg>
  );
}

export function LotusMark({ className = 'h-3 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 14" className={className} fill="currentColor" aria-hidden>
      <path d="M12 1c1.8 2 2.6 4.4 2.6 6.6 0 2.4-1.1 4.3-2.6 5.4-1.5-1.1-2.6-3-2.6-5.4C9.4 5.4 10.2 3 12 1Z" />
      <path
        d="M3 5.5c3.1.2 5.7 1.7 7 4 .6 1 .9 2.2 1 3.5-2.9-.2-5.6-1.4-7-3.6C3.4 8.4 3.1 7 3 5.5Zm18 0c-.1 1.5-.4 2.9-1 3.9-1.4 2.2-4.1 3.4-7 3.6.1-1.3.4-2.5 1-3.5 1.3-2.3 3.9-3.8 7-4Z"
        opacity=".75"
      />
    </svg>
  );
}

export function LotusRule() {
  return (
    <div className="flex items-center gap-2 text-[#c9a24a]" aria-hidden>
      <span className="h-px w-6 bg-current opacity-60" />
      <LotusMark />
      <span className="h-px w-16 bg-gradient-to-r from-current to-transparent opacity-60" />
    </div>
  );
}
