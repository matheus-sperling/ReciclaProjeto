window.ReciclaManagement = {
  props: ['user'], emits: ['close', 'updated'],
  template: `<div class="management-overlay" @click.self="$emit('close')"><section class="management" role="dialog" aria-modal="true" aria-labelledby="manage-title">
    <header><h2 id="manage-title">Cadastros de {{ user.municipio }}</h2><button type="button" @click="$emit('close')" aria-label="Fechar cadastros">Fechar</button></header>
    <nav><button v-for="tab in ['Moradores','Equipe','Pontos']" type="button" @click="aba=tab; error=''; success=''" :aria-pressed="aba===tab">{{ tab }}</button></nav>
    <p v-if="error" class="access-error" role="alert">{{ error }}</p><p v-if="success" role="status">{{ success }}</p><p v-if="loading">Carregando cadastros…</p>
    <template v-if="aba==='Moradores'">
      <form @submit.prevent="criarMorador"><label>Nome do morador<input v-model="resident.nome" required minlength="2" maxlength="120"></label><label>Bairro<input v-model="resident.bairro" maxlength="80"></label><button type="submit" :disabled="busy">Cadastrar morador</button></form>
      <label>Buscar morador<input v-model="busca" type="search" placeholder="Nome, bairro ou código"></label>
      <div v-if="selected" class="qr-card"><h3>{{ selected.nome }}</h3><p>{{ selected.bairro }}</p><canvas ref="qrCanvas" aria-label="QR pessoal do morador"></canvas><p>{{ selected.id }}</p><button @click="baixarQr" type="button">Baixar QR</button><button @click="selected=null" type="button">Fechar QR</button></div>
      <ul><li v-for="r in filtrados" :key="r.id" class="management-item"><div><strong>{{ r.nome }}</strong><span>{{ r.bairro }} · {{ r.ativo ? 'Ativo' : 'Inativo' }}</span><small>{{ r.id }}</small></div><div class="actions"><button @click="mostrarQr(r)" :disabled="!r.ativo" type="button">Ver QR</button><button @click="alterarMorador(r)" :disabled="busy" type="button">{{ r.ativo ? 'Desativar' : 'Ativar' }}</button></div></li></ul><p v-if="!filtrados.length">Nenhum morador encontrado.</p>
    </template>
    <template v-if="aba==='Equipe'">
      <form @submit.prevent="criarConta"><label>Nome<input v-model="account.nome" required minlength="2" maxlength="120"></label><label>E-mail<input v-model="account.email" required type="email" autocomplete="off"></label><label>Senha inicial<input v-model="account.password" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></label><label>Perfil<select v-model="account.role"><option value="coletor">Coletor</option><option value="gestor">Gestor</option></select></label><p class="access-hint">Compartilhe o acesso diretamente com a pessoa responsável. Senha de pelo menos 12 caracteres.</p><button :disabled="busy" type="submit">Criar conta</button></form>
      <ul><li v-for="a in equipe" :key="a.id" class="management-item"><div><strong>{{ a.nome }}</strong><span>{{ a.email }} · {{ a.role }} · {{ a.ativo ? 'Ativo' : 'Inativo' }}</span></div><div class="actions"><button @click="resetAccount=a; newPassword=''" type="button">Alterar senha</button><button @click="alterarConta(a)" :disabled="busy || a.id===user.id" type="button">{{ a.ativo ? 'Desativar' : 'Ativar' }}</button></div></li></ul>
      <form v-if="resetAccount" @submit.prevent="trocarSenha"><h3>Nova senha de {{ resetAccount.nome }}</h3><label>Nova senha<input v-model="newPassword" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></label><button type="submit" :disabled="busy">Salvar senha</button><button @click="resetAccount=null" type="button">Cancelar</button></form>
    </template>
    <template v-if="aba==='Pontos'">
      <p v-if="catalog.demonstrativo">Os pontos iniciais são demonstrativos. Confirme os locais e as coordenadas antes de operar.</p>
      <form @submit.prevent="salvarPonto"><h3>{{ point.id ? 'Editar ponto' : 'Novo ponto de coleta' }}</h3><label>Nome do ponto<input v-model="point.nome" required minlength="2" maxlength="120"></label><label>Local/endereço<input v-model="point.local" required minlength="2" maxlength="180"></label><label>Latitude<input v-model="point.lat" type="number" step="any" min="-90" max="90" required></label><label>Longitude<input v-model="point.lng" type="number" step="any" min="-180" max="180" required></label><label>Funcionamento<select v-model="point.ativo"><option :value="true">Ativo</option><option :value="false">Em manutenção</option></select></label><button :disabled="busy" type="submit">Salvar ponto</button><button @click="novoPonto" type="button">Novo ponto</button></form>
      <ul><li v-for="p in catalog.pontos" :key="p.id" class="management-item"><div><strong>{{ p.nome }}</strong><span>{{ p.local }} · {{ p.ativo ? 'Ativo' : 'Manutenção' }}</span><small>{{ p.lat }}, {{ p.lng }}</small></div><button @click="Object.assign(point,p)" type="button">Editar</button></li></ul>
    </template>
  </section></div>`,
  setup(props, { emit }) {
    const { ref, reactive, computed, onMounted, onUnmounted, nextTick } = Vue;
    const aba=ref('Moradores'), busy=ref(false), loading=ref(true), error=ref(''), success=ref(''), busca=ref('');
    const catalog=reactive({ moradores:[], pontos:[] }), equipe=ref([]), selected=ref(null), qrCanvas=ref(null);
    const resident=reactive({nome:'',bairro:''}), account=reactive({nome:'',email:'',password:'',role:'coletor'});
    const point=reactive({id:null,nome:'',local:'',lat:'',lng:'',ativo:true}), resetAccount=ref(null), newPassword=ref('');
    const filtrados=computed(()=>catalog.moradores.filter(r=>(r.nome+' '+r.bairro+' '+r.id).toLocaleLowerCase('pt-BR').includes(busca.value.toLocaleLowerCase('pt-BR'))));
    const carregar=async()=>{ const [c,e]=await Promise.all([ReciclaAPI.request('catalogo'),ReciclaAPI.request('equipe')]); Object.assign(catalog,c); equipe.value=e.users; };
    const executar=async(task,message)=>{ if(busy.value)return; busy.value=true; error.value=''; success.value=''; try{ await task(); await carregar(); success.value=message; emit('updated'); }catch(e){error.value=e.message;}finally{busy.value=false;} };
    const mostrarQr=async r=>{selected.value=r; await nextTick(); if(!window.QRious){error.value='Não foi possível carregar o gerador de QR. Recarregue com conexão.';return;} new QRious({element:qrCanvas.value,value:`recicla:morador:${r.id}`,size:280,padding:16,level:'H'});};
    const baixarQr=()=>{if(!qrCanvas.value||!selected.value)return;const a=document.createElement('a');a.href=qrCanvas.value.toDataURL('image/png');a.download=`recicla-qr-${selected.value.id}.png`;a.click();};
    const criarMorador=()=>executar(async()=>{const result=await ReciclaAPI.request('moradores',{method:'POST',body:{...resident}});resident.nome='';resident.bairro='';await mostrarQr(result.morador);},'Morador cadastrado. Baixe e entregue o QR pessoal.');
    const alterarMorador=r=>executar(async()=>{await ReciclaAPI.request('moradores',{method:'PATCH',body:{id:r.id,ativo:!r.ativo}});if(selected.value?.id===r.id)selected.value=null;},'Situação do morador atualizada.');
    const criarConta=()=>executar(async()=>{await ReciclaAPI.request('equipe',{method:'POST',body:{...account}});account.nome='';account.email='';account.password='';},'Conta criada.');
    const alterarConta=a=>executar(()=>ReciclaAPI.request('equipe',{method:'PATCH',body:{email:a.email,ativo:!a.ativo}}),'Situação da conta atualizada.');
    const trocarSenha=()=>executar(async()=>{await ReciclaAPI.request('equipe',{method:'PATCH',body:{email:resetAccount.value.email,password:newPassword.value}});newPassword.value='';resetAccount.value=null;},'Senha atualizada. As sessões anteriores dessa conta foram encerradas.');
    const novoPonto=()=>Object.assign(point,{id:null,nome:'',local:'',lat:'',lng:'',ativo:true});
    const salvarPonto=()=>executar(async()=>{await ReciclaAPI.request('pontos',{method:'POST',body:{...point}});novoPonto();},'Ponto salvo. Peça aos coletores para atualizar os cadastros.');
    const escape=e=>{if(e.key==='Escape')emit('close');};
    onMounted(async()=>{document.addEventListener('keydown',escape);try{await carregar();}catch(e){error.value=e.message;}finally{loading.value=false;}});
    onUnmounted(()=>document.removeEventListener('keydown',escape));
    return {aba,busy,loading,error,success,busca,catalog,equipe,selected,qrCanvas,resident,account,point,resetAccount,newPassword,filtrados,mostrarQr,baixarQr,criarMorador,alterarMorador,criarConta,alterarConta,trocarSenha,novoPonto,salvarPonto};
  }
};
