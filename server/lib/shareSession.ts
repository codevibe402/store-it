import jwt from "jsonwebtoken";
import crypto from "crypto";

const SECRET = process.env.JWT_SECRET || process.env.NEXTAUTH_SECRET!;
const SESSION_TTL = "2h";

// A password-protected share link only needs the password entered once per
// browser session, not on every browse/download call. Successful entry
// (POST /api/shared/:token/access) mints a short-lived JWT scoped to this
// exact token and stores it in an HttpOnly cookie named after the token's
// hash, so it can't be replayed against a different link and can't be read
// by page JS (XSS can't exfiltrate it, unlike a plain "unlocked" flag).
export function shareCookieName(shareToken: string): string {
  return `share_pw_${crypto.createHash("sha256").update(shareToken).digest("hex").slice(0, 16)}`;
}

export function signShareSession(shareToken: string): string {
  return jwt.sign({ st: crypto.createHash("sha256").update(shareToken).digest("hex") }, SECRET, { expiresIn: SESSION_TTL });
}

export function verifyShareSession(cookieValue: string | undefined, shareToken: string): boolean {
  if (!cookieValue) return false;
  try {
    const decoded = jwt.verify(cookieValue, SECRET) as jwt.JwtPayload;
    return decoded.st === crypto.createHash("sha256").update(shareToken).digest("hex");
  } catch {
    return false;
  }
}
