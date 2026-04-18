import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Zap, Mail, ArrowRight } from 'lucide-react'

export default function SignUpSuccessPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md bg-card/50 backdrop-blur border-border/50 text-center">
        <CardHeader>
          <div className="flex items-center justify-center gap-2 mb-4">
            <Zap className="h-8 w-8 text-primary" />
            <span className="text-2xl font-bold">QuizBlitz</span>
          </div>
          <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <Mail className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-2xl">Check your email</CardTitle>
          <CardDescription className="text-base">
            We&apos;ve sent you a confirmation link to complete your registration
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Click the link in your email to verify your account, then you can start creating quizzes!
          </p>
          <Link href="/auth/login">
            <Button variant="outline" className="w-full">
              <ArrowRight className="mr-2 h-4 w-4" />
              Back to Sign In
            </Button>
          </Link>
        </CardContent>
      </Card>
    </main>
  )
}
