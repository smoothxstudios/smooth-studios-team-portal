import type {BetterAuthOptions} from 'better-auth';
import {username} from 'better-auth/plugins/username';
export function authOptions(database:BetterAuthOptions['database'],secret:string,baseURL:string):BetterAuthOptions {
 return {appName:'Smooth Studios Productions',database,secret,baseURL,basePath:'/api/auth',trustedOrigins:[baseURL],telemetry:{enabled:false},
  emailAndPassword:{enabled:true,disableSignUp:false,autoSignIn:true,minPasswordLength:12,maxPasswordLength:128,revokeSessionsOnPasswordReset:true},
  user:{additionalFields:{enabled:{type:'boolean',defaultValue:true,input:false},mustChangePassword:{type:'boolean',defaultValue:false,input:false}}},
  session:{expiresIn:60*60*24*7,updateAge:60*60*12,cookieCache:{enabled:false}},
  advanced:{useSecureCookies:baseURL.startsWith('https:'),ipAddress:{ipAddressHeaders:['cf-connecting-ip']},defaultCookieAttributes:{httpOnly:true,sameSite:'lax'}},
  rateLimit:{enabled:true,storage:'database',window:60,max:100,customRules:{'/sign-in/username':{window:60,max:5},'/sign-up/email':{window:60,max:5},'/change-password':{window:60,max:5},'/get-session':false}},
  plugins:[username({minUsernameLength:3,maxUsernameLength:30,immutableUsername:true})]
 };
}
