import { NextResponse } from 'next/server'
import connectDB from '@/adapters/database/mongoose'
import User from '@/adapters/database/models/User'
import { isRateLimited, recordAttempt, getClientIp } from '@/server/lib/rateLimit'

// No account exists yet to lock, so this limits by source IP instead —
// bounds mass account creation / registration-endpoint abuse from one origin.
// Every attempt counts (not just failures): the threat here is volume of
// accounts/requests from one IP, not credential guessing against one target.
const REGISTER_IP_LIMIT = { max: 5, windowMs: 60 * 60 * 1000 }

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req.headers)
    const ipKey = `register:ip:${ip}`
    if (isRateLimited(ipKey, REGISTER_IP_LIMIT).limited) {
      return NextResponse.json({ error: 'Too many registration attempts. Please try again later.' }, { status: 429 })
    }
    recordAttempt(ipKey, REGISTER_IP_LIMIT)

    const body = await req.json()
    const username = body.username
    const email = body.email
    const password = body.password

    if (typeof username !== 'string' || typeof email !== 'string' || typeof password !== 'string') {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
    }

    const name = username.trim()
    const normalizedEmail = email.toLowerCase().trim()

    if (!name || name.length > 50) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
    }

    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
    }

    if (password.length < 6 || password.length > 128) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
    }

    await connectDB()

    const existingUser = await User.findOne({ email: normalizedEmail })
    if (existingUser) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
    }

    const user = await User.create({
      name,
      email: normalizedEmail,
      password,
      provider: "credentials",
    })

    return NextResponse.json(
      { message: 'Account created successfully' },
      { status: 201 }
    )
  } catch (err) {
    console.error("Register error:", err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}