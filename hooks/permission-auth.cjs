// The response key stays on disk/in memory. Never send it as the bearer token:
// a process that inherits an abandoned port can read every request header.
const {createHmac,timingSafeEqual}=require('node:crypto');
const isHexKey=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function permissionProof(key,nonce,requestBody,status,responseBody){
 return createHmac('sha256',Buffer.from(key,'hex'))
  .update(JSON.stringify(['cardea-permission-response-v1',nonce,requestBody,status,responseBody]))
  .digest('hex');
}
function verifyPermissionProof(key,nonce,requestBody,status,responseBody,proof){
 return isHexKey(key)&&isHexKey(nonce)&&isHexKey(proof)&&timingSafeEqual(
  Buffer.from(proof,'hex'),Buffer.from(permissionProof(key,nonce,requestBody,status,responseBody),'hex'));
}
function identityProof(key,nonce){
 return createHmac('sha256',Buffer.from(key,'hex')).update(JSON.stringify(['cardea-receiver-identity-v1',nonce])).digest('hex');
}
function verifyIdentityProof(key,nonce,proof){
 return isHexKey(key)&&isHexKey(nonce)&&isHexKey(proof)&&timingSafeEqual(Buffer.from(proof,'hex'),Buffer.from(identityProof(key,nonce),'hex'));
}
module.exports={isHexKey,permissionProof,verifyPermissionProof,identityProof,verifyIdentityProof};
