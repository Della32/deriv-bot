FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

# Criar diretório de dados
RUN mkdir -p data

CMD ["node", "src/index.js"]
