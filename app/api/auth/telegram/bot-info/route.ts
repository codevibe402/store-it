import { NextResponse } from "next/server";

export async function GET() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "Telegram bot not configured" }, { status: 500 });
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = await res.json();
    if (!data.ok) {
      return NextResponse.json({ error: "Failed to get bot info" }, { status: 500 });
    }
    return NextResponse.json({ username: data.result.username });
  } catch {
    return NextResponse.json({ error: "Failed to reach Telegram API" }, { status: 500 });
  }
}
