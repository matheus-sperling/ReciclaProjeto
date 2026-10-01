const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createApplication,periodo}=require('../server/application.cjs');
function memoryStore(){const data=new Map();let version=0;const conflict=()=>Object.assign(new Error('Conflict'),{code:'CONFLICT'});return {
 async read(k){return data.has(k)?structuredClone(data.get(k)):null;},
 async create(k,v){if(data.has(k))throw conflict();data.set(k,{value:structuredClone(v),etag:String(++version)});},
 async replace(k,v,e){if(data.get(k)?.etag!==e)throw conflict();data.set(k,{value:structuredClone(v),etag:String(++version)});},
 async list(p){return [...data].filter(([k])=>k.startsWith(p)).map(([,v])=>structuredClone(v.value));},data
};}
module.exports={memoryStore};
const setupToken='configuration-code-for-testing-only-000000', secret='session-secret-for-testing-only-0000000000';
async function fixture(){const store=memoryStore();const app=createApplication({store,secret,setupToken});
 const admin=await app.execute({action:'setup',method:'POST',body:{setupToken,nome:'Gestor teste',email:'gestor@example.test',password:'senha-de-teste-123',municipio:'Coxim'}});
 const act=(action,method='GET',body={},token=admin.sessionToken,query={})=>app.execute({action,method,body,token,query});
 await act('equipe','POST',{nome:'Coletor teste',email:'coletor@example.test',password:'senha-de-teste-123',role:'coletor'});
 const collector=await app.execute({action:'login',method:'POST',body:{email:'coletor@example.test',password:'senha-de-teste-123'}});
 const resident=(await act('moradores','POST',{nome:'Morador teste',bairro:'Centro'})).morador;
 const delivery={id:randomUUID(),moradorId:resident.id,pontoId:1,materialId:'papel',kg:2.5,criadoEm:new Date().toISOString(),coletorId:collector.user.id};
 return {app,store,act,admin,collector,resident,delivery};}
test('fluxo completo, concorrência e proteção contra entrega duplicada',async()=>{const f=await fixture();
 const results=await Promise.all(Array.from({length:6},()=>f.act('entregas','POST',f.delivery,f.collector.sessionToken)));
 assert.equal(results.filter(r=>!r.duplicate).length,1);
 const rows=await f.act('entregas');assert.equal(rows.entregas.length,1);assert.equal(rows.entregas[0].status,'sincronizado');
 const painel=await f.act('painel','GET',{},f.admin.sessionToken,{inicio:'2020-01-01',fim:'2099-12-31'});
 assert.equal(painel.entregas,1);assert.equal(painel.pontos[0].coletas.papel,2.5);
 await assert.rejects(f.act('entregas','POST',{...f.delivery,kg:3},f.collector.sessionToken),{status:409});
 await assert.rejects(f.act('setup','POST',{setupToken}),{status:409});
});
test('perfis, sessão revogada, moradores inativos e peso inválido',async()=>{const f=await fixture();
 await assert.rejects(f.act('moradores','POST',{nome:'Outro'},f.collector.sessionToken),{status:403});
 await assert.rejects(f.act('entregas','POST',{...f.delivery,kg:-1},f.collector.sessionToken),{status:400});
 await assert.rejects(f.act('entregas','POST',{...f.delivery,coletorId:f.admin.user.id},f.collector.sessionToken),{status:403});
 await f.act('moradores','PATCH',{id:f.resident.id,ativo:false});
 await assert.rejects(f.act('entregas','POST',f.delivery,f.collector.sessionToken),{status:400});
 await f.act('equipe','PATCH',{email:f.collector.user.email,password:'nova-senha-teste-123'});
 await assert.rejects(f.act('session','GET',{},f.collector.sessionToken),{status:401});
 await assert.rejects(f.act('session','GET',{},'invalid'),{status:401});
});
test('datas reais e soma exata em gramas',async()=>{assert.throws(()=>periodo('2026-02-30','2026-03-01'),{status:400});
 const f=await fixture();for(const kg of [0.1,0.2,0.001])await f.act('entregas','POST',{...f.delivery,id:randomUUID(),kg},f.collector.sessionToken);
 const p=await f.act('painel','GET',{},f.admin.sessionToken,{inicio:'2020-01-01',fim:'2099-12-31'});assert.equal(p.pontos[0].coletas.papel,0.301);
});
test('armazenamento não configurado e tentativas de login limitadas',async()=>{const app=createApplication({configured:false,missing:['Blob']});assert.deepEqual(await app.execute({action:'status'}),{configured:false,missing:['Blob']});await assert.rejects(app.execute({action:'catalogo'}),{status:503});
 const f=await fixture();for(let i=0;i<8;i++)await assert.rejects(f.app.execute({action:'login',method:'POST',body:{email:'unknown@example.test',password:'wrong'}}),{status:401});
 await assert.rejects(f.app.execute({action:'login',method:'POST',body:{email:'unknown@example.test',password:'wrong'}}),{status:429});
});
