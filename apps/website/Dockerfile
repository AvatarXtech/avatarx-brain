FROM node:22-alpine AS dependencies
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/website/package.json ./apps/website/package.json
RUN pnpm install --frozen-lockfile --filter website...

FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/apps/website/node_modules ./apps/website/node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/website ./apps/website
RUN pnpm --dir apps/website build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=builder --chown=node:node /app/apps/website/public ./public
COPY --from=builder --chown=node:node /app/apps/website/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/website/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
