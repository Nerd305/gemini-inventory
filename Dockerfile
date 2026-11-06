# Stage 1: Build the React application
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY . .
# The commit being built (the deploy workflow passes --build-arg GIT_SHA=$GITHUB_SHA). Vite bakes it into
# the version badge (src/lib/build.ts). Declared after npm ci so a new commit does not redo the install.
ARG GIT_SHA=
ENV GIT_SHA=$GIT_SHA
RUN npm run build

# Stage 2: Serve the application with Node.js
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
# Only install production dependencies
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi
COPY server.js firebase-applet-config.json ./
COPY --from=build /app/dist ./dist
# server.js reports this on /api/v1/health (the deploy also sets it as an env var; that value wins).
ARG GIT_SHA=
ENV GIT_SHA=$GIT_SHA
EXPOSE 8080
CMD ["node", "server.js"]
