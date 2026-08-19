// 岛屿分享与参观的 DOM 层。
// 为什么用 DOM 而不是画在 HUD canvas 上:这里要输入文字、要复制链接 ——
// 这两件事在 canvas 里做只会更糟。DOM 浮在 canvas 之上,只有控件本身吃指针事件。
import { encodeIslandCode, readVisitTarget } from './save';
import {
  publishIsland, postMessage, deleteMessage, postGift, claimGifts,
  type IslandMessage, type IslandGift,
} from './api';
import type { HospitalityItem } from '../world/buildings';
import { topRightRail } from './ui-rail';

export interface ShareUi {
  /** 面板是否打开:打开时主循环会把 dt 归零,免得玩家在填名字时被饿死 */
  readonly open: boolean;
  /** 走短 id 参观时,岛名和留言板要等网络回来才知道 */
  setVisitingName(name: string): void;
  /** 参观时站在制图桌前:摊开这座岛的名片 */
  openIslandCard(): void;
  /** 参观时站在码头上:留下一件伴手礼 */
  openGift(): void;
}

/** 可以当伴手礼送出去的一件材料 */
export interface GiftableItem { kind: string; label: string; count: number }

export interface ShareUiOptions {
  /** 非 null 表示正在参观别人的岛 */
  visiting: { name: string; shortId: string | null } | null;
  getIslandName: () => string;
  setIslandName: (name: string) => void;
  /** 我的岛屿码,面板打开时才计算 */
  getIslandCode: () => string;
  /** 短链 id:空字符串表示还没发布过 */
  getShareId: () => string;
  setShareId: (id: string) => void;
  /** 岛主凭证:发布时拿到,改岛/删留言/留言署名都要它 */
  getToken: () => string;
  setToken: (token: string) => void;
  /** 脚下这座岛(自己的或正在参观的)的待客清单与门牌信息 */
  getHospitality: () => {
    day: number; level: number; maxLevel: number; items: HospitalityItem[];
    /** 住客与这座岛现在能留住的人数上限 —— 等级的实际用途 */
    residents: number; capacity: number;
  };
  /** 参观时:自己背包里能当伴手礼送出去的东西 */
  getGiftable: () => GiftableItem[];
  /** 参观时:伴手礼送出成功,从自己的存档里扣掉这一件 */
  onGiftSent: (kind: string) => void;
  /** 回到自己岛上:领到的伴手礼要进背包 */
  onGiftsClaimed: (gifts: IslandGift[]) => void;
}

