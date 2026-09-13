import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      {/* Land on the Command Center, not the landing page. */}
      <SignIn
        fallbackRedirectUrl="/command-center"
        signUpFallbackRedirectUrl="/command-center"
      />
    </div>
  );
}
