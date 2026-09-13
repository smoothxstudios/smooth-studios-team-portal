let accountId:string|null=null;

export function setRequestAccount(id:string|null){accountId=id;}

/** Pin data requests to this tab's verified account, even if another tab changes cookies. */
export function accountHeaders():Record<string,string>{return {'X-Production-Account':accountId||'__signed_out__'};}