function timeAgo(at: number): string {
  const mins = Math.floor((Date.now() - at) / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

const CSS = `
#island-ui { position: fixed; inset: 0; z-index: 20; pointer-events: none;
  font: 13px/1.5 "Trebuchet MS", -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  color: #f7f0da; letter-spacing: .01em; }
#island-ui button, #island-ui input { font: inherit; }
/* "我的岛屿"不在 #island-ui 里,它挂在右上角那一列(见 ui-rail.ts),
   所以外观规则要两边都点名,字体也得自己写一遍 —— 那儿继承不到 #island-ui 的 font */
#island-ui .pill, #island-trigger { display: flex; align-items: center; gap: 6px;
  background: linear-gradient(180deg, rgba(42,65,57,.94), rgba(24,42,38,.94));
  border: 1px solid rgba(226,199,133,.52); color: #fff2cc;
  border-radius: 999px; padding: 7px 13px; cursor: pointer; -webkit-tap-highlight-color: transparent;
  box-shadow: 0 5px 18px rgba(4,18,20,.26), inset 0 1px rgba(255,255,255,.12); }
#island-ui .pill { position: absolute; pointer-events: auto; }
#island-trigger { order: 2;
  font: 13px/1.5 "Trebuchet MS", -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  letter-spacing: .01em; }
#island-ui .pill:active, #island-trigger:active { transform: translateY(1px); background: rgba(24,42,38,.98); }
#island-ui #island-visitbar { left: calc(14px + env(safe-area-inset-left)); top: calc(16px + env(safe-area-inset-top)); max-width: calc(100vw - 150px);
  background: rgba(64,45,24,0.82); border-color: rgba(255,205,120,0.5); }
#island-ui #island-visitbar .who { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#island-ui #island-visitbar button { background: rgba(255,224,150,0.16); border: 1px solid rgba(255,224,150,0.5);
  color: #ffe9a8; border-radius: 999px; padding: 3px 10px; cursor: pointer; white-space: nowrap; }
#island-ui .backdrop { position: absolute; inset: 0; pointer-events: auto;
  background: radial-gradient(circle at 50% 42%, rgba(11,28,30,.52), rgba(4,12,17,.78));
  backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; padding: 16px; }
#island-ui .card { width: min(360px, 100%); max-height: 100%; overflow-y: auto;
  background:
    linear-gradient(145deg, rgba(53,73,62,.98), rgba(28,48,43,.98)),
    #243a34;
  border: 1px solid rgba(224,195,128,.62); border-radius: 18px; padding: 20px;
  box-shadow: 0 24px 70px rgba(2,12,15,.48), inset 0 0 0 3px rgba(8,26,24,.22), inset 0 1px rgba(255,255,255,.1); }
#island-ui .card h2 { margin: 0 0 4px; font-size: 18px; color: #ffe4a8; letter-spacing: .08em; }
#island-ui .card h2::after { content: ""; display: block; width: 38px; height: 2px; margin-top: 7px;
  background: linear-gradient(90deg, #e5bf6f, transparent); }
#island-ui .card p.sub { margin: 0 0 16px; font-size: 12px; color: rgba(247,240,218,0.66); }
#island-ui label { display: block; margin: 14px 0 6px; font-size: 11px; font-weight: 700;
  letter-spacing: .08em; color: rgba(255,226,166,.78); }
#island-ui input { width: 100%; box-sizing: border-box; background: rgba(7,23,23,0.48);
  border: 1px solid rgba(226,199,133,.25); border-radius: 10px; padding: 10px 11px; color: #fff5dc;
  box-shadow: inset 0 2px 6px rgba(0,0,0,.2); }
#island-ui input:focus { outline: 2px solid rgba(224,188,103,.72); outline-offset: 0; border-color: transparent; }
#island-ui .row { display: flex; gap: 8px; }
#island-ui .row input { flex: 1; min-width: 0; }
#island-ui .btn { background: linear-gradient(180deg, #659652, #47723f); border: 1px solid rgba(218,238,169,.5);
  color: #fff7df; border-radius: 10px; padding: 9px 14px; cursor: pointer; white-space: nowrap;
  box-shadow: inset 0 1px rgba(255,255,255,.16), 0 3px 9px rgba(2,15,13,.2); font-weight: 700; }
#island-ui .btn:active { transform: translateY(1px); background: #426b3a; }
#island-ui .btn.ghost { background: rgba(233,218,174,0.07); border-color: rgba(233,218,174,0.24); box-shadow: none; }
#island-ui .note { margin: 8px 0 0; font-size: 12px; min-height: 17px; color: rgba(243,239,226,0.6); }
#island-ui .note.bad { color: #ffb0a8; }
#island-ui .note.good { color: #b6e79a; }
#island-ui .btn.wide { width: 100%; margin-top: 8px; }
#island-ui .btn:disabled { opacity: 0.5; cursor: default; }
#island-ui .guestbook { max-height: 168px; overflow-y: auto; }
#island-ui .msg { background: rgba(8,25,24,0.36); border: 1px solid rgba(226,199,133,.11);
  border-radius: 10px; padding: 8px 10px; margin-bottom: 6px; }
#island-ui .msg-head { display: flex; align-items: baseline; gap: 8px; }
#island-ui .msg-from { font-weight: 700; font-size: 12px; color: rgba(243,239,226,0.75); }
#island-ui .msg-from.verified { color: #b6e79a; }
#island-ui .msg-time { font-size: 11px; color: rgba(243,239,226,0.45); }
#island-ui .msg .del { margin-left: auto; background: none; border: 0; padding: 0;
  font-size: 11px; color: rgba(243,239,226,0.4); cursor: pointer; }
#island-ui .msg .del:hover { color: #ffb0a8; }
#island-ui .msg-text { margin: 4px 0 0; font-size: 13px; word-break: break-word; }
#island-ui .close { margin-top: 18px; width: 100%; }
#island-ui .checklist { max-height: 210px; overflow-y: auto; }
#island-ui .check { display: flex; gap: 8px; align-items: baseline; padding: 4px 0; font-size: 12px;
  color: rgba(243,239,226,0.45); }
#island-ui .check.done { color: rgba(243,239,226,0.9); }
#island-ui .check .mark { flex: none; width: 14px; color: rgba(243,239,226,0.3); }
#island-ui .check.done .mark { color: #b6e79a; }
#island-ui .check .pts { margin-left: auto; flex: none; font-size: 11px; color: rgba(255,226,166,.55); }
#island-ui .levelline { display: flex; align-items: baseline; gap: 8px; margin: 2px 0 0; }
#island-ui .levelline b { font-size: 20px; color: #ffe4a8; }
#island-ui .bar { height: 6px; border-radius: 3px; margin-top: 8px; overflow: hidden;
  background: rgba(7,23,23,0.5); box-shadow: inset 0 1px 3px rgba(0,0,0,.3); }
#island-ui .bar i { display: block; height: 100%; background: linear-gradient(90deg, #8fbf63, #e5bf6f); }
#island-ui .gifts { display: flex; flex-wrap: wrap; gap: 6px; }
#island-ui .gift { background: rgba(8,25,24,0.36); border: 1px solid rgba(226,199,133,.22);
  border-radius: 10px; padding: 7px 11px; color: #fff2cc; cursor: pointer; }
#island-ui .gift:disabled { opacity: .45; cursor: default; }
#island-ui .gift.picked { border-color: #b6e79a; background: rgba(96,150,82,0.3); }
#island-ui .gift .n { color: rgba(255,226,166,.62); font-size: 11px; margin-left: 4px; }
`;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, children: Array<Node | string> = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of children) node.append(child);
  return node;
}

