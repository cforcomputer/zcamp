FROM node:20-slim

# Create app directory
WORKDIR /usr/src/app

# Install curl for healthcheck only
RUN apt-get update && apt-get install -y wget curl

# Copy package files
COPY package*.json ./
COPY postcss.config.cjs ./
COPY tailwind.config.js ./
COPY rollup.config.mjs ./

# Install dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && npm install \
    && apt-get purge -y \
    python3 \
    make \
    g++ \
    && apt-get autoremove -y \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Copy application code
COPY . .

# Build the application
RUN npm run build

# Document the port the app uses
EXPOSE 8080

# Keep the original port
CMD [ "npm", "start" ]