// /api/login – sem aplikace pošle prohlížeč, když je potřeba přihlášení. Cloudflare Access (chrání /api)
// zobrazí přihlášení e-mailem a po něm se vrátí sem; odtud zpět do aplikace.
export const onRequestGet = ({ request }) => Response.redirect(new URL('/#/plan', request.url).toString(), 302);
