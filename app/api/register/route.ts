import { NextResponse } from 'next/server'
import connectDB from '@/adapters/database/mongoose'
import User from '@/adapters/database/models/User'

export async function POST(req: Request) {
  try {
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
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}