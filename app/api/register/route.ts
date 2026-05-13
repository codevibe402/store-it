// app/api/register/route.ts
import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import connectDB from '../../../lib/mongoose'
import User from '../../../models/User'

export async function POST(req: Request) {
  try {
    const { username, email, password } = await req.json()

    if (!username || !email || !password) {
      return NextResponse.json(
        { error: 'All fields are required' },
        { status: 400 }
      )
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: 'Password must be at least 6 characters' },
        { status: 400 }
      )
    }

    await connectDB()

    const existingUser = await User.findOne({ email: email.toLowerCase() })
    if (existingUser) {
      return NextResponse.json(
        { error: 'An account with this email already exists' },
        { status: 409 }
      )
    }

    const user = await User.create({
      name: username.trim(),
      email: email.toLowerCase().trim(),
      password: password,
    })

    return NextResponse.json(
      { message: 'Account created successfully', user: { id: user._id.toString(), name: user.name, email: user.email } },
      { status: 201 }
    )
  } catch (error: unknown) {
    if ((error as { code?: number }).code === 11000) {
      return NextResponse.json(
        { error: 'An account with this email already exists' },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
