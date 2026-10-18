/* Áreas individuais Mais Velho e Raiz. Persistência por workspace em app_state.
   Não concede acesso a acompanhantes nem altera dados dos módulos existentes. */
let KX_STATE=null;
const KX_CONFIG={
 senior:{title:'Meu Kamba Mais Velho',types:{income:'Dinheiro que entrou',expense:'Dinheiro que saiu'},incoming:['income'],outgoing:['expense']},
 raiz:{title:'Meu Kamba Raiz',types:{sale:'Venda recebida',income:'Outra receita',expense:'Despesa paga',purchase:'Compra paga',withdrawal:'Retirada pessoal'},incoming:['sale','income'],outgoing:['expense','purchase','withdrawal']}
};
const kxToday=()=>new Date(Date.now()+3600000).toISOString().slice(0,10);
function kxDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value}
function kxEntry(kind,x){
 const cfg=KX_CONFIG[kind];
 return !!(cfg&&x&&typeof x.id==='string'&&x.id.length>0&&x.id.length<=64&&Object.hasOwn(cfg.types,x.type)&&typeof x.desc==='string'&&x.desc.trim().length>0&&x.desc.length<=80&&Number.isSafeInteger(x.amount)&&x.amount>0&&x.amount<=1000000000000&&kxDate(x.date));
}
function kxDocument(kind,data){
 if(!data||data._kambaArea!==kind||data.version!==1||!Array.isArray(data.entries)||data.entries.length>20000||!data.entries.every(x=>kxEntry(kind,x)))return false;
 return new Set(data.entries.map(x=>x.id)).size===data.entries.length&&Number.isSafeInteger(data.entries.reduce((n,x)=>n+x.amount,0));
}
function kxTotals(kind,entries,month){
 const cfg=KX_CONFIG[kind],rows=entries.filter(x=>!month||x.date.slice(0,7)===month);
 const total=types=>rows.filter(x=>types.includes(x.type)).reduce((n,x)=>n+x.amount,0);
 return {incoming:total(cfg.incoming),outgoing:total(cfg.outgoing),withdrawals:total(['withdrawal']),balance:total(cfg.incoming)-total(cfg.outgoing)};
}
async function kxEnter(kind){
 if(!Object.hasOwn(KX_CONFIG,kind)||!user||!user.id)return toast('Área indisponível.');
 const epoch=SESSION_EPOCH,seq=++ENTER_SEQ;const current=()=>epoch===SESSION_EPOCH&&seq===ENTER_SEQ;
 try{
  const subs=await sb.from('subscriptions').select('*');if(!current())return;
  if(subs.error){resetAccess();throw Error('Não foi possível validar a subscrição.')}
  SUBS=subs.data||[];entCalc();if(!ENT[kind]){toast('Esta área exige uma subscrição válida do respetivo plano.');return payOpen()}
  if(!SERVER_IMPLEMENTED.includes(kind))throw Error('Aplica primeiro a atualização desta área no Supabase.');
  if(!WS[kind]){const id=uid();const created=await sb.from('workspaces').insert({id,kind,name:KX_CONFIG[kind].title});if(!current())return;if(created.error)throw created.error;WS[kind]=id}
  const ws=WS[kind];
  const result=await sb.from('app_state').select('data').eq('workspace_id',ws).maybeSingle();if(!current())return;if(result.error)throw result.error;
  const member=await sb.from('workspace_members').select('role').eq('workspace_id',ws).eq('user_id',user.id).maybeSingle();if(!current())return;if(member.error)throw member.error;
  let data=result.data&&result.data.data;
  if(!data||Object.keys(data).length===0)data={_kambaArea:kind,version:1,entries:[]};
  if(!kxDocument(kind,data))throw Error('Os dados desta área têm um formato diferente. Nada foi substituído.');
  const role=member.data&&member.data.role;
  if(!['admin','member','viewer'].includes(role))throw Error('Não foi possível confirmar o teu papel neste espaço.');
  mode=null;KX_STATE={kind,ws,epoch,owner:user.id,data,role,busy:false,month:kxToday().slice(0,7),edit:null};kxRender();
 }catch(e){if(current())toast(e.message||'Não foi possível abrir esta área.')}
}
async function kxPersist(ctx,data){
 if(ctx!==KX_STATE||ctx.epoch!==SESSION_EPOCH||!user||ctx.owner!==user.id)return false;
 if(ctx.busy)return false;
 if(!['admin','member'].includes(ctx.role)){toast('O teu acesso é apenas de consulta.');return false}
 if(!kxDocument(ctx.kind,data)){toast('Confirma os dados antes de guardar.');return false}
 ctx.busy=true;kxBusy();
 try{
  const r=await sb.from('subscriptions').select('*');
  if(ctx!==KX_STATE||ctx.epoch!==SESSION_EPOCH)return false;
  if(r.error){resetAccess();throw Error('Não foi possível validar a subscrição.')}
  SUBS=r.data||[];entCalc();if(!ENT[ctx.kind])throw Error('Subscrição inativa. Renova antes de guardar.');
  const saved=await sb.from('app_state').upsert({workspace_id:ctx.ws,data,updated_at:new Date().toISOString()});
  if(saved.error)throw saved.error;
  if(ctx!==KX_STATE||ctx.epoch!==SESSION_EPOCH)return false;
  ctx.data=data;return true;
 }catch(e){if(ctx===KX_STATE)toast(e.message||'Não foi possível guardar. Mantém o formulário aberto e tenta novamente.');return false}
 finally{ctx.busy=false;if(ctx===KX_STATE)kxBusy()}
}
function kxBusy(){document.querySelectorAll('[data-kx-write]').forEach(el=>el.disabled=!!(KX_STATE&&KX_STATE.busy))}
function kxRender(){
 const ctx=KX_STATE;if(!ctx)return;const cfg=KX_CONFIG[ctx.kind],write=['admin','member'].includes(ctx.role),totals=kxTotals(ctx.kind,ctx.data.entries,ctx.month);
 const selected=ctx.edit&&ctx.data.entries.find(x=>x.id===ctx.edit);
 const rows=ctx.data.entries.filter(x=>x.date.slice(0,7)===ctx.month).slice().sort((a,b)=>b.date.localeCompare(a.date));
 A.innerHTML=`<div class="kx-area ${ctx.kind==='senior'?'kx-senior':''}"><header><div class="brand"><div class="logo">₭</div><div><h1>${esc(cfg.title)}</h1><p>Registos individuais</p></div></div><div class="hb"><button class="secondary" data-kx="back">Trocar área</button><button class="secondary" data-a="plano">Plano e pagamentos</button><button class="secondary" data-kx="export">Exportar cópia</button><button class="danger" data-a="out">Sair</button></div></header><main>
 <div class="topline"><h2>O meu dinheiro</h2><div class="field"><label for="kx-month">Consultar mês</label><input id="kx-month" type="month" value="${esc(ctx.month)}"></div></div>
 <div class="cards"><section class="panel"><h3>Entradas no mês</h3><strong>${money(totals.incoming)}</strong></section><section class="panel"><h3>Saídas no mês</h3><strong>${money(totals.outgoing)}</strong></section><section class="panel"><h3>Saldo dos registos do mês</h3><strong>${money(totals.balance)}</strong></section></div>
 ${ctx.kind==='raiz'?`<p class="note">Regista apenas valores já recebidos ou pagos. As retiradas pessoais deste mês somam ${money(totals.withdrawals)} e já estão incluídas nas saídas. O saldo não é o lucro nem o saldo bancário.</p>`:'<p class="note">Consulta o dinheiro que entrou e saiu. O saldo corresponde apenas aos registos deste mês.</p>'}
 ${write?`<section class="panel"><h2>${selected?'Alterar registo':'Registar dinheiro'}</h2><form id="kx-form"><div class="fg"><div class="field w"><label for="kx-type">O que aconteceu?</label><select id="kx-type">${Object.entries(cfg.types).map(([v,n])=>`<option value="${v}" ${selected&&selected.type===v?'selected':''}>${esc(n)}</option>`).join('')}</select></div><div class="field w"><label for="kx-desc">Descrição</label><input id="kx-desc" maxlength="80" required value="${esc(selected?selected.desc:'')}" placeholder="${ctx.kind==='senior'?'Ex.: Pensão, alimentação':'Ex.: Venda do dia, compra de mercadoria'}"></div><div class="field"><label for="kx-amount">Valor em Kz</label><input id="kx-amount" type="number" inputmode="numeric" min="1" max="1000000000000" step="1" required value="${selected?selected.amount:''}"></div><div class="field"><label for="kx-date">Data</label><input id="kx-date" type="date" required value="${selected?selected.date:kxToday()}"></div></div><div class="row2"><button class="primary" data-kx-write>${selected?'Guardar alteração':'Guardar registo'}</button>${selected?'<button type="button" class="secondary" data-kx="cancel">Cancelar alteração</button>':''}</div><p class="mu" role="status" id="kx-status" aria-live="polite"></p></form></section>`:'<p class="note">Tens acesso de consulta. Só os membros autorizados podem registar alterações.</p>'}
 <section class="panel" style="margin-top:20px"><h2>Registos do mês (${rows.length})</h2>${rows.length?rows.map(x=>`<div class="tx"><div class="tb"><strong>${esc(x.desc)}</strong><small>${esc(cfg.types[x.type])} · ${esc(fd(x.date))}</small></div><div class="ta"><strong>${cfg.incoming.includes(x.type)?'+':'−'} ${money(x.amount)}</strong>${write?`<div><button class="secondary small" data-kx="edit" data-id="${esc(x.id)}" data-kx-write>Alterar</button><button class="danger small" data-kx="delete" data-id="${esc(x.id)}" data-kx-write>Eliminar</button></div>`:''}</div></div>`).join(''):'<p class="empty">Ainda não há registos neste mês.</p>'}</section></main><footer>Os registos são de organização financeira. Exporta cópias regularmente.</footer></div>`;
 kxBusy();
}
async function kxSubmit(form){
 const ctx=KX_STATE;if(!ctx||ctx.busy)return;if(!form.checkValidity()){form.reportValidity();return}
 const entry={id:ctx.edit||uid(),type:$('#kx-type').value,desc:$('#kx-desc').value.trim(),amount:Number($('#kx-amount').value),date:$('#kx-date').value};
 if(!kxEntry(ctx.kind,entry))return toast('Confirma a descrição, o valor inteiro e a data.');
 const data=JSON.parse(JSON.stringify(ctx.data));
 if(ctx.edit){const idx=data.entries.findIndex(x=>x.id===ctx.edit);if(idx<0)return toast('Registo não encontrado.');data.entries[idx]=entry}else data.entries.push(entry);
 if(await kxPersist(ctx,data)){ctx.month=entry.date.slice(0,7);ctx.edit=null;kxRender();toast('Registo guardado.')}
}
function kxExport(){
 const ctx=KX_STATE;if(!ctx)return;
 const payload={app:'Kamba Gestão',version:1,area:ctx.kind,exportedAt:new Date().toISOString(),data:ctx.data};
 const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
 const link=document.createElement('a');link.href=url;link.download=`kamba-${ctx.kind}-${kxToday()}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
document.addEventListener('submit',e=>{if(e.target.id!=='kx-form')return;e.preventDefault();kxSubmit(e.target)});
document.addEventListener('change',e=>{if(e.target.id==='kx-month'&&KX_STATE&&/^\d{4}-\d{2}$/.test(e.target.value)){KX_STATE.month=e.target.value;KX_STATE.edit=null;kxRender()}});
document.addEventListener('click',async e=>{
 const button=e.target.closest('[data-kx]');if(!button)return;const action=button.dataset.kx,ctx=KX_STATE;if(!ctx)return;
 if(action==='back'){if(ctx.busy)return toast('Aguarda que o registo termine.');KX_STATE=null;return gate()}
 if(action==='export')return kxExport();
 if(ctx.busy)return;
 if(action==='cancel'){ctx.edit=null;return kxRender()}
 if(action==='edit'){ctx.edit=button.dataset.id;kxRender();$('#kx-desc').focus();return}
 if(action==='delete'){
  const record=ctx.data.entries.find(x=>x.id===button.dataset.id);if(!record||!confirm('Eliminar este registo?'))return;
  const data=JSON.parse(JSON.stringify(ctx.data));data.entries=data.entries.filter(x=>x.id!==record.id);
  if(await kxPersist(ctx,data)){ctx.edit=null;kxRender();toast('Registo eliminado.')}
 }
});
