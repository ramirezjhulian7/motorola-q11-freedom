/** Q11 Freedom logo: three interconnected mesh nodes. */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none"
         xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Q11 Freedom">
      <path d="M24 9 L39 33 M24 9 L9 33 M9 33 L39 33" stroke="#22c55e"
            strokeWidth="2" strokeLinecap="round" opacity=".5" />
      <circle cx="24" cy="9" r="6" fill="#22c55e" />
      <circle cx="9" cy="33" r="5" fill="#16a34a" />
      <circle cx="39" cy="33" r="5" fill="#16a34a" />
    </svg>
  );
}
