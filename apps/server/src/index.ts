import { createServer } from 'node:http';
createServer((_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:'initializing',mode:'demo'}));}).listen(3001,'0.0.0.0');
