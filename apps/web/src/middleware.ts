import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * Mobile auto-redirect: phone user-agents are sent to the dedicated /m/*
 * route tree. Laptops/desktops are never redirected. A `minex_desktop=1`
 * cookie (set by the "Desktop" button in the mobile header) opts out for a
 * week; "Mobile site" links clear it.
 */
const MOBILE_UA =
  /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini|Mobile.+Firefox|Nokia/i;

const DESKTOP_TO_MOBILE: Record<string, string> = {
  "/": "/m",
  "/production": "/m/production",
  "/exploration": "/m/exploration",
  "/equipment": "/m/equipment",
  "/scenario": "/m/scenario",
  "/scenarios": "/m/scenario",
  "/governance": "/m/governance",
  "/alerts": "/m/alerts",
  "/admin": "/m/admin",
  "/profile": "/m/profile",
};

/** Apply mobile-redirect logic and return the response (or undefined to pass through). */
function applyMobileRedirect(req: NextRequest): NextResponse | undefined {
  const url = new URL(req.url);
  const { pathname, search } = url;

  // Never touch API, internals, static assets, or the mobile tree itself
  if (
    pathname.startsWith("/m") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/sign-") ||
    pathname.includes(".")
  ) {
    return undefined;
  }

  // Desktop opt-out cookie wins
  if (req.cookies.get("minex_desktop")?.value === "1") {
    return undefined;
  }

  const ua = req.headers.get("user-agent") ?? "";
  if (!MOBILE_UA.test(ua)) {
    return undefined;
  }

  const mobilePath = DESKTOP_TO_MOBILE[pathname] ?? "/m";
  return NextResponse.redirect(new URL(mobilePath + search, url), 307);
}

// If Clerk keys are not configured (e.g. during Vercel cold-start or missing env),
// fall back to a plain middleware that still handles mobile redirects.
const hasClerkKeys =
  !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
  !!process.env.CLERK_SECRET_KEY;

export default hasClerkKeys
  ? clerkMiddleware((_auth, req) => {
      return applyMobileRedirect(req);
    })
  : function middleware(req: NextRequest) {
      return applyMobileRedirect(req) ?? NextResponse.next();
    };

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};

