import { handlers } from "@/auth";

// NextAuth's GET/POST handlers back the whole /api/auth/* surface
// (sign-in, callback, sign-out, session).
export const { GET, POST } = handlers;
