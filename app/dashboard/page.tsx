import FileUpload from "@/components/ui/fileupload";
import LogoutButton from "@/components/LogoutButton";

export default function UploadPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0a0b0f] px-6 py-10">
      {/* Background Orbs */}
      <div className="absolute -top-40 -left-32 h-[600px] w-[600px] rounded-full bg-indigo-500/20 blur-[120px]" />
      <div className="absolute -bottom-28 -right-20 h-[500px] w-[500px] rounded-full bg-violet-500/15 blur-[120px]" />
      <div className="absolute left-1/2 top-1/2 h-[400px] w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500/10 blur-[120px]" />

      <div className="relative z-10 mx-auto flex w-full max-w-7xl flex-col gap-8">

        {/* Top Bar */}
        <header className="flex items-center justify-between">
          <h1 className="bg-gradient-to-r from-white to-indigo-400 bg-clip-text text-3xl font-bold tracking-tight text-transparent">
            StoreIt
          </h1>

          <LogoutButton className="rounded-lg border border-red-400/20 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition hover:bg-red-500/20" />
        </header>

        {/* Upload Component */}
        <div className="w-full">
          <FileUpload />
        </div>

      </div>
    </main>
  );
}