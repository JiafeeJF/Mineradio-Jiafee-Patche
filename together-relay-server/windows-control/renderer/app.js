'use strict';

const api = window.relayControl;
const state = { config: null, service: null, logs: [], dirty: false, uptimeTimer: null };
const $ = (id) => document.getElementById(id);
const viewMeta = {
  overview: ['中转服务总览', '管理双人房间、连接入口和服务健康状态。'],
  settings: ['中转服务配置', '修改监听、安全和 Windows 启动行为。'],
  logs: ['运行日志与诊断', '检查启动、连接和异常恢复记录。'],
};

function toast(message, kind = 'info') {
  const item = document.createElement('div');
  item.className = 'toast'; item.dataset.kind = kind; item.textContent = message;
  $('toast-region').append(item);
  setTimeout(() => item.remove(), 3600);
}

function setView(name) {
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('is-active', item.dataset.view === name));
  document.querySelectorAll('.view').forEach((item) => item.classList.toggle('is-active', item.id === `view-${name}`));
  $('view-title').textContent = viewMeta[name][0]; $('view-copy').textContent = viewMeta[name][1];
}

function phaseLabel(phase) {
  return ({ stopped:'已停止', starting:'启动中', running:'运行中', stopping:'停止中', error:'异常' })[phase] || phase;
}

function formatDuration(ms) {
  if (!ms || ms < 0) return '00:00:00';
  const seconds = Math.floor(ms / 1000); const h = Math.floor(seconds / 3600); const m = Math.floor((seconds % 3600) / 60); const s = seconds % 60;
  return [h,m,s].map((value) => String(value).padStart(2,'0')).join(':');
}

function renderState(next) {
  state.service = next;
  const running = next.phase === 'running'; const busy = ['starting','stopping'].includes(next.phase);
  $('service-badge').dataset.state = next.phase; $('service-badge').querySelector('span').textContent = phaseLabel(next.phase);
  $('start-service').disabled = running || busy; $('stop-service').disabled = !running && next.phase !== 'starting'; $('restart-service').disabled = !running || busy;
  $('metric-process').textContent = phaseLabel(next.phase); $('metric-pid').textContent = next.pid ? `PID ${next.pid}` : (next.lastError || '无活动进程');
  $('metric-members').textContent = `${next.members || 0} / ${next.maxMembers || 2}`;
  $('metric-room').textContent = next.members === 2 ? '双人房间已建立' : next.members === 1 ? '等待另一位听众' : running ? '房间空闲' : '等待服务启动';
  $('metric-endpoint').textContent = next.endpoint || endpointFromConfig();
  $('metric-health').textContent = next.healthy ? 'TCP/HTTP 健康检查正常' : running ? '等待健康检查' : '健康检查未运行';
  $('listener-stage').dataset.members = String(next.members || 0);
  $('signal-label').textContent = next.members === 2 ? '同步通道已建立' : next.members === 1 ? '等待配对' : running ? '等待连接' : '服务未运行';
  $('capacity-label').textContent = next.members === 2 ? '房间已满' : next.members === 1 ? '1 个空位' : '空闲';
  $('room-note').textContent = next.lastError || (next.members === 2 ? '两名听众已连接；播放状态由中转服务权威同步。' : '双方使用相同地址和授权码加入此房间。');
  updateCheck('check-service', running && next.healthy, running ? (next.healthy ? '进程与健康检查正常' : '进程运行，健康检查待确认') : phaseLabel(next.phase));
  if (window.__relayTrayRefresh) window.__relayTrayRefresh(next);
}

function updateCheck(id, ok, copy) { const node=$(id); node.classList.toggle('is-ok',!!ok); node.querySelector('span').textContent=copy; }
function endpointFromConfig(){if(!state.config)return '未配置';return state.config.publicAddress || `${state.config.host}:${state.config.port}`}

function renderLogs() {
  const container = $('log-console'); const recent = $('recent-events');
  if (!state.logs.length) { container.innerHTML='<div class="empty-state">启动服务后将在这里显示日志</div>'; recent.innerHTML='<div class="empty-state">暂无运行事件</div>'; return; }
  const make = (entry, compact=false) => {
    const row=document.createElement('div'); row.className=compact?'event-row':'log-line'; row.dataset.level=entry.level;
    const time=document.createElement('time'); const date=new Date(entry.time); time.textContent=compact?date.toLocaleTimeString('zh-CN',{hour12:false}):date.toLocaleTimeString('zh-CN',{hour12:false});
    const level=document.createElement('b'); level.textContent=entry.level;
    const message=document.createElement('span'); message.textContent=entry.message;
    row.append(time,level,message); return row;
  };
  container.replaceChildren(...state.logs.map((entry)=>make(entry)));
  recent.replaceChildren(...state.logs.slice(-5).reverse().map((entry)=>make(entry,true)));
  container.scrollTop=container.scrollHeight;
}

