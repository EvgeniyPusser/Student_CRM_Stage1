import {createApp} from './app.js';
import {config} from './config.js';
import {pool} from './repositories/db.js';
const server=createApp().listen(config.port,process.env.APP_HOST||'127.0.0.1',()=>console.log(`Student CRM stage 1 listening on ${config.port}`));
async function stop(){server.close(async()=>{await pool.end();process.exit(0)});setTimeout(()=>process.exit(1),10000).unref();}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
