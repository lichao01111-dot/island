// 群岛地图与探索日志。使用 DOM 是为了键盘焦点、触控滚动和可读文本；
// 3D 游戏仍由 canvas 渲染，面板打开时主循环冻结。
import { EXPEDITION_ORDER, EXPEDITIONS, type BlueprintKind, type ExpeditionId } from '../world/expeditions';
import { topRightRail } from './ui-rail';

export interface DestinationView {
  id: ExpeditionId;
  unlocked: boolean;
  reason: string;
  visits: number;
  discovered: number;
  total: number;
}

export interface ExpeditionUiOptions {
  getDestinations(): DestinationView[];
  getBlueprints(): BlueprintKind[];
  getObjective(): string;
  depart(id: ExpeditionId): void;
}

export interface ExpeditionUi {
  readonly open: boolean;
  openMap(): void;
  openLog(): void;
  close(): void;
  setAvailable(available: boolean): void;
  refresh(): void;
}

const STYLE = `
  /* 位置交给 #ui-rail 那一列排,这里只管长相。order:1 = 排在"我的岛屿"上面 */
  .exp-map-button{order:1;border:1px solid rgba(255,226,159,.62);border-radius:12px;background:rgba(28,47,40,.88);color:#fff1c8;padding:9px 13px;font:700 13px system-ui;box-shadow:0 8px 24px rgba(0,0,0,.18);cursor:pointer}
  .exp-map-button:hover{background:rgba(54,83,61,.94)}
  .exp-overlay{position:fixed;inset:0;z-index:40;display:none;align-items:center;justify-content:center;padding:calc(20px + env(safe-area-inset-top)) calc(20px + env(safe-area-inset-right)) calc(20px + env(safe-area-inset-bottom)) calc(20px + env(safe-area-inset-left));background:rgba(8,19,19,.72);backdrop-filter:blur(8px)}
  .exp-overlay.open{display:flex}
  .exp-panel{width:min(920px,100%);max-height:min(720px,92vh);overflow:auto;border:1px solid rgba(255,225,157,.42);border-radius:22px;background:linear-gradient(145deg,rgba(35,59,49,.98),rgba(18,38,37,.98));color:#f6f0d7;box-shadow:0 28px 80px rgba(0,0,0,.45)}
  .exp-head{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:10px;padding:18px 20px 14px;background:rgba(25,46,41,.96);border-bottom:1px solid rgba(255,255,255,.1)}
  .exp-title{margin:0 auto 0 0;font:800 22px system-ui;letter-spacing:.04em}
  .exp-tab,.exp-close{border:1px solid rgba(255,255,255,.2);border-radius:10px;background:rgba(255,255,255,.07);color:#f7efd2;padding:8px 12px;font:700 13px system-ui;cursor:pointer}
  .exp-tab.active{background:#d9a85d;color:#20372f;border-color:#f3d291}
  .exp-close{font-size:18px;line-height:1;padding:8px 11px}
  .exp-body{padding:20px}
  .exp-objective{margin:0 0 18px;padding:12px 14px;border-radius:12px;background:rgba(255,218,139,.1);color:#ffe3a7;font:650 14px/1.55 system-ui}
  .exp-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
  .exp-card{display:flex;min-height:285px;flex-direction:column;padding:16px;border:1px solid rgba(255,255,255,.13);border-radius:16px;background:rgba(255,255,255,.055)}
  .exp-card.locked{opacity:.55;filter:saturate(.55)}
  .exp-kicker{color:#d6b979;font:700 12px system-ui;letter-spacing:.08em}
  .exp-card h3{margin:8px 0 5px;font:800 19px system-ui}
  .exp-card p{margin:0;color:#cdd7cd;font:13px/1.6 system-ui}
  .exp-stats{display:flex;gap:8px;margin:14px 0;flex-wrap:wrap}
  .exp-chip{border-radius:999px;background:rgba(0,0,0,.24);padding:5px 8px;color:#e8d8aa;font:700 11px system-ui}
  .exp-depart{margin-top:auto;width:100%;border:1px solid #e7c985;border-radius:11px;background:#c58c43;color:#172c27;padding:10px;font:800 14px system-ui;cursor:pointer}
  .exp-depart:disabled{cursor:not-allowed;border-color:rgba(255,255,255,.14);background:rgba(255,255,255,.08);color:#a7afa9}
  .exp-log{display:grid;gap:12px}
  .exp-log-row{padding:14px 16px;border-radius:13px;background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.1)}
  .exp-log-row strong{display:block;margin-bottom:5px;color:#ffe0a0;font:800 15px system-ui}
  .exp-log-row span{color:#c9d3ca;font:13px/1.55 system-ui}
  @media(max-width:700px){.exp-overlay{padding:8px}.exp-panel{max-height:96vh;border-radius:17px}.exp-head{padding:13px;flex-wrap:wrap}.exp-title{width:100%}.exp-body{padding:13px}.exp-grid{grid-template-columns:1fr}.exp-card{min-height:0}.exp-tab{flex:1}}
`;

