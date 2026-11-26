export default function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#060d1a] text-slate-200 p-6">
      <div className="flex flex-col items-center gap-3">
        <div className="h-10 w-10 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
        <p className="text-xs text-slate-400">
          Carregando Command Center Konnexy Ads...
        </p>
      </div>
    </div>
  );
}
