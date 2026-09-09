/// <reference types="vite/client" />
interface Env {DB:D1Database;BUCKET?:R2Bucket;ASSETS:Fetcher;BETTER_AUTH_SECRET:string;APP_ORIGIN:string;}
declare namespace Cloudflare {interface Env {DB:D1Database;BUCKET?:R2Bucket;ASSETS:Fetcher;BETTER_AUTH_SECRET:string;APP_ORIGIN:string;}}
