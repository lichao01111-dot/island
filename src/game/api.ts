// 短链服务的客户端。
//
// 设计前提:**这一层随时可以不存在**。游戏本体是一个静态页面,岛屿长码把
// 全部数据编在链接里,没有服务端也能分享和参观。这里做的只是"锦上添花":
// 把 400 字的链接换成 6 个字符,顺带告诉岛主有多少人来过。
// 所以每个函数失败时都安静地返回 null,由调用方回退到长码,绝不弹错误打断游戏。
const TIMEOUT_MS = 6000;

export interface IslandMessage {
  id: string;
  text: string;
  fromName: string;
  fromIsland: string | null;  // 非 null 表示这条留言的署名是服务端验证过的
  at: number;
}

/** 客人放在岛上、等岛主回来领的一件东西。kind 是材料标识,服务端不解释它 */
export interface IslandGift {
  id: string;
  kind: string;
  fromName: string;
  fromIsland: string | null;
  at: number;
}

export interface PublishedIsland {
  id: string;
  /** 岛主凭证。只有首次发布时是新的,之后原样返回你发过去的那枚 */
  token: string;
  visits: number;
  messages: IslandMessage[];
  gifts: IslandGift[];
}

export interface FetchedIsland {
  code: string;
  name: string;
  day: number;
  visits: number;
  messages: IslandMessage[];
  /** 只有件数:伴手礼的清单要凭岛主令牌领取时才展开 */
  giftCount: number;
}

interface RawResult<T> { status: number; data: T | null }

async function rawRequest<T>(path: string, init?: RequestInit): Promise<RawResult<T> | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(path, {
      ...init,
      signal: controller.signal,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
    const data = await res.json().catch(() => null) as T | null;
    return { status: res.status, data };
  } catch {
    // 网络不通、服务端没部署、被拦截 —— 一律当作"没有短链服务"
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T | null> {
  const result = await rawRequest<T>(path, init);
  return result && result.status >= 200 && result.status < 300 ? result.data : null;
}

/**
 * 把岛屿码存到服务端换一个短 id。同一座岛(同种子)重复发布会更新原记录,不会攒出一堆链接。
 * 更新必须带上岛主凭证 —— 种子是公开的,没有凭证的话谁拿到你的链接都能覆盖你的岛。
 */
export type PublishResult =
  | { ok: true; island: PublishedIsland }
  // notMine:服务端上这座岛已经属于别人(通常是本机存档被清过、凭证丢了)
  | { ok: false; reason: 'notMine' | 'rejected' | 'offline' };

export async function publishIsland(code: string, token: string): Promise<PublishResult> {
  const result = await rawRequest<PublishedIsland>('api/islands', {
    method: 'POST',
    body: JSON.stringify(token ? { code, token } : { code }),
  });
  if (!result) return { ok: false, reason: 'offline' };
  // 403 不是"连不上",别拿网络问题糊弄玩家 —— 这两种情况该说的话完全不同
  if (result.status === 403) return { ok: false, reason: 'notMine' };
  if (result.status < 200 || result.status >= 300 || !result.data) {
    return { ok: false, reason: 'rejected' };
  }
  return { ok: true, island: result.data };
}

/**
 * 在别人的岛上留言。
 * from/fromToken 是自己的岛和凭证:验证通过才会用自己的岛名署名,
 * 没有(还没发布过自己的岛)就记作"路过的客人"。冒名顶替在服务端就不成立。
 */
export type PostMessageResult =
  | { ok: true; messages: IslandMessage[] }
  | { ok: false; reason: 'rate' | 'rejected' | 'offline' };

export async function postMessage(
  id: string, text: string, from: string, fromToken: string
): Promise<PostMessageResult> {
  const result = await rawRequest<{ messages: IslandMessage[] }>(
    `api/islands/${encodeURIComponent(id)}/messages`,
    {
      method: 'POST',
      body: JSON.stringify({ text, from: from || undefined, fromToken: fromToken || undefined }),
    }
  );
  if (!result) return { ok: false, reason: 'offline' };
  // 429 要和别的失败分开:这个能靠"等几秒再说"解决,不该让玩家以为是坏了
  if (result.status === 429) return { ok: false, reason: 'rate' };
  if (result.status < 200 || result.status >= 300 || !result.data) {
    return { ok: false, reason: 'rejected' };
  }
  return { ok: true, messages: result.data.messages };
}

/**
 * 在别人的岛上留下一件伴手礼。一次一件 —— 数量由放了几次表达。
 * 署名规则和留言完全一样:验证过的才用自己的岛名。
 */
export type PostGiftResult =
  | { ok: true; giftCount: number }
  | { ok: false; reason: 'rate' | 'full' | 'rejected' | 'offline' };

export async function postGift(
  id: string, kind: string, from: string, fromToken: string
): Promise<PostGiftResult> {
  const result = await rawRequest<{ giftCount: number }>(
    `api/islands/${encodeURIComponent(id)}/gifts`,
    {
      method: 'POST',
      body: JSON.stringify({ kind, from: from || undefined, fromToken: fromToken || undefined }),
    }
  );
  if (!result) return { ok: false, reason: 'offline' };
  if (result.status === 429) return { ok: false, reason: 'rate' };
  // 409 = 岛上堆的伴手礼还没被领走。这条要单独说:客人再点多少次也没用
  if (result.status === 409) return { ok: false, reason: 'full' };
  if (result.status < 200 || result.status >= 300 || !result.data) {
    return { ok: false, reason: 'rejected' };
  }
  return { ok: true, giftCount: result.data.giftCount };
}

/**
 * 岛主一次领走岛上全部伴手礼:服务端先把清单给出来再清空。
 * 注意这一步不可重放 —— 如果响应在路上丢了,这批礼物就领不回来了。
 * 之所以接受这个风险:重试机制要在服务端存"领取批次",
 * 而这层随时可以不存在,不值得为此长出状态机。
 */
export function claimGifts(id: string, token: string): Promise<{ claimed: IslandGift[] } | null> {
  return request<{ claimed: IslandGift[] }>(
    `api/islands/${encodeURIComponent(id)}/gifts`,
    { method: 'DELETE', body: JSON.stringify({ token }) }
  );
}

/** 岛主删掉自己岛上的一条留言 */
export function deleteMessage(
  id: string, messageId: string, token: string
): Promise<{ messages: IslandMessage[] } | null> {
  return request<{ messages: IslandMessage[] }>(
    `api/islands/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}`,
    { method: 'DELETE', body: JSON.stringify({ token }) }
  );
}

/** 按短 id 取回一座岛 */
export function fetchIsland(id: string): Promise<FetchedIsland | null> {
  return request<FetchedIsland>(`api/islands/${encodeURIComponent(id)}`);
}

/** 记一次到访。岛主自己回家不算 —— 调用方负责判断 */
export function countVisit(id: string): Promise<{ visits: number } | null> {
  return request<{ visits: number }>(`api/islands/${encodeURIComponent(id)}/visits`, {
    method: 'POST',
  });
}
