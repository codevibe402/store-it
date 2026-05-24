"use client";

import { useRouter } from "next/navigation";

export default function LandingPage() {
  const router = useRouter();

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:ital,wght@0,300;0,400;0,500;1,300&display=swap');

        :root {
          --cream: #FAF8F4;
          --white: #FFFFFF;
          --ink: #1A1612;
          --ink-light: #5C5550;
          --amber: #F5A623;
          --amber-dark: #D4891A;
          --amber-pale: #FEF3DC;
          --teal: #0F7B6C;
          --teal-light: #E8F5F3;
          --border: #E8E4DE;
          --shadow: 0 4px 24px rgba(26,22,18,0.08);
          --shadow-lg: 0 12px 48px rgba(26,22,18,0.14);
        }

        html { scroll-behavior: smooth; }
        body {
          font-family: 'DM Sans', sans-serif;
          background: var(--cream);
          color: var(--ink);
          overflow-x: hidden;
          margin: 0;
        }
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .si-nav {
          position: fixed; top: 0; left: 0; right: 0; z-index: 100;
          display: flex; align-items: center; justify-content: space-between;
          padding: 0 5%; height: 68px;
          background: rgba(250,248,244,0.88);
          backdrop-filter: blur(12px);
          border-bottom: 1px solid var(--border);
          animation: fadeDown 0.6s ease both;
        }
        .si-nav-logo {
          display: flex; align-items: center; gap: 10px;
          font-family: 'Syne', sans-serif; font-weight: 800; font-size: 1.35rem;
          color: var(--ink); text-decoration: none;
        }
        .si-logo-icon {
          width: 34px; height: 34px; background: var(--ink); border-radius: 8px;
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        }
        .si-nav-links { display: flex; align-items: center; gap: 32px; list-style: none; }
        .si-nav-links a {
          font-size: 0.9rem; font-weight: 500; color: var(--ink-light);
          text-decoration: none; transition: color 0.2s; cursor: pointer;
        }
        .si-nav-links a:hover { color: var(--ink); }
        .si-nav-cta {
          background: var(--ink); color: #fff; padding: 9px 22px; border-radius: 8px;
          font-weight: 600; border: none; cursor: pointer;
          font-family: 'DM Sans', sans-serif; font-size: 0.9rem;
          transition: background 0.2s, transform 0.15s;
        }
        .si-nav-cta:hover { background: var(--teal); transform: translateY(-1px); }

        .si-hero {
          min-height: 100vh; display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          text-align: center; padding: 100px 5% 60px;
          position: relative; overflow: hidden;
        }
        .si-hero-bg {
          position: absolute; inset: 0; z-index: 0; pointer-events: none;
          background:
            radial-gradient(ellipse 60% 50% at 70% 20%, rgba(245,166,35,0.13) 0%, transparent 70%),
            radial-gradient(ellipse 50% 40% at 20% 80%, rgba(15,123,108,0.10) 0%, transparent 70%);
        }
        .si-hero-badge {
          display: inline-flex; align-items: center; gap: 8px;
          background: var(--amber-pale); border: 1px solid rgba(245,166,35,0.35);
          border-radius: 100px; padding: 6px 16px;
          font-size: 0.8rem; font-weight: 500; color: var(--amber-dark);
          margin-bottom: 28px; position: relative; z-index: 1;
          animation: fadeUp 0.7s 0.1s ease both;
        }
        .si-badge-dot {
          width: 7px; height: 7px; background: var(--amber);
          border-radius: 50%; animation: pulse 2s infinite;
        }
        .si-h1 {
          font-family: 'Syne', sans-serif; font-size: clamp(2.8rem, 7vw, 6rem);
          font-weight: 800; line-height: 1.05; color: var(--ink); max-width: 820px;
          position: relative; z-index: 1; animation: fadeUp 0.7s 0.2s ease both;
        }
        .si-h1-em { font-style: normal; color: var(--teal); position: relative; }
        .si-h1-em::after {
          content: ''; position: absolute; left: 0; bottom: 4px; right: 0; height: 4px;
          background: var(--amber); border-radius: 2px;
          transform: scaleX(0); transform-origin: left;
          animation: lineIn 0.6s 0.8s ease forwards;
        }
        .si-hero-sub {
          font-size: 1.15rem; font-weight: 300; color: var(--ink-light);
          max-width: 520px; margin: 24px auto 40px; line-height: 1.7;
          position: relative; z-index: 1; animation: fadeUp 0.7s 0.3s ease both;
        }
        .si-hero-actions {
          display: flex; gap: 14px; justify-content: center; flex-wrap: wrap;
          position: relative; z-index: 1; animation: fadeUp 0.7s 0.4s ease both;
        }
        .si-btn-primary {
          display: inline-flex; align-items: center; gap: 8px;
          background: var(--ink); color: #fff; padding: 14px 30px; border-radius: 10px;
          font-family: 'DM Sans', sans-serif; font-size: 0.95rem; font-weight: 600;
          border: none; cursor: pointer;
          transition: background 0.2s, transform 0.15s, box-shadow 0.2s;
          box-shadow: 0 4px 16px rgba(26,22,18,0.18);
        }
        .si-btn-primary:hover {
          background: var(--teal); transform: translateY(-2px);
          box-shadow: 0 8px 24px rgba(15,123,108,0.25);
        }
        .si-btn-secondary {
          display: inline-flex; align-items: center; gap: 8px;
          background: var(--white); color: var(--ink); padding: 14px 30px; border-radius: 10px;
          font-family: 'DM Sans', sans-serif; font-size: 0.95rem; font-weight: 500;
          text-decoration: none; border: 1.5px solid var(--border); cursor: pointer;
          transition: border-color 0.2s, transform 0.15s, box-shadow 0.2s;
        }
        .si-btn-secondary:hover { border-color: var(--ink); transform: translateY(-2px); box-shadow: var(--shadow); }

        .si-hero-mockup {
          position: relative; z-index: 1; margin-top: 64px; width: 100%; max-width: 860px;
          animation: fadeUp 0.8s 0.5s ease both;
        }
        .si-mockup-card {
          background: var(--white); border-radius: 18px;
          border: 1px solid var(--border); box-shadow: var(--shadow-lg); overflow: hidden;
        }
        .si-mockup-bar {
          background: #F2EFE9; padding: 13px 18px;
          display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--border);
        }
        .si-dot { width: 11px; height: 11px; border-radius: 50%; }
        .si-dot-red { background: #FF5F56; }
        .si-dot-yellow { background: #FFBD2E; }
        .si-dot-green { background: #27C93F; }
        .si-mockup-body { display: grid; grid-template-columns: 200px 1fr; min-height: 280px; }
        .si-mockup-sidebar { background: #F7F5F0; border-right: 1px solid var(--border); padding: 20px 14px; }
        .si-sidebar-item {
          display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 8px;
          font-size: 0.82rem; font-weight: 500; color: var(--ink-light); margin-bottom: 3px;
          cursor: pointer; transition: background 0.15s;
        }
        .si-sidebar-item:hover { background: var(--border); color: var(--ink); }
        .si-sidebar-item.active { background: var(--amber-pale); color: var(--amber-dark); }
        .si-mockup-main { padding: 20px; }
        .si-file-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
        .si-file-card {
          background: var(--cream); border: 1px solid var(--border); border-radius: 10px;
          padding: 14px 12px; transition: box-shadow 0.2s, transform 0.15s; cursor: pointer;
        }
        .si-file-card:hover { box-shadow: var(--shadow); transform: translateY(-2px); }
        .si-file-icon {
          width: 36px; height: 36px; border-radius: 8px;
          display: flex; align-items: center; justify-content: center;
          margin-bottom: 10px; font-size: 1.1rem;
        }
        .si-fi-img { background: #FEE4E2; }
        .si-fi-doc { background: #E0F2FE; }
        .si-fi-vid { background: #F3E8FF; }
        .si-fi-zip { background: var(--amber-pale); }
        .si-fi-pdf { background: #FCE7F3; }
        .si-fi-code { background: var(--teal-light); }
        .si-file-name { font-size: 0.78rem; font-weight: 500; color: var(--ink); margin-bottom: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .si-file-meta { font-size: 0.7rem; color: var(--ink-light); }

        .si-features { padding: 100px 5%; max-width: 1100px; margin: 0 auto; }
        .si-section-label {
          font-size: 0.78rem; font-weight: 600; letter-spacing: 0.12em;
          text-transform: uppercase; color: var(--teal); margin-bottom: 14px;
        }
        .si-section-title {
          font-family: 'Syne', sans-serif; font-size: clamp(1.8rem, 4vw, 2.8rem);
          font-weight: 700; line-height: 1.15; color: var(--ink); max-width: 560px; margin-bottom: 60px;
        }
        .si-features-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
        .si-feat-card {
          background: var(--white); border: 1px solid var(--border); border-radius: 16px;
          padding: 32px 28px; transition: box-shadow 0.2s, transform 0.2s, border-color 0.2s;
          position: relative; overflow: hidden;
        }
        .si-feat-card::before {
          content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px;
          background: var(--amber); transform: scaleX(0); transform-origin: left; transition: transform 0.3s ease;
        }
        .si-feat-card:hover { box-shadow: var(--shadow-lg); transform: translateY(-4px); border-color: var(--amber); }
        .si-feat-card:hover::before { transform: scaleX(1); }
        .si-feat-icon {
          width: 48px; height: 48px; border-radius: 12px;
          display: flex; align-items: center; justify-content: center;
          margin-bottom: 20px; font-size: 1.4rem; background: var(--cream);
        }
        .si-feat-title { font-family: 'Syne', sans-serif; font-size: 1.05rem; font-weight: 700; color: var(--ink); margin-bottom: 10px; }
        .si-feat-desc { font-size: 0.9rem; font-weight: 300; color: var(--ink-light); line-height: 1.65; }

        .si-stats-band { background: var(--ink); padding: 60px 5%; }
        .si-stats-inner {
          max-width: 1000px; margin: 0 auto;
          display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; text-align: center;
        }
        .si-stat-num {
          font-family: 'Syne', sans-serif; font-size: 2.6rem; font-weight: 800;
          color: var(--amber); line-height: 1; margin-bottom: 8px;
        }
        .si-stat-label { font-size: 0.88rem; color: rgba(255,255,255,0.6); font-weight: 300; }

        .si-cta-section { padding: 100px 5%; text-align: center; }
        .si-cta-box {
          background: var(--teal); border-radius: 24px; padding: 72px 40px;
          max-width: 760px; margin: 0 auto; position: relative; overflow: hidden;
        }
        .si-cta-box::before {
          content: ''; position: absolute; top: -60px; right: -60px;
          width: 220px; height: 220px; background: rgba(255,255,255,0.07);
          border-radius: 50%; pointer-events: none;
        }
        .si-cta-box::after {
          content: ''; position: absolute; bottom: -40px; left: -40px;
          width: 160px; height: 160px; background: rgba(255,255,255,0.05);
          border-radius: 50%; pointer-events: none;
        }
        .si-cta-title {
          font-family: 'Syne', sans-serif; font-size: clamp(1.8rem, 4vw, 2.6rem);
          font-weight: 800; color: #fff; margin-bottom: 16px; position: relative; z-index: 1;
        }
        .si-cta-sub {
          color: rgba(255,255,255,0.72); font-size: 1rem; max-width: 420px;
          margin: 0 auto 36px; font-weight: 300; line-height: 1.65; position: relative; z-index: 1;
        }
        .si-btn-white {
          display: inline-flex; align-items: center; gap: 10px;
          background: #fff; color: var(--teal); padding: 15px 34px; border-radius: 10px;
          font-family: 'DM Sans', sans-serif; font-size: 0.95rem; font-weight: 700;
          border: none; cursor: pointer; transition: transform 0.15s, box-shadow 0.2s;
          box-shadow: 0 4px 20px rgba(0,0,0,0.15); position: relative; z-index: 1;
        }
        .si-btn-white:hover { transform: translateY(-2px); box-shadow: 0 8px 30px rgba(0,0,0,0.2); }

        .si-footer {
          border-top: 1px solid var(--border); padding: 32px 5%;
          display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px;
        }
        .si-footer-logo { font-family: 'Syne', sans-serif; font-weight: 800; font-size: 1.1rem; color: var(--ink); }
        .si-footer-copy { font-size: 0.82rem; color: var(--ink-light); }

        @keyframes fadeDown { from { opacity: 0; transform: translateY(-16px); } to { opacity: 1; transform: none; } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: none; } }
        @keyframes lineIn { from { transform: scaleX(0); } to { transform: scaleX(1); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

        @media (max-width: 768px) {
          .si-features-grid { grid-template-columns: 1fr; }
          .si-stats-inner { grid-template-columns: repeat(2, 1fr); }
          .si-mockup-body { grid-template-columns: 1fr; }
          .si-mockup-sidebar { display: none; }
          .si-file-grid { grid-template-columns: repeat(2, 1fr); }
          .si-nav-links { display: none; }
        }
      `}</style>

      {/* NAV */}
      <nav className="si-nav">
        <a href="#" className="si-nav-logo">
          <div className="si-logo-icon">
            <svg viewBox="0 0 18 18" width="18" height="18" fill="none">
              <rect x="2" y="5" width="14" height="10" rx="2" fill="white" opacity="0.9" />
              <rect x="2" y="3" width="6" height="3" rx="1.5" fill="white" />
            </svg>
          </div>
          StoreIt
        </a>
        <ul className="si-nav-links">
          <li><a href="#features">Features</a></li>
          <li><a href="#pricing">Pricing</a></li>
          <li><a href="#about">About</a></li>
          <li>
            {/* Routes to /sign-in → (auth)/sign_in/page.tsx → renders AuthLayout + Authform */}
            <button className="si-nav-cta" onClick={() => router.push("/sign_in")}>
              Log In
            </button>
          </li>
        </ul>
      </nav>

      {/* HERO */}
      <section className="si-hero">
        <div className="si-hero-bg" />
        <div className="si-hero-badge">
          <span className="si-badge-dot" />
          Now with real-time collaboration
        </div>
        <h1 className="si-h1">
          Your files, <em className="si-h1-em">organised</em>
          <br />and always within reach.
        </h1>
        <p className="si-hero-sub">
          StoreIt is a blazing-fast file storage platform. Upload, share, and access everything from anywhere — securely and instantly.
        </p>
        <div className="si-hero-actions">
          {/* Routes to /sign-up → (auth)/sign_up/page.tsx → renders AuthLayout + Authform */}
          <button className="si-btn-primary" onClick={() => router.push("/sign_up")}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 1v10M3 6l5 5 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M1 13h14" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            Get Started Free
          </button>
          <a href="#features" className="si-btn-secondary">
            See Features
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 7h10M7 2l5 5-5 5" stroke="#1A1612" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        </div>

        {/* Mockup */}
        <div className="si-hero-mockup">
          <div className="si-mockup-card">
            <div className="si-mockup-bar">
              <div className="si-dot si-dot-red" />
              <div className="si-dot si-dot-yellow" />
              <div className="si-dot si-dot-green" />
            </div>
            <div className="si-mockup-body">
              <div className="si-mockup-sidebar">
                {[
                  { icon: "🗂️", label: "All Files", active: true },
                  { icon: "📄", label: "Documents" },
                  { icon: "🖼️", label: "Images" },
                  { icon: "🎬", label: "Videos" },
                  { icon: "🔗", label: "Shared" },
                  { icon: "🗑️", label: "Trash" },
                ].map((item) => (
                  <div key={item.label} className={`si-sidebar-item${item.active ? " active" : ""}`}>
                    {item.icon}&nbsp;&nbsp;{item.label}
                  </div>
                ))}
              </div>
              <div className="si-mockup-main">
                <div className="si-file-grid">
                  {[
                    { icon: "🖼️", cls: "si-fi-img", name: "design-v3.png",    size: "2.4 MB" },
                    { icon: "📝", cls: "si-fi-doc", name: "report_Q4.docx",   size: "540 KB" },
                    { icon: "🎬", cls: "si-fi-vid", name: "intro.mp4",         size: "48 MB"  },
                    { icon: "📕", cls: "si-fi-pdf", name: "invoice_jan.pdf",   size: "120 KB" },
                    { icon: "💻", cls: "si-fi-code",name: "source.zip",        size: "8.1 MB" },
                    { icon: "📦", cls: "si-fi-zip", name: "assets_v2.zip",     size: "15 MB"  },
                  ].map((f) => (
                    <div key={f.name} className="si-file-card">
                      <div className={`si-file-icon ${f.cls}`}>{f.icon}</div>
                      <div className="si-file-name">{f.name}</div>
                      <div className="si-file-meta">{f.size}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="si-features" id="features">
        <div className="si-section-label">What we offer</div>
        <div className="si-section-title">Everything you need to store and share with confidence.</div>
        <div className="si-features-grid">
          {[
            { icon: "🔒", title: "End-to-End Encryption",  desc: "Your files are encrypted in transit and at rest. Only you (and who you share with) can ever see them." },
            { icon: "⚡", title: "Lightning Uploads",       desc: "Multi-part parallel uploads and smart CDN delivery mean files arrive in seconds, not minutes." },
            { icon: "🔗", title: "Instant Share Links",     desc: "Generate a shareable link in one click — set expiry dates, passwords, or access limits anytime." },
            { icon: "🌐", title: "Access Anywhere",         desc: "Web, mobile, desktop — your files follow you. Offline sync keeps essentials available without connectivity." },
            { icon: "🗂️", title: "Smart Organisation",     desc: "Auto-tagging, folders, filters, and full-text search across every document you've ever stored." },
            { icon: "👥", title: "Team Collaboration",      desc: "Invite teammates, assign permissions, comment on files, and work together in real time." },
          ].map((f) => (
            <div key={f.title} className="si-feat-card">
              <div className="si-feat-icon">{f.icon}</div>
              <div className="si-feat-title">{f.title}</div>
              <div className="si-feat-desc">{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

    

      {/* CTA */}
      <section className="si-cta-section" id="pricing">
        <div className="si-cta-box">
          <div className="si-cta-title">Start storing smarter today.</div>
          <div className="si-cta-sub">Free forever for personal use. No credit card needed. Upgrade anytime as your team grows.</div>
          <button className="si-btn-white" onClick={() => router.push("/sign_up")}>
            Create your free account
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 8h10M8 3l5 5-5 5" stroke="#0F7B6C" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="si-footer">
        <div className="si-footer-logo">StoreIt</div>
        <div className="si-footer-copy">© 2026 StoreIt. All rights reserved.</div>
      </footer>
    </>
  );
}
