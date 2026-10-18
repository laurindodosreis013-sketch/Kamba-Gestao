/* Casais / Intergeracional: registos por linha, visibilidade privada por defeito.
   O servidor, não as variáveis locais, verifica todos os acessos e revisões. */
let KS_STATE=null;
const KS_TITLES={couples:'Kamba Casais',intergenerational:'Meu Kamba Intergeracional'};
const KS_TYPES={income:'Receita recebida',expense:'Despesa paga',budget:'Orçamento mensal',goal:'Objetivo de poupança',contribution:'Contribuição para objetivo',reminder:'Lembrete',gift:'Presente planeado'};
function ksMoney(value){return new Intl.NumberFormat('pt-PT').format(value)+' Kz'}
function ksCanEdit(record,uid,role){return record.visibility==='private'?record.author_id===uid:role!=='viewer'&&(record.author_id===uid||role==='owner')}
function ksValid(kind,visibility,data){
 return Object.hasOwn(KS_TYPES,kind)&&['private','shared'].includes(visibility)&&data&&typeof data.desc==='string'&&data.desc.trim().length>0&&data.desc.length<=80&&kxDate(data.date)&&Number.isSafeInteger(data.amount)&&data.amount>=0&&data.amount<=1000000000000&&(kind==='reminder'||data.amount>0)&&typeof data.category==='string'&&data.category.length<=60&&(kind!=='budget'||data.category.trim().length>0)&&typeof data.done==='boolean'&&(kind!=='contribution'||typeof data.goal_id==='string'&&/^[0-9a-f-]{36}$/i.test(data.goal_id));
}
function ksSummary(rows,month,scope){
 const selected=rows.filter(x=>x.visibility===scope&&x.data.date.slice(0,7)===month);
 const amount=kind=>selected.filter(x=>x.kind===kind).reduce((n,x)=>n+BigInt(x.data.amount),0n);
 return {income:amount('income'),expense:amount('expense'),contributed:amount('contribution'),balance:amount('income')-amount('expense')};
}
function ksGoalProgress(goal,rows){return rows.filter(x=>x.kind==='contribution'&&x.data.goal_id===goal.id).reduce((n,x)=>n+BigInt(x.data.amount),0n)}
function ksBudgetSpent(budget,rows){return rows.filter(x=>x.kind==='expense'&&x.visibility===budget.visibility&&(budget.visibility==='shared'||x.author_id===budget.author_id)&&x.data.category===budget.data.category&&x.data.date.slice(0,7)===budget.data.date.slice(0,7)).reduce((n,x)=>n+BigInt(x.data.amount),0n)}
async function ksCall(name,args){const result=await sb.rpc(name,args);if(result.error)throw Error(result.error.message||'Operação recusada.');return result.data}
function ksCurrent(ctx){return KS_STATE===ctx&&ctx.epoch===SESSION_EPOCH&&user&&ctx.owner===user.id}
async function ksEnter(kind){
 if(!Object.hasOwn(KS_TITLES,kind)||!user)return;
 ++ENTER_SEQ;mode=null;KX_STATE=null;
 const ctx={kind,epoch:SESSION_EPOCH,owner:user.id,group:null,groups:[],invites:[],rows:[],people:[],pending:[],busy:false,edit:null,scope:'private',month:kxToday().slice(0,7)};KS_STATE=ctx;
 try{
  if(!SERVER_IMPLEMENTED.includes(kind))throw Error('Aplica primeiro a migração 016 no Supabase.');
  const [groups,invites]=await Promise.all([sb.from('kamba_groups').select('*').eq('kind',kind).order('created_at'),ksCall('kamba_pending_invites',{})]);
  if(!ksCurrent(ctx))return;if(groups.error)throw groups.error;ctx.groups=groups.data||[];ctx.invites=(invites||[]).filter(x=>x.kind===kind);ksRenderHome();
 }catch(e){if(ksCurrent(ctx)){KS_STATE=null;gate();toast(e.message||'Não foi possível carregar a área.')}}
}
function ksHomeMarkup(ctx){return `<h2>Os meus espaços</h2><p class="note">Os dados privados são visíveis apenas ao autor. Partilha um registo apenas quando quiseres que os participantes aceites o consultem.</p><section class="panel"><form id="ks-create"><label for="ks-title">Nome de um espaço novo</label><input id="ks-title" maxlength="80" required placeholder="Ex.: A nossa organização"><button class="primary" data-ks-write>Criar espaço com o meu plano</button></form><p class="mu">Criar exige uma subscrição própria válida. Convites aceites dão acesso apenas ao espaço do titular, enquanto o plano dele estiver válido.</p></section>${ctx.groups.map(g=>`<section class="panel" style="margin-top:12px"><h3>${esc(g.title)}</h3><button class="primary" data-ks="open" data-id="${esc(g.id)}">Abrir</button></section>`).join('')||'<p>Ainda não tens espaços. Podes criar um ou aceitar um convite.</p>'}<h2>Convites recebidos</h2>${ctx.invites.map(i=>`<section class="panel"><strong>${esc(i.title)}</strong><p>De: ${esc(i.inviter_email)} · Acesso: ${i.role==='viewer'?'consulta partilhada':'edição dos próprios registos partilhados'}</p><p class="mu">O titular pode consultar tudo o que marcares como partilhado. Os teus registos privados permanecem privados.</p><button class="primary" data-ks="accept" data-id="${esc(i.id)}" data-ks-write>Aceitar convite</button> <button class="secondary" data-ks="decline" data-id="${esc(i.id)}" data-ks-write>Recusar</button></section>`).join('')||'<p>Sem convites pendentes.</p>'}`}
function ksShell(body){const ctx=KS_STATE;A.innerHTML=`<div class="ks-area"><header><div class="brand"><div class="logo">₭</div><h1>${esc(KS_TITLES[ctx.kind])}</h1></div><div class="hb"><button class="secondary" data-ks="back">Trocar área</button><button class="secondary" data-ks="home">Os meus espaços</button><button class="secondary" data-a="plano">Planos e pagamentos</button><button class="danger" data-a="out">Sair</button></div></header><main>${body}</main><footer>Os registos privados não são exportados para outros participantes. A revogação impede consultas futuras; não apaga cópias já exportadas.</footer></div>`;ksBusy()}
function ksRenderHome(){if(KS_STATE)ksShell(ksHomeMarkup(KS_STATE))}
async function ksOpen(id){
 const ctx=KS_STATE;if(!ctx||ctx.busy)return;ctx.busy=true;ksBusy();
 try{
  const g=await sb.from('kamba_groups').select('*').eq('id',id).maybeSingle();if(!ksCurrent(ctx))return;
  if(g.error||!g.data||g.data.kind!==ctx.kind)throw Error('Espaço indisponível.');
  const role=await ksCall('kamba_group_role',{p_group:id});if(!ksCurrent(ctx))return;
  if(!role)throw Error('O teu acesso a este espaço terminou.');
  const active=await ksCall('kamba_group_active',{p_group:id});if(!ksCurrent(ctx))return;
  ctx.group=g.data;ctx.role=role;ctx.active=active;ctx.rows=[];ctx.people=[];ctx.pending=[];
  if(active){
   for(let offset=0;;offset+=500){const r=await sb.from('kamba_shared_records').select('*').eq('group_id',id).order('id').range(offset,offset+499);if(!ksCurrent(ctx))return;if(r.error)throw r.error;ctx.rows.push(...r.data||[]);if(!r.data||r.data.length<500)break}
  }
  if(role==='owner'){
   const [people,invites]=await Promise.all([ksCall('kamba_group_people',{p_group:id}),sb.from('kamba_group_invites').select('*').eq('group_id',id).eq('status','pending')]);if(!ksCurrent(ctx))return;if(invites.error)throw invites.error;ctx.people=people||[];ctx.pending=invites.data||[];
  }
  ctx.edit=null;ksRenderGroup();
 }catch(e){if(ksCurrent(ctx)){ctx.group=null;ctx.rows=[];ksRenderHome();toast(e.message||'Não foi possível abrir o espaço.')}}
 finally{ctx.busy=false;if(ksCurrent(ctx))ksBusy()}
}
function ksRowsMarkup(ctx){
 const filtered=ctx.rows.filter(x=>x.visibility===ctx.scope&&(x.data.date.slice(0,7)===ctx.month||['goal','reminder','gift'].includes(x.kind)));
 return filtered.map(r=>`<article class="panel ks-record"><h3>${esc(r.data.desc)}</h3><p>${esc(KS_TYPES[r.kind])} · ${esc(fd(r.data.date))} · ${r.visibility==='private'?'Privado':'Partilhado'} · ${r.author_id===user.id?'Meu registo':'Outro participante'}</p><strong>${ksMoney(r.data.amount)}</strong>${r.kind==='goal'?`<p>Contribuições visíveis: ${ksMoney(ksGoalProgress(r,ctx.rows))} / ${ksMoney(r.data.amount)}</p>`:''}${r.kind==='budget'?`<p>Despesas da categoria neste mês e visibilidade: ${ksMoney(ksBudgetSpent(r,ctx.rows))} / ${ksMoney(r.data.amount)}</p>`:''}${['reminder','gift'].includes(r.kind)?`<p>${r.data.done?'Concluído':'Pendente'}${!r.data.done&&r.data.date<kxToday()?' · Data ultrapassada':''}</p>`:''}${ksCanEdit(r,user.id,ctx.role)?`<div><button class="secondary" data-ks="edit" data-id="${esc(r.id)}" data-ks-write>Alterar</button> <button class="danger" data-ks="delete" data-id="${esc(r.id)}" data-ks-write>Eliminar</button></div>`:''}</article>`).join('')||'<p>Sem registos nesta seleção.</p>';
}
function ksFormMarkup(ctx){
 const edit=ctx.edit&&ctx.rows.find(x=>x.id===ctx.edit),d=edit?edit.data:{desc:'',amount:'',date:kxToday(),category:'',done:false};
 const goals=ctx.rows.filter(x=>x.kind==='goal');
 return `<section class="panel"><h2>${edit?'Alterar registo':'Novo registo'}</h2><form id="ks-record-form"><div class="fg"><div class="field"><label for="ks-type">Tipo</label><select id="ks-type" ${edit?'disabled':''}>${Object.entries(KS_TYPES).map(([k,n])=>`<option value="${k}" ${edit&&edit.kind===k?'selected':''}>${esc(n)}</option>`).join('')}</select></div><div class="field"><label for="ks-visibility">Quem pode ver?</label><select id="ks-visibility" ${edit&&edit.author_id!==user.id?'disabled':''}><option value="private" ${!edit||edit.visibility==='private'?'selected':''}>Só eu (privado)</option><option value="shared" ${edit&&edit.visibility==='shared'?'selected':''} ${ctx.role==='viewer'?'disabled':''}>Participantes aceites (partilhado)</option></select></div><div class="field w"><label for="ks-desc">Descrição</label><input id="ks-desc" required maxlength="80" value="${esc(d.desc)}"></div><div class="field"><label for="ks-amount">Valor / limite / objetivo (Kz)</label><input id="ks-amount" type="number" required min="0" max="1000000000000" step="1" value="${d.amount}"><small>Zero apenas em lembretes.</small></div><div class="field"><label for="ks-date">Data / prazo</label><input id="ks-date" type="date" required value="${esc(d.date)}"></div><div class="field"><label for="ks-category">Categoria (obrigatória em orçamento)</label><input id="ks-category" maxlength="60" value="${esc(d.category||'')}"></div><div class="field"><label for="ks-goal">Objetivo (só para contribuição)</label><select id="ks-goal"><option value="">Seleciona se for contribuição</option>${goals.map(g=>`<option value="${esc(g.id)}" ${d.goal_id===g.id?'selected':''}>${esc(g.data.desc)} (${g.visibility==='private'?'privado':'partilhado'})</option>`).join('')}</select></div><div class="field"><label for="ks-done">Estado do lembrete/presente</label><select id="ks-done"><option value="false">Pendente</option><option value="true" ${d.done?'selected':''}>Concluído</option></select></div></div><p class="note">Partilhar permite aos participantes aceites ler este registo. Um titular pode alterar registos partilhados; nunca pode consultar os teus registos privados. Presentes e lembretes são planeamento, não despesas pagas.</p><button class="primary" data-ks-write>Guardar</button> ${edit?'<button type="button" class="secondary" data-ks="cancel">Cancelar alteração</button>':''}</form></section>`;
}
function ksPeopleMarkup(ctx){return ctx.role==='owner'?`<section class="panel"><h2>Participantes e consentimento</h2><p>Novos convites começam em consulta. A pessoa tem de aceitar na própria conta.</p><form id="ks-invite-form"><div class="fg"><div class="field"><label for="ks-email">E-mail exato da pessoa</label><input id="ks-email" type="email" required maxlength="254"></div><div class="field"><label for="ks-role">Acesso aos registos partilhados</label><select id="ks-role"><option value="viewer">Consulta</option><option value="editor">Criar e alterar os próprios registos</option></select></div></div><button class="primary" data-ks-write ${ctx.active?'':'disabled'}>Guardar convite</button></form><p class="mu">A pessoa deve ter uma conta com esse e-mail. O convite aparece nessa conta; não é enviado e-mail automaticamente.</p>${ctx.people.map(m=>`<p>${esc(m.email)} · ${m.role==='viewer'?'Consulta':'Edição dos próprios registos'} <button class="danger" data-ks="remove" data-id="${esc(m.user_id)}" data-ks-write>Revogar acesso</button></p>`).join('')}${ctx.pending.map(i=>`<p>${esc(i.invited_email)} · Convite ${new Date(i.expires_at)>new Date()?'pendente':'expirado'} <button class="danger" data-ks="revoke" data-id="${esc(i.id)}" data-ks-write>Revogar convite</button></p>`).join('')}</section>`:`<section class="panel"><p>Para sair, exporta primeiro os teus registos. A saída termina as consultas futuras e mantém os registos históricos no espaço, respeitando a privacidade original.</p><button class="danger" data-ks="leave" data-ks-write>Sair deste espaço</button></section>`}
function ksRenderGroup(){
 const ctx=KS_STATE;if(!ctx||!ctx.group)return;
 const total=ksSummary(ctx.rows,ctx.month,ctx.scope);
 ksShell(`<h2>${esc(ctx.group.title)}</h2><div class="ks-toolbar"><button class="secondary" data-ks="refresh">Atualizar dados</button><button class="secondary" data-ks="export">Exportar registos visíveis</button></div>${ctx.active?`<div class="fg"><div class="field"><label for="ks-scope">Consultar</label><select id="ks-scope"><option value="private" ${ctx.scope==='private'?'selected':''}>Os meus registos privados</option><option value="shared" ${ctx.scope==='shared'?'selected':''}>Registos partilhados</option></select></div><div class="field"><label for="ks-month">Mês</label><input id="ks-month" type="month" value="${esc(ctx.month)}"></div></div><div class="cards"><section class="panel"><h3>Receitas</h3><strong>${ksMoney(total.income)}</strong></section><section class="panel"><h3>Despesas</h3><strong>${ksMoney(total.expense)}</strong></section><section class="panel"><h3>Saldo dos registos</h3><strong>${ksMoney(total.balance)}</strong></section><section class="panel"><h3>Contribuições para objetivos</h3><strong>${ksMoney(total.contributed)}</strong></section></div><p class="mu">Os valores correspondem à seleção e ao mês. Contribuições não são contadas outra vez como despesas. Lembretes aparecem na aplicação; não são notificações automáticas.</p>${ksFormMarkup(ctx)}<h2>Registos</h2>${ksRowsMarkup(ctx)}`:'<p class="note">A subscrição do titular está inativa. Os registos financeiros estão bloqueados. A revogação de participantes continua disponível.</p>'}${ksPeopleMarkup(ctx)}`);
}
function ksBusy(){document.querySelectorAll('[data-ks-write]').forEach(x=>{if(KS_STATE&&KS_STATE.busy)x.disabled=true;else x.disabled=!!(x.closest('#ks-invite-form')&&KS_STATE&&KS_STATE.group&&!KS_STATE.active)})}
async function ksWrite(work,refresh=true){const ctx=KS_STATE;if(!ctx||ctx.busy)return;ctx.busy=true;ksBusy();try{await work();if(!ksCurrent(ctx))return;ctx.busy=false;if(refresh&&ctx.group)await ksOpen(ctx.group.id);else if(refresh)await ksEnter(ctx.kind)}catch(e){if(ksCurrent(ctx))toast(e.message||'Não foi possível guardar.')}finally{ctx.busy=false;if(ksCurrent(ctx))ksBusy()}}
async function ksSubmitRecord(form){
 const ctx=KS_STATE;if(!ctx||ctx.busy||!form.checkValidity()){if(form)form.reportValidity();return}
 const kind=$('#ks-type').value,visibility=$('#ks-visibility').value;
 const data={desc:$('#ks-desc').value.trim(),amount:Number($('#ks-amount').value),date:$('#ks-date').value,category:$('#ks-category').value.trim(),done:$('#ks-done').value==='true'};
 if(kind==='contribution')data.goal_id=$('#ks-goal').value;
 if(!ksValid(kind,visibility,data))return toast('Confirma os valores, a data, a categoria ou o objetivo.');
 const old=ctx.edit&&ctx.rows.find(x=>x.id===ctx.edit);
 await ksWrite(()=>ksCall('kamba_save_record',{p_group:ctx.group.id,p_id:old?old.id:null,p_kind:kind,p_visibility:visibility,p_data:data,p_rev:old?old.rev:0}));
}
async function ksExport(){const ctx=KS_STATE;if(!ctx||!ctx.group||!ctx.active)return;const payload={app:'Kamba Gestão',area:ctx.kind,group:ctx.group.title,exportedAt:new Date().toISOString(),records:ctx.rows};const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`kamba-${ctx.kind}-${kxToday()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
document.addEventListener('submit',e=>{
 if(!e.target.id.startsWith('ks-'))return;e.preventDefault();const ctx=KS_STATE;if(!ctx||!e.target.checkValidity()){e.target.reportValidity();return}
 if(e.target.id==='ks-record-form')return ksSubmitRecord(e.target);
 if(e.target.id==='ks-create'){const title=$('#ks-title').value.trim();return ksWrite(()=>ksCall('kamba_create_group',{p_kind:ctx.kind,p_title:title}))}
 if(e.target.id==='ks-invite-form'){const email=$('#ks-email').value.trim(),role=$('#ks-role').value;return ksWrite(()=>ksCall('kamba_invite',{p_group:ctx.group.id,p_email:email,p_role:role}))}
});
document.addEventListener('change',e=>{const ctx=KS_STATE;if(!ctx||ctx.busy)return;if(e.target.id==='ks-scope'){ctx.scope=e.target.value;ctx.edit=null;ksRenderGroup()}if(e.target.id==='ks-month'&&/^\d{4}-\d{2}$/.test(e.target.value)){ctx.month=e.target.value;ctx.edit=null;ksRenderGroup()}});
document.addEventListener('click',e=>{
 const b=e.target.closest('[data-ks]'),ctx=KS_STATE;if(!b||!ctx||ctx.busy)return;const action=b.dataset.ks,id=b.dataset.id;
 if(action==='back'){KS_STATE=null;return gate()}
 if(action==='home')return ksEnter(ctx.kind);
 if(action==='open')return ksOpen(id);
 if(action==='refresh')return ksOpen(ctx.group.id);
 if(action==='export')return ksExport();
 if(action==='edit'){ctx.edit=id;ksRenderGroup();$('#ks-desc').focus();return}
 if(action==='cancel'){ctx.edit=null;return ksRenderGroup()}
 if(action==='accept'||action==='decline')return ksWrite(()=>ksCall('kamba_accept_invite',{p_invite:id,p_accept:action==='accept'}));
 if(action==='revoke'&&confirm('Revogar este convite?'))return ksWrite(()=>ksCall('kamba_revoke_invite',{p_invite:id}));
 if(action==='remove'&&confirm('Revogar o acesso deste participante? Os registos históricos são mantidos.'))return ksWrite(()=>ksCall('kamba_remove_member',{p_group:ctx.group.id,p_user:id}));
 if(action==='leave'&&confirm('Exportaste os teus registos? Sair termina o teu acesso ao espaço.'))return ksWrite(async()=>{await ksCall('kamba_remove_member',{p_group:ctx.group.id,p_user:user.id});ctx.group=null});
 if(action==='delete'&&confirm('Eliminar este registo?')){const record=ctx.rows.find(x=>x.id===id);if(record)return ksWrite(()=>ksCall('kamba_delete_record',{p_id:id,p_rev:record.rev}))}
});
