# Stage 1: Build the React application
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2: Serve the application with Node.js
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
# Only install production dependencies
RUN npm ci --omit=dev
COPY server.js .
COPY --from=build /app/dist ./dist
EXPOSE 8080
CMD ["node", "server.js"]
