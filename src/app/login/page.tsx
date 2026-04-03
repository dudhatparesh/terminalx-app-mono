"use client";

import { useState, useEffect, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

type AuthMode = "none" | "password" | "local" | "oauth";

export default function LoginPage() {
  const router = useRouter();
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch("/api/auth/me");
        const data = await res.json();

        if (res.ok && data.username) {
          // Already logged in
          window.location.href = "/";
          return;
        }

        // Set auth mode from response (included even in 401)
        const mode = data.authMode || data.mode;
        if (mode) {
          setAuthMode(mode as AuthMode);
          if (mode === "none") {
            window.location.href = "/";
            return;
          }
        }
      } catch {
        // Default to local mode if auth check fails
        setAuthMode("local");
      } finally {
        setCheckingAuth(false);
      }
    }

    checkAuth();
  }, [router, authMode]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const body: Record<string, string> = { password };
      if (authMode === "local") {
        body.username = username;
      }

      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        setError("Invalid credentials");
        setIsSubmitting(false);
        return;
      }

      // Hard redirect to ensure the cookie is sent with the request
      window.location.href = "/";
    } catch {
      setError("Invalid credentials");
      setIsSubmitting(false);
    }
  }

  if (checkingAuth) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0D0F12]">
        <Loader2 className="h-6 w-6 animate-spin text-[#3B82F6]" />
      </div>
    );
  }

  return (
    <div className="flex h-screen items-center justify-center bg-[#0D0F12] px-4">
      <div className="w-full max-w-[400px]">
        {/* Wordmark */}
        <div className="mb-6 text-center">
          <h1
            className="text-[24px] font-bold text-[#3B82F6]"
            style={{ fontFamily: "var(--font-jetbrains-mono), monospace" }}
          >
            TerminalX
          </h1>
        </div>

        <Card className="border-[#2A2D3A] bg-[#151820]">
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {authMode === "local" && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="username" className="text-[#E4E4E7]">
                    Username
                  </Label>
                  <Input
                    id="username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Enter username"
                    autoComplete="username"
                    className="border-[#2A2D3A] bg-[#0D0F12] text-[#E4E4E7] placeholder:text-[#6B7280]"
                  />
                </div>
              )}

              <div className="flex flex-col gap-2">
                <Label htmlFor="password" className="text-[#E4E4E7]">
                  Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  autoComplete="current-password"
                  className="border-[#2A2D3A] bg-[#0D0F12] text-[#E4E4E7] placeholder:text-[#6B7280]"
                />
              </div>

              <Button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-[#3B82F6] text-white hover:bg-[#2563EB] disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  "Sign In"
                )}
              </Button>

              {error && (
                <Alert variant="destructive" className="border-[#EF4444]/30 bg-[#EF4444]/10">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-[#EF4444]">
                    {error}
                  </AlertDescription>
                </Alert>
              )}
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
