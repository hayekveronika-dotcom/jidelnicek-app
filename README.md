# Jídelníček App

Rodinný jídelníček jako PWA: knihovna pokrmů, týdenní jídelníček, mražené zásoby a nákupní seznam.

- `app/` – webová aplikace (statické soubory, bez build kroku). Podrobnosti v [app/README.md](app/README.md).
- `functions/` – server pro synchronizaci dat (Cloudflare Pages Functions + D1), nasazuje se spolu s aplikací.

Nasazení: Cloudflare Pages, *Build output directory* = `app`, *Build command* prázdné. Nastavení D1 a Cloudflare Access: [app/README.md](app/README.md#nastavení-serveru-cloudflare-jednorázově).
