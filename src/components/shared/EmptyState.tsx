export default function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-16 text-slate-400 text-sm border border-dashed border-slate-200 rounded-lg">
      {message}
    </div>
  );
}
