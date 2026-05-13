import Link from "next/link";

const AuthLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <main className="auth-page">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

        .auth-page {
          min-height: 100vh;
          background:
            linear-gradient(135deg, rgba(15, 123, 108, 0.10), transparent 32%),
            linear-gradient(315deg, rgba(245, 166, 35, 0.12), transparent 36%),
            #f6f3ee;
          color: #18140f;
          font-family: 'Inter', sans-serif;
          display: grid;
          place-items: center;
          padding: 24px;
        }

        .auth-shell {
          width: min(1040px, 100%);
          min-height: 660px;
          display: grid;
          grid-template-columns: 0.95fr 1.05fr;
          background: #fffdfa;
          border: 1px solid #e6ded2;
          border-radius: 28px;
          overflow: hidden;
          box-shadow: 0 24px 80px rgba(24, 20, 15, 0.13);
        }

        .auth-side {
          background: #15120e;
          color: #fffdfa;
          padding: 36px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          position: relative;
          overflow: hidden;
        }

        .auth-side::before {
          content: "";
          position: absolute;
          inset: auto -80px -90px auto;
          width: 260px;
          height: 260px;
          border-radius: 50%;
          background: rgba(15, 123, 108, 0.34);
        }

        .auth-brand {
          display: inline-flex;
          align-items: center;
          gap: 12px;
          color: inherit;
          text-decoration: none;
          font-weight: 800;
          font-size: 1.3rem;
          position: relative;
          z-index: 1;
        }

        .auth-brand-mark {
          width: 42px;
          height: 42px;
          border-radius: 12px;
          background: #fffdfa;
          display: grid;
          place-items: center;
        }

        .auth-copy {
          position: relative;
          z-index: 1;
          max-width: 360px;
        }

        .auth-eyebrow {
          color: #f5a623;
          font-size: 0.78rem;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          margin-bottom: 18px;
        }

        .auth-copy h1 {
          font-size: clamp(2.2rem, 5vw, 4rem);
          line-height: 1;
          letter-spacing: 0;
          margin: 0;
        }

        .auth-copy p {
          color: rgba(255,253,250,0.68);
          line-height: 1.65;
          margin: 20px 0 0;
          font-size: 0.98rem;
        }

        .auth-highlights {
          position: relative;
          z-index: 1;
          display: grid;
          gap: 10px;
        }

        .auth-highlight {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          border: 1px solid rgba(255,253,250,0.12);
          background: rgba(255,253,250,0.06);
          border-radius: 14px;
          padding: 12px 14px;
          color: rgba(255,253,250,0.74);
          font-size: 0.86rem;
        }

        .auth-highlight strong {
          color: #fffdfa;
          font-size: 0.78rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }

        .auth-form-wrap {
          padding: 48px;
          display: flex;
          flex-direction: column;
          justify-content: center;
          background:
            linear-gradient(180deg, rgba(255,255,255,0.78), rgba(255,255,255,0.96)),
            #fffdfa;
        }

        .auth-form-top {
          display: flex;
          justify-content: flex-end;
          margin-bottom: 34px;
        }

        .auth-home {
          color: #5f574d;
          font-size: 0.88rem;
          font-weight: 700;
          text-decoration: none;
        }

        .auth-card-scope [data-slot="card"] {
          width: 100%;
          max-width: 430px;
          margin: 0 auto;
          border-radius: 20px;
          border: 1px solid #ebe4da;
          background: #ffffff;
          color: #18140f;
          box-shadow: 0 14px 40px rgba(24,20,15,0.08);
          padding: 0;
          overflow: hidden;
        }

        .auth-card-scope [data-slot="card-header"] {
          padding: 24px 24px 10px;
          gap: 10px;
        }

        .auth-card-scope [data-slot="card-title"] {
          font-size: 1.55rem;
          font-weight: 800;
          letter-spacing: 0;
        }

        .auth-card-scope [data-slot="card-description"] {
          color: #6c6258;
          font-size: 0.92rem;
        }

        .auth-card-scope [data-slot="card-content"] {
          padding: 10px 24px 18px;
        }

        .auth-card-scope [data-slot="card-footer"] {
          padding: 14px 24px;
          border-top: 1px solid #eee7dd;
          background: #faf8f4;
        }

        .auth-card-scope form {
          display: grid;
          gap: 14px;
        }

        .auth-card-scope [data-slot="field"],
        .auth-card-scope [data-slot="input-group"] {
          display: grid;
          gap: 7px;
        }

        .auth-card-scope label {
          color: #3b342d;
          font-size: 0.83rem;
          font-weight: 700;
        }

        .auth-card-scope input {
          width: 100%;
          min-height: 44px;
          border: 1px solid #ded5c8;
          border-radius: 12px;
          background: #fffdfa;
          color: #18140f;
          padding: 0 13px;
          font-size: 0.95rem;
          outline: none;
        }

        .auth-card-scope input:focus {
          border-color: #0f7b6c;
          box-shadow: 0 0 0 4px rgba(15,123,108,0.12);
        }

        .auth-card-scope button {
          min-height: 40px;
          border-radius: 12px;
          border: 1px solid #ded5c8;
          padding: 0 14px;
          font-weight: 700;
          cursor: pointer;
        }

        .auth-card-scope button[type="submit"] {
          background: #15120e;
          color: #fffdfa;
          border-color: #15120e;
        }

        .auth-card-scope button[type="button"] {
          background: #fffdfa;
          color: #2c261f;
        }

        .auth-card-scope button:hover {
          transform: translateY(-1px);
        }

        @media (max-width: 860px) {
          .auth-page { padding: 0; place-items: stretch; }
          .auth-shell { min-height: 100vh; grid-template-columns: 1fr; border-radius: 0; }
          .auth-side { min-height: 330px; padding: 28px; }
          .auth-form-wrap { padding: 28px; }
          .auth-form-top { margin-bottom: 22px; }
        }
      `}</style>

      <section className="auth-shell">
        <aside className="auth-side">
          <Link href="/" className="auth-brand">
            <span className="auth-brand-mark">
              <svg viewBox="0 0 18 18" width="19" height="19" fill="none">
                <rect x="2" y="5" width="14" height="10" rx="2" fill="#15120e" opacity="0.95" />
                <rect x="2" y="3" width="6" height="3" rx="1.5" fill="#15120e" />
              </svg>
            </span>
            StoreIt
          </Link>

          <div className="auth-copy">
            <div className="auth-eyebrow">Private workspace</div>
            <h1>Store, share, and recover with confidence.</h1>
            <p>
              Your account opens the file manager with duplicate checks, expiring links, visible versions, and full-content search.
            </p>
          </div>

          <div className="auth-highlights">
            <div className="auth-highlight"><span>Duplicate detection</span><strong>Active</strong></div>
            <div className="auth-highlight"><span>Folder share permissions</span><strong>Read/Write</strong></div>
            <div className="auth-highlight"><span>Version history</span><strong>Visible</strong></div>
          </div>
        </aside>

        <section className="auth-form-wrap">
          <div className="auth-form-top">
            <Link href="/" className="auth-home">Back to home</Link>
          </div>
          <div className="auth-card-scope">{children}</div>
        </section>
      </section>
    </main>
  );
};

export default AuthLayout;
