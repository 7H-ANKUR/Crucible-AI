import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      {/* Land on the Command Center, not the landing page. */}
      <SignUp
        fallbackRedirectUrl="/command-center"
        signInFallbackRedirectUrl="/command-center"
      />
    </div>
  );
}