/**
 * 一个浮层。参观模式下有三个(留言/名片/伴手礼),同一时刻只该有一个开着 ——
 * 面板开着时主循环把 dt 归零,但按键仍在轮询,不挡住重复打开就会叠出好几层背景。
 */
interface Modal { open(): void; close(): void; readonly isOpen: boolean }

function createModal(
  root: HTMLElement, title: string, body: Array<Node | string>, onToggle: (open: boolean) => void
): Modal {
  const closeBtn = el('button', { className: 'btn ghost close', type: 'button', textContent: '关闭' });
  const card = el('div', { className: 'card' }, [el('h2', { textContent: title }), ...body, closeBtn]);
  const backdrop = el('div', { className: 'backdrop' }, [card]);
  let isOpen = false;
  const close = (): void => { isOpen = false; onToggle(false); backdrop.remove(); };
  const open = (): void => {
    if (isOpen) return;
    isOpen = true; onToggle(true); root.append(backdrop); card.scrollTop = 0;
  };
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  // Esc 关闭:自己岛上的面板本来就支持,做客的这几个不跟上会显得少了一半
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen) close(); });
  return { open, close, get isOpen() { return isOpen; } };
}

/** 待客清单:勾上的写亮,没勾上的压暗,分数摆在右边 —— 缺什么一眼看得见 */
function renderChecklist(host: HTMLElement, items: HospitalityItem[]): void {
  host.textContent = '';
  for (const item of items) {
    host.append(el('div', { className: item.done ? 'check done' : 'check' }, [
      el('span', { className: 'mark', textContent: item.done ? '✓' : '·' }),
      el('span', { textContent: item.label }),
      el('span', { className: 'pts', textContent: `+${item.points}` }),
    ]));
  }
}