function fillSettings(config) {
  state.config = config;
  $('room-name').value=config.roomName; $('host').value=config.host; $('port').value=config.port; $('public-address').value=config.publicAddress;
  $('allow-lan').checked=config.allowLanWithoutAuth; $('debug').checked=config.debug; $('auto-start-app').checked=config.autoStartApp;
  $('auto-start-service').checked=config.autoStartService; $('restart-on-crash').checked=config.restartOnCrash; $('start-minimized').checked=config.startMinimized;
  $('authorization-code').value=''; $('authorization-code').placeholder=config.authorizationCodeConfigured?'已安全保存':'请输入 6 位数字';
  $('metric-endpoint').textContent=endpointFromConfig();
  updateCheck('check-endpoint',!!config.publicAddress,config.publicAddress||'建议填写域名:端口');
  updateCheck('check-firewall',false,`需放行 TCP ${config.port} 端口`);
}

function formValue() {
  return { roomName:$('room-name').value,host:$('host').value,port:Number($('port').value),publicAddress:$('public-address').value,allowLanWithoutAuth:$('allow-lan').checked,debug:$('debug').checked,autoStartApp:$('auto-start-app').checked,autoStartService:$('auto-start-service').checked,restartOnCrash:$('restart-on-crash').checked,startMinimized:$('start-minimized').checked,serverId:state.config.serverId };
}

function showErrors(errors={}) {
  document.querySelectorAll('[data-error]').forEach((node)=>node.textContent=errors[node.dataset.error]||'');
  for(const input of document.querySelectorAll('input')) input.removeAttribute('aria-invalid');
  const map={roomName:'room-name',host:'host',port:'port',publicAddress:'public-address',authorizationCode:'authorization-code'};
  for(const key of Object.keys(errors)){const input=$(map[key]);if(input)input.setAttribute('aria-invalid','true')}
}

async function action(name, success) {
  document.querySelectorAll('.service-actions button').forEach((button)=>button.disabled=true);
  try { const result=await api[name](); renderState(result); toast(success); }
  catch(error){toast(error.message||String(error),'error')}
  finally{if(state.service)renderState(state.service)}
}

document.querySelectorAll('[data-view]').forEach((button)=>button.addEventListener('click',()=>setView(button.dataset.view)));
document.querySelectorAll('[data-view-jump]').forEach((button)=>button.addEventListener('click',()=>setView(button.dataset.viewJump)));
$('start-service').addEventListener('click',()=>action('start','中转服务已启动。'));
$('stop-service').addEventListener('click',()=>action('stop','中转服务已停止。'));
$('restart-service').addEventListener('click',()=>action('restart','中转服务已重新启动。'));
$('copy-endpoint').addEventListener('click',async()=>{await navigator.clipboard.writeText(endpointFromConfig());toast('连接地址已复制。')});
$('copy-firewall').addEventListener('click',async()=>{await api.getFirewallCommand(state.config.port);toast('PowerShell 防火墙命令已复制，请以管理员身份执行。')});
$('reveal-code').addEventListener('click',async()=>{const input=$('authorization-code');if(input.type==='password'){input.value=await api.revealAuthorizationCode();input.type='text';$('reveal-code').textContent='隐藏'}else{input.type='password';$('reveal-code').textContent='显示'}});
$('generate-code').addEventListener('click',async()=>{$('authorization-code').value=await api.generateAuthorizationCode();$('authorization-code').type='text';$('reveal-code').textContent='隐藏';toast('已生成新的授权码，保存后生效。')});
$('settings-form').addEventListener('submit',async(event)=>{event.preventDefault();const code=$('authorization-code').value;const result=await api.saveConfig(formValue(),code);showErrors(result.errors);const message=$('settings-message');if(!result.ok){message.textContent='请修正标记的配置项。';message.dataset.kind='error';return}fillSettings(result.config);message.textContent=state.service&&state.service.phase==='running'?'配置已保存，重启服务后生效。':'配置已保存。';message.dataset.kind='ok';toast(message.textContent)});
$('open-data').addEventListener('click',()=>api.openDataDirectory());
$('clear-logs').addEventListener('click',async()=>{await api.clearLogs();state.logs=[];renderLogs();toast('当前日志视图已清空。')});
$('export-diagnostics').addEventListener('click',async()=>{const result=await api.exportDiagnostics();if(!result.canceled)toast('诊断文件已导出。')});

api.onState(renderState);
api.onLog((entry)=>{state.logs.push(entry);if(state.logs.length>800)state.logs.shift();renderLogs()});
api.onLogsCleared(()=>{state.logs=[];renderLogs()});
setInterval(()=>{$('metric-uptime').textContent=state.service&&state.service.startedAt?formatDuration(Date.now()-state.service.startedAt):'00:00:00'},1000);

(async()=>{try{const data=await api.bootstrap();fillSettings(data.config);state.logs=data.logs||[];renderState(data.state);renderLogs()}catch(error){toast(`控制台初始化失败：${error.message}`,'error')}})();

