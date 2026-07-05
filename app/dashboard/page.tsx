import FileUpload from "@/components/ui/fileupload";
import LogoutButton from "@/components/LogoutButton";

export default function UploadPage() {
  return (
    <main className="upload-page">
      <div className="bg-orb orb-1" />
      <div className="bg-orb orb-2" />
      <div className="bg-orb orb-3" />

      <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 50 }}>
        <LogoutButton className="px-4 py-2 bg-red-600/80 hover:bg-red-600 text-white rounded-lg text-sm font-medium" />
      </div>

      <div className="upload-page-inner">
        <FileUpload />
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

        .upload-page {
          min-height: 100vh;
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #0a0b0f;
          font-family: 'Inter', sans-serif;
          padding: 24px;
          box-sizing: border-box;
          position: relative;
          overflow: hidden;
        }

        /* Ambient background orbs */
        .bg-orb {
          position: absolute;
          border-radius: 50%;
          filter: blur(120px);
          pointer-events: none;
          z-index: 0;
        }
        .orb-1 {
          width: 600px;
          height: 600px;
          background: radial-gradient(circle, rgba(99, 102, 241, 0.18) 0%, transparent 70%);
          top: -150px;
          left: -100px;
        }
        .orb-2 {
          width: 500px;
          height: 500px;
          background: radial-gradient(circle, rgba(139, 92, 246, 0.14) 0%, transparent 70%);
          bottom: -100px;
          right: -80px;
        }
        .orb-3 {
          width: 400px;
          height: 400px;
          background: radial-gradient(circle, rgba(59, 130, 246, 0.10) 0%, transparent 70%);
          top: 40%;
          left: 50%;
          transform: translateX(-50%);
        }

        .upload-page-inner {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 1200px;
          display: flex;
          flex-direction: column;
          align-items: stretch;
        }

        /* Override FileUpload container to fill space */
        .upload-page-inner > * {
          width: 100%;
        }
      `}</style>
    </main>
  );
}