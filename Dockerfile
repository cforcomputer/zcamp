FROM node:20-slim

# Create app directory
WORKDIR /usr/src/app

# Install dependencies including PostgreSQL development files
RUN apt-get update && apt-get install -y \
    wget \
    curl \
    python3 \
    make \
    g++ \
    libpq-dev \  
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./
COPY postcss.config.cjs ./
COPY tailwind.config.js ./
COPY rollup.config.mjs ./

ENV NODE_PG_FORCE_NATIVE=0

# Install ALL dependencies 
RUN npm install

# Copy application code
COPY . .

# Build the application
RUN npm run build

# Document the port the app uses
EXPOSE 8080

# Start the app
# Replace the current CMD line
CMD [ "node", "--no-warnings", "--experimental-specifier-resolution=node", "build/server.js" ]