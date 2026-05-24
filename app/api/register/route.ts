// app/api/register/route.t
import { NextResponse } from 'next/server'
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

    const normalizedEmail = email.toLowerCase().trim()

    // CHECK EXISTING USER
    const existingUser = await User.findOne({
      email: normalizedEmail,
    })

    if (existingUser) {
      return NextResponse.json(
        { error: 'Email already exists' },
        { status: 409 }
      )
    }

   
    const user = await User.create({
      name: username.trim(),
      email: normalizedEmail,
      password: password, 
      provider: "credentials"
    })

    return NextResponse.json(
      {
        message: 'Account created successfully',
        user: {
          id: user._id.toString(),
          name: user.name,
          email: user.email,
        },
      },
      { status: 201 }
    )
  } catch (error: any) {
    console.log(error)

    if (error.code === 11000) {
      return NextResponse.json(
        { error: 'Duplicate email detected' },
        { status: 409 }
      )
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}