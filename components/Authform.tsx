"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { zodResolver } from "@hookform/resolvers/zod"
import { Controller, useForm, Resolver } from "react-hook-form"
import { toast } from "sonner"
import * as z from "zod"

import { 
  Card, 
  CardHeader, 
  CardTitle, 
  CardDescription, 
  CardContent, 
  CardFooter 
} from "./ui/card"

import { Button } from "./ui/button"

import { 
  Field, 
  FieldLabel, 
  FieldError 
} from "./ui/field"

import { Input } from "./ui/input"
import { sanitizeEmail, sanitizeUsername, sanitizePassword } from "@/shared/security"
import { TelegramLoginButton } from "./TelegramLoginButton"
import { useAuth } from "./AuthProvider"
import { unlockDeviceDEK } from "@/client/lib/dek"

type FormType = "sign-up" | "sign-in"

type FormValues = {
  email: string
  username?: string
  password: string
}

const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(128),
})

const signUpSchema = z.object({
  email: z.string().email(),
  username: z.string().min(1, "Username is required").max(50),
  password: z.string().min(6).max(128),
})

const Authform = () => {
    const router = useRouter()
  const { setAuthUser } = useAuth()
  const [type, setType] = React.useState<FormType>("sign-in")
  const [showForgotPassword, setShowForgotPassword] = React.useState(false)
  const [recoveryEmail, setRecoveryEmail] = React.useState("")
  const [recoveryCode, setRecoveryCode] = React.useState("")
  const [recoverySubmitting, setRecoverySubmitting] = React.useState(false)

  const schema = type === "sign-up" ? signUpSchema : signInSchema

  const form = useForm<FormValues>({
    resolver: zodResolver(schema) as Resolver<FormValues>,
    defaultValues: {
      email: "",
      username: "",
      password: "",
    },
  })



async function onSubmit(data: FormValues) {
  const safeEmail = sanitizeEmail(data.email)
  const safePassword = sanitizePassword(data.password)

  if (!safeEmail || !safePassword) {
    toast.error("Invalid input")
    return
  }

  try {
    if (type === "sign-up") {
      const safeUsername = sanitizeUsername(data.username)
      if (!safeUsername) {
        toast.error("Invalid input")
        return
      }

      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: safeUsername, email: safeEmail, password: safePassword }),
      })

      if (!res.ok) {
        toast.error("Registration failed")
        return
      }

      toast.success("Registration successful!")
      form.reset({ email: "", username: "", password: "" })
      setType("sign-in")
      router.push("/sign_in")
      return
    }

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: safeEmail, password: safePassword }),
    })
    const loginResult = await res.json().catch(() => ({}))

    if (!res.ok) {
      toast.error(loginResult.error || "Invalid credentials")
      return
    }

    // Must go through AuthProvider's setAuthUser() (not left unset) so the
    // app's client-side session state actually updates — otherwise
    // useAuth().isAuthenticated stays false, which RequireAuth immediately
    // reads as "not logged in" and bounces straight back to /sign_in.
    setAuthUser(loginResult.user)

    toast.success("Logged in successfully!")
    router.push("/dashboard")
  } catch {
    toast.error("Something went wrong")
  }
}
  const handleTypeSwitch = (newType: FormType) => {
  setType(newType)
}

  async function handleRecoverySubmit() {
    const safeEmail = sanitizeEmail(recoveryEmail)
    if (!safeEmail || !recoveryCode.trim()) {
      toast.error("Enter your email and recovery code")
      return
    }

    setRecoverySubmitting(true)
    try {
      const res = await fetch("/api/auth/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: safeEmail, recoveryCode }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        toast.error(data.error || "Invalid email or recovery code")
        return
      }

      // Signs the user in (this endpoint mints a real session, same as
      // /api/auth/login) and separately unwraps this account's DEK for use
      // on this device — the two are independent outcomes of one submit.
      setAuthUser(data.user)
      try {
        await unlockDeviceDEK(data.user.userId, recoveryCode, data)
      } catch {
        toast.error("Signed in, but that recovery code doesn't match this account's files.")
        router.push("/dashboard")
        return
      }

      toast.success("Signed in and unlocked your files.")
      router.push("/dashboard")
    } catch {
      toast.error("Something went wrong")
    } finally {
      setRecoverySubmitting(false)
    }
  }

  return (
    <Card className="w-full sm:max-w-md">
      <CardHeader>
        {/* Toggle Buttons */}
        <div className="flex w-full rounded-lg border border-input bg-muted p-1 mb-4">
          <button
            type="button"
            onClick={() => handleTypeSwitch("sign-in")}
            className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-all duration-200 ${
              type === "sign-in"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => handleTypeSwitch("sign-up")}
            className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-all duration-200 ${
              type === "sign-up"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Sign Up
          </button>
        </div>

        <CardTitle>Store it</CardTitle>
        <CardDescription>
          {type === "sign-in"
            ? "Welcome back! Sign in to your account."
            : "Create an account to get started."}
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form id="form-rhf-demo" onSubmit={form.handleSubmit(onSubmit)}>
          <div className="flex flex-col gap-4">
            {/* Email */}
            <Controller
              name="email"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="form-rhf-email">Email</FieldLabel>
                  <Input
                    {...field}
                    id="form-rhf-email"
                    aria-invalid={fieldState.invalid}
                    placeholder="Enter your email"
                    autoComplete="off"
                  />
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />

            {/* Username — only for sign-up */}
            {type === "sign-up" && (
              <Controller
                control={form.control}
                name="username"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="form-rhf-username">Username</FieldLabel>
                    <Input
                      {...field}
                      id="form-rhf-username"
                      placeholder="Enter your username"
                      value={field.value ?? ""}
                      aria-invalid={fieldState.invalid}
                    />
                    {fieldState.invalid && (
                      <FieldError errors={[fieldState.error]} />
                    )}
                  </Field>
                )}
              />
            )}

            {/* Password */}
            <Controller
              name="password"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel>Password</FieldLabel>
                  <Input
                    {...field}
                    type="password"
                    placeholder="Enter your password"
                    value={field.value || ""}
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
          </div>
        </form>
      </CardContent>

      <CardFooter className="flex flex-col gap-3">
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => form.reset()}>
            Reset
          </Button>
          <Button type="submit" form="form-rhf-demo">
            {type === "sign-in" ? "Sign In" : "Sign Up"}
          </Button>
        </div>
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          onClick={() => { window.location.href = "/api/auth/google" }}
        >
          Sign In with Google
        </Button>
        <div className="flex justify-center">
          <TelegramLoginButton />
        </div>

        {type === "sign-in" && (
          <div className="w-full border-t pt-3">
            <button
              type="button"
              onClick={() => setShowForgotPassword((v) => !v)}
              className="w-full text-center text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Forgot password?
            </button>
            {showForgotPassword && (
              <div className="mt-3 rounded-lg border bg-muted/40 p-3 text-xs">
                <p className="text-muted-foreground">
                  Sign in with your account email and the recovery code you saved when encryption
                  was first set up — this signs you in and unlocks your encrypted files, no
                  password needed.
                </p>
                <div className="mt-2 flex flex-col gap-2">
                  <Input
                    value={recoveryEmail}
                    onChange={(e) => setRecoveryEmail(e.target.value)}
                    placeholder="Account email"
                    autoComplete="off"
                    className="h-8 text-xs"
                  />
                  <Input
                    value={recoveryCode}
                    onChange={(e) => setRecoveryCode(e.target.value)}
                    placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                    autoComplete="off"
                    className="h-8 text-xs"
                  />
                  <button
                    type="button"
                    disabled={recoverySubmitting}
                    onClick={handleRecoverySubmit}
                    className="w-full rounded-md border bg-background py-1.5 font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {recoverySubmitting ? "Verifying…" : "Sign in with recovery code"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardFooter>
    </Card>
  )
}

export default Authform
