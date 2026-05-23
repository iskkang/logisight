export default function LoadingState({ text }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-400">
      <div className="w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin mb-3" />
      <p className="text-sm">{text ?? 'Loading...'}</p>
    </div>
  );
}
