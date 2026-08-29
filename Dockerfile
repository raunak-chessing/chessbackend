FROM node:22-alpine AS builder
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# prisma.config.js resolves DATABASE_URL via Prisma's config loader even for
# `generate`, which only reads the schema and never opens a connection — no
# env vars are available at build time otherwise, so a placeholder is enough.
ENV DATABASE_URL="postgresql://user:password@localhost:5432/db"
RUN pnpm exec prisma generate

# V8 sets its old-space heap ceiling from physical RAM it detects at
# startup, not physical+swap — on a 1GB-RAM instance it self-limits well
# below what's actually usable once swap is counted, and the build gets
# killed by V8's own governor rather than an actual system OOM. Raising
# this lets it use the swap that's already provisioned instead.
ENV NODE_OPTIONS="--max-old-space-size=2048"
RUN pnpm run build
RUN pnpm prune --prod

FROM node:22-alpine AS runtime
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma

EXPOSE 4001
CMD ["node", "dist/src/main"]
