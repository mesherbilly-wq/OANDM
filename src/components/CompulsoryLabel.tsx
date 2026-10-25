/** Red label shown beside a handover document when Required is checked. */
export function CompulsoryLabel({ show = true }: { show?: boolean }) {
  if (!show) return null;
  return (
    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-700 bg-red-50 border border-red-200">
      Compulsory
    </span>
  );
}
