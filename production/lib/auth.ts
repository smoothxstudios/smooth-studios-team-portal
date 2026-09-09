import {env} from 'cloudflare:workers';
import {betterAuth} from 'better-auth';
import {authOptions} from './auth-options';
let cached:ReturnType<typeof betterAuth>|undefined;
export function auth(){if(!env.BETTER_AUTH_SECRET||!env.APP_ORIGIN)throw new Error('Account sign-in is not configured');return cached??=betterAuth(authOptions(env.DB,env.BETTER_AUTH_SECRET,env.APP_ORIGIN));}
