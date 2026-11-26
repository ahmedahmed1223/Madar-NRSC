interface Props {
  message: string;
  action?: { label: string; run: () => void };
}

/** A filtered list can offer a way back to its records, alongside the reason it is empty. */
export function ListEmptyState({ message, action }: Props) {
  return (
    <div className="col-span-full flex flex-col items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-6 text-center sm:py-8">
      <p role="status" className="text-sm font-semibold text-slate-700">{message}</p>
      {action && (
        <button type="button" onClick={action.run} className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-blue-700 hover:border-blue-400 hover:bg-blue-50">
          {action.label}
        </button>
      )}
    </div>
  );
}
