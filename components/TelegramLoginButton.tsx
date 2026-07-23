"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "./ui/button"
import { useAuth } from "./AuthProvider"

export function TelegramLoginButton() {
  const router = useRouter()
  const { setAuthUser } = useAuth()
  const containerRef = useRef<HTMLDivElement>(null)
  const [botUsername, setBotUsername] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/auth/telegram/bot-info")
      .then((r) => r.json())
      .then((d) => {
        if (d.username) setBotUsername(d.username)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!botUsername || !containerRef.current) return

    const existing = containerRef.current.querySelector("script");
    if (existing) return;

    ;(window as any).onTelegramAuth = async (user: any) => {
      const res = await fetch("/api/auth/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: String(user.id),
          first_name: user.first_name || "",
          last_name: user.last_name || "",
          username: user.username || "",
          photo_url: user.photo_url || "",
          auth_date: String(user.auth_date),
          hash: user.hash,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        // Must go through setAuthUser() (not left unset) so useAuth()'s
        // client-side state actually updates — otherwise RequireAuth reads
        // isAuthenticated as still false and bounces straight back to
        // /sign_in.
        setAuthUser(data.user)
        router.push("/dashboard")
      }
    }

    const script = document.createElement("script")
    script.src = "https://telegram.org/js/telegram-widget.js?22"
    script.setAttribute("data-telegram-login", botUsername)
    script.setAttribute("data-size", "large")
    script.setAttribute("data-onauth", "onTelegramAuth(user)")
    script.setAttribute("data-request-access", "write")
    script.async = true
    containerRef.current.appendChild(script)

    return () => {
      delete (window as any).onTelegramAuth
    }
  }, [botUsername, router, setAuthUser])

  if (loading) {
    return (
      <Button type="button" variant="secondary" className="w-full" disabled>
        Loading Telegram...
      </Button>
    )
  }

  if (!botUsername) {
    return (
      <Button type="button" variant="secondary" className="w-full" disabled>
        Telegram login unavailable
      </Button>
    )
  }

  return (
    <div className="flex justify-center">
      <div ref={containerRef} />
    </div>
  )
}
