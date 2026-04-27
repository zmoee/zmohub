export default function Loading() {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-white/95 backdrop-blur-sm">
      <div className="relative flex items-center justify-center">
        <div className="h-14 w-14 rounded-full border-4 border-gray-200 border-t-black animate-spin" />
        <div className="absolute h-6 w-6 rounded-full bg-white" />
      </div>
    </div>
  );
}