export function mountExpeditionUi(options: ExpeditionUiOptions): ExpeditionUi {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const mapButton = document.createElement('button');
  mapButton.className = 'exp-map-button';
  mapButton.type = 'button';
  mapButton.textContent = '航海图';
  mapButton.setAttribute('aria-label', '打开航海图与探索日志');
  mapButton.hidden = true;
  topRightRail().appendChild(mapButton);

  const overlay = document.createElement('div');
  overlay.className = 'exp-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', '群岛航海图');
  overlay.innerHTML = `
    <section class="exp-panel">
      <header class="exp-head">
        <h2 class="exp-title">群岛航海图</h2>
        <button class="exp-tab active" type="button" data-tab="map">航线</button>
        <button class="exp-tab" type="button" data-tab="log">探索日志</button>
        <button class="exp-close" type="button" aria-label="关闭">×</button>
      </header>
      <div class="exp-body"></div>
    </section>`;
  document.body.appendChild(overlay);

  const body = overlay.querySelector<HTMLDivElement>('.exp-body')!;
  const closeButton = overlay.querySelector<HTMLButtonElement>('.exp-close')!;
  const tabs = Array.from(overlay.querySelectorAll<HTMLButtonElement>('.exp-tab'));
  let currentTab: 'map' | 'log' = 'map';
  let isOpen = false;

  function renderMap(): void {
    const views = options.getDestinations();
    body.innerHTML = `<p class="exp-objective">${options.getObjective()}</p><div class="exp-grid"></div>`;
    const grid = body.querySelector<HTMLDivElement>('.exp-grid')!;
    for (const id of EXPEDITION_ORDER) {
      const def = EXPEDITIONS[id];
      const view = views.find((v) => v.id === id)!;
      const card = document.createElement('article');
      card.className = `exp-card${view.unlocked ? '' : ' locked'}`;
      card.innerHTML = `
        <span class="exp-kicker">${def.subtitle}</span>
        <h3>${def.icon} ${def.name}</h3>
        <p>${def.description}</p>
        <div class="exp-stats">
          <span class="exp-chip">航程 ${def.distance}</span>
          <span class="exp-chip">已去 ${view.visits} 次</span>
          <span class="exp-chip">发现 ${view.discovered}/${view.total}</span>
        </div>
        <button class="exp-depart" type="button" ${view.unlocked ? '' : 'disabled'}>${view.unlocked ? '准备出发' : view.reason}</button>`;
      card.querySelector<HTMLButtonElement>('.exp-depart')!.addEventListener('click', () => options.depart(id));
      grid.appendChild(card);
    }
  }

  function renderLog(): void {
    const views = options.getDestinations();
    const blueprints = options.getBlueprints();
    const blueprintLabels: Record<BlueprintKind, string> = {
      campfire: '石砌火塘', shelter: '木屋', collector: '蓄水池', dock: '加固船坞',
    };
    body.innerHTML = `<div class="exp-log"></div>`;
    const log = body.querySelector<HTMLDivElement>('.exp-log')!;
    for (const view of views) {
      const def = EXPEDITIONS[view.id];
      const row = document.createElement('div');
      row.className = 'exp-log-row';
      row.innerHTML = `<strong>${def.name}</strong><span>${view.visits > 0
        ? `远征 ${view.visits} 次，永久发现 ${view.discovered}/${view.total} 处。`
        : view.unlocked ? '航线已标出，尚未登陆。' : `尚未解锁：${view.reason}`}</span>`;
      log.appendChild(row);
    }
    const blue = document.createElement('div');
    blue.className = 'exp-log-row';
    blue.innerHTML = `<strong>带回的建设图纸</strong><span>${blueprints.length > 0
      ? blueprints.map((b) => blueprintLabels[b]).join('、')
      : '还没有找到升级图纸。探索地标，而不只是采集普通资源。'}</span>`;
    log.appendChild(blue);
  }

  function render(): void {
    tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === currentTab));
    if (currentTab === 'map') renderMap(); else renderLog();
  }

  function open(tab: 'map' | 'log'): void {
    currentTab = tab;
    isOpen = true;
    overlay.classList.add('open');
    render();
    closeButton.focus();
  }

  function close(): void {
    isOpen = false;
    overlay.classList.remove('open');
    mapButton.focus();
  }

  mapButton.addEventListener('click', () => open('map'));
  closeButton.addEventListener('click', close);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) close();
    if (e.key.toLowerCase() === 'm' && !isOpen && !mapButton.hidden) open('map');
  });
  for (const tab of tabs) {
    tab.addEventListener('click', () => { currentTab = tab.dataset.tab as 'map' | 'log'; render(); });
  }

  return {
    get open() { return isOpen; },
    openMap: () => open('map'),
    openLog: () => open('log'),
    close,
    setAvailable(available: boolean) { mapButton.hidden = !available; },
    refresh: render,
  };
}