export function mountShareUi(opts: ShareUiOptions): ShareUi {
  document.head.append(el('style', { textContent: CSS }));
  const root = el('div', { id: 'island-ui' });
  document.body.append(root);

  if (opts.visiting) {
    // 参观模式:一条横幅、一个回家的出口,外加三个浮层 ——
    // 留言、制图桌上的岛屿名片、码头上的伴手礼。没有"我的岛屿"面板
    const who = el('span', { className: 'who', textContent: `参观中 · ${opts.visiting.name}` });
    const back = el('button', { type: 'button', textContent: '返回我的岛' });
    back.addEventListener('click', () => {
      // 去掉 ?visit= 后整页重载,回到自己的存档
      window.location.href = window.location.pathname;
    });
    const bar = el('div', { className: 'pill', id: 'island-visitbar' }, [who]);
    let openCount = 0;
    const track = (open: boolean): void => { openCount = Math.max(0, openCount + (open ? 1 : -1)); };
    // 走短 id 时岛名要等网络回来,所以凡是要显示岛名的地方都得等到真正显示时再取
    let visitingName = opts.visiting.name;

    // ---- 岛屿名片:客人在制图桌前能读到的东西。纯本地计算,不需要服务端 ----
    const cardName = el('p', { className: 'sub' });
    const cardLevel = el('p', { className: 'levelline' });
    const cardBar = el('i');
    const cardList = el('div', { className: 'checklist' });
    const islandCard = createModal(root, '岛屿名片', [
      cardName,
      cardLevel,
      el('div', { className: 'bar' }, [cardBar]),
      el('label', { textContent: '待客清单' }),
      cardList,
    ], track);

    function openIslandCard(): void {
      const info = opts.getHospitality();
      cardName.textContent = `「${visitingName}」· 第 ${info.day} 天`;
      cardLevel.textContent = '';
      cardLevel.append(
        el('b', { textContent: `Lv.${info.level}` }),
        el('span', { textContent: `/ ${info.maxLevel} · 待客清单 ${info.items.filter((i) => i.done).length}/${info.items.length}` }),
      );
      const done = info.items.reduce((sum, i) => sum + (i.done ? i.points : 0), 0);
      const total = info.items.reduce((sum, i) => sum + i.points, 0);
      cardBar.style.width = `${Math.round((done / total) * 100)}%`;
      renderChecklist(cardList, info.items);
      islandCard.open();
    }

    // ---- 留言与伴手礼:都要写服务端,长码参观时没有可写的地方 ----
    const shortId = opts.visiting.shortId;
    if (!shortId) {
      bar.append(back);
      root.append(bar);
      return {
        get open() { return openCount > 0; },
        setVisitingName(name: string) { visitingName = name; who.textContent = `参观中 · ${name}`; },
        openIslandCard,
        // 长码参观没有服务端,礼物无处可放。名片照看不误
        openGift() { islandCard.close(); openIslandCard(); },
      };
    }

    const textInput = el('input', {
      type: 'text', maxLength: 60, placeholder: '写一句话给岛主(最多 60 字)',
    });
    const sendBtn = el('button', { className: 'btn', type: 'button', textContent: '留下' });
    const guestNote = el('p', { className: 'note' });
    const guestSub = el('p', { className: 'sub' });
    const messageModal = createModal(root, '留言', [
      guestSub,
      el('div', { className: 'row' }, [textInput, sendBtn]),
      guestNote,
    ], track);

    const leave = el('button', { type: 'button', id: 'island-leave', textContent: '留言' });
    leave.addEventListener('click', () => {
      textInput.value = '';
      guestNote.textContent = '';
      guestNote.className = 'note';
      // 署名和岛名都在打开这一刻才确定:名字可能刚从网络回来,自己的岛也可能刚发布
      guestSub.textContent = `给「${visitingName}」留句话。${opts.getShareId()
        ? `将以「${opts.getIslandName()}」的名义署名`
        : '你还没发布过自己的岛,会记作「路过的客人」'}`;
      messageModal.open();
      textInput.focus();
    });

    const send = async (): Promise<void> => {
      const text = textInput.value.trim();
      if (!text) return;
      sendBtn.disabled = true;
      const result = await postMessage(shortId, text, opts.getShareId(), opts.getToken());
      sendBtn.disabled = false;
      if (result.ok) {
        guestNote.textContent = '留言已留下 · 岛主下次回来就能看到';
        guestNote.className = 'note good';
        textInput.value = '';
        window.setTimeout(messageModal.close, 1200);
        return;
      }
      guestNote.className = 'note bad';
      guestNote.textContent = result.reason === 'rate'
        ? '说得太快了,过几秒再试'
        : result.reason === 'offline'
          ? '连不上服务器,留言没能送出去'
          : '这条留言没能送出去';
    };
    sendBtn.addEventListener('click', () => { void send(); });
    textInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') void send(); });
    bar.append(leave);

    // ---- 伴手礼:从自己背包里拿一件放在主人岛上 ----
    // 东西是真的从自己家里扣的,所以先送成功、再扣 —— 顺序反了会凭空少东西
    const giftSub = el('p', { className: 'sub' });
    const giftRow = el('div', { className: 'gifts' });
    const giftNote = el('p', { className: 'note' });
    const giftSend = el('button', { className: 'btn wide', type: 'button', textContent: '留下这件' });
    const giftModal = createModal(root, '伴手礼', [giftSub, giftRow, giftNote, giftSend], track);
    let picked = '';

    function renderGiftRow(): void {
      const items = opts.getGiftable().filter((i) => i.count > 0);
      giftRow.textContent = '';
      if (items.length === 0) {
        picked = '';
        giftRow.append(el('p', { className: 'note', textContent: '背包是空的 · 回自己岛上采点东西再来' }));
        giftSend.disabled = true;
        return;
      }
      if (!items.some((i) => i.kind === picked)) picked = items[0].kind;
      for (const item of items) {
        const btn = el('button', {
          className: picked === item.kind ? 'gift picked' : 'gift', type: 'button',
        }, [
          el('span', { textContent: item.label }),
          el('span', { className: 'n', textContent: `×${item.count}` }),
        ]);
        btn.addEventListener('click', () => { picked = item.kind; renderGiftRow(); });
        giftRow.append(btn);
      }
      giftSend.disabled = false;
    }

    function openGift(): void {
      giftNote.textContent = '';
      giftNote.className = 'note';
      giftSub.textContent = `从背包里挑一件留给「${visitingName}」。${opts.getShareId()
        ? `会署上「${opts.getIslandName()}」的名字`
        : '你还没发布过自己的岛,会记作「路过的客人」'}`;
      renderGiftRow();
      giftModal.open();
    }

    giftSend.addEventListener('click', () => {
      void (async (): Promise<void> => {
        if (!picked) return;
        giftSend.disabled = true;
        const result = await postGift(shortId, picked, opts.getShareId(), opts.getToken());
        giftSend.disabled = false;
        if (result.ok) {
          opts.onGiftSent(picked);
          giftNote.textContent = '放下了 · 岛主下次回来就能领到';
          giftNote.className = 'note good';
          renderGiftRow();
          window.setTimeout(giftModal.close, 1200);
          return;
        }
        giftNote.className = 'note bad';
        giftNote.textContent = result.reason === 'rate'
          ? '刚放过一件,过几秒再来'
          : result.reason === 'full'
            ? '岛上堆的伴手礼还没被领走,先等岛主回来'
            : result.reason === 'offline'
              ? '连不上服务器,这件东西没送出去'
              : '这件东西没能送出去';
      })();
    });

    bar.append(back);
    root.append(bar);
    return {
      get open() { return openCount > 0; },
      setVisitingName(name: string) {
        visitingName = name;
        who.textContent = `参观中 · ${name}`;
      },
      openIslandCard,
      openGift,
    };
  }

  const state = {
    open: false,
    setVisitingName() { /* 自己岛上没有横幅可更新 */ },
    // 这两个入口只属于参观模式:自己岛上的制图桌是航海图,码头是出发点
    openIslandCard() { /* 自己的岛不用看名片 */ },
    openGift() { /* 不能给自己送伴手礼 */ },
  };

  const trigger = el('button', {
    id: 'island-trigger', type: 'button', textContent: '我的岛屿',
  });
  topRightRail().append(trigger);

  const nameInput = el('input', { type: 'text', maxLength: 12, placeholder: '给这座岛起个名字' });
  const linkInput = el('input', { type: 'text', readOnly: true });
  const visitInput = el('input', { type: 'text', placeholder: '粘贴岛屿码或邀请链接' });
  const copyBtn = el('button', { className: 'btn', type: 'button', textContent: '复制' });
  const goBtn = el('button', { className: 'btn', type: 'button', textContent: '前往' });
  const shortenBtn = el('button', { className: 'btn ghost wide', type: 'button', textContent: '换成短链接' });
  const visitorLine = el('p', { className: 'note' });
  const guestbookLabel = el('label', { textContent: '留言板' });
  const guestbook = el('div', { className: 'guestbook' });
  const giftLine = el('p', { className: 'note' });
  const claimBtn = el('button', { className: 'btn wide', type: 'button', textContent: '领取伴手礼' });
  const levelLine = el('p', { className: 'levelline' });
  const levelBar = el('i');
  // 等级到底有什么用:能留住几个人。这一行是住客系统对玩家唯一的说明入口
  const residentLine = el('p', { className: 'note' });
  const checklist = el('div', { className: 'checklist' });
  const note = el('p', { className: 'note' });
  const closeBtn = el('button', { className: 'btn ghost close', type: 'button', textContent: '关闭' });

  const card = el('div', { className: 'card' }, [
    el('h2', { textContent: '岛屿' }),
    el('p', { className: 'sub', textContent: '把链接发给朋友,他们就能来你的岛上走走。' }),
    levelLine,
    el('div', { className: 'bar' }, [levelBar]),
    residentLine,
    el('label', { textContent: '待客清单' }),
    checklist,
    el('label', { textContent: '岛屿名字' }),
    nameInput,
    el('label', { textContent: '邀请链接' }),
    el('div', { className: 'row' }, [linkInput, copyBtn]),
    shortenBtn,
    visitorLine,
    giftLine,
    claimBtn,
    guestbookLabel,
    guestbook,
    el('label', { textContent: '参观别人的岛' }),
    el('div', { className: 'row' }, [visitInput, goBtn]),
    note,
    closeBtn,
  ]);
  const backdrop = el('div', { className: 'backdrop' }, [card]);

  function inviteLink(): string {
    const { origin, pathname } = window.location;
    // 有短 id 就用短链接;没有就把整座岛编进链接里 —— 后者不需要服务端,永远可用
    const token = opts.getShareId() || opts.getIslandCode();
    return `${origin}${pathname}?visit=${token}`;
  }

  function setNote(text: string, tone: '' | 'bad' | 'good' = ''): void {
    note.textContent = text;
    note.className = `note ${tone}`.trim();
  }

  // 待客清单:等级就是这张表。玩家看到的"下一级差什么"和客人真正能做的事是同一件事
  function renderHospitality(): void {
    const info = opts.getHospitality();
    const done = info.items.reduce((sum, i) => sum + (i.done ? i.points : 0), 0);
    const total = info.items.reduce((sum, i) => sum + i.points, 0);
    levelLine.textContent = '';
    levelLine.append(
      el('b', { textContent: `Lv.${info.level}` }),
      el('span', { textContent: `/ ${info.maxLevel} · 客人能做的事 ${info.items.filter((i) => i.done).length}/${info.items.length}` }),
    );
    levelBar.style.width = `${Math.round((done / total) * 100)}%`;
    // 等级的实际用途:能留住几个人。不说这句的话,玩家不知道为什么没人来
    residentLine.className = 'note';
    if (info.capacity === 0) {
      residentLine.textContent = '这座岛还养不活别人 —— 把清单再勾上几项,就会有人漂过来。';
    } else if (info.residents >= info.capacity) {
      residentLine.textContent = `住客 ${info.residents}/${info.capacity} · 已经住满了,再提升等级才能多留一个人。`;
    } else {
      residentLine.textContent = `住客 ${info.residents}/${info.capacity} · 还能再留 ${info.capacity - info.residents} 个人,过几天会有人漂到码头。`;
    }
    renderChecklist(checklist, info.items);
  }

  // 伴手礼:没有就整块藏起来,别让空栏目占着地方
  function renderGifts(count: number): void {
    const show = !!opts.getShareId() && count > 0;
    giftLine.style.display = show ? '' : 'none';
    claimBtn.style.display = show ? '' : 'none';
    claimBtn.disabled = false;
    claimBtn.textContent = '领取伴手礼';
    if (show) giftLine.textContent = `客人留下了 ${count} 件伴手礼`;
  }

  claimBtn.addEventListener('click', () => {
    void (async (): Promise<void> => {
      claimBtn.disabled = true;
      claimBtn.textContent = '正在领取…';
      const result = await claimGifts(opts.getShareId(), opts.getToken());
      if (!result) {
        claimBtn.disabled = false;
        claimBtn.textContent = '领取伴手礼';
        setNote('领不到,服务器没响应', 'bad');
        return;
      }
      opts.onGiftsClaimed(result.claimed);
      renderGifts(0);
      setNote(result.claimed.length > 0 ? '伴手礼已经收进背包' : '已经没有可领的了', 'good');
    })();
  });

  // 留言板。文本一律走 textContent —— 别人写的内容永远不当 HTML 解析
  function renderGuestbook(messages: IslandMessage[]): void {
    guestbook.textContent = '';
    const visible = opts.getShareId() ? messages : [];
    guestbookLabel.style.display = opts.getShareId() ? '' : 'none';
    guestbook.style.display = opts.getShareId() ? '' : 'none';
    if (!opts.getShareId()) return;
    if (visible.length === 0) {
      guestbook.append(el('p', { className: 'note', textContent: '还没有人留言' }));
      return;
    }
    for (const message of [...visible].reverse()) {
      const del = el('button', { className: 'del', type: 'button', textContent: '删除', title: '删掉这条留言' });
      del.addEventListener('click', async () => {
        del.disabled = true;
        const result = await deleteMessage(opts.getShareId(), message.id, opts.getToken());
        if (result) renderGuestbook(result.messages);
        else { del.disabled = false; setNote('删不掉,服务器没响应', 'bad'); }
      });
      guestbook.append(el('div', { className: 'msg' }, [
        el('div', { className: 'msg-head' }, [
          // 未验证署名的一律显示成"路过的客人",不给冒名留任何余地
          el('span', {
            className: message.fromIsland ? 'msg-from verified' : 'msg-from',
            textContent: message.fromName,
          }),
          el('span', { className: 'msg-time', textContent: timeAgo(message.at) }),
          del,
        ]),
        el('p', { className: 'msg-text', textContent: message.text }),
      ]));
    }
  }

  // 发布 / 刷新短链。已经有 id 时重发一次,让客人看到的是岛现在的样子而不是上周的
  async function publish(announce: boolean): Promise<void> {
    const had = opts.getShareId();
    if (announce) shortenBtn.textContent = '正在生成…';
    const result = await publishIsland(opts.getIslandCode(), opts.getToken());
    if (announce) shortenBtn.textContent = '换成短链接';
    if (!result.ok) {
      // 三种失败要说三种话:连不上 ≠ 岛不是你的 ≠ 服务端不收
      if (result.reason === 'notMine') {
        // 凭证对不上就别再拿旧短链当自己的:那条链接现在指向别人的岛
        opts.setShareId('');
        linkInput.value = inviteLink();
        shortenBtn.style.display = '';
        setNote('这座岛的凭证不在这台设备上(存档清过?),先用长链接分享', 'bad');
      } else if (announce) {
        setNote(result.reason === 'offline'
          ? '短链服务连不上,先用长链接吧 —— 一样能用'
          : '短链服务没能收下这座岛,先用长链接吧', 'bad');
      }
      return;
    }
    const island = result.island;
    if (island.id !== had) opts.setShareId(island.id);
    if (island.token && island.token !== opts.getToken()) opts.setToken(island.token);
    linkInput.value = inviteLink();
    shortenBtn.style.display = 'none';
    if (announce) setNote('已换成短链接', 'good');
    visitorLine.textContent = island.visits > 0 ? `已有 ${island.visits} 位客人来过` : '还没有人来过';
    renderGuestbook(island.messages ?? []);
    renderGifts((island.gifts ?? []).length);
  }

  function setOpen(open: boolean): void {
    state.open = open;
    if (!open) { backdrop.remove(); return; }
    nameInput.value = opts.getIslandName();
    linkInput.value = inviteLink();
    visitInput.value = '';
    setNote('');
    visitorLine.textContent = '';
    renderHospitality();
    renderGuestbook([]);
    renderGifts(0);
    // 已经发布过就静默刷新一次(顺带取回到访数与留言);没发布过就把按钮留给玩家自己按
    shortenBtn.style.display = opts.getShareId() ? 'none' : '';
    if (opts.getShareId()) void publish(false);
    root.append(backdrop);
    nameInput.focus();
  }

  trigger.addEventListener('click', () => setOpen(true));
  closeBtn.addEventListener('click', () => setOpen(false));
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) setOpen(false); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.open) setOpen(false); });

  nameInput.addEventListener('input', () => {
    const name = nameInput.value.trim();
    opts.setIslandName(name || '无名小岛');
    linkInput.value = inviteLink();
  });

  copyBtn.addEventListener('click', async () => {
    const link = inviteLink();
    try {
      await navigator.clipboard.writeText(link);
      setNote('链接已复制', 'good');
    } catch {
      // 没有剪贴板权限(http 或旧浏览器)时,退回到"选中让用户自己复制"
      linkInput.select();
      setNote('已选中链接,按 Cmd/Ctrl+C 复制', '');
    }
  });

  shortenBtn.addEventListener('click', () => { void publish(true); });

  goBtn.addEventListener('click', () => {
    const target = readVisitTarget(visitInput.value);
    if (!target) { setNote('这不是有效的岛屿码或邀请链接', 'bad'); return; }
    setNote(target.snapshot ? `正在前往「${target.snapshot.name}」…` : '正在打开…', 'good');
    // 长码就用规范编码进去,短 id 原样带走 —— 不管用户粘的是链接还是裸码都归一化到同一条路
    const token = target.shortId ?? encodeIslandCode(target.snapshot!);
    window.location.href = `${window.location.pathname}?visit=${token}`;
  });

  return state;
}
