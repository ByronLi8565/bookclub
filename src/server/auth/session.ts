import * as Schema from "effect/Schema";
import { signToken, verifyToken } from "./signedToken.ts";

export interface SessionClaims {
  userId: string;
  email: string;
  name: string;
  exp: number;
}

const SessionClaimsSchema = Schema.Struct({
  userId: Schema.String,
  email: Schema.String,
  name: Schema.String,
  exp: Schema.Number,
});

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const signSession = signToken<SessionClaims>;

export const verifySession = (token: string, secret: string): Promise<SessionClaims | null> =>
  verifyToken(SessionClaimsSchema, token, secret);
