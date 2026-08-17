# DoomTransmit - Deploy no servidor Linux

O que precisa configurar para funcionar:

1. **Domínio próprio** apontando para o IP do servidor (registro DNS tipo A). Não funciona com `localhost`/IP puro, precisa de HTTPS.
2. **Arquivo `.env`** na raiz do projeto com:
   - `DOMAIN=seu-dominio-aqui.com`
   - `EMAIL=seu-email@exemplo.com`
3. **Portas liberadas no firewall**: `80` e `443`.
4. **Docker e Docker Compose** instalados no servidor.

## Rodar

```bash
nano .env
docker compose up -d --build
```

Depois disso o app fica disponível em `https://SEU_DOMINIO`.
