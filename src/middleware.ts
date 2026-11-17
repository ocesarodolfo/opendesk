import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "atende_session";

// Camada de rede: apenas presenca/ausencia do cookie (a validacao real do
// JWT acontece nas paginas e rotas de API).
export function middleware(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const { pathname } = req.nextUrl;
  const isLoginPage = pathname.startsWith("/login");

  if (!token && !isLoginPage) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (token && isLoginPage) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|icon.png|sw.js).*)"],
};
