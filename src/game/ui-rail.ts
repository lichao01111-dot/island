// 右上角的入口按钮竖列(航海图、我的岛屿……)。
// 以前每个按钮各自 position:fixed 钉一个 top:它们靠手算的间距错开,
// 字号一变、文案一长、或者再加一个入口就会叠在一起。现在交给同一个 flex 列排。
const RAIL_ID = 'ui-rail';

// z-index 夹在 HUD 画布(10)和两个面板(#island-ui 20 / .exp-overlay 40)之间:
// 高过画布才点得到,低过面板才不会浮在打开的卡片上面。
const STYLE = `
#${RAIL_ID} { position: fixed; right: calc(16px + env(safe-area-inset-right)); top: calc(84px + env(safe-area-inset-top)); z-index: 12;
  display: flex; flex-direction: column; align-items: flex-end; gap: 8px; pointer-events: none; }
#${RAIL_ID} > * { pointer-events: auto; }
#${RAIL_ID} > [hidden] { display: none; }
@media (max-width: 700px) { #${RAIL_ID} { right: calc(12px + env(safe-area-inset-right)); top: calc(124px + env(safe-area-inset-top)); } }
`;

/** 拿到右上角按钮列,第一次调用时建好。挂进来的按钮用 order 决定先后 */
export function topRightRail(): HTMLElement {
  const existing = document.getElementById(RAIL_ID);
  if (existing) return existing;

  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const rail = document.createElement('div');
  rail.id = RAIL_ID;
  document.body.appendChild(rail);
  return rail;
}
