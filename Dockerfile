# syntax=docker/dockerfile:1

# ============================================================
# Multi-stage build for the Next.js 16 app (output: "standalone").
#
# EasyPanel: create an "App" service, source = this repo, build type
# = Dockerfile. Set the NEXT_PUBLIC_* values as BUILD ARGS (they are
# inlined into the client bundle at build time — setting them only as
# runtime env vars does NOT work). Set every server-side secret as a
# runtime Environment Variable.
# ============================================================

# ---- 1. deps: install node_modules from the lockfile ----------------
FROM node:22-alpine AS deps
# Next's standalone server links against glibc symbols; the compat
# shim lets the Alpine (musl) image run it without surprises.
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# ---- 2. builder: compile the standalone server ----------------------
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* are baked into the client bundle here. Pass them via
# EasyPanel "Build Arguments" (or `docker build --build-arg`).
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- 3. runner: minimal runtime image -------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3009 \
    HOSTNAME=0.0.0.0

# Run as an unprivileged user.
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

# The standalone build already contains the minimal server + the
# node_modules it actually reaches. `public` and `.next/static` are
# NOT included by the standalone tracer, so copy them explicitly.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3009

# Liveness probe — checks that the Next.js server is accepting connections.
# Requests to / redirect to /login which wget follows; exit 0 means healthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider "http://127.0.0.1:${PORT}/" || exit 1

# server.js is emitted at the root of the standalone bundle and honours
# PORT / HOSTNAME. No `next start` needed.
CMD ["node", "server.js"]
