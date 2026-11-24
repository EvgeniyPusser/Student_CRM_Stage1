export const config={port:Number(process.env.PORT||8080),origin:process.env.APP_ORIGIN||'http://localhost:8080',secure:process.env.COOKIE_SECURE==='true',environment:process.env.APP_ENV||'development',localInvites:process.env.LOCAL_INVITES==='true'};
if(config.environment==='production') throw new Error('Stage 1 is not production ready: 2FA and delivery workflows are pending.');
