import { LoginForm } from "@/components/auth/login-form"

export default function LoginPage() {
  return <LoginForm showDevSeed={process.env.NODE_ENV !== "production"} />
}
